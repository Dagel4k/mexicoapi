import type { ProblemaConsulta } from "@mexicoapi/core/rutas";
import { PROBLEMAS, type TipoProblema, URL_PROBLEMAS } from "./problemas.js";

export const CACHE_DATOS =
  "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800";
export const CACHE_STATUS = "public, max-age=60";
// `/v1/tipo-cambio/fix/ultimo` cambia con cada publicación: sin stale, un cliente no se queda
// horas con el FIX de ayer.
export const CACHE_ULTIMO = "public, max-age=300";
// La CLABE va en la URL y es de la cuenta de una persona: la guarda el navegador o el cliente,
// no un caché compartido.
export const CACHE_CLABE = "private, max-age=3600";

const SEGURIDAD: ReadonlyArray<readonly [string, string]> = [
  ["Access-Control-Allow-Origin", "*"],
  ["Access-Control-Expose-Headers", "ETag, Retry-After"],
  ["X-Content-Type-Options", "nosniff"],
  ["Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"],
  ["Referrer-Policy", "no-referrer"],
  ["Cross-Origin-Resource-Policy", "cross-origin"],
  // Sin includeSubDomains ni preload: solo este host, y se puede retirar.
  ["Strict-Transport-Security", "max-age=31536000"],
];

/**
 * Encabezados de toda respuesta del Worker; los de seguridad no se pueden pisar. La plataforma
 * comprime según `Accept-Encoding`, así que `Vary` lo nombra siempre (RFC 9110, 12.5.5): un caché
 * compartido no le da el cuerpo en br a quien no lo pidió.
 */
export function encabezados(extra?: HeadersInit): Headers {
  const resultado = new Headers(extra);
  for (const [nombre, valor] of SEGURIDAD) resultado.set(nombre, valor);
  const vary = resultado.get("Vary");
  const nombres = (vary ?? "").split(",").map((n) => n.trim().toLowerCase());
  if (!nombres.includes("accept-encoding") && !nombres.includes("*")) {
    resultado.set("Vary", vary === null ? "Accept-Encoding" : `${vary}, Accept-Encoding`);
  }
  return resultado;
}

export function respuestaVacia(status: number, extra?: HeadersInit): Response {
  return new Response(null, { status, headers: encabezados(extra) });
}

/** La misma respuesta sin cuerpo (para HEAD); cancela el cuerpo que reemplaza. */
export async function sinCuerpo(respuesta: Response): Promise<Response> {
  await respuesta.body?.cancel();
  return new Response(null, { status: respuesta.status, headers: respuesta.headers });
}

/** Sin `cache`, la respuesta no se guarda (`no-store`). */
export function respuestaJson(
  cuerpo: unknown,
  opciones: { status?: number; cache?: string; encabezados?: HeadersInit } = {},
): Response {
  const h = encabezados(opciones.encabezados);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", opciones.cache ?? "no-store");
  return new Response(JSON.stringify(cuerpo), { status: opciones.status ?? 200, headers: h });
}

/** Único `detail` de un 500: nunca se exponen trazas ni mensajes internos. */
export const DETALLE_ERROR_INTERNO = "Ocurrió un error interno.";

const CAMPOS_FIJOS = new Set(["type", "title", "status", "detail", "instance"]);

/** Problem+json (RFC 9457). Nunca debe llevar trazas ni mensajes internos. */
export function respuestaProblema(
  tipo: TipoProblema,
  detalle: string,
  extras?: Record<string, unknown>,
  instancia?: string,
): Response {
  const { title, status } = PROBLEMAS[tipo];
  const cuerpo: Record<string, unknown> = {
    type: `${URL_PROBLEMAS}#${tipo}`,
    title,
    status,
    detail: detalle,
  };
  if (instancia !== undefined) cuerpo.instance = instancia;
  for (const [campo, valor] of Object.entries(extras ?? {})) {
    if (!CAMPOS_FIJOS.has(campo)) cuerpo[campo] = valor;
  }
  const h = encabezados();
  h.set("Content-Type", "application/problem+json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(cuerpo), { status, headers: h });
}

/** La respuesta de un problema del núcleo (sus reglas, sus errores, una consulta sin registro). */
export const respuestaDe = (
  { tipo, detalle, extras }: ProblemaConsulta,
  instancia: string,
): Response => respuestaProblema(tipo, detalle, extras, instancia);
