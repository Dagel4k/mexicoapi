import type { FechaISO } from "../fechas.js";

/**
 * Tipo de cambio FIX (pesos por dólar) que el Banco de México publica en el DOF.
 * `fecha_publicacion` es la del DOF; solo hay registro los días con publicación.
 */
export interface TipoCambioFix {
  fecha_publicacion: FechaISO;
  /** Decimal con 4 decimales, como lo publica el DOF. */
  valor: string;
}

/** Valor de la unidad de inversión (UDI) para el día `fecha`; la serie es diaria. */
export interface Udi {
  fecha: FechaISO;
  /** Decimal con 6 decimales, como lo publica el DOF. */
  valor: string;
}
