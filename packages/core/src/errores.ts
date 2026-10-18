import type { Autoridad } from "./dias-habiles/tipos.js";
import type { FechaISO } from "./fechas.js";

/** Una cuenta de días dio una fecha antes de 0001-01-01 o después de 9999-12-31. */
export class FechaFueraDeRangoError extends RangeError {
  /** Código fijo para distinguirlo de los demás RangeError (parámetros inválidos). */
  readonly codigo = "fecha-fuera-de-rango";

  constructor() {
    super("La fecha resultante sale del rango 0001-9999");
    this.name = "FechaFueraDeRangoError";
  }
}

/** Se consultó una fecha que el calendario de la autoridad no cubre. */
export class CalendarioIncompletoError extends Error {
  /** Código fijo para mapear el error (por ejemplo, a problem+json) sin depender de instanceof. */
  readonly codigo = "calendario-incompleto";
  readonly autoridad: Autoridad;
  readonly fecha: FechaISO;
  readonly cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO };

  constructor(
    autoridad: Autoridad,
    fecha: FechaISO,
    cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO },
  ) {
    super(
      `Calendario incompleto: el calendario de ${autoridad} no cubre ${fecha}; ` +
        `cobertura ${cobertura.desde} a ${cobertura.hasta}.`,
    );
    this.name = "CalendarioIncompletoError";
    this.autoridad = autoridad;
    this.fecha = fecha;
    this.cobertura = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
  }
}
