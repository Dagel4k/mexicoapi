// Caché del catálogo en el equipo del usuario. `meta.json` dice qué archivos de datos valen
// (`codigos-<id>.json` y, si hay node:sqlite, `codigos-<id>.sqlite`). Se escriben primero los
// datos nuevos y al final `meta.json`, cada uno en un temporal que se renombra: quien lee ve el
// catálogo anterior completo o el nuevo completo, nunca uno a medias. Quien escribe tiene el
// candado `sync.lock`: dos guardados a la vez en el mismo directorio no se pisan.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, posix, win32 } from "node:path";
import type { Catalogo, CodigoPostal } from "./catalogo.js";
import { SepomexError } from "./error.js";
import { cargarSqlite, escribirSqlite } from "./sqlite.js";
import type { FilaSepomex } from "./txt.js";

const FORMATO = 1;
const META = "meta.json";
const DATOS = /^codigos-[0-9a-f]{12}\.(json|sqlite)$/;
const JSON_DATOS = /^codigos-[0-9a-f]{12}\.json$/;
const SQLITE_DATOS = /^codigos-[0-9a-f]{12}\.sqlite$/;
/** Temporales de un guardado que se cortó y candados viejos apartados. */
const RESTOS =
  /^((codigos-[0-9a-f]{12}\.(json|sqlite)|meta\.json)\.tmp-|sync\.lock\.viejo-)[0-9a-f]{12}$/;

const CANDADO = "sync.lock";
/** Un candado más viejo que esto se puede tomar: ninguna sincronización tarda tanto. */
const VIDA_CANDADO_MS = 10 * 60_000;
/** Un archivo de datos que ningún meta.json nombra y es más viejo que esto es un resto. */
const EDAD_RESTO_MS = 60 * 60_000;

/**
 * Directorio por omisión de la caché: `%LOCALAPPDATA%\mexicoapi\sepomex` en Windows y
 * `$XDG_CACHE_HOME/mexicoapi/sepomex` (o `~/.cache/mexicoapi/sepomex`) en los demás sistemas.
 * Una ruta relativa en la variable se ignora.
 */
export function directorioCache(
  entorno: Readonly<Record<string, string | undefined>> = process.env,
  plataforma: string = process.platform,
  inicio: string = homedir(),
): string {
  if (plataforma === "win32") {
    const local = entorno.LOCALAPPDATA;
    const base = local && win32.isAbsolute(local) ? local : win32.join(inicio, "AppData", "Local");
    return win32.join(base, "mexicoapi", "sepomex");
  }
  const xdg = entorno.XDG_CACHE_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(inicio, ".cache");
  return posix.join(base, "mexicoapi", "sepomex");
}

/** Lo que se guarda en meta.json. */
export interface MetaGuardada {
  formato: number;
  descargado: string;
  origen: "descarga" | "archivo";
  fuente: string;
  as_of: string | null;
  aviso: string;
  nota: string;
  filas: number;
  codigos_postales: number;
  municipios: number;
  sin_municipio_inegi: number;
  advertencias: string[];
  sha256: string;
  /** Nombre del JSON de datos dentro del directorio. */
  json: string;
  /** Nombre del SQLite dentro del directorio, o null. */
  sqlite: string | null;
  /** Por qué no hay SQLite; null si lo hay. */
  sin_sqlite: string | null;
}

export type ResumenGuardado = Omit<MetaGuardada, "formato" | "json" | "sqlite" | "sin_sqlite">;

const codigoDe = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

const mensajeDe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Un fallo del sistema de archivos o de SQLite al guardar. */
export function errorEscritura(dir: string, error: unknown): SepomexError {
  if (error instanceof SepomexError) return error;
  return new SepomexError(
    "escritura",
    `No se pudo guardar el catálogo en ${dir} (${mensajeDe(error)}).`,
    { cause: error },
  );
}

function cacheInvalida(dir: string, archivo: string, causa?: unknown): SepomexError {
  return new SepomexError(
    "cache-invalida",
    `El catálogo guardado en ${dir} está dañado (${archivo}). Vuelve a correr sepomex.sync() o sepomex.importar(ruta).`,
    causa === undefined ? undefined : { cause: causa },
  );
}

const esTexto = (v: unknown): v is string => typeof v === "string";
const esEntero = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function esMeta(v: unknown): v is MetaGuardada {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    m.formato === FORMATO &&
    [m.descargado, m.fuente, m.aviso, m.nota, m.sha256].every(esTexto) &&
    (m.origen === "descarga" || m.origen === "archivo") &&
    (m.as_of === null || esTexto(m.as_of)) &&
    [m.filas, m.codigos_postales, m.municipios, m.sin_municipio_inegi].every(esEntero) &&
    Array.isArray(m.advertencias) &&
    m.advertencias.every(esTexto) &&
    esTexto(m.json) &&
    JSON_DATOS.test(m.json) &&
    (m.sqlite === null || (esTexto(m.sqlite) && SQLITE_DATOS.test(m.sqlite))) &&
    (m.sin_sqlite === null || esTexto(m.sin_sqlite))
  );
}

/** El último meta.json leído, con la marca de su archivo (ruta, mtime, tamaño e inodo). */
let metaEnMemoria: { marca: string; meta: MetaGuardada } | undefined;

/**
 * meta.json del directorio; null si no existe. Lanza `cache-invalida` si está dañado. Si el
 * archivo no cambió desde la última lectura (mismo mtime, tamaño e inodo), no se vuelve a leer.
 * La marca y el texto salen del mismo descriptor: un rename a mitad no los mezcla.
 */
export async function leerMeta(dir: string): Promise<MetaGuardada | null> {
  const ruta = join(dir, META);
  let marca: string;
  let texto: string;
  try {
    const archivo = await open(ruta, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await archivo.stat();
      if (!info.isFile()) throw cacheInvalida(dir, META);
      marca = `${ruta}|${info.mtimeMs}|${info.size}|${info.ino}`;
      if (metaEnMemoria?.marca === marca) return metaEnMemoria.meta;
      texto = await archivo.readFile("utf8");
    } finally {
      await archivo.close();
    }
  } catch (error) {
    if (error instanceof SepomexError) throw error;
    if (codigoDe(error) === "ENOENT") return null;
    throw cacheInvalida(dir, META, error);
  }
  let meta: unknown;
  try {
    meta = JSON.parse(texto);
  } catch (error) {
    throw cacheInvalida(dir, META, error);
  }
  if (!esMeta(meta)) throw cacheInvalida(dir, META);
  metaEnMemoria = { marca, meta };
  return meta;
}

const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/** rename con unos reintentos: en Windows un antivirus o un lector pueden tomar el archivo. */
async function renombrar(desde: string, hacia: string): Promise<void> {
  for (let intento = 0; ; intento++) {
    try {
      await rename(desde, hacia);
      return;
    } catch (error) {
      const codigo = codigoDe(error);
      if (intento >= 4 || (codigo !== "EPERM" && codigo !== "EACCES" && codigo !== "EBUSY")) {
        throw error;
      }
      await esperar(25 * 2 ** intento);
    }
  }
}

const temporalDe = (ruta: string) => `${ruta}.tmp-${randomBytes(6).toString("hex")}`;

async function borrarSiPuede(ruta: string): Promise<void> {
  try {
    await rm(ruta, { force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Un residuo no estorba: meta.json ya no lo nombra y el siguiente guardado lo vuelve a intentar.
  }
}

/** Escribe en un temporal, lo pasa a disco y lo renombra a `ruta`. */
async function escribirAtomico(ruta: string, contenido: string): Promise<void> {
  const temporal = temporalDe(ruta);
  try {
    const archivo = await open(temporal, "wx");
    try {
      await archivo.writeFile(contenido, "utf8");
      await archivo.sync();
    } finally {
      await archivo.close();
    }
    await renombrar(temporal, ruta);
  } catch (error) {
    await borrarSiPuede(temporal);
    throw error;
  }
}

/** Escribe el SQLite si node:sqlite carga; si no, devuelve por qué no. */
async function escribirSqliteAtomico(
  ruta: string,
  filas: readonly FilaSepomex[],
  resumen: ResumenGuardado,
): Promise<string | null> {
  const carga = await cargarSqlite();
  if ("motivo" in carga) return carga.motivo;
  const temporal = temporalDe(ruta);
  try {
    escribirSqlite(carga.modulo, temporal, filas, resumen);
    await renombrar(temporal, ruta);
    return null;
  } catch (error) {
    await borrarSiPuede(temporal);
    throw error;
  }
}

/**
 * Borra los archivos del catálogo reemplazado y los restos (datos que ningún meta.json nombra y
 * temporales) de más de una hora: los de un guardado que se cortó. Nunca lanza.
 */
async function limpiar(
  dir: string,
  anterior: MetaGuardada | null,
  actual: MetaGuardada,
): Promise<void> {
  const vigentes = new Set([actual.json, actual.sqlite]);
  try {
    for (const nombre of [anterior?.json, anterior?.sqlite]) {
      if (nombre && !vigentes.has(nombre)) await borrarSiPuede(join(dir, nombre));
    }
    const limite = Date.now() - EDAD_RESTO_MS;
    for (const nombre of await readdir(dir)) {
      if (vigentes.has(nombre) || !(DATOS.test(nombre) || RESTOS.test(nombre))) continue;
      const info = await stat(join(dir, nombre)).catch(() => undefined);
      if (info !== undefined && info.mtimeMs < limite) await borrarSiPuede(join(dir, nombre));
    }
  } catch {
    // Limpiar es de mejor esfuerzo: el catálogo nuevo ya quedó guardado.
  }
}

interface Candado {
  pid?: unknown;
  host?: unknown;
  desde?: unknown;
  ficha?: unknown;
}

async function leerCandado(ruta: string): Promise<{ datos: Candado; edadMs: number } | null> {
  try {
    const [texto, info] = await Promise.all([readFile(ruta, "utf8"), stat(ruta)]);
    let datos: Candado = {};
    try {
      const leido: unknown = JSON.parse(texto);
      if (typeof leido === "object" && leido !== null) datos = leido as Candado;
    } catch {
      // Un candado recién creado puede estar vacío todavía.
    }
    return { datos, edadMs: Date.now() - info.mtimeMs };
  } catch (error) {
    if (codigoDe(error) === "ENOENT") return null;
    throw error;
  }
}

function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codigoDe(error) === "EPERM";
  }
}

/** Viejo, o de un proceso de este equipo que ya terminó (una corrida cortada con Ctrl+C). */
function abandonado({ datos, edadMs }: { datos: Candado; edadMs: number }): boolean {
  if (edadMs > VIDA_CANDADO_MS) return true;
  return (
    datos.host === hostname() &&
    typeof datos.pid === "number" &&
    datos.pid !== process.pid &&
    !procesoVivo(datos.pid)
  );
}

function ocupado(dir: string, datos: Candado): SepomexError {
  const pid = typeof datos.pid === "number" ? datos.pid : "?";
  const desde = typeof datos.desde === "string" ? datos.desde : "?";
  return new SepomexError(
    "ocupado",
    `Otra sincronización está guardando en ${dir} (proceso ${pid} desde ${desde}). Espera a que termine; si no hay ninguna, borra ${join(dir, CANDADO)}.`,
  );
}

/**
 * Aparta un candado abandonado con un nombre único (rename es atómico: si dos lo intentan, solo
 * uno lo mueve). Si lo que se movió ya era el candado nuevo de otro proceso, se devuelve.
 */
async function apartar(ruta: string, visto: Candado): Promise<void> {
  const aparte = `${ruta}.viejo-${randomBytes(6).toString("hex")}`;
  try {
    await rename(ruta, aparte);
  } catch {
    return;
  }
  const movido = await leerCandado(aparte).catch(() => null);
  if (movido !== null && movido.datos.ficha !== visto.ficha) {
    await copyFile(aparte, ruta, constants.COPYFILE_EXCL).catch(() => undefined);
  }
  await borrarSiPuede(aparte);
}

/**
 * Toma el candado de `dir` y devuelve cómo soltarlo. Lanza SepomexError `ocupado` si otro
 * proceso lo tiene; uno abandonado se toma.
 */
async function tomarCandado(dir: string): Promise<() => Promise<void>> {
  const ruta = join(dir, CANDADO);
  const propio = {
    pid: process.pid,
    host: hostname(),
    desde: new Date().toISOString(),
    ficha: randomBytes(8).toString("hex"),
  };
  let visto: Candado = {};
  for (let intento = 0; intento < 3; intento++) {
    try {
      await writeFile(ruta, JSON.stringify(propio), { flag: "wx" });
      return async () => {
        const actual = await leerCandado(ruta).catch(() => null);
        if (actual?.datos.ficha === propio.ficha) await borrarSiPuede(ruta);
      };
    } catch (error) {
      if (codigoDe(error) !== "EEXIST") throw errorEscritura(dir, error);
    }
    const actual = await leerCandado(ruta).catch((error: unknown) => {
      throw errorEscritura(dir, error);
    });
    if (actual === null) continue;
    visto = actual.datos;
    if (!abandonado(actual)) break;
    await apartar(ruta, actual.datos);
  }
  throw ocupado(dir, visto);
}

/**
 * Corre `trabajo` con el candado de `dir` tomado (crea el directorio si falta). Si no se puede
 * crear el directorio o el candado, lanza SepomexError `escritura`.
 */
export async function conCandado<T>(dir: string, trabajo: () => Promise<T>): Promise<T> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    throw errorEscritura(dir, error);
  }
  const soltar = await tomarCandado(dir);
  try {
    return await trabajo();
  } finally {
    await soltar();
  }
}

export interface Guardado {
  catalogo: Catalogo;
  filas: readonly FilaSepomex[];
  resumen: ResumenGuardado;
  /** Escribir también el SQLite si node:sqlite existe. */
  sqlite: boolean;
}

/**
 * Guarda el catálogo en `dir` (con el candado tomado, ver `conCandado`): los datos nuevos con
 * nombres nuevos y después meta.json. Si algo falla antes de meta.json, borra lo nuevo y la caché
 * anterior sigue igual. Un meta.json dañado se reemplaza.
 */
export async function guardar(dir: string, g: Guardado): Promise<MetaGuardada> {
  const anterior = await leerMeta(dir).catch(() => null);
  const id = randomBytes(6).toString("hex");
  const json = `codigos-${id}.json`;
  const sqlite = `codigos-${id}.sqlite`;
  let meta: MetaGuardada;
  try {
    const codigos = Object.fromEntries(g.catalogo.codigos.map((c) => [c.cp, c]));
    await escribirAtomico(join(dir, json), JSON.stringify({ formato: FORMATO, codigos }));
    const sinSqlite = g.sqlite
      ? await escribirSqliteAtomico(join(dir, sqlite), g.filas, g.resumen)
      : "Se guardó sin SQLite porque se pidió con sqlite: false.";
    meta = {
      formato: FORMATO,
      ...g.resumen,
      json,
      sqlite: sinSqlite === null ? sqlite : null,
      sin_sqlite: sinSqlite,
    };
    await escribirAtomico(join(dir, META), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (error) {
    await borrarSiPuede(join(dir, json));
    await borrarSiPuede(join(dir, sqlite));
    throw errorEscritura(dir, error);
  }
  await limpiar(dir, anterior, meta);
  return meta;
}

type Codigos = Readonly<Record<string, CodigoPostal>>;

let enMemoria: { dir: string; json: string; codigos: Codigos } | undefined;

/**
 * Los códigos postales guardados en `dir`, leídos una vez por cada catálogo (se vuelve a leer si
 * meta.json nombra otro). Lanza `sin-datos` si no hay catálogo y `cache-invalida` si está dañado.
 */
export async function cargarCodigos(dir: string): Promise<Codigos> {
  for (let intento = 0; ; intento++) {
    const meta = await leerMeta(dir);
    if (meta === null) {
      throw new SepomexError(
        "sin-datos",
        `No hay códigos postales guardados en ${dir}. Corre sepomex.sync() (o mexicoapi sepomex sync) para descargarlos de Correos de México.`,
      );
    }
    if (enMemoria?.dir === dir && enMemoria.json === meta.json) return enMemoria.codigos;
    let texto: string;
    try {
      texto = await readFile(join(dir, meta.json), "utf8");
    } catch (error) {
      // Otro proceso pudo guardar un catálogo nuevo y borrar este entre las dos lecturas.
      if (codigoDe(error) === "ENOENT" && intento === 0) continue;
      throw cacheInvalida(dir, meta.json, error);
    }
    let datos: { formato?: unknown; codigos?: unknown };
    try {
      datos = JSON.parse(texto) as typeof datos;
    } catch (error) {
      throw cacheInvalida(dir, meta.json, error);
    }
    const { codigos } = datos;
    if (
      datos.formato !== FORMATO ||
      typeof codigos !== "object" ||
      codigos === null ||
      Array.isArray(codigos)
    ) {
      throw cacheInvalida(dir, meta.json);
    }
    enMemoria = { dir, json: meta.json, codigos: codigos as Codigos };
    return enMemoria.codigos;
  }
}
