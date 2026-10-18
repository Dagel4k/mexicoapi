import type { Entorno } from "./entorno.js";
import {
  CACHE_DATOS,
  DETALLE_ERROR_INTERNO,
  encabezados,
  respuestaProblema,
} from "./respuestas.js";
import type { Contexto } from "./rutas.js";

/** Origen ficticio: el binding ASSETS solo mira la ruta. */
export const ORIGEN_ASSETS = "https://assets.local";

/** Pide un asset por su ruta; `ruta` nunca lleva texto sin validar. */
export function pedirAsset(entorno: Entorno, ruta: string): Promise<Response> {
  return entorno.ASSETS.fetch(new Request(new URL(ruta, ORIGEN_ASSETS)));
}

/** Libera un cuerpo que no se va a leer. */
export async function descartar(respuesta: Response): Promise<void> {
  await respuesta.body?.cancel();
}

/** `*` solo, o una lista de etiquetas entre comillas con o sin `W/` (RFC 9110, 13.1.2). */
const CONDICION = /^\s*(?:\*|(?:W\/)?"[^"]*"(?:\s*,\s*(?:W\/)?"[^"]*")*)\s*$/;
const ETIQUETA = /(?:W\/)?"[^"]*"/g;
const opaca = (etiqueta: string): string => etiqueta.replace(/^W\//, "");

/** Comparación débil de If-None-Match; un encabezado mal formado no coincide. */
function coincide(condicion: string, etag: string | null): boolean {
  if (!CONDICION.test(condicion)) return false;
  if (condicion.trim() === "*") return true;
  if (etag === null) return false;
  return [...condicion.matchAll(ETIQUETA)].some(([etiqueta]) => opaca(etiqueta) === opaca(etag));
}

/**
 * Sirve el shard `ruta` (armada solo con parámetros validados). Si no existe, `siFalta` es lo
 * pedido para el 404 ("el estado 33") o la función que arma la respuesta.
 */
export async function servirShard(
  c: Contexto,
  ruta: string,
  siFalta: string | (() => Promise<Response>),
): Promise<Response> {
  const asset = await pedirAsset(c.entorno, ruta);
  if (asset.status !== 200) {
    await descartar(asset);
    if (asset.status !== 404) {
      // Lo que se lanza lo registra manejar(); este 500 se arma aquí, así que se registra aquí.
      console.error(
        `mexicoapi: error interno: el asset respondió ${asset.status} en ${c.plantilla}`,
      );
      return respuestaProblema("error-interno", DETALLE_ERROR_INTERNO, undefined, c.url.pathname);
    }
    return typeof siFalta === "string"
      ? respuestaProblema("no-encontrado", `No existe ${siFalta}.`, undefined, c.url.pathname)
      : siFalta();
  }

  const h = encabezados({ "Cache-Control": CACHE_DATOS });
  const etag = asset.headers.get("ETag");
  if (etag !== null) h.set("ETag", etag);
  const condicion = c.peticion.headers.get("If-None-Match");
  if (condicion !== null && coincide(condicion, etag)) {
    await descartar(asset);
    return new Response(null, { status: 304, headers: h });
  }

  h.set("Content-Type", "application/json; charset=utf-8");
  if (c.peticion.method === "HEAD") {
    await descartar(asset);
    return new Response(null, { status: 200, headers: h });
  }
  return new Response(asset.body, { status: 200, headers: h });
}
