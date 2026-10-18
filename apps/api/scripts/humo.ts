// Prueba de humo de una API desplegada: pide las rutas principales y comprueba estado, tipo de
// contenido, forma mínima del cuerpo y los encabezados de seguridad. Lo usa el flujo de despliegue
// tras cada publicación y las pruebas de integración contra el Worker local.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResultadoHumo {
  ok: boolean;
  fallas: string[];
  /** Milisegundos por ruta; incluye las peticiones que fallaron. */
  tiempos: Record<string, number>;
}

export interface OpcionesHumo {
  fetch?: typeof fetch;
  /** Tope por petición; por omisión 10 s. */
  timeoutMs?: number;
}

type Tipo = "json" | "problema" | "texto";

interface Comprobacion {
  ruta: string;
  estado: number;
  tipo: Tipo;
  /** Devuelve el motivo de la falla, o `undefined` si el cuerpo es el esperado. */
  validar?: (cuerpo: unknown) => string | undefined;
}

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
];

const TIPOS: Record<Tipo, string> = {
  json: "application/json",
  problema: "application/problem+json",
  texto: "text/plain",
};

const ENCABEZADOS: readonly (readonly [string, string])[] = [
  ["access-control-allow-origin", "*"],
  ["x-content-type-options", "nosniff"],
];

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

async function revisar(respuesta: Response, caso: Comprobacion): Promise<string | undefined> {
  if (respuesta.status !== caso.estado) {
    return `estado ${respuesta.status}, se esperaba ${caso.estado}`;
  }
  const medio = (respuesta.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (medio.toLowerCase() !== TIPOS[caso.tipo]) {
    return `tipo de contenido ${medio || "ausente"}, se esperaba ${TIPOS[caso.tipo]}`;
  }
  for (const [nombre, valor] of ENCABEZADOS) {
    const actual = respuesta.headers.get(nombre);
    if (actual !== valor) return `${nombre}: ${actual ?? "ausente"}, se esperaba ${valor}`;
  }
  if (caso.tipo === "texto") {
    return (await respuesta.text()).trim() === "" ? "cuerpo vacío" : undefined;
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
  timeoutMs: number,
): Promise<string | undefined> {
  try {
    return await acotar(timeoutMs, async (signal) =>
      revisar(await pedidor(`${base}${caso.ruta}`, { signal }), caso),
    );
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
  for (const caso of COMPROBACIONES) {
    const inicio = performance.now();
    const falla = await comprobar(origen, caso, pedidor, timeoutMs);
    tiempos[caso.ruta] = Math.round(performance.now() - inicio);
    if (falla !== undefined) fallas.push(`${caso.ruta}: ${falla}`);
  }
  return { ok: fallas.length === 0, fallas, tiempos };
}

/** Punto de entrada del CLI: imprime un renglón por ruta y devuelve el código de salida. */
export async function principal(
  argumentos: string[],
  escribir: (texto: string) => void,
  opciones: OpcionesHumo = {},
): Promise<number> {
  const [base, ...sobran] = argumentos;
  if (base === undefined || sobran.length > 0 || !/^https?:\/\/\S+$/.test(base)) {
    escribir("Uso: node apps/api/scripts/humo.ts <url-base>\n");
    return 2;
  }
  const { ok, fallas, tiempos } = await probarHumo(base, opciones);
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
