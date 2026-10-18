import type { FechaISO } from "../fechas.js";

export type Autoridad = "lft" | "cnbv" | "sat";

/**
 * Tipos de plazo de un calendario curado. En el SAT, `declaraciones_pagos` no cuenta las
 * vacaciones generales como inhábiles (CFF art. 12, segundo párrafo).
 */
export type TipoPlazo = "general" | "declaraciones_pagos";

export interface Fuente {
  nombre: string;
  url: string;
  fecha_publicacion?: FechaISO;
  fragmento?: string;
}

export interface DiaInhabil {
  fecha: FechaISO;
  motivo: string;
  tipo: "descanso" | "vacaciones" | "fin_de_semana";
  fuente: Fuente;
}
