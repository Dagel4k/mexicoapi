import type { FechaISO } from "@mexicoapi/core";

const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha civil (AAAA-MM-DD) de un instante en America/Mexico_City. */
export function fechaEnMexico(instante: Date): FechaISO {
  return formato.format(instante) as FechaISO;
}

/** Año de una fecha ISO, como número. */
export const anioDe = (fecha: FechaISO): number => Number(fecha.slice(0, 4));
