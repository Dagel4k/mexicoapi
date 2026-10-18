import type { FechaISO } from "../fechas.js";

/** Publicación oficial que respalda un valor curado, con el texto citado tal cual. */
export interface FuenteDof {
  nombre: string;
  /** En dof.gob.mx, sidof.segob.gob.mx o www.diputados.gob.mx. */
  url: string;
  fecha_publicacion: FechaISO;
  fragmento: string;
}

export type AutoridadCurada = "cnbv" | "sat";
export type TipoDiaCurado = "descanso" | "vacaciones";

export interface DiaInhabilCurado {
  fecha: FechaISO;
  autoridad: AutoridadCurada;
  motivo: string;
  tipo: TipoDiaCurado;
  fuente: FuenteDof;
}

/** Rango, por tipo de día, en el que la lista de días inhábiles está completa. */
export type CoberturaCurada = Partial<
  Record<TipoDiaCurado, { readonly desde: FechaISO; readonly hasta: FechaISO }>
>;

/** Unidad de medida y actualización. Rige del 1 de febrero al 31 de enero siguiente. */
export interface Uma {
  anio: number;
  diaria: string;
  mensual: string;
  anual: string;
  vigencia_desde: FechaISO;
  fuente: FuenteDof;
}

export interface SalarioMinimo {
  anio: number;
  /** `zlfn`: Zona Libre de la Frontera Norte. */
  zona: "general" | "zlfn";
  diario: string;
  vigencia_desde: FechaISO;
  fuente: FuenteDof;
}

/** Montos en pesos y tasa en porcentaje, como strings con dos decimales. */
export interface TramoIsr {
  limite_inferior: string;
  /** `null` en el último tramo ("En adelante"). */
  limite_superior: string | null;
  cuota_fija: string;
  tasa_excedente: string;
}

export interface TarifaIsr {
  anio: number;
  periodo: "mensual" | "anual";
  tramos: TramoIsr[];
  fuente: FuenteDof;
}
