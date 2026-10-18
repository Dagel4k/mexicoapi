import { permitidoPorRobots } from "./robots.js";

export const AGENTE = "mexicoapi-bot/1 (+https://github.com/Dagel4k/mexicoapi)";

/**
 * Tope del cuerpo de una respuesta. La fuente más grande, el PDF de participantes del SPEI,
 * ronda los 400 KB; el tope deja mucho margen y evita que una respuesta sin fin llene la memoria.
 */
export const TOPE_CUERPO_BYTES = 50 * 1024 * 1024;

const MAXIMO_REDIRECCIONES = 5;
const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

export interface RespuestaHttp {
  /** URL final, después de las redirecciones. */
  url: string;
  estado: number;
  tipo: string | null;
  cuerpo: Uint8Array;
  obtenido_en: string;
}

/** Fallo de red o respuesta no exitosa; `estado` es null si no hubo respuesta. */
export class ErrorHttp extends Error {
  readonly url: string;
  readonly estado: number | null;

  constructor(mensaje: string, url: string, estado: number | null) {
    super(mensaje);
    this.name = "ErrorHttp";
    this.url = url;
    this.estado = estado;
  }
}

export interface OpcionesCliente {
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  ahora?: () => number;
  intervaloMinimoMs?: number;
  timeoutMs?: number;
  reintentos?: number;
}

export interface OpcionesObtener {
  /** Estados no exitosos que se devuelven con su cuerpo en lugar de lanzar; no se reintentan. */
  aceptar?: readonly number[];
  /**
   * Hosts (con puerto, si lo llevan) a los que se puede pedir, también en las redirecciones.
   * Por omisión, solo el de la URL pedida.
   */
  hosts?: readonly string[];
  /** Tope del cuerpo en bytes; `TOPE_CUERPO_BYTES` por omisión. */
  topeBytes?: number;
}

export interface Cliente {
  obtener(url: string, opciones?: OpcionesObtener): Promise<RespuestaHttp>;
}

const TOPE_RETRY_AFTER_MS = 60_000;

function esReintentable(estado: number): boolean {
  return estado === 429 || estado >= 500;
}

function esFalloDeRed(e: unknown): boolean {
  return (
    e instanceof TypeError ||
    (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
  );
}

/** Retry-After en segundos o como fecha HTTP, en ms, entre 0 y el tope; null si no sirve. */
function retryAfterMs(res: Response, ahora: number): number | null {
  const valor = res.headers.get("retry-after")?.trim();
  if (valor === undefined || valor === "") return null;
  const ms = /^\d+$/.test(valor) ? Number(valor) * 1000 : Date.parse(valor) - ahora;
  if (Number.isNaN(ms)) return null;
  return Math.min(Math.max(0, ms), TOPE_RETRY_AFTER_MS);
}

/**
 * Cierra el cuerpo que no se va a leer, para no dejar la conexión abierta. No espera: la
 * cancelación de un cuerpo clonado solo termina cuando se cancelan las dos copias.
 */
function descartar(cuerpo: ReadableStream | ReadableStreamDefaultReader | null): void {
  cuerpo?.cancel().catch(() => undefined);
}

/** Lee el cuerpo por partes y lanza en cuanto pasa `tope`, sin esperar a que termine. */
async function leerCuerpo(res: Response, url: string, tope: number): Promise<Uint8Array> {
  const largo = res.headers.get("content-length")?.trim();
  if (largo !== undefined && /^\d+$/.test(largo) && Number(largo) > tope) {
    descartar(res.body);
    throw new ErrorHttp(
      `La respuesta de ${url} declara ${largo} bytes, más que el tope de ${tope}`,
      url,
      res.status,
    );
  }
  if (res.body === null) return new Uint8Array(0);
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      descartar(lector);
      throw new ErrorHttp(`La respuesta de ${url} pasa el tope de ${tope} bytes`, url, res.status);
    }
    partes.push(value);
  }
  const cuerpo = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    cuerpo.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return cuerpo;
}

/** La URL a la que apunta una redirección; lanza si no la trae o no es válida. */
function destinoDe(res: Response, url: string): string {
  const location = res.headers.get("location");
  if (location === null || location.trim() === "") {
    throw new ErrorHttp(`HTTP ${res.status} sin Location al pedir ${url}`, url, res.status);
  }
  if (!URL.canParse(location, url)) {
    throw new ErrorHttp(
      `HTTP ${res.status} con una Location no válida al pedir ${url}`,
      url,
      res.status,
    );
  }
  return new URL(location, url).href;
}

/** Solo https y un host de la lista; `pedida` es la URL original, para el mensaje. */
function revisarDestino(actual: string, hosts: readonly string[], pedida: string): URL {
  const destino = new URL(actual);
  const donde = actual === pedida ? actual : `${actual} (redirección al pedir ${pedida})`;
  if (destino.protocol !== "https:") {
    throw new ErrorHttp(`Solo se pide por https: ${donde}`, pedida, null);
  }
  if (!hosts.includes(destino.host)) {
    throw new ErrorHttp(`Host no permitido (${destino.host}): ${donde}`, pedida, null);
  }
  return destino;
}

type Intento =
  | { tipo: "respuesta"; res: Response; cuerpo: Uint8Array }
  | { tipo: "redireccion"; estado: number; destino: string }
  | { tipo: "fallo"; res: Response };

type Paso =
  | { tipo: "respuesta"; respuesta: RespuestaHttp }
  | { tipo: "redireccion"; estado: number; destino: string };

export function crearCliente(opciones: OpcionesCliente = {}): Cliente {
  const fetchFn = opciones.fetch ?? fetch;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ahora = opciones.ahora ?? Date.now;
  const intervalo = opciones.intervaloMinimoMs ?? 1000;
  const timeoutMs = opciones.timeoutMs ?? 30_000;
  const reintentos = opciones.reintentos ?? 3;

  const colas = new Map<string, Promise<unknown>>();
  const inicios = new Map<string, number>();
  const robots = new Map<string, Promise<string | null>>();

  /** Una petición por vez por host, con `intervalo` ms entre sus inicios. */
  function limitado<T>(host: string, tarea: () => Promise<T>): Promise<T> {
    const previa = colas.get(host) ?? Promise.resolve();
    const actual = previa
      .catch(() => undefined)
      .then(async () => {
        const ultimo = inicios.get(host);
        if (ultimo !== undefined) {
          const falta = ultimo + intervalo - ahora();
          if (falta > 0) await esperar(falta);
        }
        inicios.set(host, ahora());
        return tarea();
      });
    colas.set(host, actual);
    return actual;
  }

  /** Un pedido, sin seguir redirecciones: quien llama revisa cada salto. */
  async function intento(url: string, aceptar: readonly number[], tope: number): Promise<Intento> {
    const res = await limitado(new URL(url).host, () =>
      fetchFn(url, {
        headers: { "User-Agent": AGENTE },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if (REDIRECCIONES.has(res.status)) {
      descartar(res.body);
      return { tipo: "redireccion", estado: res.status, destino: destinoDe(res, url) };
    }
    if (!res.ok && !aceptar.includes(res.status)) {
      descartar(res.body);
      return { tipo: "fallo", res };
    }
    return { tipo: "respuesta", res, cuerpo: await leerCuerpo(res, url, tope) };
  }

  /** Pide una URL con reintentos; devuelve la respuesta o la redirección que trajo. */
  async function pedir(url: string, aceptar: readonly number[], tope: number): Promise<Paso> {
    let ultimoEstado: number | null = null;
    let ultimoMotivo = "";
    for (let i = 0; i <= reintentos; i++) {
      let espera = 1000 * 2 ** i;
      try {
        const r = await intento(url, aceptar, tope);
        if (r.tipo === "redireccion") return r;
        if (r.tipo === "respuesta") {
          return {
            tipo: "respuesta",
            respuesta: {
              url,
              estado: r.res.status,
              tipo: r.res.headers.get("content-type"),
              cuerpo: r.cuerpo,
              obtenido_en: new Date(ahora()).toISOString(),
            },
          };
        }
        const estado = r.res.status;
        if (!esReintentable(estado)) {
          throw new ErrorHttp(`HTTP ${estado} al pedir ${url}`, url, estado);
        }
        ultimoEstado = estado;
        ultimoMotivo = `HTTP ${estado}`;
        espera = retryAfterMs(r.res, ahora()) ?? espera;
      } catch (e) {
        if (e instanceof ErrorHttp || !esFalloDeRed(e)) throw e;
        ultimoEstado = null;
        ultimoMotivo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      if (i < reintentos) await esperar(espera);
    }
    throw new ErrorHttp(
      `${ultimoMotivo} al pedir ${url} tras ${reintentos + 1} intentos`,
      url,
      ultimoEstado,
    );
  }

  /**
   * Pide `url` y sigue hasta 5 redirecciones. Cada salto pasa por la misma revisión que la URL
   * original: https, host de la lista, robots.txt (salvo al pedir el propio robots.txt) e
   * intervalo por host.
   */
  async function seguir(
    url: string,
    opciones: OpcionesObtener,
    conRobots: boolean,
  ): Promise<RespuestaHttp> {
    const hosts = opciones.hosts ?? [new URL(url).host];
    const aceptar = opciones.aceptar ?? [];
    const tope = opciones.topeBytes ?? TOPE_CUERPO_BYTES;
    const vistas = new Set<string>();
    let actual = url;
    for (let saltos = 0; ; saltos++) {
      const destino = revisarDestino(actual, hosts, url);
      const clave = `${destino.origin}${destino.pathname}${destino.search}`;
      if (vistas.has(clave)) {
        throw new ErrorHttp(`Redirección en bucle a ${actual} al pedir ${url}`, url, null);
      }
      vistas.add(clave);
      if (conRobots) {
        const txt = await robotsDe(destino, hosts);
        if (txt !== null && !permitidoPorRobots(txt, AGENTE, destino.pathname + destino.search)) {
          throw new ErrorHttp(`robots.txt no permite pedir ${actual}`, url, null);
        }
      }
      const paso = await pedir(actual, aceptar, tope);
      if (paso.tipo === "respuesta") return paso.respuesta;
      if (saltos >= MAXIMO_REDIRECCIONES) {
        throw new ErrorHttp(
          `Más de ${MAXIMO_REDIRECCIONES} redirecciones al pedir ${url}`,
          url,
          paso.estado,
        );
      }
      actual = paso.destino;
    }
  }

  /**
   * robots.txt del host; null significa que todo está permitido. Un 4xx definitivo permite
   * todo; un 429 o un 5xx tras los reintentos, o una redirección que no se puede seguir, es
   * "no disponible": se lanza y no se guarda.
   */
  function robotsDe(destino: URL, hosts: readonly string[]): Promise<string | null> {
    const { host, origin } = destino;
    let p = robots.get(host);
    if (p === undefined) {
      p = seguir(`${origin}/robots.txt`, { hosts }, false).then(
        (r) => new TextDecoder().decode(r.cuerpo),
        (e: unknown) => {
          if (
            e instanceof ErrorHttp &&
            e.estado !== null &&
            e.estado >= 400 &&
            e.estado < 500 &&
            e.estado !== 429
          ) {
            return null;
          }
          robots.delete(host);
          throw e;
        },
      );
      robots.set(host, p);
    }
    return p;
  }

  return {
    obtener(url: string, opciones: OpcionesObtener = {}): Promise<RespuestaHttp> {
      return seguir(url, opciones, true);
    },
  };
}
