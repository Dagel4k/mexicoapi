import type { FechaISO } from "../fechas.js";

/** Las autoridades con calendario de días hábiles. Los tipos y los esquemas salen de aquí. */
export const AUTORIDADES = Object.freeze(["lft", "cnbv", "sat"] as const);
export type Autoridad = (typeof AUTORIDADES)[number];

/**
 * Tipos de plazo de un calendario curado. En el SAT, `declaraciones_pagos` no cuenta las
 * vacaciones generales como inhábiles (CFF art. 12, segundo párrafo).
 */
export const TIPOS_PLAZO = Object.freeze(["general", "declaraciones_pagos"] as const);
export type TipoPlazo = (typeof TIPOS_PLAZO)[number];

const congelar = (mapa: (a: Autoridad) => string): Readonly<Record<Autoridad, string>> =>
  Object.freeze(
    Object.fromEntries(AUTORIDADES.map((a) => [a, mapa(a)])) as Record<Autoridad, string>,
  );

/** Cómo se nombra cada autoridad en los textos: el único lugar donde se escribe. */
const NOMBRES: Readonly<Record<Autoridad, readonly [articulo: "la" | "el", siglas: string]>> = {
  lft: ["la", "LFT"],
  cnbv: ["la", "CNBV"],
  sat: ["el", "SAT"],
};

/** Las siglas: "SAT". */
export const SIGLAS_AUTORIDAD = congelar((a) => NOMBRES[a][1]);
/** Con su artículo: "el SAT", "la LFT". */
export const NOMBRE_AUTORIDAD = congelar((a) => `${NOMBRES[a][0]} ${NOMBRES[a][1]}`);
/** Con "de": "del SAT", "de la LFT". */
export const DE_AUTORIDAD = congelar((a) =>
  NOMBRES[a][0] === "el" ? `del ${NOMBRES[a][1]}` : `de la ${NOMBRES[a][1]}`,
);

/** El nombre de una autoridad conocida, o el texto tal cual (una autoridad que no existe). */
export const nombreDe = (autoridad: string): string =>
  Object.hasOwn(NOMBRE_AUTORIDAD, autoridad) ? NOMBRE_AUTORIDAD[autoridad as Autoridad] : autoridad;

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
