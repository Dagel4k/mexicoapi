import { type CoberturaSerie, esFechaIsoValida, type FechaISO } from "@mexicoapi/core";
import { ErrorDatos } from "../errores.js";
import { anioDe } from "../fecha.js";

/** Registros de un año de una serie y las fechas que cubren. */
export interface ShardAnual<T> {
  anio: string;
  tramo: CoberturaSerie;
  datos: T[];
}

/**
 * Parte una serie en un shard por año, del año del primer registro al del último. La cobertura
 * va de la primera a la última fecha; el tramo de cada año va del 1 de enero al 31 de diciembre,
 * recortado a la cobertura. Un año sin registros dentro de la cobertura lleva `datos: []`.
 */
export function partirPorAnio<T>(
  registros: readonly T[],
  fechaDe: (registro: T) => FechaISO,
  dataset: string,
): { cobertura: CoberturaSerie; shards: ShardAnual<T>[] } {
  const fechas = registros.map(fechaDe);
  const desde = fechas[0];
  const hasta = fechas.at(-1);
  if (desde === undefined || hasta === undefined) {
    throw new ErrorDatos("la serie no tiene registros", dataset);
  }
  fechas.forEach((fecha, i) => {
    if (!esFechaIsoValida(fecha)) throw new ErrorDatos(`fecha inválida: ${fecha}`, dataset);
    const anterior = fechas[i - 1];
    if (anterior !== undefined && anterior >= fecha) {
      throw new ErrorDatos(
        `la serie no está en orden estricto por fecha: ${fecha} después de ${anterior}`,
        dataset,
      );
    }
  });

  const shards: ShardAnual<T>[] = [];
  const primero = anioDe(desde);
  for (let a = primero; a <= anioDe(hasta); a++) {
    const anio = String(a).padStart(4, "0");
    const inicio = `${anio}-01-01`;
    const fin = `${anio}-12-31`;
    shards.push({
      anio,
      tramo: { desde: inicio < desde ? desde : inicio, hasta: fin > hasta ? hasta : fin },
      datos: [],
    });
  }
  registros.forEach((registro, i) => {
    (shards[anioDe(fechas[i] as FechaISO) - primero] as ShardAnual<T>).datos.push(registro);
  });
  return { cobertura: { desde, hasta }, shards };
}
