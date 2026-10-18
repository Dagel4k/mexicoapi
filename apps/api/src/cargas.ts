import {
  type AutoridadCurada,
  type Calendario,
  type CoberturaSerie,
  crearCalendario,
  type DiaInhabil,
  esFechaIsoValida,
  type FechaISO,
  type FuenteDof,
  type TipoCambioFix,
  type TipoDiaCurado,
  type Udi,
  type Uma,
} from "@mexicoapi/core";
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

/** El SAT distingue los plazos de declaraciones y pagos (CFF art. 12, segundo párrafo). */
export type TipoPlazo = "general" | "declaraciones_pagos";

export interface PlazoCurado {
  readonly cobertura: CoberturaSerie;
  /** Tipos de día que no son inhábiles en este plazo. */
  readonly excluirTipos: readonly TipoDiaCurado[];
  readonly calendario: Calendario;
}

/** El calendario de una autoridad como lo escribe el build, ya revisado. */
export interface CalendarioCurado {
  readonly autoridad: AutoridadCurada;
  readonly plazos: ReadonlyMap<TipoPlazo, PlazoCurado>;
  /** Cuenta todos los tipos de día: en su cobertura la lista está completa. */
  readonly general: PlazoCurado;
  /** La cobertura del plazo que contiene a las de los demás. */
  readonly amplia: CoberturaSerie;
  /** Todos los días del shard, en orden. */
  readonly dias: readonly DiaInhabil[];
}

const TIPOS_PLAZO: ReadonlySet<string> = new Set(["general", "declaraciones_pagos"]);
const TIPOS_DIA: ReadonlySet<unknown> = new Set(["descanso", "vacaciones"]);

const contiene = (a: CoberturaSerie, b: CoberturaSerie): boolean =>
  a.desde <= b.desde && b.hasta <= a.hasta;
const dentro = (fecha: FechaISO, { desde, hasta }: CoberturaSerie): boolean =>
  fecha >= desde && fecha <= hasta;

function aDiaCurado(v: unknown): DiaInhabil | undefined {
  if (!esObjeto(v) || !esFecha(v.fecha) || typeof v.motivo !== "string" || !TIPOS_DIA.has(v.tipo)) {
    return undefined;
  }
  const fuente = aFuenteDof(v.fuente);
  if (fuente === undefined) return undefined;
  return Object.freeze({ fecha: v.fecha, motivo: v.motivo, tipo: v.tipo as TipoDiaCurado, fuente });
}

type PlazoLeido = Omit<PlazoCurado, "calendario">;

function aPlazo(v: unknown): PlazoLeido | undefined {
  if (
    !esObjeto(v) ||
    !esRango(v.cobertura) ||
    !Array.isArray(v.excluir_tipos) ||
    !v.excluir_tipos.every((tipo) => TIPOS_DIA.has(tipo))
  ) {
    return undefined;
  }
  const { desde, hasta } = v.cobertura;
  return {
    cobertura: Object.freeze({ desde, hasta }),
    excluirTipos: Object.freeze([...(v.excluir_tipos as TipoDiaCurado[])]),
  };
}

/**
 * Revisa el calendario de una autoridad y arma un `Calendario` por tipo de plazo con los días
 * de su cobertura. `general` cuenta todos los tipos de día y un plazo contiene las coberturas de
 * los demás; los días van en orden estricto y dentro de esa cobertura. Lo que no cumple falla en
 * vez de llegar a un plazo legal.
 */
function aCalendarioCurado(valor: unknown, autoridad: AutoridadCurada): CalendarioCurado {
  const nombre = `calendarios/${autoridad}`;
  if (
    !esObjeto(valor) ||
    valor.autoridad !== autoridad ||
    !esObjeto(valor.plazos) ||
    !Array.isArray(valor.dias)
  ) {
    throw new Error(`El shard ${nombre} no tiene autoridad, plazos y días.`);
  }
  const fuenteFinDeSemana = aFuenteDof(valor.fuente_fin_de_semana);
  if (fuenteFinDeSemana === undefined) {
    throw new Error(`El shard ${nombre} no cita la regla de los fines de semana.`);
  }
  const leidos = new Map<TipoPlazo, PlazoLeido>();
  for (const [tipo, v] of Object.entries(valor.plazos)) {
    const plazo = TIPOS_PLAZO.has(tipo) ? aPlazo(v) : undefined;
    if (plazo === undefined) throw new Error(`El shard ${nombre} tiene un plazo inesperado.`);
    leidos.set(tipo as TipoPlazo, plazo);
  }
  const general = leidos.get("general");
  if (general === undefined || general.excluirTipos.length > 0) {
    throw new Error(`El shard ${nombre} no tiene un plazo general que cuente todos los días.`);
  }
  const coberturas = [...leidos.values()].map((p) => p.cobertura);
  const amplia = coberturas.find((c) => coberturas.every((otra) => contiene(c, otra)));
  if (amplia === undefined) {
    throw new Error(`Ningún plazo del shard ${nombre} contiene a los demás.`);
  }
  const dias: DiaInhabil[] = [];
  let anterior = "";
  for (const v of valor.dias as unknown[]) {
    const dia = aDiaCurado(v);
    if (dia === undefined || dia.fecha <= anterior || !dentro(dia.fecha, amplia)) {
      throw new Error(`El shard ${nombre} tiene un día inesperado, repetido o fuera de orden.`);
    }
    anterior = dia.fecha;
    dias.push(dia);
  }
  const plazos = new Map<TipoPlazo, PlazoCurado>();
  for (const [tipo, { cobertura, excluirTipos }] of leidos) {
    const calendario = crearCalendario({
      autoridad,
      cobertura,
      dias: dias.filter((d) => dentro(d.fecha, cobertura)),
      fuenteFinDeSemana,
      excluirTipos,
    });
    plazos.set(tipo, Object.freeze({ cobertura, excluirTipos, calendario }));
  }
  return Object.freeze({
    autoridad,
    plazos: new MapaCongelado(plazos),
    general: plazos.get("general") as PlazoCurado,
    amplia,
    dias: Object.freeze(dias),
  });
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
    typeof anio !== "number" ||
    !Number.isInteger(anio) ||
    anio < 1900 ||
    anio > 2100 ||
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

export function reiniciarCargas(): void {
  meta = undefined;
  bancos = undefined;
  shards.clear();
  calendarios.clear();
  umas = undefined;
}
