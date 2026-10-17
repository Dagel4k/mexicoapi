import type { FechaISO } from "../fechas.js";

export type Autoridad = "lft" | "cnbv" | "sat";

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
