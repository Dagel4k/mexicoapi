import type { FechaISO } from "../fechas.js";

export type TipoBanco = "banca_multiple" | "banca_desarrollo" | "otra_entidad" | "banco_central";

/** Periodo en el que una clave SPEI estuvo vigente para un banco. */
export interface PeriodoBanco {
  codigo_spei: string;
  nombre_corto: string;
  visto_desde: FechaISO;
  visto_hasta: FechaISO;
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
