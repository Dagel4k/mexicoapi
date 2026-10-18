import type { Entorno, Opciones } from "./entorno.js";
import { dentroDelLimite } from "./limite.js";
import { nombreDeError } from "./registro.js";
import {
  CACHE_DATOS,
  DETALLE_ERROR_INTERNO,
  respuestaProblema,
  respuestaVacia,
  sinCuerpo,
} from "./respuestas.js";
import { RUTAS, resolver } from "./rutas.js";

const METODOS = "GET, HEAD, OPTIONS";

/** Lo que se sabe de la petición para registrar un error sin datos del usuario. */
interface Rastro {
  plantilla?: string;
}

/**
 * `camino` sin las `/` del final. Recorre desde el final y lee cada carácter una vez: lineal con
 * cualquier racha de `/`, a diferencia de `/\/+$/`.
 */
export function sinBarrasFinales(camino: string): string {
  let fin = camino.length;
  while (fin > 0 && camino.charCodeAt(fin - 1) === 0x2f) fin -= 1;
  return camino.slice(0, fin);
}

async function atender(
  peticion: Request,
  url: URL,
  entorno: Entorno,
  opciones: Opciones,
  rastro: Rastro,
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
    const destino = sinBarrasFinales(camino);
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
  rastro.plantilla = ruta.plantilla;
  return ruta.manejar({
    peticion,
    url,
    entorno,
    opciones,
    plantilla: ruta.plantilla,
    parametros,
    consulta,
  });
}

/**
 * Una línea por error interno, con prefijo fijo: el nombre del error y la plantilla de la ruta.
 * Nunca la URL, la query, la IP ni el mensaje, que pueden traer datos del usuario.
 */
function registrarError(error: unknown, rastro: Rastro): void {
  const nombre = nombreDeError(error);
  console.error(`mexicoapi: error interno: ${nombre} en ${rastro.plantilla ?? "(sin ruta)"}`);
}

export async function manejar(
  peticion: Request,
  entorno: Entorno,
  opciones: Opciones = {},
): Promise<Response> {
  const url = new URL(peticion.url);
  const rastro: Rastro = {};
  try {
    const respuesta = await atender(peticion, url, entorno, opciones, rastro);
    return peticion.method === "HEAD" ? await sinCuerpo(respuesta) : respuesta;
  } catch (error) {
    registrarError(error, rastro);
    const r = respuestaProblema("error-interno", DETALLE_ERROR_INTERNO, undefined, url.pathname);
    // El cuerpo es un texto propio: para HEAD basta con no mandarlo.
    return peticion.method === "HEAD"
      ? new Response(null, { status: r.status, headers: r.headers })
      : r;
  }
}

export default {
  fetch: (p, e) => manejar(p, e),
} satisfies ExportedHandler<Entorno>;
