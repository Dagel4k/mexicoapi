import type { Entorno, Opciones } from "./entorno.js";
import { respuestaProblema } from "./respuestas.js";

export async function manejar(
  peticion: Request,
  _entorno: Entorno,
  _opciones: Opciones = {},
): Promise<Response> {
  const url = new URL(peticion.url);
  return respuestaProblema("no-encontrado", "No existe la ruta.", undefined, url.pathname);
}

export default {
  fetch: (p, e) => manejar(p, e),
} satisfies ExportedHandler<Entorno>;
