// Arma en otra carpeta el paquete `mexicoapi` tal como se publica: lo que lista `files` (dist,
// README.md, CHANGELOG.md, LICENSE) y un package.json sin `devDependencies` ni `scripts`, que solo sirven en el
// monorepo (el núcleo ya viaja en dist/nucleo). npm pack y npm publish se corren en esa carpeta:
// así el .tgz y lo que npm registra de la versión salen del mismo manifiesto.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
// packages/mcp/scripts/publicable.ts usa este mismo código para `mexicoapi-mcp`.
//
//   node scripts/publicable.ts <destino>   después de pnpm --filter mexicoapi... build
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USO =
  "uso: node scripts/publicable.ts <destino>\n" +
  "  arma en <destino> (nuevo o vacío) el paquete que se publica; npm pack y npm publish se corren ahí.\n";
const noDesdeAqui = (nombre: string): string =>
  `${nombre} no se empaqueta desde aquí: este package.json trae lo que solo sirve en el monorepo. ` +
  "Arma el paquete con node scripts/publicable.ts <destino> y corre npm pack o npm publish en <destino>.\n";

/** Lo que solo sirve en el monorepo y no viaja en el paquete publicado. */
const SOLO_MONOREPO = ["devDependencies", "scripts"] as const;
/** Los campos de dependencias que viajan en el paquete y pueden nombrar otro del workspace. */
const DEPENDENCIAS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
/** Un paquete interno del monorepo o un rango de pnpm workspace, que npm no podría instalar. */
const INTERNO = /@mexicoapi\/[\w.-]+|workspace:[^"]*/;

type Manifiesto = Record<string, unknown>;
/** Nombre de un paquete del workspace y el rango con que se publica, por ejemplo `^0.1.0`. */
export type Versiones = Readonly<Record<string, string>>;

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

/**
 * El manifiesto sin devDependencies ni scripts y con el rango `workspace:` de cada dependencia que
 * está en `versiones` cambiado por su rango publicado. Falla si lo demás nombra un paquete interno
 * o un rango `workspace:`.
 */
export function manifiestoPublicable(
  manifiesto: Readonly<Manifiesto>,
  versiones: Versiones = {},
): Manifiesto {
  const publicable: Manifiesto = {};
  for (const [campo, valor] of Object.entries(manifiesto)) {
    if (!(SOLO_MONOREPO as readonly string[]).includes(campo)) publicable[campo] = valor;
  }
  for (const campo of DEPENDENCIAS) {
    const dependencias = publicable[campo];
    if (typeof dependencias !== "object" || dependencias === null) continue;
    publicable[campo] = Object.fromEntries(
      Object.entries(dependencias).map(([nombre, rango]) => {
        const delWorkspace = typeof rango === "string" && rango.startsWith("workspace:");
        const publicado = delWorkspace && Object.hasOwn(versiones, nombre);
        return [nombre, publicado ? versiones[nombre] : rango];
      }),
    );
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
        `falta ${entrada} (lo lista files); compila antes con ` +
          `pnpm --filter ${String(manifiesto.name)}... build`,
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
 * Revisa que `carpeta` (el paquete o su copia publicable) traiga un CHANGELOG.md cuyo primer
 * encabezado `## ` empiece con la versión de su package.json, por ejemplo `## 0.1.0 (sin publicar)`
 * o `## 0.1.0 (2026-10-20)`. El workflow de publicación lo usa antes de `npm publish`.
 */
export async function revisarHistorial(carpeta: string): Promise<void> {
  const { version } = JSON.parse(
    await readFile(join(carpeta, "package.json"), "utf8"),
  ) as Manifiesto;
  let historial: string;
  try {
    historial = await readFile(join(carpeta, "CHANGELOG.md"), "utf8");
  } catch {
    throw new Error(`falta CHANGELOG.md en ${carpeta}`);
  }
  const encabezado = /^## (\S.*)$/m.exec(historial)?.[1];
  if (encabezado === undefined) throw new Error("CHANGELOG.md no tiene ningún encabezado ##");
  const versionDelHistorial = encabezado.split(/\s/)[0];
  if (versionDelHistorial !== version) {
    throw new Error(
      `el primer encabezado de CHANGELOG.md es "## ${encabezado}", pero la versión es ${String(version)}`,
    );
  }
}

/**
 * Arma en `destino` (que no existe o está vacío, fuera de `raiz`) el paquete de `raiz` tal como se
 * publica, con las dependencias del workspace en `versiones` (ver manifiestoPublicable). Si algo
 * falla, no deja nada a medias. Devuelve lo que copió de `files`.
 */
export async function armarPublicable(
  raiz: string,
  destino: string,
  versiones: Versiones = {},
): Promise<string[]> {
  // Dentro del paquete, npm pack lo tomaría por parte de packages/sdk y cp se copiaría a sí mismo.
  const desdeRaiz = relative(resolve(raiz), resolve(destino));
  const fuera = isAbsolute(desdeRaiz) || desdeRaiz === ".." || desdeRaiz.startsWith(`..${sep}`);
  if (!fuera) throw new Error(`el destino debe estar fuera de ${raiz}`);
  const manifiesto = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as Manifiesto;
  const publicable = manifiestoPublicable(manifiesto, versiones);
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
    await revisarHistorial(destino);
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
  /** Rango publicado de cada dependencia del workspace (ver manifiestoPublicable). */
  versiones?: Versiones | undefined;
}

export async function principal(
  argv: readonly string[],
  opciones: OpcionesPrincipal,
): Promise<number> {
  if (opciones.evento === "prepack") {
    let nombre = "el paquete";
    try {
      const manifiesto = await readFile(join(opciones.raiz, "package.json"), "utf8");
      nombre = String((JSON.parse(manifiesto) as Manifiesto).name);
    } catch {
      // Sin un manifiesto legible el aviso es el mismo, sin el nombre.
    }
    opciones.errores(`publicable: ${noDesdeAqui(nombre)}`);
    return 1;
  }
  const [destino, ...resto] = argv;
  if (destino === undefined || resto.length > 0) {
    opciones.errores(USO);
    return 2;
  }
  try {
    const files = await armarPublicable(opciones.raiz, destino, opciones.versiones);
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
