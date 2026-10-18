// Un fetch falso con respuestas en cola, y respuestas de la API para armarlas.
import type { FetchCompatible, InitFetch, RespuestaFetch } from "../../src/cliente/index.js";

export const BASE = "https://api.ejemplo.mx";

export const PROBLEMAS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

export const META = {
  dataset: "inegi.estados",
  as_of: "2026-10-17",
  sources: [
    {
      name: "INEGI",
      url: "https://www.inegi.org.mx",
      license: "Libre uso",
      license_url: "https://www.inegi.org.mx/inegi/terminos.html",
      citation: "INEGI.",
    },
  ],
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/inegi-estados.md",
};

export interface Llamada {
  url: string;
  init: InitFetch;
}

/** Una respuesta, un error que lanza fetch, o una función que decide con la llamada. */
export type Paso =
  | Response
  | RespuestaFetch
  | Error
  | ((llamada: Llamada) => Promise<RespuestaFetch> | RespuestaFetch);

/** fetch que contesta con `pasos` en orden y anota cada llamada; sin pasos, falla la prueba. */
export function fetchFalso(...pasos: Paso[]): { fetch: FetchCompatible; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const fetch: FetchCompatible = async (url, init) => {
    const llamada = { url, init };
    llamadas.push(llamada);
    const paso = pasos.shift();
    if (paso === undefined) throw new Error(`fetch falso: llamada de más a ${url}`);
    if (paso instanceof Error) throw paso;
    return typeof paso === "function" ? paso(llamada) : paso;
  };
  return { fetch, llamadas };
}

export function json(
  cuerpo: unknown,
  status = 200,
  encabezados: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...encabezados },
  });
}

export const datos = (data: unknown, encabezados: Record<string, string> = {}): Response =>
  json({ data, meta: META }, 200, encabezados);

/** Un problem+json como los de la API. */
export function problema(
  tipo: string,
  status: number,
  title: string,
  detail: string,
  extras: Record<string, unknown> = {},
  encabezados: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ type: PROBLEMAS + tipo, title, status, detail, ...extras }),
    {
      status,
      headers: { "Content-Type": "application/problem+json; charset=utf-8", ...encabezados },
    },
  );
}

export const errorInterno = (encabezados: Record<string, string> = {}): Response =>
  problema("error-interno", 500, "Error interno", "Ocurrió un error interno.", {}, encabezados);

/** Una promesa que no se resuelve: fetch o cuerpo colgados. */
export const colgada = <T>(): Promise<T> => new Promise<T>(() => {});

/** El error con el que se rechaza `promesa`; falla si se cumple. */
export async function rechazo(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un rechazo");
}
