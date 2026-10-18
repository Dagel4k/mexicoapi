// Las revisiones de .github/workflows/publicacion.yml antes de publicar en npm, a partir de la
// etiqueta del Release (`mexicoapi@X.Y.Z` o `mexicoapi-mcp@X.Y.Z`). Cada comando escribe en stdout
// líneas `clave=valor` para GITHUB_OUTPUT, o falla con el motivo en stderr.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
//
//   node scripts/liberacion.ts revisar <etiqueta>   el package.json y el CHANGELOG.md del paquete
//   node scripts/liberacion.ts npm <etiqueta>       si la versión se puede publicar en npm
//   node scripts/liberacion.ts verify <sha>         si el check verify de CI pasó en ese commit
//                                                   (lee de stdin la respuesta de la API de GitHub)
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USO =
  "uso: node scripts/liberacion.ts revisar <etiqueta> | npm <etiqueta> | verify <sha>\n" +
  "  <etiqueta> es mexicoapi@X.Y.Z o mexicoapi-mcp@X.Y.Z; verify lee de stdin la respuesta de\n" +
  "  GET /repos/<repo>/commits/<sha>/check-runs?check_name=verify.\n";

/** Cada paquete que se publica y su carpeta en el repositorio. */
export const PAQUETES: Readonly<Record<string, string>> = {
  mexicoapi: "packages/sdk",
  "mexicoapi-mcp": "packages/mcp",
};

const ETIQUETA = /^([a-z-]+)@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(-[0-9A-Za-z.-]+)?$/;
const FORMATO = "mexicoapi@X.Y.Z o mexicoapi-mcp@X.Y.Z (X, Y y Z números sin ceros a la izquierda)";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;

export interface Liberacion {
  nombre: string;
  version: string;
  /** Carpeta del paquete desde la raíz del repositorio. */
  carpeta: string;
}

/** El paquete, la versión y la carpeta de una etiqueta `mexicoapi@X.Y.Z` o `mexicoapi-mcp@X.Y.Z`. */
export function leerEtiqueta(etiqueta: string): Liberacion {
  const partes = ETIQUETA.exec(etiqueta);
  const nombre = partes?.[1];
  const version = partes?.[2];
  if (nombre === undefined || version === undefined || !Object.hasOwn(PAQUETES, nombre)) {
    throw new Error(`la etiqueta ${JSON.stringify(etiqueta)} no es ${FORMATO}`);
  }
  if (partes?.[3] !== undefined) {
    throw new Error(
      `la etiqueta ${JSON.stringify(etiqueta)} es de una pre-versión: por ahora no se publican ` +
        `pre-versiones, solo ${FORMATO}`,
    );
  }
  return { nombre, version, carpeta: PAQUETES[nombre] as string };
}

/** Revisa que el package.json de la carpeta sea del paquete y la versión de la etiqueta. */
export function revisarManifiesto(manifiesto: unknown, liberacion: Liberacion): void {
  const archivo = `${liberacion.carpeta}/package.json`;
  if (typeof manifiesto !== "object" || manifiesto === null || Array.isArray(manifiesto)) {
    throw new Error(`${archivo} no es un objeto JSON`);
  }
  const { name, version } = manifiesto as Record<string, unknown>;
  if (name !== liberacion.nombre) {
    throw new Error(
      `${archivo} es del paquete ${JSON.stringify(name)}, no de ${liberacion.nombre}`,
    );
  }
  if (version !== liberacion.version) {
    throw new Error(
      `la etiqueta es de ${liberacion.nombre}@${liberacion.version}, pero ${archivo} dice ` +
        `${JSON.stringify(version)}: crea el Release sobre el commit que sube la versión`,
    );
  }
}

/** true si `fecha` (AAAA-MM-DD) es un día que existe. */
function fechaValida(fecha: string): boolean {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia)).toISOString().slice(0, 10) === fecha;
}

/**
 * Revisa que el primer encabezado `## ` del historial (`archivo`) sea `## <versión> (AAAA-MM-DD)`:
 * lo que se publica ya no dice "(sin publicar)".
 */
export function revisarFecha(historial: string, version: string, archivo = "CHANGELOG.md"): void {
  const encabezado = /^## .*$/m.exec(historial)?.[0].trimEnd();
  if (encabezado === undefined) throw new Error(`${archivo} no tiene ningún encabezado ##`);
  const fecha = /^## (\S+) \((\d{4}-\d{2}-\d{2})\)$/.exec(encabezado);
  if (fecha?.[1] === version && fechaValida(fecha[2] as string)) return;
  const motivo = encabezado.startsWith(`## ${version} (sin publicar)`)
    ? `: el PR de la versión cambia "sin publicar" por la fecha`
    : "";
  throw new Error(
    `el primer encabezado de ${archivo} es "${encabezado}" y debe ser "## ${version} (AAAA-MM-DD)"${motivo}`,
  );
}

/** Lee el package.json y el CHANGELOG.md del paquete en `raiz` y los revisa. */
async function revisarCarpeta(raiz: string, liberacion: Liberacion): Promise<void> {
  const leer = async (archivo: string): Promise<string> => {
    try {
      return await readFile(join(raiz, liberacion.carpeta, archivo), "utf8");
    } catch {
      throw new Error(`no se pudo leer ${liberacion.carpeta}/${archivo}`);
    }
  };
  let manifiesto: unknown;
  try {
    manifiesto = JSON.parse(await leer("package.json"));
  } catch (error) {
    throw error instanceof SyntaxError
      ? new Error(`${liberacion.carpeta}/package.json no es JSON`)
      : error;
  }
  revisarManifiesto(manifiesto, liberacion);
  const historial = await leer("CHANGELOG.md");
  revisarFecha(historial, liberacion.version, `${liberacion.carpeta}/CHANGELOG.md`);
}

/** Un número de versión: más dígitos es mayor; con los mismos, el orden del texto. */
const compararNumeros = (a: string, b: string): number =>
  a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;

/** Precedencia semver: negativo si `a` va antes que `b`, 0 si son iguales, positivo si después. */
export function compararVersiones(a: string, b: string): number {
  const [pa, pb] = [a, b].map((v) => {
    const partes = SEMVER.exec(v);
    if (partes === null) throw new Error(`${JSON.stringify(v)} no es una versión semver`);
    return partes;
  }) as [RegExpExecArray, RegExpExecArray];
  for (const i of [1, 2, 3]) {
    const diferencia = compararNumeros(pa[i] as string, pb[i] as string);
    if (diferencia !== 0) return diferencia;
  }
  const [preA, preB] = [pa[4], pb[4]];
  if (preA === undefined || preB === undefined) {
    // Sin pre-versión va después que con ella.
    return (preA === undefined ? 1 : 0) - (preB === undefined ? 1 : 0);
  }
  const [idsA, idsB] = [preA.split("."), preB.split(".")];
  for (let i = 0; i < Math.min(idsA.length, idsB.length); i += 1) {
    const [x, y] = [idsA[i] as string, idsB[i] as string];
    const [numX, numY] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    let diferencia: number;
    if (numX && numY) diferencia = compararNumeros(x, y);
    else if (numX || numY) diferencia = numX ? -1 : 1;
    else diferencia = x < y ? -1 : x > y ? 1 : 0;
    if (diferencia !== 0) return diferencia;
  }
  return idsA.length - idsB.length;
}

/** Lo que dejó `npm view <paquete> versions --json`. */
export interface RespuestaNpm {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type EstadoNpm = { estado: "publicable"; ultima: string } | { estado: "sin-paquete" };

/**
 * `publicable` si el paquete existe en npm y la versión es mayor que todas las publicadas;
 * `sin-paquete` si npm responde 404 (la primera versión se publica a mano). Lanza si la versión ya
 * está o es menor, y si npm falla por otra razón, para no confundir una red caída con un 404.
 */
export function estadoEnNpm(
  respuesta: RespuestaNpm,
  liberacion: Pick<Liberacion, "nombre" | "version">,
): EstadoNpm {
  const { nombre, version } = liberacion;
  if (respuesta.status !== 0) {
    // npm 11 escribe `npm error code E404`; versiones anteriores, `npm ERR! code E404`.
    if (/\bcode E404\b/.test(respuesta.stderr)) return { estado: "sin-paquete" };
    const motivo = respuesta.stderr.trim().split("\n")[0]?.trim() ?? "";
    throw new Error(`no se pudo consultar npm: ${motivo || `salió con ${respuesta.status}`}`);
  }
  let versiones: unknown;
  try {
    versiones = JSON.parse(respuesta.stdout);
  } catch {
    versiones = undefined;
  }
  // Con una sola versión, npm la escribe sin la lista.
  if (typeof versiones === "string") versiones = [versiones];
  if (
    !Array.isArray(versiones) ||
    versiones.length === 0 ||
    !versiones.every((v) => typeof v === "string" && SEMVER.test(v))
  ) {
    throw new Error(`respuesta inesperada de npm view ${nombre} versions: ${respuesta.stdout}`);
  }
  if (versiones.includes(version)) {
    throw new Error(
      `${nombre}@${version} ya está en npm: un número publicado no se puede volver a usar, ` +
        "sube la versión en un PR nuevo",
    );
  }
  const ultima = (versiones as string[]).reduce((a, b) => (compararVersiones(a, b) >= 0 ? a : b));
  if (compararVersiones(version, ultima) < 0) {
    throw new Error(
      `${version} es menor que ${ultima}, la versión más reciente de ${nombre} en npm: ` +
        "solo se publican versiones nuevas",
    );
  }
  return { estado: "publicable", ultima };
}

/**
 * Revisa la respuesta de `GET /repos/<repo>/commits/<sha>/check-runs?check_name=verify`: la corrida
 * más reciente del check `verify` de GitHub Actions en `sha` terminó con éxito.
 */
export function revisarVerify(respuesta: unknown, sha: string): void {
  const corridas = (respuesta as { check_runs?: unknown } | null)?.check_runs;
  if (
    !Array.isArray(corridas) ||
    !corridas.every((c) => typeof c === "object" && c !== null && typeof c.id === "number")
  ) {
    throw new Error("respuesta inesperada de la API de GitHub (check runs)");
  }
  const delVerify = (corridas as Record<string, unknown>[]).filter(
    (c) =>
      c.name === "verify" &&
      c.head_sha === sha &&
      (c.app as { slug?: unknown } | null)?.slug === "github-actions",
  );
  const ultima = delVerify.sort((a, b) => (b.id as number) - (a.id as number))[0];
  if (ultima === undefined) {
    throw new Error(
      `el commit ${sha} no tiene el check verify de CI. CI corre en el último commit de cada ` +
        "push a main: crea el Release sobre ese commit",
    );
  }
  if (ultima.status !== "completed") {
    throw new Error(
      `verify todavía no termina en ${sha} (${String(ultima.status)}): cuando termine en verde, ` +
        "vuelve a correr este workflow",
    );
  }
  if (ultima.conclusion !== "success") {
    throw new Error(
      `verify terminó con ${String(ultima.conclusion)} en ${sha}: solo se publica un commit con ` +
        "CI en verde",
    );
  }
}

/** El error como anotación de GitHub Actions, en una sola línea. */
export function comoAnotacion(mensaje: string): string {
  const escapado = mensaje.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::error title=liberacion::${escapado}\n`;
}

/** Lo que usa npmView de spawnSync. */
export type Ejecutar = (
  comando: string,
  opciones: { encoding: "utf8"; shell: true },
) => { status: number | null; stdout: string | null; stderr: string | null };

/** `npm view <nombre> versions --json`. */
export function npmView(nombre: string, ejecutar: Ejecutar = spawnSync): RespuestaNpm {
  // En Windows npm es un .cmd: va con shell. nombre es uno de PAQUETES.
  const r = ejecutar(`npm view ${nombre} versions --json`, { encoding: "utf8", shell: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Todo lo que trae un flujo (por omisión, stdin), como texto. */
export async function leerTodo(flujo: AsyncIterable<unknown> = process.stdin): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of flujo) partes.push(Buffer.from(parte as Buffer | string));
  return Buffer.concat(partes).toString("utf8");
}

export interface OpcionesLiberacion {
  /** Raíz del repositorio. */
  raiz: string;
  salida: (texto: string) => void;
  errores: (texto: string) => void;
  /** Los errores como anotaciones de GitHub Actions. */
  anotar?: boolean | undefined;
  /** Consulta `npm view <nombre> versions --json` (por omisión, con npm). */
  consultarNpm?: (nombre: string) => RespuestaNpm;
  /** La entrada de `verify` (por omisión, stdin). */
  leerEntrada?: () => Promise<string>;
}

export async function principal(
  argv: readonly string[],
  opciones: OpcionesLiberacion,
): Promise<number> {
  const { consultarNpm = npmView, leerEntrada = leerTodo } = opciones;
  const [comando, argumento, ...resto] = argv;
  if (
    !["revisar", "npm", "verify"].includes(comando ?? "") ||
    argumento === undefined ||
    resto.length > 0
  ) {
    opciones.errores(USO);
    return 2;
  }
  try {
    if (comando === "verify") {
      if (!SHA.test(argumento)) {
        throw new Error(`${JSON.stringify(argumento)} no es el SHA completo de un commit`);
      }
      let respuesta: unknown;
      try {
        respuesta = JSON.parse(await leerEntrada());
      } catch {
        throw new Error("respuesta inesperada de la API de GitHub: no es JSON");
      }
      revisarVerify(respuesta, argumento);
      opciones.salida(`verify terminó bien en ${argumento}\n`);
      return 0;
    }
    const liberacion = leerEtiqueta(argumento);
    if (comando === "revisar") {
      await revisarCarpeta(opciones.raiz, liberacion);
      const { nombre, version, carpeta } = liberacion;
      opciones.salida(`nombre=${nombre}\nversion=${version}\ncarpeta=${carpeta}\n`);
      return 0;
    }
    const estado = estadoEnNpm(consultarNpm(liberacion.nombre), liberacion);
    opciones.salida(
      estado.estado === "publicable"
        ? `estado=publicable\nultima=${estado.ultima}\n`
        : "estado=sin-paquete\n",
    );
    return 0;
  } catch (error) {
    // Lo que lanzan este script y node:fs siempre es un Error.
    const mensaje = (error as Error).message;
    opciones.errores(
      opciones.anotar === true ? comoAnotacion(mensaje) : `liberacion: ${mensaje}\n`,
    );
    return 1;
  }
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    raiz: fileURLToPath(new URL("../../..", import.meta.url)),
    salida: (texto) => process.stdout.write(texto),
    errores: (texto) => process.stderr.write(texto),
    anotar: process.env.GITHUB_ACTIONS === "true",
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`liberacion.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
