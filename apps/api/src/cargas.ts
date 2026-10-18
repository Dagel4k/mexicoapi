import {
  type AutoridadCurada,
  type CoberturaSerie,
  esFechaIsoValida,
  type FechaISO,
  type FuenteDof,
  type TipoCambioFix,
  type TipoDiaCurado,
  type Udi,
  type Uma,
} from "@mexicoapi/core";
import {
  type CalendarioCurado,
  crearCalendarioCurado,
  type DatosCalendarioCurado,
  type PlazoCalendario,
} from "@mexicoapi/core/curados";
import type { Entorno } from "./entorno.js";
import { descartar, pedirAsset } from "./estaticos.js";

// Copia de los tipos que escribe el build del sitio; el Worker no importa el pipeline.
export interface FuenteMeta {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
}

export interface Meta {
  dataset: string;
  as_of: string;
  sources: FuenteMeta[];
  docs: string;
}

export interface DatasetInterno {
  meta: Meta;
  records: number;
  data_sha256: string;
  frescura_horas: number;
  /** Solo en las series (FIX y UDIS): fechas del primer y del último registro. */
  cobertura?: CoberturaSerie;
}

/** Un dataset curado: lo capturan personas desde el DOF, así que no tiene frescura. */
export interface DatasetCurado {
  meta: Meta;
  records: number;
  data_sha256: string;
}

export interface MetaInterna {
  datasets: Record<string, DatasetInterno>;
  /** Por id (`dias-inhabiles.sat`); quien lo necesita falla si falta. */
  curados?: Record<string, DatasetCurado>;
}

export interface BancoCatalogo {
  codigo: string;
  nombre_corto: string;
  activo: boolean;
}

type Objeto = Record<string, unknown>;

const esObjeto = (v: unknown): v is Objeto =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const sonTextos = (o: Objeto, campos: readonly string[]): boolean =>
  campos.every((campo) => typeof o[campo] === "string");

const esFuente = (v: unknown): boolean =>
  esObjeto(v) && sonTextos(v, ["name", "url", "license", "license_url", "citation"]);

const esMeta = (v: unknown): boolean =>
  esObjeto(v) &&
  sonTextos(v, ["dataset", "as_of", "docs"]) &&
  Array.isArray(v.sources) &&
  v.sources.every(esFuente);

const esFecha = (v: unknown): v is FechaISO => typeof v === "string" && esFechaIsoValida(v);

/** `{desde, hasta}` con fechas reales y en orden. */
const esRango = (v: unknown): v is CoberturaSerie =>
  esObjeto(v) && esFecha(v.desde) && esFecha(v.hasta) && v.desde <= v.hasta;

const esDatasetCurado = (v: unknown): v is Objeto =>
  esObjeto(v) &&
  esMeta(v.meta) &&
  typeof v.records === "number" &&
  typeof v.data_sha256 === "string";

const esDatasetInterno = (v: unknown): boolean =>
  esDatasetCurado(v) &&
  typeof v.frescura_horas === "number" &&
  (v.cobertura === undefined || esRango(v.cobertura));

async function leerJson(entorno: Entorno, ruta: string): Promise<unknown> {
  const respuesta = await pedirAsset(entorno, ruta);
  if (respuesta.status !== 200) {
    await descartar(respuesta);
    throw new Error(`El asset ${ruta} respondió ${respuesta.status}.`);
  }
  return respuesta.json();
}

function aMetaInterna(valor: unknown): MetaInterna {
  if (!esObjeto(valor) || !esObjeto(valor.datasets)) {
    throw new Error("El meta interno no tiene datasets.");
  }
  if (!Object.values(valor.datasets).every(esDatasetInterno)) {
    throw new Error("El meta interno tiene un dataset con forma inesperada.");
  }
  const { curados } = valor;
  if (
    curados !== undefined &&
    !(esObjeto(curados) && Object.values(curados).every(esDatasetCurado))
  ) {
    throw new Error("El meta interno tiene un dataset curado con forma inesperada.");
  }
  return congelar(valor) as unknown as MetaInterna;
}

/** Lo que vive entre peticiones no se puede alterar desde una de ellas. */
export function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

/**
 * Vista de solo lectura de un Map: no tiene `set`, `delete` ni `clear`, y como no es un Map,
 * `Map.prototype.set.call(vista, …)` lanza TypeError.
 */
class MapaCongelado<K, V> implements ReadonlyMap<K, V> {
  readonly #mapa: Map<K, V>;

  constructor(mapa: Map<K, V>) {
    this.#mapa = mapa;
    Object.freeze(this);
  }

  get size(): number {
    return this.#mapa.size;
  }

  get(clave: K): V | undefined {
    return this.#mapa.get(clave);
  }

  has(clave: K): boolean {
    return this.#mapa.has(clave);
  }

  forEach(fn: (valor: V, clave: K, mapa: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [clave, valor] of this.#mapa) fn.call(thisArg, valor, clave, this);
  }

  entries(): MapIterator<[K, V]> {
    return this.#mapa.entries();
  }

  keys(): MapIterator<K> {
    return this.#mapa.keys();
  }

  values(): MapIterator<V> {
    return this.#mapa.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#mapa.entries();
  }
}

function aCatalogo(valor: unknown): ReadonlyMap<string, BancoCatalogo> {
  if (!esObjeto(valor) || !Array.isArray(valor.data)) {
    throw new Error("El shard de bancos no tiene data.");
  }
  const catalogo = new Map<string, BancoCatalogo>();
  for (const b of valor.data as unknown[]) {
    if (
      !esObjeto(b) ||
      !sonTextos(b, ["codigo", "nombre_corto"]) ||
      typeof b.activo !== "boolean"
    ) {
      throw new Error("El shard de bancos tiene un registro con forma inesperada.");
    }
    const { codigo, nombre_corto, activo } = b as unknown as BancoCatalogo;
    catalogo.set(codigo, Object.freeze({ codigo, nombre_corto, activo }));
  }
  return new MapaCongelado(catalogo);
}

/** Un año de una serie, como lo escribe el build: el tramo que cubre y sus registros. */
export interface ShardSerie<T> {
  readonly tramo: CoberturaSerie;
  readonly datos: readonly T[];
}

interface DefinicionSerie<T> {
  carpeta: string;
  /** El registro con solo sus campos, o undefined si no tiene la forma esperada. */
  registro: (v: Objeto) => T | undefined;
  fecha: (r: T) => FechaISO;
}

const VALOR_FIX = /^\d+\.\d{4}$/;
const VALOR_UDI = /^\d+\.\d{6}$/;

const SERIE_FIX: DefinicionSerie<TipoCambioFix> = {
  carpeta: "fix",
  registro: ({ fecha_publicacion, valor }) =>
    esFecha(fecha_publicacion) && typeof valor === "string" && VALOR_FIX.test(valor)
      ? { fecha_publicacion, valor }
      : undefined,
  fecha: (r) => r.fecha_publicacion,
};

const SERIE_UDIS: DefinicionSerie<Udi> = {
  carpeta: "udis",
  registro: ({ fecha, valor }) =>
    esFecha(fecha) && typeof valor === "string" && VALOR_UDI.test(valor)
      ? { fecha, valor }
      : undefined,
  fecha: (r) => r.fecha,
};

/**
 * Revisa un shard anual: el tramo cae dentro de su año y los registros van en orden estricto
 * dentro del tramo. Lo que no cumple falla en vez de llegar a una consulta.
 */
function aShard<T>(valor: unknown, anio: string, serie: DefinicionSerie<T>): ShardSerie<T> {
  const nombre = `${serie.carpeta}/${anio}`;
  if (!esObjeto(valor) || !esRango(valor.tramo) || !Array.isArray(valor.datos)) {
    throw new Error(`El shard ${nombre} no tiene tramo y datos.`);
  }
  const { desde, hasta } = valor.tramo;
  if (!desde.startsWith(`${anio}-`) || !hasta.startsWith(`${anio}-`)) {
    throw new Error(`El tramo del shard ${nombre} sale de su año.`);
  }
  const datos: T[] = [];
  let anterior = "";
  for (const v of valor.datos as unknown[]) {
    const registro = esObjeto(v) ? serie.registro(v) : undefined;
    if (registro === undefined) {
      throw new Error(`El shard ${nombre} tiene un registro con forma inesperada.`);
    }
    const fecha = serie.fecha(registro);
    if (fecha < desde || fecha > hasta || fecha <= anterior) {
      throw new Error(`El shard ${nombre} tiene un registro fuera del tramo o fuera de orden.`);
    }
    anterior = fecha;
    datos.push(Object.freeze(registro));
  }
  return Object.freeze({
    tramo: Object.freeze({ desde, hasta }),
    datos: Object.freeze(datos),
  });
}

/** Año de una fecha ISO, como número. */
export const anioDe = (fecha: FechaISO): number => Number(fecha.slice(0, 4));

/** Cita de un valor curado: los cuatro campos, con una fecha de publicación que existe. */
function aFuenteDof(v: unknown): FuenteDof | undefined {
  if (
    !esObjeto(v) ||
    !sonTextos(v, ["nombre", "url", "fragmento"]) ||
    !esFecha(v.fecha_publicacion)
  ) {
    return undefined;
  }
  const { nombre, url, fecha_publicacion, fragmento } = v as unknown as FuenteDof;
  return Object.freeze({ nombre, url, fecha_publicacion, fragmento });
}

const TIPOS_DIA: ReadonlySet<unknown> = new Set(["descanso", "vacaciones"]);

type DiaCurado = DatosCalendarioCurado["dias"][number];

function aDiaCurado(v: unknown): DiaCurado | undefined {
  if (!esObjeto(v) || !esFecha(v.fecha) || typeof v.motivo !== "string" || !TIPOS_DIA.has(v.tipo)) {
    return undefined;
  }
  const fuente = aFuenteDof(v.fuente);
  if (fuente === undefined) return undefined;
  return { fecha: v.fecha, motivo: v.motivo, tipo: v.tipo as TipoDiaCurado, fuente };
}

function aPlazo(v: unknown): PlazoCalendario | undefined {
  if (
    !esObjeto(v) ||
    !esRango(v.cobertura) ||
    !Array.isArray(v.excluir_tipos) ||
    !v.excluir_tipos.every((tipo) => TIPOS_DIA.has(tipo))
  ) {
    return undefined;
  }
  const { desde, hasta } = v.cobertura;
  return { cobertura: { desde, hasta }, excluir_tipos: v.excluir_tipos as TipoDiaCurado[] };
}

/** Cada valor de `v` con `leer`, o undefined si alguno no tiene la forma. Conserva las llaves. */
function cadaValor<T>(
  v: Objeto,
  leer: (valor: unknown) => T | undefined,
): Record<string, T> | undefined {
  const leidos: [string, T][] = [];
  for (const [llave, valor] of Object.entries(v)) {
    const leido = leer(valor);
    if (leido === undefined) return undefined;
    leidos.push([llave, leido]);
  }
  // fromEntries define cada llave, también `__proto__`, que así llega al núcleo y la rechaza.
  return Object.fromEntries(leidos);
}

/**
 * Revisa la forma del JSON del calendario de una autoridad y lo arma con el núcleo, que exige sus
 * reglas (los plazos y su cobertura, las fuentes de los fines de semana de cada año, los días en
 * orden y dentro de la cobertura). Lo que no cumple falla en vez de llegar a un plazo legal.
 */
function aCalendarioCurado(valor: unknown, autoridad: AutoridadCurada): CalendarioCurado {
  const nombre = `calendarios/${autoridad}`;
  if (
    !esObjeto(valor) ||
    valor.autoridad !== autoridad ||
    !esObjeto(valor.plazos) ||
    !esObjeto(valor.fuentes_fin_de_semana) ||
    !Array.isArray(valor.dias)
  ) {
    throw new Error(`El shard ${nombre} no tiene autoridad, plazos, fuentes y días.`);
  }
  const plazos = cadaValor(valor.plazos, aPlazo);
  const fuentes = cadaValor(valor.fuentes_fin_de_semana, aFuenteDof);
  const dias = (valor.dias as unknown[]).map(aDiaCurado);
  if (plazos === undefined || fuentes === undefined || dias.includes(undefined)) {
    throw new Error(`El shard ${nombre} tiene un plazo, una fuente o un día con forma inesperada.`);
  }
  return crearCalendarioCurado({
    autoridad,
    plazos,
    fuentes_fin_de_semana: fuentes,
    dias: dias as DiaCurado[],
  });
}

const esAnio = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1900 && v <= 2100;

/**
 * `v1/_internos/constantes.json`: carpeta de constantes (`constantes/uma`,
 * `isr/tarifa/mensual`...) → años con shard, en orden estricto.
 */
function aAniosConstantes(valor: unknown): ReadonlyMap<string, readonly number[]> {
  if (!esObjeto(valor)) throw new Error("El índice de años de las constantes no es un objeto.");
  const anios = new Map<string, readonly number[]>();
  for (const [carpeta, lista] of Object.entries(valor)) {
    if (
      !Array.isArray(lista) ||
      lista.length === 0 ||
      !lista.every((anio, i) => esAnio(anio) && (i === 0 || anio > lista[i - 1]))
    ) {
      throw new Error("El índice de años de las constantes tiene una lista inesperada.");
    }
    anios.set(carpeta, Object.freeze([...(lista as number[])]));
  }
  return new MapaCongelado(anios);
}

/** La UMA de cada año, en años consecutivos, con la meta del dataset. */
export interface ListaUma {
  readonly umas: readonly Uma[];
  readonly meta: Meta;
}

const MONTO = /^(?:0|[1-9]\d*)\.\d{2}$/;
const esMonto = (v: unknown): v is string => typeof v === "string" && MONTO.test(v);

/** Una UMA con solo sus campos; rige desde el 1 de febrero de su año. */
function aUma(v: unknown): Uma | undefined {
  if (!esObjeto(v)) return undefined;
  const { anio, diaria, mensual, anual, vigencia_desde } = v;
  const fuente = aFuenteDof(v.fuente);
  if (
    !esAnio(anio) ||
    !esMonto(diaria) ||
    !esMonto(mensual) ||
    !esMonto(anual) ||
    typeof vigencia_desde !== "string" ||
    vigencia_desde !== `${anio}-02-01` ||
    fuente === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ anio, diaria, mensual, anual, vigencia_desde, fuente });
}

/** Un hueco entre años haría responder una UMA que ya no regía: falla en vez de eso. */
function aListaUma(valor: unknown): ListaUma {
  if (
    !esObjeto(valor) ||
    !Array.isArray(valor.data) ||
    valor.data.length === 0 ||
    !esMeta(valor.meta)
  ) {
    throw new Error("La lista de la UMA no tiene data y meta.");
  }
  const umas: Uma[] = [];
  for (const v of valor.data as unknown[]) {
    const uma = aUma(v);
    const anterior = umas[umas.length - 1];
    if (uma === undefined || (anterior !== undefined && uma.anio !== anterior.anio + 1)) {
      throw new Error("La lista de la UMA tiene un registro inesperado o años no consecutivos.");
    }
    umas.push(uma);
  }
  return Object.freeze({
    umas: Object.freeze(umas),
    meta: congelar(valor.meta) as unknown as Meta,
  });
}

// Se guarda el valor y no la promesa: en workerd, una promesa iniciada por una petición que
// se cancela puede no resolverse nunca para las demás. Una falla no se recuerda.
let meta: MetaInterna | undefined;
let bancos: ReadonlyMap<string, BancoCatalogo> | undefined;
// `carpeta/anio` → shard. Solo se piden años dentro de la cobertura, así que a lo más guarda
// los años de cada serie.
const shards = new Map<string, ShardSerie<unknown>>();
const calendarios = new Map<AutoridadCurada, CalendarioCurado>();
let umas: ListaUma | undefined;
let anios: ReadonlyMap<string, readonly number[]> | undefined;

/** `v1/_internos/meta.json`, leído una vez por isolate. */
export async function metaInterna(entorno: Entorno): Promise<MetaInterna> {
  meta ??= aMetaInterna(await leerJson(entorno, "/v1/_internos/meta.json"));
  return meta;
}

/** Código de banco → `{codigo, nombre_corto, activo}`, leído una vez por isolate. */
export async function catalogoBancos(
  entorno: Entorno,
): Promise<ReadonlyMap<string, BancoCatalogo>> {
  bancos ??= aCatalogo(await leerJson(entorno, "/v1/bancos.json"));
  return bancos;
}

async function shardDe<T>(
  entorno: Entorno,
  serie: DefinicionSerie<T>,
  anio: number,
  cobertura: CoberturaSerie,
): Promise<ShardSerie<T>> {
  if (!(anio >= anioDe(cobertura.desde) && anio <= anioDe(cobertura.hasta))) {
    throw new Error(`El año ${anio} está fuera de la cobertura de ${serie.carpeta}.`);
  }
  const texto = String(anio).padStart(4, "0");
  const clave = `${serie.carpeta}/${texto}`;
  let shard = shards.get(clave) as ShardSerie<T> | undefined;
  if (shard === undefined) {
    shard = aShard(await leerJson(entorno, `/v1/_internos/${clave}.json`), texto, serie);
    shards.set(clave, shard);
  }
  return shard;
}

/** `v1/_internos/fix/{anio}.json`, leído una vez por isolate; `anio` debe caer en la cobertura. */
export function shardFix(
  entorno: Entorno,
  anio: number,
  cobertura: CoberturaSerie,
): Promise<ShardSerie<TipoCambioFix>> {
  return shardDe(entorno, SERIE_FIX, anio, cobertura);
}

/** `v1/_internos/udis/{anio}.json`, leído una vez por isolate; `anio` debe caer en la cobertura. */
export function shardUdis(
  entorno: Entorno,
  anio: number,
  cobertura: CoberturaSerie,
): Promise<ShardSerie<Udi>> {
  return shardDe(entorno, SERIE_UDIS, anio, cobertura);
}

/** `v1/_internos/calendarios/{autoridad}.json`, leído una vez por isolate. */
export async function calendarioCurado(
  entorno: Entorno,
  autoridad: AutoridadCurada,
): Promise<CalendarioCurado> {
  let calendario = calendarios.get(autoridad);
  if (calendario === undefined) {
    const valor = await leerJson(entorno, `/v1/_internos/calendarios/${autoridad}.json`);
    calendario = aCalendarioCurado(valor, autoridad);
    calendarios.set(autoridad, calendario);
  }
  return calendario;
}

/** `v1/constantes/uma.json` (todas las UMA con su meta), leído una vez por isolate. */
export async function listaUma(entorno: Entorno): Promise<ListaUma> {
  umas ??= aListaUma(await leerJson(entorno, "/v1/constantes/uma.json"));
  return umas;
}

/** `v1/_internos/constantes.json`, leído una vez por isolate. */
export async function aniosConstantes(
  entorno: Entorno,
): Promise<ReadonlyMap<string, readonly number[]>> {
  anios ??= aAniosConstantes(await leerJson(entorno, "/v1/_internos/constantes.json"));
  return anios;
}

export function reiniciarCargas(): void {
  meta = undefined;
  bancos = undefined;
  shards.clear();
  calendarios.clear();
  umas = undefined;
  anios = undefined;
}
