// Consultas a la API: fetch con tiempo límite por intento (incluida la lectura del cuerpo),
// reintentos con espera exponencial y caché en memoria con revalidación por ETag.
import type { Cache } from "./cache.js";
import { congelar, esObjeto } from "./comun.js";
import { MexicoApiError, type Problema } from "./error.js";
import type { FetchCompatible, InitFetch, RespuestaSinMeta, SenalAborto } from "./tipos.js";

/** Lo que el cliente usa del entorno, sin depender de los tipos de DOM ni de Node. */
interface Entorno {
  fetch?: FetchCompatible;
  AbortController: new () => { readonly signal: SenalAborto; abort(motivo?: unknown): void };
  setTimeout(funcion: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const entorno = globalThis as unknown as Entorno;

const ESPERA_BASE_MS = 250;
const ESPERA_TOPE_MS = 10_000;
/** Lo más que se espera por un Retry-After; si pide más, no se reintenta. */
const RETRY_AFTER_TOPE_MS = 60_000;

export interface ConfigHttp {
  /** Origen de la API sin barra final ni `/v1`. */
  base: string | undefined;
  timeoutMs: number;
  reintentos: number;
  fetch: FetchCompatible | undefined;
  cache: Cache | undefined;
  ttlMs: number;
}

/** Una consulta lista para pedirse. */
export interface Pedido {
  /** Ruta con sus valores codificados y la query. */
  camino: string;
  /** URL para los errores: la plantilla de la ruta (`{clabe}`) en vez de sus valores. */
  urlOculta: string;
  /** Cambia cada valor de la ruta por `{nombre}`. */
  ocultar(texto: string): string;
  /** Si la respuesta debe traer `meta`. */
  conMeta: boolean;
  signal: SenalAborto | undefined;
}

interface Leida {
  status: number;
  texto: string;
  encabezado(nombre: string): string | null;
}

type Falla = { falla: "tiempo" } | { falla: "red"; error: unknown };

/** Pide `p` a la API (o lo toma de la caché) y lo entrega congelado; lanza MexicoApiError. */
export async function pedirApi(c: ConfigHttp, p: Pedido): Promise<RespuestaSinMeta<unknown>> {
  if (c.base === undefined) {
    throw new TypeError(
      "Falta base: crearCliente({ base }) necesita el origen de la API para consultarla; para responder solo con el paquete, usa offline: true.",
    );
  }
  const fetch = c.fetch ?? entorno.fetch;
  if (fetch === undefined) {
    throw new TypeError("No hay fetch en este entorno; pásalo en crearCliente({ fetch }).");
  }
  const url = c.base + p.camino;
  const guardado = c.cache?.leer(url);
  if (guardado !== undefined && guardado.expira > Date.now()) return guardado.respuesta;
  const encabezados: Record<string, string> = { Accept: "application/json" };
  if (guardado?.etag != null) encabezados["If-None-Match"] = guardado.etag;

  const r = await conReintentos(c, fetch, url, encabezados, p);
  if (r.status === 304 && guardado !== undefined) {
    guardar(c, url, guardado.respuesta, r, guardado.etag);
    return guardado.respuesta;
  }
  const cuerpo = leerJson(r.texto);
  if (
    r.status >= 200 &&
    r.status < 300 &&
    esObjeto(cuerpo) &&
    cuerpo.data !== undefined &&
    (!p.conMeta || esObjeto(cuerpo.meta))
  ) {
    const respuesta = congelar({
      data: cuerpo.data,
      ...(esObjeto(cuerpo.meta) ? { meta: cuerpo.meta } : {}),
      origen: "api" as const,
      advertencias: [],
    });
    guardar(c, url, respuesta, r, r.encabezado("ETag"));
    return respuesta;
  }
  throw errorDeRespuesta(r.status, cuerpo, p);
}

async function conReintentos(
  c: ConfigHttp,
  fetch: FetchCompatible,
  url: string,
  encabezados: Record<string, string>,
  p: Pedido,
): Promise<Leida> {
  for (let intento = 0; ; intento++) {
    const r = await intentar(c, fetch, url, encabezados, p.signal);
    if (p.signal?.aborted) throw p.signal.reason;
    let espera: number;
    if ("falla" in r) {
      // Un intento que agotó el tiempo no se repite: la consulta ya esperó lo que se pidió.
      if (r.falla === "tiempo" || intento >= c.reintentos) throw sinRespuesta(c, r, p);
      espera = esperaExponencial(intento);
    } else {
      if ((r.status < 500 && r.status !== 429) || intento >= c.reintentos) return r;
      espera = retryAfter(r.encabezado("Retry-After")) ?? esperaExponencial(intento);
      if (espera > RETRY_AFTER_TOPE_MS) return r;
    }
    await esperar(espera, p.signal);
  }
}

/** Un intento: la respuesta leída completa, o por qué no llegó. */
async function intentar(
  c: ConfigHttp,
  fetch: FetchCompatible,
  url: string,
  encabezados: Record<string, string>,
  senal: SenalAborto | undefined,
): Promise<Leida | Falla> {
  const control = new entorno.AbortController();
  let agotado = false;
  const reloj = entorno.setTimeout(() => {
    agotado = true;
    control.abort();
  }, c.timeoutMs);
  const cancelar = (): void => control.abort(senal?.reason);
  senal?.addEventListener("abort", cancelar);
  try {
    const init: InitFetch = { headers: encabezados, signal: control.signal as InitFetch["signal"] };
    // Las carreras con la señal cortan aunque un fetch propio no la respete.
    const respuesta = await hastaAbortar(fetch(url, init), control.signal);
    const texto = await hastaAbortar(respuesta.text(), control.signal);
    return { status: respuesta.status, texto, encabezado: (n) => respuesta.headers.get(n) };
  } catch (error) {
    return agotado ? { falla: "tiempo" } : { falla: "red", error };
  } finally {
    entorno.clearTimeout(reloj);
    senal?.removeEventListener("abort", cancelar);
  }
}

function hastaAbortar<T>(promesa: Promise<T>, senal: SenalAborto): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const abortar = (): void => rechazar(senal.reason);
    if (senal.aborted) abortar();
    senal.addEventListener("abort", abortar);
    promesa.then(resolver, rechazar).finally(() => senal.removeEventListener("abort", abortar));
  });
}

function esperar(ms: number, senal: SenalAborto | undefined): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const abortar = (): void => {
      entorno.clearTimeout(reloj);
      rechazar(senal?.reason);
    };
    const reloj = entorno.setTimeout(() => {
      senal?.removeEventListener("abort", abortar);
      resolver();
    }, ms);
    senal?.addEventListener("abort", abortar);
  });
}

/** 250 ms, 500 ms, 1 s... (tope 10 s), cada una entre la mitad y el total, al azar. */
const esperaExponencial = (intento: number): number =>
  Math.floor(Math.min(ESPERA_BASE_MS * 2 ** intento, ESPERA_TOPE_MS) * (0.5 + Math.random() / 2));

/** Milisegundos que pide un Retry-After en segundos o como fecha HTTP; undefined si no sirve. */
function retryAfter(valor: string | null): number | undefined {
  if (valor === null) return undefined;
  const ms = /^\s*\d+\s*$/.test(valor) ? Number(valor) * 1000 : Date.parse(valor) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

function guardar(
  c: ConfigHttp,
  url: string,
  respuesta: RespuestaSinMeta<unknown>,
  r: Leida,
  etag: string | null,
): void {
  const control = r.encabezado("Cache-Control") ?? "";
  if (c.cache === undefined || /no-store/i.test(control)) return;
  const maxAge = /max-age=(\d+)/i.exec(control)?.[1];
  const ttl = maxAge === undefined ? c.ttlMs : Math.min(c.ttlMs, Number(maxAge) * 1000);
  c.cache.guardar(url, { respuesta, etag, expira: Date.now() + ttl });
}

function leerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

function sinRespuesta(c: ConfigHttp, r: Falla, p: Pedido): MexicoApiError {
  const tiempo = r.falla === "tiempo";
  return new MexicoApiError(
    {
      type: "about:blank",
      title: "Sin respuesta de la API",
      status: 0,
      detail: tiempo
        ? `Se agotó el tiempo de espera (${c.timeoutMs} ms).`
        : "No se pudo conectar con la API.",
    },
    { url: p.urlOculta, origen: "api", cause: tiempo ? undefined : limpiar(r.error, p) },
  );
}

/** Copia del error de fetch sin los valores de la ruta: algunos entornos ponen la URL. */
function limpiar(error: unknown, p: Pedido): Error {
  const original = error instanceof Error ? error : undefined;
  const copia = new Error(
    p.ocultar(original?.message ?? String(error)),
    original?.cause === undefined ? undefined : { cause: original.cause },
  );
  copia.name = original?.name ?? "Error";
  return copia;
}

function errorDeRespuesta(status: number, cuerpo: unknown, p: Pedido): MexicoApiError {
  let problema: Problema;
  if (
    status >= 400 &&
    esObjeto(cuerpo) &&
    typeof cuerpo.type === "string" &&
    typeof cuerpo.title === "string"
  ) {
    problema = {
      ...cuerpo,
      type: cuerpo.type,
      title: cuerpo.title,
      status,
      detail: p.ocultar(typeof cuerpo.detail === "string" ? cuerpo.detail : ""),
    };
    if (typeof problema.instance === "string") problema.instance = p.ocultar(problema.instance);
  } else {
    problema = {
      type: "about:blank",
      title: "Respuesta inesperada de la API",
      status,
      detail:
        status >= 200 && status < 300
          ? "La respuesta no trae JSON con data."
          : `La API respondió ${status} sin problem+json.`,
    };
  }
  return new MexicoApiError(problema, { url: p.urlOculta, origen: "api" });
}
