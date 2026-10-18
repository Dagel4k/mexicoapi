// Calendarios curados de ejemplo con la forma del shard que escribe el build: el SAT y la CNBV
// de 2026 (la CNBV también con 2025). Las fechas son las publicadas en el DOF; los fragmentos de
// la RMF y la CNBV están recortados. Los días de descanso del SAT son los de la regla del art. 12
// del CFF, que el shard puede traer (iguales a los de la regla) o no.
import { diasDescansoCff, FUENTE_CFF_12 } from "../../src/dias-habiles/cff.js";
import type { DatosCalendarioCurado } from "../../src/dias-habiles/curados.js";

const fuente = (nombre: string, url: string, fecha_publicacion: string, fragmento: string) => ({
  nombre,
  url,
  fecha_publicacion,
  fragmento,
});

export const FUENTE_CFF = FUENTE_CFF_12;
const FUENTE_RMF = fuente(
  "Resolución Miscelánea Fiscal para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025",
  "2025-12-28",
  "2.1.6. [...] se consideran días inhábiles [...] el 2 y 3 de abril de 2026.",
);
const FUENTE_RMF_1 = fuente(
  "Primera Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
  "2026-07-09",
  "2.1.6. [...] el primer periodo general de vacaciones comprende del 20 al 31 de julio de 2026.",
);
export const FUENTE_CNBV_2025 = fuente(
  "Disposiciones de la CNBV para 2025",
  "https://dof.gob.mx/nota_detalle.php?codigo=5746258&fecha=27/12/2024",
  "2024-12-27",
  "Artículo 1.- [...] los siguientes días del año 2025: [...] IX. Los sábados y domingos.",
);
export const FUENTE_CNBV = fuente(
  "Disposiciones de la CNBV para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025",
  "2025-12-10",
  "Artículo 1.- [...] IX. Los sábados y domingos.",
);

type Dia = DatosCalendarioCurado["dias"][number];

const dia = (fecha: string, motivo: string, tipo: Dia["tipo"], f: Dia["fuente"]): Dia => ({
  fecha,
  motivo,
  tipo,
  fuente: f,
});

/** El día del art. 12 de esa fecha, como lo da la regla. */
const delCff = (fecha: string): Dia => {
  const regla = diasDescansoCff(Number(fecha.slice(0, 4))).find((d) => d.fecha === fecha);
  if (regla === undefined) throw new Error(`${fecha} no es del art. 12`);
  return dia(regla.fecha, regla.motivo, "descanso", FUENTE_CFF);
};

export const PRIMER_PERIODO = Array.from({ length: 12 }, (_, i) => `2026-07-${20 + i}`);

/** Los días de vacaciones del SAT 2026: lo único que se captura del DOF. */
export const VACACIONES_SAT: Dia[] = [
  dia("2026-04-02", "Día inhábil para el SAT", "vacaciones", FUENTE_RMF),
  dia("2026-04-03", "Día inhábil para el SAT", "vacaciones", FUENTE_RMF),
  ...PRIMER_PERIODO.map((fecha) =>
    dia(fecha, "Primer periodo general de vacaciones de 2026", "vacaciones", FUENTE_RMF_1),
  ),
];

/** Las vacaciones con tres días del art. 12, como los trae el dataset (iguales a la regla). */
export const DIAS_SAT: Dia[] = [
  delCff("2026-01-01"),
  ...VACACIONES_SAT,
  delCff("2026-11-16"),
  delCff("2026-12-25"),
].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

/**
 * El SAT 2026: las vacaciones están completas hasta el 30 de noviembre; los días del art. 12, de
 * 2026 a 2100 por regla. Los fines de semana los cita la regla, no el shard.
 */
export const SHARD_SAT: DatosCalendarioCurado = {
  autoridad: "sat",
  plazos: {
    general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
    declaraciones_pagos: {
      cobertura: { desde: "2026-01-01", hasta: "2100-12-31" },
      excluir_tipos: ["vacaciones"],
    },
  },
  fuentes_fin_de_semana: {},
  dias: DIAS_SAT,
};

export const DIAS_CNBV: Dia[] = [
  dia("2025-12-12", "12 de diciembre", "descanso", FUENTE_CNBV_2025),
  dia("2026-11-02", "2 de noviembre", "descanso", FUENTE_CNBV),
  dia("2026-12-12", "12 de diciembre", "descanso", FUENTE_CNBV),
];

export const SHARD_CNBV: DatosCalendarioCurado = {
  autoridad: "cnbv",
  plazos: {
    general: { cobertura: { desde: "2025-01-01", hasta: "2026-12-31" }, excluir_tipos: [] },
  },
  fuentes_fin_de_semana: { 2025: FUENTE_CNBV_2025, 2026: FUENTE_CNBV },
  dias: DIAS_CNBV,
};
