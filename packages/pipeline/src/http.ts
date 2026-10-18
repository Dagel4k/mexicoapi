import { permitidoPorRobots } from "./robots.js";

export const AGENTE = "mexicoapi-bot/1 (+https://github.com/Dagel4k/mexicoapi)";

export interface RespuestaHttp {
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

export interface Cliente {
  obtener(url: string): Promise<RespuestaHttp>;
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

/** Retry-After en segundos enteros, en ms y con tope; null si no aplica. */
function retryAfterMs(res: Response): number | null {
  const valor = res.headers.get("retry-after")?.trim();
  if (valor === undefined || !/^\d+$/.test(valor)) return null;
  return Math.min(Number(valor) * 1000, TOPE_RETRY_AFTER_MS);
}

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

  async function intento(url: string): Promise<{ res: Response; cuerpo: Uint8Array | null }> {
    const res = await limitado(new URL(url).host, () =>
      fetchFn(url, {
        headers: { "User-Agent": AGENTE },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if (!res.ok) return { res, cuerpo: null };
    return { res, cuerpo: new Uint8Array(await res.arrayBuffer()) };
  }

  async function pedir(url: string): Promise<RespuestaHttp> {
    let ultimoEstado: number | null = null;
    let ultimoMotivo = "";
    for (let i = 0; i <= reintentos; i++) {
      let espera = 1000 * 2 ** i;
      try {
        const { res, cuerpo } = await intento(url);
        if (cuerpo !== null) {
          return {
            url: res.url || url,
            estado: res.status,
            tipo: res.headers.get("content-type"),
            cuerpo,
            obtenido_en: new Date(ahora()).toISOString(),
          };
        }
        if (!esReintentable(res.status)) {
          throw new ErrorHttp(`HTTP ${res.status} al pedir ${url}`, url, res.status);
        }
        ultimoEstado = res.status;
        ultimoMotivo = `HTTP ${res.status}`;
        espera = retryAfterMs(res) ?? espera;
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
   * robots.txt del host; null significa que todo está permitido. Un 4xx definitivo permite
   * todo; un 429 o un 5xx tras los reintentos es "no disponible": se lanza y no se guarda.
   */
  function robotsDe(url: string): Promise<string | null> {
    const { host, origin } = new URL(url);
    let p = robots.get(host);
    if (p === undefined) {
      p = pedir(`${origin}/robots.txt`).then(
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
    async obtener(url: string): Promise<RespuestaHttp> {
      const txt = await robotsDe(url);
      if (txt !== null) {
        const { pathname, search } = new URL(url);
        if (!permitidoPorRobots(txt, AGENTE, pathname + search)) {
          throw new ErrorHttp(`robots.txt no permite pedir ${url}`, url, null);
        }
      }
      return pedir(url);
    },
  };
}
