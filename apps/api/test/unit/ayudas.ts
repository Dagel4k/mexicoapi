import type { Entorno } from "../../src/entorno.js";

export interface AssetFalso {
  cuerpo: string;
  etag?: string;
  /** 200 si se omite. */
  status?: number;
}

export interface AssetsFalsos {
  binding: Fetcher;
  /** Ruta (pathname más query) de cada petición recibida, en orden. */
  pedidas: string[];
  /** Rutas cuyo cuerpo se canceló sin leerse por completo. */
  canceladas: string[];
}

export const ORIGEN_ASSETS = "https://assets.local";

/**
 * ASSETS falso: sirve un mapa `ruta → {cuerpo, etag}`, responde 404 a lo demás y registra
 * cada petición. Con `fallar`, la petición lanza como lo haría un error de red del binding.
 */
export function crearAssets(
  mapa: Readonly<Record<string, AssetFalso>> = {},
  opciones: { fallar?: boolean } = {},
): AssetsFalsos {
  const pedidas: string[] = [];
  const canceladas: string[] = [];
  const fetch = async (entrada: RequestInfo | URL): Promise<Response> => {
    const peticion = entrada instanceof Request ? entrada : new Request(entrada);
    const url = new URL(peticion.url);
    if (url.origin !== ORIGEN_ASSETS) throw new Error(`origen inesperado: ${url.origin}`);
    const ruta = url.pathname + url.search;
    pedidas.push(ruta);
    if (opciones.fallar === true) throw new Error("fallo del binding con /ruta/interna");
    const asset = mapa[ruta];
    if (asset === undefined) return new Response("not found", { status: 404 });
    const bytes = new TextEncoder().encode(asset.cuerpo);
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(controlador) {
        controlador.enqueue(bytes);
        controlador.close();
      },
      cancel() {
        canceladas.push(ruta);
      },
    });
    const encabezados = new Headers({ "Content-Type": "application/json" });
    if (asset.etag !== undefined) encabezados.set("ETag", asset.etag);
    const status = asset.status ?? 200;
    const sinCuerpo = status === 204 || status === 304;
    return new Response(sinCuerpo ? null : cuerpo, { status, headers: encabezados });
  };
  return { binding: { fetch } as unknown as Fetcher, pedidas, canceladas };
}

export function entornoDe(assets: AssetsFalsos, extra: Partial<Omit<Entorno, "ASSETS">> = {}) {
  return { ASSETS: assets.binding, ...extra } as Entorno;
}

export const ORIGEN_API = "https://api.test";

export function peticion(ruta: string, init?: RequestInit): Request {
  return new Request(`${ORIGEN_API}${ruta}`, init);
}

export const SEGURIDAD: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "ETag",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
};

/** Comprueba los encabezados de seguridad y que no haya cookies. */
export function seguridadDe(respuesta: Response): Record<string, string | null> {
  const encontrados: Record<string, string | null> = {};
  for (const nombre of Object.keys(SEGURIDAD)) encontrados[nombre] = respuesta.headers.get(nombre);
  encontrados["set-cookie"] = respuesta.headers.get("set-cookie");
  return encontrados;
}

export const SEGURIDAD_ESPERADA: Readonly<Record<string, string | null>> = {
  ...SEGURIDAD,
  "set-cookie": null,
};
