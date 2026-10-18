// Caché del catálogo en el equipo del usuario. `meta.json` dice qué archivos de datos valen
// (`codigos-<id>.json` y, si hay node:sqlite, `codigos-<id>.sqlite`). Se escriben primero los
// datos nuevos y al final `meta.json`, cada uno en un temporal que se renombra: quien lee ve el
// catálogo anterior completo o el nuevo completo, nunca uno a medias.
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
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
}

export type ResumenGuardado = Omit<MetaGuardada, "formato" | "json" | "sqlite">;

const codigoDe = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

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
    (m.sqlite === null || (esTexto(m.sqlite) && SQLITE_DATOS.test(m.sqlite)))
  );
}

/** meta.json del directorio; null si no existe. Lanza `cache-invalida` si está dañado. */
export async function leerMeta(dir: string): Promise<MetaGuardada | null> {
  let texto: string;
  try {
    texto = await readFile(join(dir, META), "utf8");
  } catch (error) {
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

async function escribirSqliteAtomico(
  ruta: string,
  filas: readonly FilaSepomex[],
  resumen: ResumenGuardado,
): Promise<boolean> {
  const modulo = await cargarSqlite();
  if (modulo === null) return false;
  const temporal = temporalDe(ruta);
  try {
    escribirSqlite(modulo, temporal, filas, resumen);
    await renombrar(temporal, ruta);
    return true;
  } catch (error) {
    await borrarSiPuede(temporal);
    throw error;
  }
}

/** Borra los archivos de datos que ya no nombra meta.json. Nunca lanza. */
async function limpiar(dir: string): Promise<void> {
  try {
    const meta = await leerMeta(dir);
    if (meta === null) return;
    const vigentes = new Set([meta.json, meta.sqlite]);
    for (const nombre of await readdir(dir)) {
      if (DATOS.test(nombre) && !vigentes.has(nombre)) await borrarSiPuede(join(dir, nombre));
    }
  } catch {
    // Limpiar es de mejor esfuerzo: el catálogo nuevo ya quedó guardado.
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
 * Guarda el catálogo en `dir`: los datos nuevos con nombres nuevos y después meta.json. Si algo
 * falla antes de meta.json, borra lo nuevo y la caché anterior sigue igual.
 */
export async function guardar(dir: string, g: Guardado): Promise<MetaGuardada> {
  await mkdir(dir, { recursive: true });
  const id = randomBytes(6).toString("hex");
  const json = `codigos-${id}.json`;
  const sqlite = `codigos-${id}.sqlite`;
  let meta: MetaGuardada;
  try {
    const codigos = Object.fromEntries(g.catalogo.codigos.map((c) => [c.cp, c]));
    await escribirAtomico(join(dir, json), JSON.stringify({ formato: FORMATO, codigos }));
    const conSqlite =
      g.sqlite && (await escribirSqliteAtomico(join(dir, sqlite), g.filas, g.resumen));
    meta = { formato: FORMATO, ...g.resumen, json, sqlite: conSqlite ? sqlite : null };
    await escribirAtomico(join(dir, META), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (error) {
    await borrarSiPuede(join(dir, json));
    await borrarSiPuede(join(dir, sqlite));
    throw error;
  }
  await limpiar(dir);
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
