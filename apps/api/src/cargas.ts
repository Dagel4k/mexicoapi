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

const esDatasetInterno = (v: unknown): boolean =>
  esObjeto(v) &&
  esMeta(v.meta) &&
  typeof v.records === "number" &&
  typeof v.data_sha256 === "string" &&
  typeof v.frescura_horas === "number";

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

// Se guarda el valor y no la promesa: en workerd, una promesa iniciada por una petición que
// se cancela puede no resolverse nunca para las demás. Una falla no se recuerda.
let meta: MetaInterna | undefined;
let bancos: ReadonlyMap<string, BancoCatalogo> | undefined;

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

export function reiniciarCargas(): void {
  meta = undefined;
  bancos = undefined;
}
