// Empaqueta para el navegador, como lo haría un bundler, cada entrada universal de mexicoapi
// instalada en un proyecto: esbuild con platform "browser", format "esm" y bundle, sin minificar ni
// dividir (el bundle trae también lo que la entrada carga con import()). Falla si una entrada llega
// a un módulo de Node, si no se puede armar, si carga archivos de fuera del paquete o si la
// principal pasa de LIMITE_GZIP_PRINCIPAL bytes con gzip. CI lo corre sobre el .tgz instalado en un
// proyecto nuevo, y las pruebas del paquete también. Los avisos de esbuild no cuentan: los calla
// para el código que está en node_modules.
// esbuild es el del lockfile que usa wrangler (devDependency de este paquete): no suma dependencias.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
//
//   node scripts/navegador.ts <proyecto>   con mexicoapi instalado en <proyecto>/node_modules
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { entradasUniversales, esModuloDeNode, LIMITE_GZIP_PRINCIPAL } from "./revisar.ts";

const PAQUETE = "mexicoapi";
const USO =
  "uso: node scripts/navegador.ts <proyecto>\n" +
  "  empaqueta para el navegador cada entrada universal de mexicoapi instalada en <proyecto>.\n";
/** Nombre del módulo virtual que importa la entrada, como lo haría el código de quien la usa. */
const ENTRADA = "entrada.js";

/** Un error de esbuild. */
interface Mensaje {
  text: string;
  location: { file: string; line: number } | null;
}

interface Resolucion {
  path: string;
  importer: string;
}

interface Plugin {
  name: string;
  setup(build: {
    onResolve(
      opciones: { filter: RegExp },
      resolver: (args: Resolucion) => { path: string; external: true } | undefined,
    ): void;
  }): void;
}

/** Lo que este script usa de la API de esbuild. */
export interface Esbuild {
  version: string;
  build(opciones: Record<string, unknown>): Promise<{
    outputFiles: { contents: Uint8Array }[];
    metafile: { inputs: Record<string, unknown> };
  }>;
}

export interface Entrada {
  /** La ruta de `exports` (`.`, `./datos`...). */
  ruta: string;
  /** Cómo la importa quien usa el paquete (`mexicoapi`, `mexicoapi/datos`...). */
  especificador: string;
  /** Bytes del bundle y de ese bundle con gzip (nivel por omisión de zlib); 0 si no se armó. */
  bytes: number;
  gzip: number;
  /** Lo que haría fallar la revisión; vacío si está bien. */
  problemas: string[];
}

/** El esbuild de wrangler, resuelto desde wrangler: no es dependencia de este paquete. */
export function cargarEsbuild(): Esbuild {
  const wrangler = createRequire(import.meta.url).resolve("wrangler/package.json");
  return createRequire(wrangler)("esbuild") as Esbuild;
}

const mensaje = (m: Mensaje): string =>
  m.location === null ? m.text : `${m.text} (${m.location.file}:${m.location.line})`;

async function empaquetar(raiz: string, ruta: string, esbuild: Esbuild): Promise<Entrada> {
  const especificador = ruta === "." ? PAQUETE : `${PAQUETE}/${ruta.slice(2)}`;
  const problemas: string[] = [];
  const enProyecto = (archivo: string): string => relative(raiz, archivo).split(sep).join("/");
  // Un módulo de Node queda fuera del bundle y se anota, para decir todos y desde dónde.
  const modulosDeNode: Plugin = {
    name: "modulos-de-node",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, ({ path, importer }) => {
        if (!esModuloDeNode(path)) return undefined;
        problemas.push(`importa ${path} (en ${enProyecto(importer)})`);
        return { path, external: true };
      });
    },
  };
  let resultado: Awaited<ReturnType<Esbuild["build"]>>;
  try {
    resultado = await esbuild.build({
      stdin: {
        contents: `export * from ${JSON.stringify(especificador)};\n`,
        resolveDir: raiz,
        sourcefile: ENTRADA,
        loader: "js",
      },
      absWorkingDir: raiz,
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
      plugins: [modulosDeNode],
    });
  } catch (error) {
    const errores = (error as { errors?: Mensaje[] }).errors;
    if (errores === undefined) throw error;
    return {
      ruta,
      especificador,
      bytes: 0,
      gzip: 0,
      problemas: [...problemas, ...errores.map(mensaje)],
    };
  }
  for (const archivo of Object.keys(resultado.metafile.inputs)) {
    if (archivo !== ENTRADA && !archivo.startsWith(`node_modules/${PAQUETE}/`)) {
      problemas.push(`carga ${archivo}, de fuera del paquete`);
    }
  }
  const [bundle, ...otros] = resultado.outputFiles;
  if (bundle === undefined || otros.length > 0) {
    const cuantos = resultado.outputFiles.length;
    throw new Error(`esbuild dio ${cuantos} archivos para ${especificador}, no uno`);
  }
  const codigo = bundle.contents;
  const gzip = gzipSync(codigo).length;
  if (ruta === "." && gzip > LIMITE_GZIP_PRINCIPAL) {
    problemas.push(
      `pesa ${gzip} bytes con gzip; el tope de la entrada principal es ${LIMITE_GZIP_PRINCIPAL}`,
    );
  }
  return { ruta, especificador, bytes: codigo.length, gzip, problemas };
}

/** Empaqueta cada entrada universal del mexicoapi instalado en `proyecto`, en el orden de exports. */
export async function empaquetarEntradas(
  proyecto: string,
  esbuild: Esbuild = cargarEsbuild(),
): Promise<Entrada[]> {
  const raiz = resolve(proyecto);
  const manifiesto = join(raiz, "node_modules", PAQUETE, "package.json");
  const { exports } = JSON.parse(await readFile(manifiesto, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const entradas: Entrada[] = [];
  for (const { ruta } of entradasUniversales(exports ?? {})) {
    entradas.push(await empaquetar(raiz, ruta, esbuild));
  }
  return entradas;
}

export interface OpcionesPrincipal {
  salida: (texto: string) => void;
  errores: (texto: string) => void;
}

export async function principal(
  argv: readonly string[],
  opciones: OpcionesPrincipal,
): Promise<number> {
  const [proyecto, ...resto] = argv;
  if (proyecto === undefined || resto.length > 0) {
    opciones.errores(USO);
    return 2;
  }
  try {
    const esbuild = cargarEsbuild();
    const entradas = await empaquetarEntradas(proyecto, esbuild);
    if (!entradas.some((e) => e.ruta === ".")) {
      throw new Error(`${PAQUETE} no declara su entrada principal en exports`);
    }
    opciones.salida(`navegador: esbuild ${esbuild.version}, platform browser, format esm\n`);
    let problemas = 0;
    for (const e of entradas) {
      const tope = e.ruta === "." ? ` (tope ${LIMITE_GZIP_PRINCIPAL})` : "";
      opciones.salida(
        `navegador: ${e.especificador}: ${e.bytes} bytes, ${e.gzip} con gzip${tope}\n`,
      );
      for (const p of e.problemas) opciones.errores(`navegador: ${e.especificador}: ${p}\n`);
      problemas += e.problemas.length;
    }
    if (problemas > 0) return 1;
    opciones.salida("navegador: OK\n");
    return 0;
  } catch (error) {
    // Lo que lanzan este script, node:fs y JSON.parse siempre es un Error.
    opciones.errores(`navegador: ${(error as Error).message}\n`);
    return 1;
  }
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    salida: (texto) => process.stdout.write(texto),
    errores: (texto) => process.stderr.write(texto),
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`navegador.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
