import {
  PROBLEMAS,
  type TipoProblema,
  tipoDeProblema,
  URL_PROBLEMAS,
} from "@mexicoapi/core/problemas";
import { congelar } from "./comun.js";
import type { Origen } from "./tipos.js";

/**
 * Cuerpo problem+json (RFC 9457), con las extensiones que agrega la API (`parametro`, `fecha`,
 * `cobertura`, `autoridad`).
 */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  [extension: string]: unknown;
}

export interface ContextoError {
  /** URL consultada, con `{nombre}` en lugar de cada valor de la ruta. */
  url: string;
  origen: Origen;
  cause?: unknown;
}

/**
 * Una consulta que no dio datos: la API, o el paquete con las mismas reglas, respondió con un
 * problema, o la API no respondió (`status` 0). Ni el mensaje, ni `url`, ni `problema` traen los
 * valores de la ruta: una CLABE aparece como `{clabe}`.
 */
export class MexicoApiError extends Error {
  override readonly name = "MexicoApiError";
  /** Estado HTTP de la respuesta; 0 si la API no respondió (sin conexión o tiempo agotado). */
  readonly status: number;
  /** URI del tipo de problema; `about:blank` si la respuesta no traía un problem+json. */
  readonly type: string;
  /** El tipo de problema de la API sin su URL: `no-encontrado`, `dato-no-disponible`... */
  readonly tipo: string | undefined;
  readonly title: string;
  readonly detail: string;
  /** El problem+json completo y congelado; si la respuesta no traía uno, el que arma el cliente. */
  readonly problema: Readonly<Problema>;
  readonly url: string;
  /** `paquete` si el problema lo encontró el cliente con los datos o las reglas del paquete. */
  readonly origen: Origen;

  constructor(problema: Problema, contexto: ContextoError) {
    const { type, title, status, detail } = problema;
    super(
      status > 0 ? `${status} ${title}: ${detail}` : `${title}: ${detail}`,
      contexto.cause === undefined ? undefined : { cause: contexto.cause },
    );
    this.status = status;
    this.type = type;
    this.tipo = tipoDeProblema(type);
    this.title = title;
    this.detail = detail;
    this.problema = congelar(problema);
    this.url = contexto.url;
    this.origen = contexto.origen;
  }
}

/** Los problemas de la API que el cliente también encuentra con los datos del paquete. */
export type TipoLocal = Exclude<
  TipoProblema,
  "metodo-no-permitido" | "demasiadas-peticiones" | "error-interno"
>;

/** Lo que necesita un error que arma el cliente. */
export interface ContextoLocal {
  urlOculta: string;
  /** La plantilla de la ruta: lo que la API da en `instance`, sin los valores. */
  instancia: string;
  causa?: MexicoApiError | undefined;
}

/**
 * Un problema del catálogo de la API, con su forma, encontrado con lo que trae el paquete.
 * `detalle` se usa tal cual: quien lo arma con un valor de la ruta debe ocultarlo antes.
 */
export function problemaLocal(
  contexto: ContextoLocal,
  tipo: TipoLocal,
  detalle: string,
  extras?: Readonly<Record<string, unknown>>,
): MexicoApiError {
  const { status, title } = PROBLEMAS[tipo];
  return new MexicoApiError(
    {
      type: `${URL_PROBLEMAS}#${tipo}`,
      title,
      status,
      detail: detalle,
      instance: contexto.instancia,
      ...extras,
    },
    { url: contexto.urlOculta, origen: "paquete", cause: contexto.causa },
  );
}
