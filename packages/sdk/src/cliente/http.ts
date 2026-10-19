// Consultas a la API: fetch con tiempo límite por intento (incluida la lectura del cuerpo), sin
// seguir redirecciones y con un tope para el cuerpo, reintentos con espera exponencial dentro de
// un tope de espera total, y caché en memoria con revalidación por ETag y stale-if-error.
import type { Cache, Guardado } from "./cache.js";
import { congelar, esObjeto, type Objeto, type RespuestaPrevia } from "./comun.js";
import { MexicoApiError, type Problema } from "./error.js";
import type { FetchCompatible, InitFetch, RespuestaFetch, SenalAborto } from "./tipos.js";

/** Lo que el cliente usa del entorno, sin depender de los tipos de DOM ni de Node. */
interface Entorno {
  fetch?: FetchCompatible;
  AbortController: new () => { readonly signal: SenalAborto; abort(motivo?: unknown): void };
  setTimeout(funcion: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  TextDecoder: new () => { decode(bytes: Uint8Array): string };
}

const entorno = globalThis as unknown as Entorno;

const ESPERA_BASE_MS = 250;
const ESPERA_TOPE_MS = 10_000;
/** Lo más que se espera por un Retry-After; si pide más, no se reintenta. */
const RETRY_AFTER_TOPE_MS = 60_000;
/** Causas anidadas que se copian al ocultar la ruta; las demás se cortan. */
const CAUSAS_MAX = 5;
/**
 * Tope del cuerpo de una respuesta. La más grande de la API, `/v1/municipios`, ronda los 250 KB;
 * el tope deja mucho margen y evita que una respuesta sin fin llene la memoria.
 */
export const TOPE_CUERPO_BYTES = 8 * 1024 * 1024;
const TOPE_TEXTO = `${TOPE_CUERPO_BYTES / (1024 * 1024)} MB`;

export interface ConfigHttp {
  /** Origen de la API sin barra final ni `/v1`. */
  base: string;
  timeoutMs: number;
  reintentos: number;
  /** Espera total entre reintentos que se permite una consulta. */
  esperaMaximaMs: number;
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
  /** Qué debe ser `data`; sin forma (una ruta que el cliente no conoce), cualquier valor. */
  forma: "lista" | "objeto" | undefined;
  signal: SenalAborto | undefined;
}

interface Leida {
  status: number;
  /** El cuerpo; vacío si pasó del tope. */
  texto: string;
  /** Si el cuerpo pasó de TOPE_CUERPO_BYTES y se dejó de leer. */
  grande: boolean;
  /** Si la API respondió con una redirección (que no se sigue): su cuerpo no se lee. */
  redireccion: boolean;
  encabezado(nombre: string): string | null;
}

type Falla = { falla: "tiempo" } | { falla: "red"; error: unknown };

/** Un problema que la API dio como respuesta a la consulta: un 4xx con problem+json salvo 429. */
export const esDefinitivo = (error: MexicoApiError): boolean =>
  error.status >= 400 && error.status < 500 && error.status !== 429 && error.type !== "about:blank";

/**
 * Pide `p` a la API (o lo toma de la caché) y lo entrega congelado; lanza MexicoApiError. Si la
 * API no responde y hay una respuesta guardada dentro de su stale-if-error, entrega esa.
 */
export async function pedirApi(c: ConfigHttp, p: Pedido): Promise<RespuestaPrevia> {
  const fetch = c.fetch ?? entorno.fetch;
  if (fetch === undefined) {
    throw new TypeError("No hay fetch en este entorno; pásalo en crearCliente({ fetch }).");
  }
  const url = c.base + p.camino;
  const guardado = c.cache?.leer(url);
  if (guardado !== undefined && guardado.expira > Date.now()) return guardado.respuesta;
  try {
    return await deLaApi(c, fetch, url, guardado, p);
  } catch (error) {
    if (
      guardado !== undefined &&
      error instanceof MexicoApiError &&
      !esDefinitivo(error) &&
      Date.now() <= guardado.expira + guardado.rancioMs
    ) {
      return rancia(guardado, error);
    }
    throw error;
  }
}

async function deLaApi(
  c: ConfigHttp,
  fetch: FetchCompatible,
  url: string,
  guardado: Guardado | undefined,
  p: Pedido,
): Promise<RespuestaPrevia> {
  const encabezados: Record<string, string> = { Accept: "application/json" };
  if (guardado?.etag != null) encabezados["If-None-Match"] = guardado.etag;

  const r = await conReintentos(c, fetch, url, encabezados, p);
  if (r.redireccion) throw inesperada(r.status, "La API respondió con una redirección.", p);
  if (r.grande) throw inesperada(r.status, `La respuesta pasa de ${TOPE_TEXTO}.`, p);
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
    if (!tieneForma(cuerpo.data, p.forma)) {
      throw inesperada(r.status, `La respuesta no trae data como ${p.forma}.`, p);
    }
    const respuesta = congelar({
      data: cuerpo.data,
      ...(esObjeto(cuerpo.meta) ? { meta: cuerpo.meta } : {}),
      origen: "api" as const,
      // Las de primer nivel de la API (`/v1/dias-inhabiles`); solo los textos.
      advertencias: Array.isArray(cuerpo.advertencias)
        ? cuerpo.advertencias.filter((a): a is string => typeof a === "string")
        : [],
      // Y sus avisos, con los códigos que da la API; se revisan al completar la respuesta.
      ...(Array.isArray(cuerpo.avisos) ? { avisos: cuerpo.avisos } : {}),
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
  let esperado = 0;
  for (let intento = 0; ; intento++) {
    const r = await intentar(c, fetch, url, encabezados, p.signal);
    if (p.signal?.aborted) throw p.signal.reason;
    let espera: number;
    if ("falla" in r) {
      // Un intento que agotó el tiempo no se repite: la consulta ya esperó lo que se pidió.
      if (r.falla === "tiempo" || intento >= c.reintentos) throw sinRespuesta(c, r, p);
      espera = esperaExponencial(intento);
      if (esperado + espera > c.esperaMaximaMs) throw sinRespuesta(c, r, p);
    } else {
      if ((r.status < 500 && r.status !== 429) || intento >= c.reintentos) return r;
      // Nunca antes de lo que pide Retry-After: si no cabe en lo que queda, no se reintenta y
      // quien llama responde ya (con el error, la caché o el paquete).
      espera = retryAfter(r.encabezado("Retry-After")) ?? esperaExponencial(intento);
      if (espera > RETRY_AFTER_TOPE_MS || esperado + espera > c.esperaMaximaMs) return r;
    }
    esperado += espera;
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
    const init: InitFetch = {
      headers: encabezados,
      signal: control.signal as InitFetch["signal"],
      // "manual" y no "error": workerd (Cloudflare Workers) rechaza "error". La redirección se
      // reconoce abajo y no se sigue.
      redirect: "manual",
    };
    // Las carreras con la señal cortan aunque un fetch propio no la respete.
    const respuesta = await hastaAbortar(fetch(url, init), control.signal);
    const encabezado = (n: string): string | null => respuesta.headers.get(n);
    if (esRedireccion(respuesta)) {
      cancelarCuerpo(respuesta);
      return { status: respuesta.status, texto: "", grande: false, redireccion: true, encabezado };
    }
    const texto = await hastaAbortar(leerTexto(respuesta, control.signal), control.signal);
    return {
      status: respuesta.status,
      texto: texto ?? "",
      grande: texto === null,
      redireccion: false,
      encabezado,
    };
  } catch (error) {
    return agotado ? { falla: "tiempo" } : { falla: "red", error };
  } finally {
    entorno.clearTimeout(reloj);
    senal?.removeEventListener("abort", cancelar);
  }
}

/**
 * Con `redirect: "manual"`, los navegadores dan una respuesta `opaqueredirect` (estado 0) y
 * Node y workerd, la 3xx tal cual. Un 304 no es redirección: es la revalidación con ETag.
 */
const esRedireccion = (r: RespuestaFetch): boolean =>
  r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400 && r.status !== 304);

/** Cierra el cuerpo que no se va a leer, si es un stream. */
function cancelarCuerpo(r: RespuestaFetch): void {
  if (typeof r.body?.getReader === "function") {
    r.body
      .getReader()
      .cancel()
      .catch(() => undefined);
  }
}

/**
 * El texto del cuerpo, o null si pasa de TOPE_CUERPO_BYTES: por partes si la respuesta trae
 * `body` (se corta y se cancela al pasar del tope o al abortar el intento), con `text()` si no.
 */
async function leerTexto(respuesta: RespuestaFetch, senal: SenalAborto): Promise<string | null> {
  // Un fetch propio puede traer otro tipo de body (node-fetch 2 da un stream de Node): ese se lee
  // con text(), como antes.
  const cuerpo = typeof respuesta.body?.getReader === "function" ? respuesta.body : undefined;
  if (Number(respuesta.headers.get("Content-Length")) > TOPE_CUERPO_BYTES) {
    cancelarCuerpo(respuesta);
    return null;
  }
  if (!cuerpo) {
    const texto = await respuesta.text();
    return texto.length > TOPE_CUERPO_BYTES ? null : texto;
  }
  const lector = cuerpo.getReader();
  const cancelar = (): void => void lector.cancel(senal.reason).catch(() => undefined);
  senal.addEventListener("abort", cancelar);
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > TOPE_CUERPO_BYTES) {
        cancelar();
        return null;
      }
      trozos.push(value);
    }
  } catch (error) {
    cancelar();
    throw error;
  } finally {
    senal.removeEventListener("abort", cancelar);
  }
  const bytes = new Uint8Array(total);
  let desde = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, desde);
    desde += trozo.byteLength;
  }
  return new entorno.TextDecoder().decode(bytes);
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
  respuesta: RespuestaPrevia,
  r: Leida,
  etag: string | null,
): void {
  const control = r.encabezado("Cache-Control") ?? "";
  if (c.cache === undefined || /no-store/i.test(control)) return;
  const segundos = (directiva: string): number | undefined => {
    const valor = new RegExp(`(?:^|[\\s,])${directiva}=(\\d+)`, "i").exec(control)?.[1];
    return valor === undefined ? undefined : Number(valor) * 1000;
  };
  const maxAge = segundos("max-age");
  const ahora = Date.now();
  c.cache.guardar(url, {
    respuesta,
    etag,
    guardadoEn: ahora,
    expira: ahora + (maxAge === undefined ? c.ttlMs : Math.min(c.ttlMs, maxAge)),
    rancioMs: segundos("stale-if-error") ?? 0,
  });
}

/** 45 s, 3 min, 5 h, 2 días. */
function duracion(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`;
}

/** La respuesta guardada, ya caducada, con la advertencia de su edad y del fallo. */
function rancia(guardado: Guardado, causa: MexicoApiError): RespuestaPrevia {
  const ahora = Date.now();
  return congelar({
    ...guardado.respuesta,
    advertencias: [
      `Respuesta guardada de la API, de hace ${duracion(ahora - guardado.guardadoEn)} y caducada hace ${duracion(ahora - guardado.expira)}, porque la API falló: ${causa.message}`,
      ...guardado.respuesta.advertencias,
    ],
  });
}

function tieneForma(data: unknown, forma: Pedido["forma"]): boolean {
  if (forma === "lista") return Array.isArray(data);
  if (forma === "objeto") return esObjeto(data);
  return true;
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

/**
 * Copia del error de fetch y de su cadena de causas sin los valores de la ruta: algunos entornos
 * o un fetch propio ponen la URL en el mensaje. Solo pasan el nombre, el mensaje y `code`.
 */
function limpiar(error: unknown, p: Pedido, profundidad = 0): Error {
  const original = error instanceof Error ? error : undefined;
  const causa = original?.cause;
  const copia: Error & { code?: string } = new Error(
    p.ocultar(original?.message ?? String(error)),
    causa === undefined || profundidad >= CAUSAS_MAX
      ? undefined
      : { cause: limpiar(causa, p, profundidad + 1) },
  );
  copia.name = original?.name ?? "Error";
  const code = (original as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") copia.code = p.ocultar(code);
  return copia;
}

/** Cada texto de un valor JSON, con los valores de la ruta ocultos. */
function ocultarEn(valor: unknown, p: Pedido): unknown {
  if (typeof valor === "string") return p.ocultar(valor);
  if (Array.isArray(valor)) return valor.map((v) => ocultarEn(v, p));
  if (esObjeto(valor)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, ocultarEn(v, p)]));
  }
  return valor;
}

/** Una respuesta que no es de la API, o que no tiene la forma de la ruta. */
function inesperada(status: number, detalle: string, p: Pedido): MexicoApiError {
  return new MexicoApiError(
    { type: "about:blank", title: "Respuesta inesperada de la API", status, detail: detalle },
    { url: p.urlOculta, origen: "api" },
  );
}

function errorDeRespuesta(status: number, cuerpo: unknown, p: Pedido): MexicoApiError {
  if (
    status >= 400 &&
    esObjeto(cuerpo) &&
    typeof cuerpo.type === "string" &&
    typeof cuerpo.title === "string"
  ) {
    // `type` y `title` son del catálogo de la API: no traen valores y no se tocan.
    const problema: Problema = {
      ...(ocultarEn(cuerpo, p) as Objeto),
      type: cuerpo.type,
      title: cuerpo.title,
      status,
      detail: typeof cuerpo.detail === "string" ? p.ocultar(cuerpo.detail) : "",
    };
    return new MexicoApiError(problema, { url: p.urlOculta, origen: "api" });
  }
  return inesperada(
    status,
    status >= 200 && status < 300
      ? "La respuesta no trae JSON con data."
      : `La API respondió ${status} sin problem+json.`,
    p,
  );
}
