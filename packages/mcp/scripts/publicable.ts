// Arma en otra carpeta el paquete `mexicoapi-mcp` tal como se publica, con el mismo código que el
// de `mexicoapi` (packages/sdk/scripts/publicable.ts): lo que lista `files` (dist, README.md,
// LICENSE) y un package.json sin `devDependencies` ni `scripts`. La dependencia `mexicoapi`, que en
// el monorepo es `workspace:*`, se publica como `^<versión de packages/sdk>`. Ese rango no basta
// para que los datos nuevos lleguen a quien ya usó `npx -y mexicoapi-mcp`: npx no actualiza las
// dependencias de un paquete que no cambió de versión. Por eso cada versión de mexicoapi va seguida
// de un patch de mexicoapi-mcp armado con este script, cuyo piso sube a la versión nueva; la
// instalación vieja ya no lo cumple y npx la reinstala. npm pack y npm publish se corren en esa
// carpeta.
//
//   node scripts/publicable.ts <destino>               después de pnpm --filter mexicoapi-mcp... build
//   node scripts/publicable.ts --publicar <destino>    además revisa que mexicoapi@<versión> ya
//                                                      esté en npm (antes de npm publish)
import { spawnSync } from "node:child_process";
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
const PUBLICAR = "--publicar";

/** El rango con que se publica la dependencia `mexicoapi`: ^ y la versión de `raizSdk`. */
export async function rangoMexicoapi(raizSdk: string): Promise<string> {
  const archivo = join(raizSdk, "package.json");
  const { name, version } = JSON.parse(await readFile(archivo, "utf8")) as Record<string, unknown>;
  if (name !== "mexicoapi" || typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`${archivo} no es el de mexicoapi con una versión exacta`);
  }
  return `^${version}`;
}

/** Lo que dejó `npm view <paquete>@<versión> version --json`. */
export interface RespuestaNpm {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * true si npm respondió `version`; false si respondió otra cosa o un 404 (no existe el paquete o
 * esa versión). Lanza si npm falló por otra razón, para no confundir una red caída con un 404.
 */
export function publicadaEnNpm(respuesta: RespuestaNpm, version: string): boolean {
  if (respuesta.status === 0) {
    const texto = respuesta.stdout.trim();
    return texto !== "" && JSON.parse(texto) === version;
  }
  if (/\bE404\b/.test(respuesta.stderr)) return false;
  const motivo = respuesta.stderr.trim().split("\n")[0] ?? "";
  throw new Error(`no se pudo consultar npm: ${motivo || `salió con ${respuesta.status}`}`);
}

function npmView(spec: string): RespuestaNpm {
  // En Windows npm es un .cmd: va con shell. spec solo trae el nombre, @ y una versión semver.
  const r = spawnSync(`npm view ${spec} version --json`, { encoding: "utf8", shell: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export interface OpcionesMcp extends Omit<OpcionesPrincipal, "versiones"> {
  /** Carpeta de packages/sdk, de donde sale la versión de mexicoapi. */
  raizSdk: string;
  /** Con --publicar: consulta npm (por omisión, `npm view`). */
  consultarNpm?: (spec: string) => RespuestaNpm;
}

export async function principal(argv: readonly string[], opciones: OpcionesMcp): Promise<number> {
  const { raizSdk, consultarNpm = npmView, ...comunes } = opciones;
  const publicar = argv.includes(PUBLICAR);
  const resto = argv.filter((a) => a !== PUBLICAR);
  let versiones: Versiones = {};
  // Como prepack, principalComun se niega antes de leer nada.
  if (opciones.evento !== "prepack") {
    try {
      const rango = await rangoMexicoapi(raizSdk);
      // Sin destino, principalComun solo muestra el uso: no hace falta consultar npm.
      if (publicar && resto.length === 1) {
        const version = rango.slice(1);
        if (!publicadaEnNpm(consultarNpm(`mexicoapi@${version}`), version)) {
          throw new Error(
            `mexicoapi@${version} todavía no está en npm: publícalo antes que mexicoapi-mcp, ` +
              `que depende de ${rango}`,
          );
        }
      }
      versiones = { mexicoapi: rango };
    } catch (error) {
      opciones.errores(`publicable: ${(error as Error).message}\n`);
      return 1;
    }
  }
  return principalComun(resto, { ...comunes, versiones });
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
