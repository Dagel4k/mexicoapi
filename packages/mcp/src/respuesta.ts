// Lo que comparten los resultados de las herramientas: la procedencia que acompaña a cada dato
// (as_of, fuente, origen y advertencias), sus esquemas, el texto legible y cómo se traducen los
// errores esperables del paquete y de la API.
import { esFechaIsoValida } from "mexicoapi";
import { type Cliente, type Meta, MexicoApiError } from "mexicoapi/cliente";
import type { EsquemaJson } from "./esquema.js";
import { ErrorHerramienta, type EsquemaObjeto, type ResultadoHerramienta } from "./herramientas.js";

/** Con qué responden las herramientas. */
export interface OpcionesHerramientas {
  cliente: Cliente;
  /** true si el cliente consulta la API (MEXICOAPI_BASE); false si solo usa el paquete. */
  conApi: boolean;
  /** Directorio de la caché de SEPOMEX; por omisión, el de `mexicoapi/sepomex`. */
  dirSepomex?: string | undefined;
}

export interface Fuente {
  nombre: string;
  url: string;
}

/**
 * `api`: la API de MéxicoAPI. `paquete`: los datos y las reglas del paquete `mexicoapi`.
 * `cache_local`: el catálogo de Correos de México que el usuario descargó en su equipo.
 */
export type Origen = "api" | "paquete" | "cache_local";

/** Lo que acompaña a cada dato para citarlo. */
export interface Procedencia {
  as_of: string | null;
  fuente: Fuente;
  fuentes: Fuente[];
  origen: Origen;
  advertencias: string[];
}

/** Advertencia de los datos que caducan cuando el servidor no tiene MEXICOAPI_BASE. */
export const AVISO_SIN_API =
  "Respuesta con los datos del paquete mexicoapi, sin consultar la API (no hay MEXICOAPI_BASE): pueden faltar publicaciones recientes.";

/** Cierre de la descripción de las herramientas de datos que caducan. */
export const RESPALDO_API =
  "Consulta la API de MéxicoAPI si está configurada; si no, o si no responde, usa los datos del paquete y lo advierte.";

/** Documentación de los validadores, la fuente de las validaciones por algoritmo. */
export const FUENTE_VALIDADORES: Fuente = {
  nombre: "MéxicoAPI, validadores de formato y dígito verificador",
  url: "https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#validadores",
};

const FUENTE_API: Fuente = {
  nombre: "API de MéxicoAPI",
  url: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md",
};

export const FECHA = { type: "string", format: "date" } as const;

const ESQUEMA_FUENTE = {
  type: "object",
  properties: { nombre: { type: "string" }, url: { type: "string" } },
  required: ["nombre", "url"],
  additionalProperties: false,
} as const;

/** La fuente que traen los registros (días inhábiles, constantes, el fundamento del FIX). */
export const ESQUEMA_FUENTE_DATO = {
  type: "object",
  properties: {
    nombre: { type: "string" },
    url: { type: "string" },
    fecha_publicacion: FECHA,
    fragmento: { type: "string" },
  },
  required: ["nombre", "url"],
} as const;

const DESCRIPCION_AS_OF =
  "Fecha de corte del dataset: la de la última actualización que lo cambió (en los datos curados, la publicación más reciente de sus fuentes). No es la fecha del valor, que va en datos.";

const DESCRIPCION_ORIGEN: Readonly<Record<Origen, string>> = {
  api: "la API de MéxicoAPI",
  paquete: "los datos y las reglas del paquete mexicoapi, sin red",
  cache_local: "el catálogo de Correos de México que el usuario descargó en este equipo",
};

interface OpcionesEsquema {
  /** Orígenes posibles de la herramienta. */
  origenes: readonly Origen[];
  /** Si as_of puede ser null (validaciones por algoritmo, catálogo sin fecha). */
  asOfNulo?: boolean;
  /** Campos propios de la herramienta, todos obligatorios. */
  extra?: Readonly<Record<string, EsquemaJson>>;
}

/** outputSchema de una herramienta: `datos` y la procedencia, más sus campos propios. */
export function esquemaSalida(datos: EsquemaJson, opciones: OpcionesEsquema): EsquemaObjeto {
  const extra = opciones.extra ?? {};
  return {
    type: "object",
    properties: {
      datos,
      ...extra,
      as_of: opciones.asOfNulo
        ? { type: ["string", "null"], format: "date", description: DESCRIPCION_AS_OF }
        : { ...FECHA, description: DESCRIPCION_AS_OF },
      fuente: { ...ESQUEMA_FUENTE, description: "Fuente para citar el dato." },
      fuentes: {
        type: "array",
        items: ESQUEMA_FUENTE,
        minItems: 1,
        description: "Todas las fuentes de la respuesta, empezando por fuente.",
      },
      origen: {
        type: "string",
        enum: [...opciones.origenes],
        description: `${opciones.origenes.map((o) => `${o}: ${DESCRIPCION_ORIGEN[o]}`).join("; ")}.`,
      },
      advertencias: { type: "array", items: { type: "string" } },
    },
    required: [
      "datos",
      ...Object.keys(extra),
      "as_of",
      "fuente",
      "fuentes",
      "origen",
      "advertencias",
    ],
    additionalProperties: false,
  };
}

/** Quita los saltos y controles de un texto de los datos: cada dato queda en su línea. */
export function enLinea(texto: string): string {
  return texto.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}

/** Las fuentes sin repetir, en su orden. */
export function unicas(fuentes: readonly Fuente[]): Fuente[] {
  const vistas = new Set<string>();
  return fuentes.filter((f) => {
    const clave = `${f.nombre}\n${f.url}`;
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/** Una fuente de un registro (`{ nombre, url, ... }`), solo con su nombre y su URL. */
export const fuenteDe = (f: { nombre: string; url: string }): Fuente => ({
  nombre: f.nombre,
  url: f.url,
});

/** Las fuentes de un `meta` de la API o del paquete; la de la API si no trae ninguna legible. */
function fuentesDeMeta(meta: Meta): Fuente[] {
  const lista: readonly unknown[] = Array.isArray(meta.sources) ? meta.sources : [];
  const fuentes = lista.flatMap((f) => {
    const { name, url } = (f ?? {}) as { name?: unknown; url?: unknown };
    return typeof name === "string" && typeof url === "string" ? [{ nombre: name, url }] : [];
  });
  return fuentes.length === 0 ? [FUENTE_API] : unicas(fuentes);
}

const asOfDe = (meta: Meta): string | null =>
  typeof meta.as_of === "string" && esFechaIsoValida(meta.as_of) ? meta.as_of : null;

interface OpcionesProcedencia {
  /** Las fuentes del registro; sin ellas (o vacías), las del `meta`. */
  fuentes?: readonly Fuente[] | undefined;
  /** Advertencias de la herramienta, después de las del cliente. */
  advertencias?: readonly string[] | undefined;
  /** Si el dato caduca y el servidor no consulta la API: agrega AVISO_SIN_API. */
  sinApi?: boolean | undefined;
}

/** La procedencia de una respuesta del cliente (o de un `meta` del paquete). */
export function procedencia(
  r: { meta: Meta; origen: "api" | "paquete"; advertencias?: readonly string[] | undefined },
  opciones: OpcionesProcedencia = {},
): Procedencia {
  const fuentes =
    opciones.fuentes !== undefined && opciones.fuentes.length > 0
      ? unicas(opciones.fuentes)
      : fuentesDeMeta(r.meta);
  const advertencias = [
    ...(opciones.sinApi === true && r.origen === "paquete" ? [AVISO_SIN_API] : []),
    ...(r.advertencias ?? []),
    ...(opciones.advertencias ?? []),
  ];
  return {
    as_of: asOfDe(r.meta),
    fuente: fuentes[0] as Fuente,
    fuentes,
    origen: r.origen,
    advertencias: [...new Set(advertencias)],
  };
}

const TEXTO_ORIGEN: Readonly<Record<Origen, string>> = {
  api: "API de MéxicoAPI",
  paquete: "datos del paquete mexicoapi",
  cache_local: "catálogo de Correos de México descargado en este equipo",
};

/** Las líneas de fuente, fecha, origen y advertencias que cierran el texto de un resultado. */
function pie(p: Procedencia, sinFecha: string): string[] {
  const lineas = p.fuentes.map(
    (f, i) => `${i === 0 ? "Fuente" : "Otra fuente"}: ${enLinea(f.nombre)} (${enLinea(f.url)})`,
  );
  lineas.push(
    `as_of (corte de los datos): ${p.as_of ?? sinFecha}`,
    `Origen: ${TEXTO_ORIGEN[p.origen]}`,
  );
  for (const a of p.advertencias) lineas.push(`Advertencia: ${enLinea(a)}`);
  return lineas;
}

/**
 * Un resultado: el texto (las líneas propias y el pie de procedencia) y `structuredContent` con
 * `datos`, los campos propios y la procedencia.
 */
export function resultado(
  lineas: readonly string[],
  datos: unknown,
  p: Procedencia,
  opciones: { extra?: Readonly<Record<string, unknown>>; sinFecha?: string } = {},
): ResultadoHerramienta {
  const texto = [...lineas, ...pie(p, opciones.sinFecha ?? "sin fecha")].join("\n");
  return {
    content: [{ type: "text", text: texto }],
    structuredContent: { datos, ...opciones.extra, ...p },
  };
}

/**
 * Corre una consulta al cliente. Un problema de la API o del paquete (MexicoApiError) pasa a
 * ErrorHerramienta con su detalle en una línea, que no trae rutas de archivos ni trazas. Cualquier
 * otro error (también TypeError o RangeError: con los argumentos ya validados son defectos) sigue
 * tal cual y el protocolo lo responde como error interno, sin detalles. Si la llamada ya se
 * canceló, el error sigue tal cual: no se responde.
 */
export async function consultar<T>(signal: AbortSignal, consulta: () => Promise<T>): Promise<T> {
  try {
    return await consulta();
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof MexicoApiError) {
      throw new ErrorHerramienta(enLinea(error.detail) || enLinea(error.message));
    }
    throw error;
  }
}

/** Anotaciones de las herramientas de solo lectura; `openWorldHint` si pueden usar la API. */
export const anotaciones = (openWorldHint: boolean) =>
  ({ readOnlyHint: true, openWorldHint, idempotentHint: true }) as const;
