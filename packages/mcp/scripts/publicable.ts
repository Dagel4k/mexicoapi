// Arma en otra carpeta el paquete `mexicoapi-mcp` tal como se publica, con el mismo código que el
// de `mexicoapi` (packages/sdk/scripts/publicable.ts): lo que lista `files` (dist, README.md,
// LICENSE) y un package.json sin `devDependencies` ni `scripts`. La dependencia `mexicoapi`, que en
// el monorepo es `workspace:*`, se publica como `^<versión de packages/sdk>`: los datos nuevos
// salen como versiones patch de mexicoapi y llegan a quien usa `npx -y mexicoapi-mcp` sin publicar
// otra vez el servidor. npm pack y npm publish se corren en esa carpeta.
//
//   node scripts/publicable.ts <destino>   después de pnpm --filter mexicoapi-mcp... build
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type OpcionesPrincipal,
  principal as principalComun,
  type Versiones,
} from "../../sdk/scripts/publicable.ts";

/** Una versión semver exacta, sin rango. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** El rango con que se publica la dependencia `mexicoapi`: ^ y la versión de `raizSdk`. */
export async function rangoMexicoapi(raizSdk: string): Promise<string> {
  const archivo = join(raizSdk, "package.json");
  const { name, version } = JSON.parse(await readFile(archivo, "utf8")) as Record<string, unknown>;
  if (name !== "mexicoapi" || typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`${archivo} no es el de mexicoapi con una versión exacta`);
  }
  return `^${version}`;
}

export interface OpcionesMcp extends Omit<OpcionesPrincipal, "versiones"> {
  /** Carpeta de packages/sdk, de donde sale la versión de mexicoapi. */
  raizSdk: string;
}

export async function principal(argv: readonly string[], opciones: OpcionesMcp): Promise<number> {
  const { raizSdk, ...comunes } = opciones;
  let versiones: Versiones = {};
  // Como prepack, principalComun se niega antes de leer nada.
  if (opciones.evento !== "prepack") {
    try {
      versiones = { mexicoapi: await rangoMexicoapi(raizSdk) };
    } catch (error) {
      opciones.errores(`publicable: ${(error as Error).message}\n`);
      return 1;
    }
  }
  return principalComun(argv, { ...comunes, versiones });
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    raiz: fileURLToPath(new URL("..", import.meta.url)),
    raizSdk: fileURLToPath(new URL("../../sdk", import.meta.url)),
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
