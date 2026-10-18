import type { Entorno, Opciones } from "./entorno.js";
import {
  CACHE_DATOS,
  DETALLE_ERROR_INTERNO,
  respuestaProblema,
  respuestaVacia,
} from "./respuestas.js";
import { RUTAS, resolver } from "./rutas.js";

const METODOS = "GET, HEAD, OPTIONS";

/** Con el binding LIMITE, una IP que lo rebasa recibe 429; si el binding falla, se deja pasar. */
async function dentroDelLimite(peticion: Request, entorno: Entorno): Promise<boolean> {
  if (entorno.LIMITE === undefined) return true;
  const ip = peticion.headers.get("CF-Connecting-IP") ?? "desconocida";
  try {
    const { success } = await entorno.LIMITE.limit({ key: `ip:${ip}` });
    return success !== false;
  } catch {
    return true;
  }
}

async function atender(
  peticion: Request,
  url: URL,
  entorno: Entorno,
  opciones: Opciones,
): Promise<Response> {
  if (!(await dentroDelLimite(peticion, entorno))) {
    const r = respuestaProblema(
      "demasiadas-peticiones",
      "Se rebasó el límite de peticiones; intenta de nuevo en un minuto.",
      undefined,
      url.pathname,
    );
    r.headers.set("Retry-After", "60");
    return r;
  }

  if (peticion.method === "OPTIONS") {
    return respuestaVacia(204, {
      "Access-Control-Allow-Methods": METODOS,
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "86400",
    });
  }
  if (peticion.method !== "GET" && peticion.method !== "HEAD") {
    const r = respuestaProblema(
      "metodo-no-permitido",
      "Solo se permiten GET, HEAD y OPTIONS.",
      undefined,
      url.pathname,
    );
    r.headers.set("Allow", METODOS);
    return r;
  }

  const camino = url.pathname;
  if (camino !== "/" && camino.endsWith("/")) {
    const destino = camino.replace(/\/+$/, "");
    // "//dominio" en Location sería una redirección a otro origen.
    if (destino !== "" && !destino.startsWith("//")) {
      return respuestaVacia(308, { Location: destino + url.search, "Cache-Control": CACHE_DATOS });
    }
  }

  const resolucion = resolver(RUTAS, url);
  if ("problema" in resolucion) {
    const { problema, detalle, parametro } = resolucion;
    const extras = parametro === undefined ? undefined : { parametro };
    return respuestaProblema(problema, detalle, extras, camino);
  }
  const { ruta, parametros, consulta } = resolucion;
  return ruta.manejar({ peticion, url, entorno, opciones, parametros, consulta });
}

export async function manejar(
  peticion: Request,
  entorno: Entorno,
  opciones: Opciones = {},
): Promise<Response> {
  const url = new URL(peticion.url);
  let respuesta: Response;
  try {
    respuesta = await atender(peticion, url, entorno, opciones);
  } catch {
    respuesta = respuestaProblema("error-interno", DETALLE_ERROR_INTERNO, undefined, url.pathname);
  }
  if (peticion.method !== "HEAD") return respuesta;
  return new Response(null, { status: respuesta.status, headers: respuesta.headers });
}

export default {
  fetch: (p, e) => manejar(p, e),
} satisfies ExportedHandler<Entorno>;
