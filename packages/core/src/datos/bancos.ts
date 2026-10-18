import type { FechaISO } from "../fechas.js";

export type TipoBanco = "banca_multiple" | "banca_desarrollo" | "otra_entidad" | "banco_central";

/**
 * Periodo en el que un banco tuvo una clave SPEI y un nombre corto, como intervalo
 * semiabierto [desde, hasta). `desde` es la primera fecha en que se observó el par para
 * el código; `hasta` es la fecha de la primera observación en que el código ya no
 * mostraba ese par (cambio de nombre, de clave SPEI o ausencia); `null` es el vigente.
 */
export interface PeriodoBanco {
  codigo_spei: string;
  nombre_corto: string;
  desde: FechaISO;
  hasta: FechaISO | null;
}

export interface Banco {
  /** 3 dígitos, el de la CLABE. */
  codigo: string;
  /** El del último periodo observado. */
  codigo_spei: string;
  /** El del último periodo observado. */
  nombre_corto: string;
  /** Del PDF oficial de participantes directos. */
  razon_social: string | null;
  /** Encabezado de sección del PDF, tal cual. */
  sector: string | null;
  tipo: TipoBanco;
  participacion: "directa" | "no_confirmada";
  activo: boolean;
  baja_detectada: FechaISO | null;
  /** Cronológico. */
  historial: PeriodoBanco[];
}
