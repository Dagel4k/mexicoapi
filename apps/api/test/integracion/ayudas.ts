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

/**
 * Pide `ruta` tal cual, pegada al origen: `//v1` no se toma como otro host y los `%` no se
 * decodifican. Sigue las redirecciones.
 */
export function pedirCruda(ruta: string): Promise<Response> {
  return fetch(`${new URL(inject("urlApi")).origin}${ruta}`, { redirect: "follow" });
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

/** `records` del manifiesto de `data/<directorio>`: los conteos no se fijan en las pruebas. */
export async function registrosDe(directorio: string): Promise<number> {
  const texto = await readFile(
    new URL(`../../../../data/${directorio}/manifest.json`, import.meta.url),
    "utf8",
  );
  const { records } = JSON.parse(texto) as { records: unknown };
  if (typeof records !== "number" || records <= 0) {
    throw new Error(`El manifiesto de ${directorio} no tiene records.`);
  }
  return records;
}

/** Los registros de `data/<directorio>`, según el `data_file` de su manifiesto. */
export async function datosDe<T>(directorio: string): Promise<T[]> {
  const base = new URL(`../../../../data/${directorio}/`, import.meta.url);
  const { data_file } = JSON.parse(await readFile(new URL("manifest.json", base), "utf8")) as {
    data_file: string;
  };
  return JSON.parse(await readFile(new URL(data_file, base), "utf8")) as T[];
}
