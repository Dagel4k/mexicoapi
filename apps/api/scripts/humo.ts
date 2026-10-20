// Prueba de humo de una API desplegada: pide las rutas principales y las páginas del sitio y
// comprueba estado, tipo de contenido, forma mínima del cuerpo y los encabezados de seguridad.
// Con una base https, también que `/v1` por http da 403 https-requerido; con `--robots`, el
// `X-Robots-Tag` de cada entorno. Lo usa el flujo de despliegue tras cada publicación y las
// pruebas de integración contra el Worker local.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface ResultadoHumo {
  ok: boolean;
  fallas: string[];
  /** Milisegundos por ruta; incluye las peticiones que fallaron. */
  tiempos: Record<string, number>;
}

/**
 * El `X-Robots-Tag` que se espera: `noindex` en staging (en toda respuesta) y `ninguno` en
 * producción (ausente en `/` y en `/v1`).
 */
export type Robots = "noindex" | "ninguno";

export interface OpcionesHumo {
  fetch?: typeof fetch;
  /** Tope por petición; por omisión 10 s. */
  timeoutMs?: number;
  /** Sin él no se revisa `X-Robots-Tag`. */
  robots?: Robots;
}

type Tipo = "json" | "problema" | "texto" | "html";

/** Una regla para el valor de un encabezado, con la descripción que va en la falla. */
interface Condicion {
  descripcion: string;
  cumple: (valor: string) => boolean;
}

/** Valor exacto, un patrón, una condición, o `null` si no debe venir. */
type Esperado = string | RegExp | Condicion | null;

type Encabezados = readonly (readonly [string, Esperado])[];

interface Comprobacion {
  ruta: string;
  estado: number;
  tipo: Tipo;
  /**
   * Devuelve el motivo de la falla, o `undefined` si el cuerpo es el esperado. En `texto` y `html`
   * recibe el texto del cuerpo.
   */
  validar?: (cuerpo: unknown) => string | undefined;
  /** Los encabezados que debe traer; por omisión, CORS, nosniff, HSTS y Vary. */
  encabezados?: Encabezados;
  /**
   * Se pide por http, sin seguir redirecciones; en los resultados va como `http:// <ruta>`. Vale
   * también una redirección 301, 302, 307 o 308 a la misma URL con https.
   */
  porHttp?: boolean;
  /** Lo que dice la falla cuando el estado no es `estado`; por omisión, `estado`. */
  estadoEsperado?: string;
}

const UN_ANIO = 31_536_000;

/**
 * Si algún valor de `Strict-Transport-Security` pide `max-age` de un año o más. El borde puede
 * agregar el suyo (separado por coma), y un valor más largo o con más directivas no es una falla:
 * un fallo del humo de producción revierte el despliegue.
 */
function hstsDeUnAnio(valor: string): boolean {
  return valor.split(",").some((uno) =>
    uno.split(";").some((directiva) => {
      const [nombre, ...resto] = directiva.split("=");
      if (nombre?.trim().toLowerCase() !== "max-age" || resto.length !== 1) return false;
      const segundos = (resto[0] ?? "").trim().replace(/^"(\d+)"$/, "$1");
      return /^\d+$/.test(segundos) && Number(segundos) >= UN_ANIO;
    }),
  );
}

const HSTS: readonly [string, Esperado] = [
  "strict-transport-security",
  { descripcion: `max-age de ${UN_ANIO} o más`, cumple: hstsDeUnAnio },
];
// La plataforma puede agregar su propio Vary: basta con que nombre Accept-Encoding.
const VARY: readonly [string, Esperado] = ["vary", /(?:^|,)\s*accept-encoding\s*(?:,|$)/i];

const TIEMPO_MAXIMO_MS = 10_000;

// Banco 012, plaza 180, cuenta 00000000001 y dígito de control 5: se obtuvo con
// `digitoControlClabe("01218000000000001")` del núcleo.
const CLABE = "012180000000000015";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Una fecha dentro de la cobertura de las UDIS (la serie empieza el 2020-01-01).
const FECHA_UDI = "2024-06-03";

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined;
}

const dataDe = (cuerpo: unknown): unknown => objeto(cuerpo)?.data;

const COMPROBACIONES: readonly Comprobacion[] = [
  {
    ruta: "/v1/estados",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = dataDe(cuerpo);
      if (!Array.isArray(data) || data.length !== 32) return "no trae 32 estados";
      const asOf = objeto(objeto(cuerpo)?.meta)?.as_of;
      if (typeof asOf !== "string" || !FECHA.test(asOf)) return "meta.as_of no es una fecha";
      return undefined;
    },
  },
  {
    ruta: "/v1/municipios/25006",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = objeto(dataDe(cuerpo));
      return data?.cvegeo === "25006" && data.nombre === "Culiacán"
        ? undefined
        : "no es Culiacán (25006)";
    },
  },
  {
    ruta: "/v1/bancos/012",
    estado: 200,
    tipo: "json",
    validar: (cuerpo) =>
      objeto(dataDe(cuerpo))?.codigo === "012" ? undefined : "no es el banco 012",
  },
  {
    ruta: `/v1/clabe/${CLABE}`,
    estado: 200,
    tipo: "json",
    validar: (cuerpo) =>
      objeto(dataDe(cuerpo))?.valido === true ? undefined : "la CLABE de prueba no es válida",
  },
  {
    ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=1",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const resultado = objeto(dataDe(cuerpo))?.resultado;
      return resultado === "2026-11-17"
        ? undefined
        : `resultado ${String(resultado)}, no 2026-11-17`;
    },
  },
  {
    // El primer periodo de vacaciones del SAT (20 al 31 de julio) se salta: confirma que el
    // calendario curado se carga.
    ruta: "/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-15&dias=10",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const resultado = objeto(dataDe(cuerpo))?.resultado;
      return resultado === "2026-08-12"
        ? undefined
        : `resultado ${String(resultado)}, no 2026-08-12`;
    },
  },
  {
    ruta: "/v1/constantes/uma/2026",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = objeto(dataDe(cuerpo));
      if (data?.anio !== 2026) return "no es la UMA de 2026";
      return typeof data.diaria === "string" && /^\d+\.\d{2}$/.test(data.diaria)
        ? undefined
        : "diaria no es un decimal con 2 decimales";
    },
  },
  {
    // Un año anterior a los datos: el Worker lo distingue de uno futuro con el índice de años de
    // las constantes, así que confirma que ese índice se carga.
    ruta: "/v1/constantes/uma/2015",
    estado: 404,
    tipo: "problema",
    validar(cuerpo) {
      const tipo = objeto(cuerpo)?.type;
      const nombre =
        typeof tipo === "string" ? tipo.slice(tipo.lastIndexOf("#") + 1) : String(tipo);
      return nombre === "no-encontrado" ? undefined : `type ${nombre}, no no-encontrado`;
    },
  },
  {
    ruta: "/v1/tipo-cambio/fix/ultimo",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = objeto(dataDe(cuerpo));
      if (typeof data?.fecha_publicacion !== "string" || !FECHA.test(data.fecha_publicacion)) {
        return "fecha_publicacion no es una fecha";
      }
      return typeof data.valor === "string" && /^\d+\.\d{4}$/.test(data.valor)
        ? undefined
        : "valor no es un decimal con 4 decimales";
    },
  },
  {
    ruta: `/v1/udis?fecha=${FECHA_UDI}`,
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = objeto(dataDe(cuerpo));
      if (data?.fecha !== FECHA_UDI) return `fecha ${String(data?.fecha)}, no ${FECHA_UDI}`;
      return typeof data.valor === "string" && /^\d+\.\d{6}$/.test(data.valor)
        ? undefined
        : "valor no es un decimal con 6 decimales";
    },
  },
  { ruta: "/v1/estados/33", estado: 404, tipo: "problema" },
  {
    ruta: "/v1/status",
    estado: 200,
    tipo: "json",
    validar(cuerpo) {
      const data = dataDe(cuerpo);
      if (!Array.isArray(data)) return "data no es una lista";
      return data.length > 0 ? undefined : "data no trae datasets";
    },
  },
  { ruta: "/v1/openapi.json", estado: 200, tipo: "json" },
  { ruta: "/descargas/SHA256SUMS", estado: 200, tipo: "texto" },
  // El sitio lo sirven los assets: la página de inicio no lleva CORS.
  {
    ruta: "/",
    estado: 200,
    tipo: "html",
    encabezados: [["x-content-type-options", "nosniff"], HSTS, VARY],
    validar: (cuerpo) =>
      String(cuerpo).includes("<h1>MéxicoAPI</h1>") ? undefined : "no es la página de inicio",
  },
  {
    ruta: "/llms.txt",
    estado: 200,
    tipo: "texto",
    validar: (cuerpo) =>
      String(cuerpo).startsWith("# MéxicoAPI\n") ? undefined : "no empieza con # MéxicoAPI",
  },
  {
    // Fuera de /v1, lo que no existe es 404.html de los assets, solo con la regla `/*` de
    // _headers (sin CORS). Si lo respondiera el Worker (problem+json), el despliegue habría
    // perdido `not_found_handling`.
    ruta: "/v2",
    estado: 404,
    tipo: "html",
    encabezados: [["x-content-type-options", "nosniff"], ["x-frame-options", "DENY"], HSTS, VARY],
    validar: (cuerpo) =>
      String(cuerpo).includes("<h1>No existe esta página</h1>") ? undefined : "no es 404.html",
  },
];

/**
 * `/v1` por http: 403 https-requerido del Worker, o una redirección de la plataforma a la misma
 * URL con https. Solo con una base https.
 */
const POR_HTTP: Comprobacion = {
  ruta: "/v1/estados",
  estado: 403,
  estadoEsperado: "403 o una redirección a https://",
  tipo: "problema",
  porHttp: true,
  validar(cuerpo) {
    const tipo = objeto(cuerpo)?.type;
    const nombre = typeof tipo === "string" ? tipo.slice(tipo.lastIndexOf("#") + 1) : String(tipo);
    return nombre === "https-requerido" ? undefined : `type ${nombre}, no https-requerido`;
  },
};

const TIPOS: Record<Tipo, string> = {
  json: "application/json",
  problema: "application/problem+json",
  texto: "text/plain",
  html: "text/html",
};

const ENCABEZADOS: Encabezados = [
  ["access-control-allow-origin", "*"],
  ["x-content-type-options", "nosniff"],
  HSTS,
  VARY,
];

const etiqueta = (caso: Comprobacion): string =>
  caso.porHttp === true ? `http:// ${caso.ruta}` : caso.ruta;

/** Lo que se espera de `X-Robots-Tag` en `caso`, o undefined si no se revisa. */
function robotsDe(caso: Comprobacion, robots: Robots | undefined): Esperado | undefined {
  if (robots === "noindex") return "noindex";
  if (robots === "ninguno" && (caso.ruta === "/" || caso.ruta.startsWith("/v1"))) return null;
  return undefined;
}

/** Los encabezados que se revisan en `caso`, con el `X-Robots-Tag` del entorno. */
function encabezadosDe(caso: Comprobacion, robots: Robots | undefined): Encabezados {
  const base = caso.encabezados ?? ENCABEZADOS;
  const conHttp: Encabezados = caso.porHttp === true ? [...base, ["location", null]] : base;
  const tag = robotsDe(caso, robots);
  return tag === undefined ? conHttp : [...conHttp, ["x-robots-tag", tag]];
}

/** Lo que se esperaba, para el texto de la falla. */
function describir(esperado: Esperado): string {
  if (esperado === null) return "ausente";
  if (typeof esperado === "string") return esperado;
  return esperado instanceof RegExp ? String(esperado) : esperado.descripcion;
}

function cumple(actual: string | null, esperado: Esperado): boolean {
  if (esperado === null) return actual === null;
  if (actual === null) return false;
  if (typeof esperado === "string") return actual === esperado;
  return esperado instanceof RegExp ? esperado.test(actual) : esperado.cumple(actual);
}

/** La falla de un encabezado, o undefined si cumple lo esperado. */
function revisarEncabezado(
  nombre: string,
  actual: string | null,
  esperado: Esperado,
): string | undefined {
  if (cumple(actual, esperado)) return undefined;
  const mostrado = actual === null ? "ausente" : actual === "" ? "(vacío)" : actual;
  return `${nombre}: ${mostrado}, se esperaba ${describir(esperado)}`;
}

/** Las redirecciones de la plataforma que valen en la comprobación por http. */
const REDIRECCIONES: readonly number[] = [301, 302, 307, 308];

/** La falla de una redirección de `pedida` (http) que debía ir a `esperada` (https). */
function revisarRedireccion(
  respuesta: Response,
  pedida: string,
  esperada: string,
): string | undefined {
  const location = respuesta.headers.get("location");
  if (location === null || location.trim() === "") {
    return `redirección ${respuesta.status} sin location`;
  }
  let destino: string;
  try {
    destino = new URL(location, pedida).href;
  } catch {
    destino = location;
  }
  return destino === new URL(esperada).href
    ? undefined
    : `redirige a ${location}, se esperaba ${esperada}`;
}

const mensajeDe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Corre `tarea` con un tope de tiempo que cubre la petición y la lectura del cuerpo, aunque el
 * `fetch` recibido ignore la señal.
 */
async function acotar<T>(timeoutMs: number, tarea: (señal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => {
      rechazar(new Error(`sin respuesta en ${timeoutMs} ms`));
      control.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([tarea(control.signal), limite]);
  } finally {
    clearTimeout(reloj);
  }
}

async function revisar(
  respuesta: Response,
  caso: Comprobacion,
  encabezados: Encabezados,
): Promise<string | undefined> {
  if (respuesta.status !== caso.estado) {
    return `estado ${respuesta.status}, se esperaba ${caso.estadoEsperado ?? caso.estado}`;
  }
  const medio = (respuesta.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (medio.toLowerCase() !== TIPOS[caso.tipo]) {
    return `tipo de contenido ${medio || "ausente"}, se esperaba ${TIPOS[caso.tipo]}`;
  }
  for (const [nombre, esperado] of encabezados) {
    const falla = revisarEncabezado(nombre, respuesta.headers.get(nombre), esperado);
    if (falla !== undefined) return falla;
  }
  if (caso.tipo === "texto" || caso.tipo === "html") {
    const texto = await respuesta.text();
    if (texto.trim() === "") return "cuerpo vacío";
    return caso.validar?.(texto);
  }
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return "el cuerpo no es JSON";
  }
  return caso.validar?.(cuerpo);
}

async function comprobar(
  base: string,
  caso: Comprobacion,
  pedidor: typeof fetch,
  opciones: { timeoutMs: number; robots: Robots | undefined },
): Promise<string | undefined> {
  const origen = caso.porHttp === true ? base.replace(/^https:/, "http:") : base;
  const init: RequestInit = caso.porHttp === true ? { redirect: "manual" } : {};
  const url = `${origen}${caso.ruta}`;
  try {
    return await acotar(opciones.timeoutMs, async (signal) => {
      const respuesta = await pedidor(url, { ...init, signal });
      if (caso.porHttp === true && REDIRECCIONES.includes(respuesta.status)) {
        await respuesta.body?.cancel();
        return revisarRedireccion(respuesta, url, `${base}${caso.ruta}`);
      }
      return revisar(respuesta, caso, encabezadosDe(caso, opciones.robots));
    });
  } catch (error) {
    return mensajeDe(error);
  }
}

/** Recorre las comprobaciones contra `base` (por ejemplo `https://api.example.mx`). */
export async function probarHumo(
  base: string,
  opciones: OpcionesHumo = {},
): Promise<ResultadoHumo> {
  const origen = base.replace(/\/+$/, "");
  const pedidor = opciones.fetch ?? fetch;
  const timeoutMs = opciones.timeoutMs ?? TIEMPO_MAXIMO_MS;
  const fallas: string[] = [];
  const tiempos: Record<string, number> = {};
  // Por http solo si la base es https: el Worker local de las pruebas va por http y no da 403.
  const casos = origen.startsWith("https://") ? [...COMPROBACIONES, POR_HTTP] : COMPROBACIONES;
  for (const caso of casos) {
    const inicio = performance.now();
    const falla = await comprobar(origen, caso, pedidor, { timeoutMs, robots: opciones.robots });
    tiempos[etiqueta(caso)] = Math.round(performance.now() - inicio);
    if (falla !== undefined) fallas.push(`${etiqueta(caso)}: ${falla}`);
  }
  return { ok: fallas.length === 0, fallas, tiempos };
}

const leerArgumentos = (argumentos: string[]) =>
  parseArgs({
    args: argumentos,
    allowPositionals: true,
    options: { robots: { type: "string" } },
  });

/** Punto de entrada del CLI: imprime un renglón por ruta y devuelve el código de salida. */
export async function principal(
  argumentos: string[],
  escribir: (texto: string) => void,
  opciones: OpcionesHumo = {},
): Promise<number> {
  const uso = (): number => {
    escribir("Uso: node apps/api/scripts/humo.ts <url-base> [--robots noindex|ninguno]\n");
    return 2;
  };
  let leidos: ReturnType<typeof leerArgumentos>;
  try {
    leidos = leerArgumentos(argumentos);
  } catch {
    return uso();
  }
  const [base, ...sobran] = leidos.positionals;
  const robots = leidos.values.robots;
  if (base === undefined || sobran.length > 0 || !/^https?:\/\/\S+$/.test(base)) return uso();
  if (robots !== undefined && robots !== "noindex" && robots !== "ninguno") return uso();
  const { ok, fallas, tiempos } = await probarHumo(base, {
    ...opciones,
    ...(robots === undefined ? {} : { robots }),
  });
  for (const [ruta, ms] of Object.entries(tiempos)) {
    const falla = fallas.some((f) => f.startsWith(`${ruta}: `));
    escribir(`${falla ? "FALLA" : "ok   "} ${String(ms).padStart(5)} ms  ${ruta}\n`);
  }
  for (const falla of fallas) escribir(`falla: ${falla}\n`);
  escribir(ok ? "Prueba de humo correcta.\n" : `Prueba de humo con ${fallas.length} falla(s).\n`);
  return ok ? 0 : 1;
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin probar nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), (texto) => {
    process.stdout.write(texto);
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`humo.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
