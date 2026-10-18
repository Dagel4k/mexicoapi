// Mete el núcleo dentro de dist para que `mexicoapi` no dependa de @mexicoapi/core al publicarse:
// copia el núcleo compilado a dist/nucleo y cambia sus imports por rutas relativas.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
//
//   node scripts/empaquetar.ts preparar  antes de tsc: revisa que el núcleo esté compilado y borra dist
//   node scripts/empaquetar.ts nucleo    después de tsc: copia el núcleo y reescribe los imports
import { access, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const NUCLEO = "@mexicoapi/core";
const CARPETA_NUCLEO = "nucleo";
const COMPILADO = /\.(js|d\.ts)$/;
// Un import, reexport o import() del núcleo por su nombre exacto (sin subrutas), con su comilla.
const IMPORT_NUCLEO = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])@mexicoapi\/core\2/g;

const USO = "uso: node scripts/empaquetar.ts preparar|nucleo\n";

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

const aPosix = (ruta: string): string => ruta.split(sep).join("/");

async function compilados(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  return entradas
    .filter((e) => e.isFile() && COMPILADO.test(e.name))
    .map((e) => aPosix(relative(dir, join(e.parentPath, e.name))))
    .sort();
}

/**
 * Entrada compilada del núcleo, según el `exports` del @mexicoapi/core enlazado en
 * `raiz/node_modules`: así la copia sigue a la dependencia declarada y no a una ruta fija.
 */
export async function ubicarNucleo(raiz: string): Promise<string> {
  const paquete = join(raiz, "node_modules", ...NUCLEO.split("/"));
  let manifiesto: { exports?: Record<string, { import?: unknown }> };
  try {
    manifiesto = JSON.parse(await readFile(join(paquete, "package.json"), "utf8"));
  } catch {
    throw new Error(`No se encontró ${NUCLEO} en ${paquete}; falta pnpm install`);
  }
  const destino = manifiesto.exports?.["."]?.import;
  if (typeof destino !== "string") {
    throw new Error(`${NUCLEO} no declara una entrada import en exports["."]`);
  }
  const entrada = join(paquete, destino);
  if (!(await existe(entrada))) {
    throw new Error(
      `Falta ${entrada}: compila el núcleo antes (pnpm --filter ${NUCLEO} build o pnpm -r build)`,
    );
  }
  return entrada;
}

/**
 * Copia los .js y .d.ts de la carpeta de `entrada` a `destino`, que se vacía antes para no
 * arrastrar archivos de una copia anterior. Devuelve las rutas copiadas, relativas y ordenadas.
 */
export async function copiarNucleo(entrada: string, destino: string): Promise<string[]> {
  if (!(await existe(entrada))) throw new Error(`No existe la entrada del núcleo ${entrada}`);
  const origen = dirname(entrada);
  const archivos = await compilados(origen);
  await rm(destino, { recursive: true, force: true });
  for (const archivo of archivos) {
    await cp(join(origen, archivo), join(destino, archivo));
  }
  return archivos;
}

/**
 * Cambia `@mexicoapi/core` por la ruta relativa a `entradaNucleo` en los .js y .d.ts de `dist`,
 * salvo los del propio núcleo. Falla si después queda alguna mención (una subruta, un comentario):
 * el paquete publicado no puede pedir un módulo que no viaja con él.
 */
export async function reescribirImports(dist: string, entradaNucleo: string): Promise<string[]> {
  const carpetaNucleo = dirname(entradaNucleo);
  const cambiados: string[] = [];
  for (const archivo of await compilados(dist)) {
    const ruta = join(dist, archivo);
    if (ruta.startsWith(carpetaNucleo + sep)) continue;
    const original = await readFile(ruta, "utf8");
    let destino = aPosix(relative(dirname(ruta), entradaNucleo));
    if (!destino.startsWith(".")) destino = `./${destino}`;
    const nuevo = original.replace(IMPORT_NUCLEO, (_todo, antes: string, comilla: string) => {
      return `${antes}${comilla}${destino}${comilla}`;
    });
    if (nuevo.includes(NUCLEO)) {
      throw new Error(`${archivo} todavía menciona ${NUCLEO} después de reescribir sus imports`);
    }
    if (nuevo !== original) {
      await writeFile(ruta, nuevo);
      cambiados.push(archivo);
    }
  }
  return cambiados;
}

export interface OpcionesPrincipal {
  /** Carpeta del paquete (la que tiene package.json y dist). */
  raiz: string;
  salida: (texto: string) => void;
  errores: (texto: string) => void;
}

const plural = (n: number, palabra: string): string => `${n} ${palabra}${n === 1 ? "" : "s"}`;

export async function principal(
  argv: readonly string[],
  opciones: OpcionesPrincipal,
): Promise<number> {
  const [comando, ...resto] = argv;
  if (resto.length > 0 || (comando !== "preparar" && comando !== "nucleo")) {
    opciones.errores(USO);
    return 2;
  }
  const dist = join(opciones.raiz, "dist");
  try {
    // Antes de tsc: sin el núcleo compilado, tsc solo diría que no encuentra el módulo.
    const entrada = await ubicarNucleo(opciones.raiz);
    if (comando === "preparar") {
      await rm(dist, { recursive: true, force: true });
      return 0;
    }
    const destino = join(dist, CARPETA_NUCLEO);
    const copiados = await copiarNucleo(entrada, destino);
    const cambiados = await reescribirImports(
      dist,
      join(destino, relative(dirname(entrada), entrada)),
    );
    opciones.salida(
      `empaquetar: ${plural(copiados.length, "archivo")} del núcleo en dist/${CARPETA_NUCLEO}; ` +
        `imports reescritos en ${plural(cambiados.length, "archivo")}\n`,
    );
    return 0;
  } catch (error) {
    // Lo que lanzan este script y node:fs siempre es un Error.
    opciones.errores(`empaquetar: ${(error as Error).message}\n`);
    return 1;
  }
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    raiz: fileURLToPath(new URL("..", import.meta.url)),
    salida: (texto) => process.stdout.write(texto),
    errores: (texto) => process.stderr.write(texto),
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`empaquetar.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
