import { readFile } from "node:fs/promises";
import { request } from "node:http";
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

/** Un host que no es local: por http, el Worker lo trata como una petición sin cifrar. */
export const HOST_PUBLICO = "mexicoapi.example";

/**
 * Pide `ruta` por http al Worker local con `Host: mexicoapi.example`: el Worker ve
 * `http://mexicoapi.example<ruta>`, como una petición por http a la API pública. Usa node:http
 * porque fetch no deja cambiar el `Host`.
 */
export function pedirPorHttp(ruta: string, metodo = "GET"): Promise<Response> {
  const origen = new URL(inject("urlApi"));
  return new Promise((resolver, rechazar) => {
    const peticion = request(
      {
        host: origen.hostname,
        port: origen.port,
        path: ruta,
        method: metodo,
        headers: { Host: HOST_PUBLICO },
      },
      (respuesta) => {
        const partes: Buffer[] = [];
        respuesta.on("data", (parte: Buffer) => partes.push(parte));
        respuesta.on("error", rechazar);
        respuesta.on("end", () => {
          const encabezados = new Headers();
          for (const [nombre, valor] of Object.entries(respuesta.headers)) {
            for (const v of [valor ?? []].flat()) encabezados.append(nombre, v);
          }
          const cuerpo = Buffer.concat(partes);
          resolver(
            new Response(cuerpo.length === 0 ? null : cuerpo, {
              status: respuesta.statusCode ?? 0,
              headers: encabezados,
            }),
          );
        });
      },
    );
    peticion.on("error", rechazar);
    peticion.end();
  });
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
