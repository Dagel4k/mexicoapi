// Ayudas para probar las herramientas: clientes sin red o con un fetch falso, y un servidor en
// memoria que las llama por el protocolo (así se revisan también los esquemas de entrada y salida).
import { crearCliente, type FetchCompatible, type InitFetch } from "mexicoapi/cliente";
import { expect } from "vitest";
import { crearHerramientas } from "../src/catalogo.js";
import type { Herramienta, ResultadoHerramienta } from "../src/herramientas.js";
import type { OpcionesHerramientas } from "../src/respuesta.js";
import { conectar } from "./ayudas.js";

export const BASE = "https://api.prueba";
export const URL_PROBLEMAS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md";

/** El meta con el que responde la API falsa: as_of y fuente propios, para distinguirlo. */
export const META_API = {
  dataset: "prueba.api",
  as_of: "2026-10-19",
  sources: [
    {
      name: "Fuente según la API",
      url: "https://fuente.prueba",
      license: "",
      license_url: "",
      citation: "",
    },
  ],
  docs: "https://docs.prueba",
};

export interface RespuestaFalsa {
  status?: number;
  cuerpo?: unknown;
  encabezados?: Record<string, string>;
}

type Responder = (
  url: URL,
  init: InitFetch,
) => RespuestaFalsa | Error | Promise<RespuestaFalsa | Error>;

/** Un fetch que responde con `responder` y anota cada URL pedida. */
export function fetchFalso(responder: Responder): { fetch: FetchCompatible; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchCompatible = async (url, init) => {
    urls.push(url);
    const r = await responder(new URL(url), init);
    if (r instanceof Error) throw r;
    const encabezados = r.encabezados ?? {};
    return {
      status: r.status ?? 200,
      headers: { get: (nombre: string) => encabezados[nombre.toLowerCase()] ?? null },
      text: async () => JSON.stringify(r.cuerpo),
    };
  };
  return { fetch, urls };
}

/** Respuesta 200 de la API con `data` y META_API (o el meta dado). */
export const apiOk = (data: unknown, extra: Record<string, unknown> = {}): RespuestaFalsa => ({
  cuerpo: { data, meta: META_API, ...extra },
});

/** Un problem+json de la API. */
export const apiProblema = (status: number, tipo: string, detail: string): RespuestaFalsa => ({
  status,
  encabezados: { "content-type": "application/problem+json" },
  cuerpo: { type: `${URL_PROBLEMAS}#${tipo}`, title: "Problema", status, detail },
});

/** Herramientas sin red: el cliente solo responde con el paquete. */
export function herramientasSinRed(
  opciones: Partial<OpcionesHerramientas> = {},
): readonly Herramienta[] {
  return crearHerramientas({
    cliente: crearCliente({ offline: true }),
    conApi: false,
    ...opciones,
  });
}

/** Herramientas con la API falsa en BASE, sin reintentos ni esperas. */
export function herramientasConApi(
  responder: Responder,
  opciones: Partial<OpcionesHerramientas> = {},
): { herramientas: readonly Herramienta[]; urls: string[] } {
  const { fetch, urls } = fetchFalso(responder);
  const cliente = crearCliente({ base: BASE, fetch, reintentos: 0, esperaMaximaMs: 0 });
  return { herramientas: crearHerramientas({ cliente, conApi: true, ...opciones }), urls };
}

/** Un fetch que falla si alguien lo llama: para probar que algo no usa la red. */
export function herramientasSinTocarRed(opciones: Partial<OpcionesHerramientas> = {}): {
  herramientas: readonly Herramienta[];
  urls: string[];
} {
  return herramientasConApi(() => new Error("no debió pedir nada a la red"), opciones);
}

/** Llama la herramienta por el protocolo y devuelve el resultado (falla si es error JSON-RPC). */
export type Llamador = (
  nombre: string,
  args?: Record<string, unknown>,
) => Promise<ResultadoHerramienta>;

/** Un servidor en memoria con `herramientas`, ya inicializado. */
export async function servidor(herramientas: readonly Herramienta[]): Promise<Llamador> {
  const cliente = conectar({ herramientas });
  await cliente.inicializar();
  return async (nombre, args = {}) => {
    const respuesta = await cliente.pedir("tools/call", { name: nombre, arguments: args });
    expect(respuesta.error, JSON.stringify(respuesta.error)).toBeUndefined();
    return respuesta.result as ResultadoHerramienta;
  };
}

/** El texto del resultado. */
export const texto = (r: ResultadoHerramienta): string => r.content.map((b) => b.text).join("\n");

/** Comprueba que el resultado es un error de la herramienta con ese texto. */
export function esError(r: ResultadoHerramienta, mensaje: string | RegExp): void {
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toBeUndefined();
  if (typeof mensaje === "string") expect(texto(r)).toBe(mensaje);
  else expect(texto(r)).toMatch(mensaje);
}

/** El structuredContent de un resultado correcto. */
export function contenido(r: ResultadoHerramienta): Record<string, unknown> {
  expect(r.isError, texto(r)).toBeUndefined();
  return r.structuredContent as Record<string, unknown>;
}
