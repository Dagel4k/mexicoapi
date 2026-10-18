import { readFile } from "node:fs/promises";
import { inject } from "vitest";

/** El `public/` que construyó `pnpm -r build` y que sirve el Worker. */
export const PUBLICO = new URL("../../public/", import.meta.url);

export const BASE_PROBLEMAS =
  "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

/** Encabezados que el Worker pone en todas sus respuestas. */
export const SEGURIDAD: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "ETag, Retry-After",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
};

/** Pide `ruta` (con su query) al Worker local; las redirecciones no se siguen. */
export function pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(ruta, inject("urlApi")), { redirect: "manual", ...init });
}

export async function pedirJson(ruta: string): Promise<{ respuesta: Response; cuerpo: unknown }> {
  const respuesta = await pedir(ruta);
  return { respuesta, cuerpo: await respuesta.json() };
}

/** Tipo de medio sin parámetros (`application/json; charset=utf-8` → `application/json`). */
export const tipoDeMedio = (respuesta: Response): string =>
  (respuesta.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";

export async function leerPublico(ruta: string): Promise<Buffer> {
  return readFile(new URL(ruta, PUBLICO));
}
