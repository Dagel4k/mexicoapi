import {
  CACHE_DATOS,
  DETALLE_ERROR_INTERNO,
  encabezados,
  respuestaProblema,
} from "./respuestas.js";
import type { Contexto } from "./rutas.js";

/** Origen ficticio: el binding ASSETS solo mira la ruta. */
export const ORIGEN_ASSETS = "https://assets.local";

/**
 * Sirve el shard `ruta` (armada solo con parámetros validados). `recurso` nombra lo pedido en
 * el 404, por ejemplo "el estado 33".
 */
export async function servirShard(c: Contexto, ruta: string, recurso: string): Promise<Response> {
  const asset = await c.entorno.ASSETS.fetch(new Request(new URL(ruta, ORIGEN_ASSETS)));
  if (asset.status !== 200) {
    await asset.body?.cancel();
    return asset.status === 404
      ? respuestaProblema("no-encontrado", `No existe ${recurso}.`, undefined, c.url.pathname)
      : respuestaProblema("error-interno", DETALLE_ERROR_INTERNO, undefined, c.url.pathname);
  }
  const h = encabezados({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_DATOS,
  });
  const etag = asset.headers.get("ETag");
  if (etag !== null) h.set("ETag", etag);
  return new Response(asset.body, { status: 200, headers: h });
}
