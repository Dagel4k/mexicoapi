import {
  type CoberturaSerie,
  esFechaIsoValida,
  type FechaISO,
  type TipoCambioFix,
  type Udi,
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

export interface MetaInterna {
  datasets: Record<string, DatasetInterno>;
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

const esDatasetInterno = (v: unknown): boolean =>
  esObjeto(v) &&
  esMeta(v.meta) &&
  typeof v.records === "number" &&
  typeof v.data_sha256 === "string" &&
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

// Se guarda el valor y no la promesa: en workerd, una promesa iniciada por una petición que
// se cancela puede no resolverse nunca para las demás. Una falla no se recuerda.
let meta: MetaInterna | undefined;
let bancos: ReadonlyMap<string, BancoCatalogo> | undefined;
// `carpeta/anio` → shard. Solo se piden años dentro de la cobertura, así que a lo más guarda
// los años de cada serie.
const shards = new Map<string, ShardSerie<unknown>>();

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

export function reiniciarCargas(): void {
  meta = undefined;
  bancos = undefined;
  shards.clear();
}
