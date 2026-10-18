import { type Autoridad, DE_AUTORIDAD } from "./dias-habiles/tipos.js";
import type { FechaISO } from "./fechas.js";

/** Una cuenta de días dio una fecha antes de 0001-01-01 o después de 9999-12-31. */
export class FechaFueraDeRangoError extends RangeError {
  /** Tipo fijo para distinguirlo de los demás RangeError (parámetros inválidos) sin instanceof. */
  readonly tipo = "fecha-fuera-de-rango";

  constructor() {
    super("La fecha resultante sale del rango 0001-9999");
    this.name = "FechaFueraDeRangoError";
  }
}

/**
 * El tramo de una serie (FIX o UDIS) que recibió una consulta no alcanza para responder con
 * certeza, o trae registros fuera de las fechas que dice cubrir. Es un error de quien carga los
 * datos, no de quien consulta.
 */
export class SerieIncompletaError extends Error {
  /** Tipo fijo para reconocer el error sin depender de instanceof. */
  readonly tipo = "serie-incompleta";
  readonly fecha: FechaISO;
  /** Fechas que dice cubrir el tramo recibido. */
  readonly tramo: { readonly desde: FechaISO; readonly hasta: FechaISO };

  constructor(
    fecha: FechaISO,
    tramo: { readonly desde: FechaISO; readonly hasta: FechaISO },
    motivo: string,
  ) {
    super(
      `Serie incompleta para ${fecha}: ${motivo}; tramo cargado ${tramo.desde} a ${tramo.hasta}.`,
    );
    this.name = "SerieIncompletaError";
    this.fecha = fecha;
    this.tramo = Object.freeze({ desde: tramo.desde, hasta: tramo.hasta });
  }
}

/** Se consultó una fecha que el calendario de la autoridad no cubre. */
export class CalendarioIncompletoError extends Error {
  /** Tipo fijo para mapear el error (por ejemplo, a problem+json) sin depender de instanceof. */
  readonly tipo = "calendario-incompleto";
  readonly autoridad: Autoridad;
  readonly fecha: FechaISO;
  readonly cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO };
  /**
   * El texto para quien consulta, el mismo `detail` de la API. Por omisión dice qué fecha falta y
   * qué cubre el calendario; las consultas de los calendarios curados explican además por qué.
   */
  readonly detalle: string;

  constructor(
    autoridad: Autoridad,
    fecha: FechaISO,
    cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO },
    detalle?: string,
  ) {
    const cubre = `cubre del ${cobertura.desde} al ${cobertura.hasta}`;
    super(
      `Calendario incompleto: el calendario ${DE_AUTORIDAD[autoridad]} no cubre ${fecha}; ${cubre}.`,
    );
    this.name = "CalendarioIncompletoError";
    this.autoridad = autoridad;
    this.fecha = fecha;
    this.cobertura = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
    this.detalle =
      detalle ?? `El calendario ${DE_AUTORIDAD[autoridad]} no cubre ${fecha}; ${cubre}.`;
  }
}

type ErrorDelNucleo = FechaFueraDeRangoError | SerieIncompletaError | CalendarioIncompletoError;

/**
 * Si `error` es un error del núcleo de ese `tipo`. Compara el campo y no la clase: con dos copias
 * del núcleo (el paquete y otra dependencia), instanceof falla.
 */
export function esErrorDelNucleo<T extends ErrorDelNucleo["tipo"]>(
  error: unknown,
  tipo: T,
): error is Extract<ErrorDelNucleo, { tipo: T }> {
  return typeof error === "object" && error !== null && (error as { tipo?: unknown }).tipo === tipo;
}
