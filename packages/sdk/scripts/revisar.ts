// Revisa una entrada compilada del paquete: qué archivos carga, cuánto pesan con gzip y qué
// importa de fuera de dist. Lo usan las pruebas del paquete sobre dist.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
import { access, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Tope de la entrada principal (validadores y cliente, sin datos), en bytes: gzip con el nivel
 * por omisión de zlib de los archivos de su grafo concatenados en el orden en que se recorren.
 * Se parece a lo que deja un bundler sin minificar; 15 000 cumple con 15 KB y con 15 KiB.
 */
export const LIMITE_GZIP_PRINCIPAL = 15_000;

/** Entradas que pueden usar Node (descarga de SEPOMEX y CLI); todas las demás son universales. */
export const ENTRADAS_SOLO_NODE: ReadonlySet<string> = new Set(["./sepomex", "./cli"]);

/** Lo que devuelve `especificadores` por un import() que no es una cadena literal. */
export const IMPORT_DINAMICO = "import(<expresión>)";

// La palabra clave no puede ser parte de un identificador ni de un acceso a propiedad (`x.import`),
// pero puede ir pegada a lo que sigue (`import{a}from"x"`, `export*from"x"`) y después de otra
// sentencia o de un comentario en la misma línea, como en código compacto o generado.
const ESTATICO =
  /(?<![\w$.])(?:import|export)(?![\w$])\s*(?:[\w$*{},\s]+?\s*\bfrom\s*)?(["'])([^"'\n]+)\1/g;
const DINAMICO = /(?<![\w$.])import\s*\(\s*(?:(["'])([^"'\n]+)\1\s*\))?/g;

const NODE: ReadonlySet<string> = new Set(builtinModules);

export interface Importacion {
  archivo: string;
  especificador: string;
}

export interface Grafo {
  /** Rutas absolutas, desde la entrada y en el orden en que se recorren. */
  archivos: string[];
  /** Imports que no son relativos: módulos de Node o paquetes. */
  externas: Importacion[];
}

export interface Medida extends Grafo {
  bytes: number;
  gzip: number;
}

export interface ImportEnCodigo {
  especificador: string;
  /** Un import() se carga al llamarlo; los demás, al cargar el archivo. */
  dinamico: boolean;
}

/**
 * Módulos que pide un archivo ESM compilado, en orden de aparición: imports, reexports e
 * import() literales. Un import() con una expresión aparece como `IMPORT_DINAMICO`, porque no se
 * puede saber qué carga. Peca de cauto: un comentario con forma de import también cuenta.
 */
export function importaciones(codigo: string): ImportEnCodigo[] {
  const encontrados: [number, ImportEnCodigo][] = [];
  for (const m of codigo.matchAll(ESTATICO)) {
    encontrados.push([m.index, { especificador: m[2] as string, dinamico: false }]);
  }
  for (const m of codigo.matchAll(DINAMICO)) {
    encontrados.push([m.index, { especificador: m[2] ?? IMPORT_DINAMICO, dinamico: true }]);
  }
  return encontrados.sort((a, b) => a[0] - b[0]).map(([, importacion]) => importacion);
}

/** Los especificadores de `importaciones`, estáticos y dinámicos. */
export function especificadores(codigo: string): string[] {
  return importaciones(codigo).map((i) => i.especificador);
}

export function esModuloDeNode(especificador: string): boolean {
  if (especificador.startsWith("node:")) return true;
  return NODE.has(especificador) || NODE.has(especificador.split("/", 1)[0] as string);
}

const esRelativo = (especificador: string): boolean =>
  especificador.startsWith("./") || especificador.startsWith("../");

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

export interface OpcionesGrafo {
  /** Con `false`, no sigue los import(): da lo que se carga al importar la entrada. */
  dinamicos?: boolean;
}

/** Recorre los imports relativos desde `entrada`; los demás quedan en `externas`. */
export async function grafoDeModulos(
  entrada: string,
  opciones: OpcionesGrafo = {},
): Promise<Grafo> {
  const dinamicos = opciones.dinamicos ?? true;
  const archivos = [resolve(entrada)];
  const vistos = new Set(archivos);
  const externas: Importacion[] = [];
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i] as string;
    for (const { especificador, dinamico } of importaciones(await readFile(archivo, "utf8"))) {
      if (dinamico && !dinamicos) continue;
      if (!esRelativo(especificador)) {
        externas.push({ archivo, especificador });
        continue;
      }
      const destino = resolve(dirname(archivo), especificador);
      if (vistos.has(destino)) continue;
      if (!(await existe(destino))) {
        throw new Error(`${archivo} importa ${especificador}, que no existe`);
      }
      vistos.add(destino);
      archivos.push(destino);
    }
  }
  return { archivos, externas };
}

/** Grafo de `entrada` con sus bytes y su gzip, medido como dice `LIMITE_GZIP_PRINCIPAL`. */
export async function medirEntrada(entrada: string, opciones: OpcionesGrafo = {}): Promise<Medida> {
  const grafo = await grafoDeModulos(entrada, opciones);
  const todo = Buffer.concat(await Promise.all(grafo.archivos.map((a) => readFile(a))));
  return { ...grafo, bytes: todo.length, gzip: gzipSync(todo).length };
}

/** Entradas del `exports` de package.json que deben correr fuera de Node, con su archivo. */
export function entradasUniversales(
  exports: Record<string, unknown>,
): { ruta: string; archivo: string }[] {
  const entradas: { ruta: string; archivo: string }[] = [];
  for (const [ruta, destino] of Object.entries(exports)) {
    if (ENTRADAS_SOLO_NODE.has(ruta) || typeof destino !== "object" || destino === null) continue;
    const archivo = (destino as { import?: unknown }).import;
    if (typeof archivo === "string") entradas.push({ ruta, archivo });
  }
  return entradas;
}
