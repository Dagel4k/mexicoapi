import type { Autoridad } from "./dias-habiles/tipos.js";
import type { FechaISO } from "./fechas.js";

/** Se consultó una fecha que el calendario de la autoridad no cubre. */
export class CalendarioIncompletoError extends Error {
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
