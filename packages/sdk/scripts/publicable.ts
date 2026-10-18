// Arma en otra carpeta el paquete `mexicoapi` tal como se publica: lo que lista `files` (dist,
// README.md, LICENSE) y un package.json sin `devDependencies` ni `scripts`, que solo sirven en el
// monorepo (el núcleo ya viaja en dist/nucleo). npm pack y npm publish se corren en esa carpeta:
// así el .tgz y lo que npm registra de la versión salen del mismo manifiesto.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
//
//   node scripts/publicable.ts <destino>   después de pnpm --filter mexicoapi... build
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USO =
  "uso: node scripts/publicable.ts <destino>\n" +
  "  arma en <destino> (nuevo o vacío) el paquete que se publica; npm pack y npm publish se corren ahí.\n";
const NO_DESDE_AQUI =
  "mexicoapi no se empaqueta desde aquí: este package.json trae las devDependencies del monorepo. " +
  "Arma el paquete con node scripts/publicable.ts <destino> y corre npm pack o npm publish en <destino>.\n";

/** Lo que solo sirve en el monorepo y no viaja en el paquete publicado. */
const SOLO_MONOREPO = ["devDependencies", "scripts"] as const;
/** Un paquete interno del monorepo o un rango de pnpm workspace, que npm no podría instalar. */
const INTERNO = /@mexicoapi\/[\w.-]+|workspace:[^"]*/;

type Manifiesto = Record<string, unknown>;

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** El manifiesto sin devDependencies ni scripts. Falla si lo demás nombra un paquete interno. */
export function manifiestoPublicable(manifiesto: Readonly<Manifiesto>): Manifiesto {
  const publicable: Manifiesto = {};
  for (const [campo, valor] of Object.entries(manifiesto)) {
    if (!(SOLO_MONOREPO as readonly string[]).includes(campo)) publicable[campo] = valor;
  }
  const interno = INTERNO.exec(JSON.stringify(publicable));
  if (interno !== null) {
    throw new Error(`el manifiesto publicable todavía nombra ${interno[0]}, que npm no instala`);
  }
  return publicable;
}

/** Las rutas de archivos que declara el manifiesto: main, types, bin y cada destino de exports. */
function rutasDeclaradas(manifiesto: Readonly<Manifiesto>): string[] {
  const rutas: string[] = [];
  const recorrer = (valor: unknown): void => {
    if (typeof valor === "string") rutas.push(valor);
    else if (typeof valor === "object" && valor !== null) Object.values(valor).forEach(recorrer);
  };
  recorrer([manifiesto.main, manifiesto.types, manifiesto.bin, manifiesto.exports]);
  return [...new Set(rutas)].filter((r) => r !== "./package.json" && r !== "package.json");
}

const sinPunto = (ruta: string): string => ruta.replace(/^\.\//, "");

/**
 * Revisa que exista todo lo que lista `files` y todo archivo que declara el manifiesto, dentro de
 * `files`, antes de escribir nada. Devuelve `files`.
 */
async function revisar(raiz: string, manifiesto: Readonly<Manifiesto>): Promise<string[]> {
  const { files } = manifiesto;
  if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === "string")) {
    throw new Error("el package.json no lista sus archivos en files");
  }
  for (const entrada of files) {
    if (!(await existe(join(raiz, entrada)))) {
      throw new Error(
        `falta ${entrada} (lo lista files); compila antes con pnpm --filter mexicoapi... build`,
      );
    }
  }
  for (const ruta of rutasDeclaradas(manifiesto)) {
    const archivo = sinPunto(ruta);
    const enFiles = files.some((f) => archivo === f || archivo.startsWith(`${f}/`));
    if (!enFiles || !(await existe(join(raiz, archivo)))) {
      throw new Error(`${ruta} no está en lo que se publica: falta compilar o agregarlo a files`);
    }
  }
  return files;
}

/**
 * Arma en `destino` (que no existe o está vacío, fuera de `raiz`) el paquete de `raiz` tal como se
 * publica. Si algo falla, no deja nada a medias. Devuelve lo que copió de `files`.
 */
export async function armarPublicable(raiz: string, destino: string): Promise<string[]> {
  // Dentro del paquete, npm pack lo tomaría por parte de packages/sdk y cp se copiaría a sí mismo.
  const desdeRaiz = relative(resolve(raiz), resolve(destino));
  const fuera = isAbsolute(desdeRaiz) || desdeRaiz === ".." || desdeRaiz.startsWith(`..${sep}`);
  if (!fuera) throw new Error(`el destino debe estar fuera de ${raiz}`);
  const manifiesto = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as Manifiesto;
  const publicable = manifiestoPublicable(manifiesto);
  const files = await revisar(raiz, manifiesto);
  const existia = await existe(destino);
  if (existia && (await readdir(destino)).length > 0) {
    throw new Error(`${destino} no está vacío`);
  }
  try {
    await mkdir(destino, { recursive: true });
    for (const entrada of files) {
      await cp(join(raiz, entrada), join(destino, entrada), { recursive: true });
    }
    await writeFile(join(destino, "package.json"), `${JSON.stringify(publicable, null, 2)}\n`);
  } catch (error) {
    if (existia) {
      for (const nombre of await readdir(destino)) {
        await rm(join(destino, nombre), { recursive: true, force: true });
      }
    } else {
      await rm(destino, { recursive: true, force: true });
    }
    throw error;
  }
  return files;
}

export interface OpcionesPrincipal {
  /** Carpeta del paquete (la que tiene package.json y dist). */
  raiz: string;
  salida: (texto: string) => void;
  errores: (texto: string) => void;
  /** `npm_lifecycle_event`: con `prepack`, npm intenta empaquetar desde `raiz`. */
  evento?: string | undefined;
}

export async function principal(
  argv: readonly string[],
  opciones: OpcionesPrincipal,
): Promise<number> {
  if (opciones.evento === "prepack") {
    opciones.errores(`publicable: ${NO_DESDE_AQUI}`);
    return 1;
  }
  const [destino, ...resto] = argv;
  if (destino === undefined || resto.length > 0) {
    opciones.errores(USO);
    return 2;
  }
  try {
    const files = await armarPublicable(opciones.raiz, destino);
    const { name, version } = JSON.parse(
      await readFile(join(destino, "package.json"), "utf8"),
    ) as Manifiesto;
    opciones.salida(
      `publicable: ${String(name)}@${String(version)} en ${destino}: ${files.join(", ")} y ` +
        "package.json sin devDependencies ni scripts. Corre ahí npm pack o npm publish.\n",
    );
    return 0;
  } catch (error) {
    // Lo que lanzan este script y node:fs siempre es un Error.
    opciones.errores(`publicable: ${(error as Error).message}\n`);
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
    evento: process.env.npm_lifecycle_event,
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`publicable.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
