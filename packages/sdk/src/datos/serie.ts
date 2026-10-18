import type { CoberturaSerie, FechaISO } from "./tipos.js";

/**
 * Cobertura de una serie completa: del primer al último registro. Revisa que vaya en orden
 * estricto por fecha, como suponen fixPublicado, fixParaOperacion y udiDeFecha.
 */
export function coberturaDe<T>(
  serie: readonly T[],
  fechaDe: (registro: T) => FechaISO,
): CoberturaSerie {
  const fechas = serie.map(fechaDe);
  const desde = fechas[0];
  const hasta = fechas.at(-1);
  if (desde === undefined || hasta === undefined) {
    throw new Error("La serie del paquete está vacía");
  }
  for (let i = 1; i < fechas.length; i++) {
    if ((fechas[i - 1] as FechaISO) >= (fechas[i] as FechaISO)) {
      throw new Error(`La serie del paquete no va en orden estricto por fecha en ${fechas[i]}`);
    }
  }
  return Object.freeze({ desde, hasta });
}
