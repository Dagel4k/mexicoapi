import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabil,
  DiaInhabilCurado,
  FuenteDof,
} from "@mexicoapi/core";
import { PLAZOS, type PlazoCalendario, type RangoFechas, revisarPlazos } from "../curado/plazos.js";
import { ErrorDatos } from "../errores.js";
import { anioDe } from "../fecha.js";

export type { PlazoCalendario } from "../curado/plazos.js";

/**
 * `v1/_internos/calendarios/<autoridad>.json`: lo que el Worker pasa a `crearCalendario`. Un
 * plazo usa solo los días de `dias` que caen en su cobertura, porque `crearCalendario` rechaza
 * los de afuera (en el SAT, el 25 de diciembre queda fuera de `general`).
 */
export interface ShardCalendario {
  autoridad: AutoridadCurada;
  /** `general` siempre; el SAT agrega `declaraciones_pagos`. */
  plazos: { general: PlazoCalendario; declaraciones_pagos?: PlazoCalendario };
  /**
   * Por año de la cobertura amplia (`"2026"`), la publicación que cita los sábados y domingos
   * de ese año. El Worker toma la del año de cada fecha.
   */
  fuentes_fin_de_semana: Record<string, FuenteDof>;
  /** Todos los días curados, por fecha, sin `autoridad`. */
  dias: DiaInhabil[];
}

/**
 * Los fines de semana de cada año se citan con la fuente del último día de descanso de ese año
 * (el CFF art. 12 en el SAT, las disposiciones del año en la CNBV), que debe mencionarlos.
 */
function fuentesFinDeSemana(
  registros: readonly DiaInhabilCurado[],
  amplia: RangoFechas,
  dataset: string,
): Record<string, FuenteDof> {
  const fuentes: Record<string, FuenteDof> = {};
  for (let anio = anioDe(amplia.desde); anio <= anioDe(amplia.hasta); anio++) {
    const ultimo = registros
      .filter((r) => r.tipo === "descanso" && anioDe(r.fecha) === anio)
      .at(-1);
    if (ultimo === undefined) {
      throw new ErrorDatos(
        `el calendario está sin días de descanso en ${anio}, con que se citan sus fines de semana`,
        dataset,
      );
    }
    const { fuente } = ultimo;
    if (!/sábados/i.test(fuente.fragmento) || !/domingos/i.test(fuente.fragmento)) {
      throw new ErrorDatos(
        `la fuente de los fines de semana de ${anio} (${fuente.nombre}) no menciona los sábados y domingos`,
        dataset,
      );
    }
    fuentes[String(anio)] = { ...fuente };
  }
  return fuentes;
}

/** Arma el shard interno del calendario de una autoridad; `registros` va ordenado por fecha. */
export function shardCalendario(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): ShardCalendario {
  const dataset = `dias-inhabiles.${autoridad}`;
  if (cobertura === null) throw new ErrorDatos("el calendario está sin cobertura", dataset);
  const { plazos, amplia, fallas } = revisarPlazos(PLAZOS[autoridad], cobertura, registros);
  if (amplia === null || fallas.length > 0) throw new ErrorDatos(fallas.join("; "), dataset);
  return {
    autoridad,
    plazos: plazos as ShardCalendario["plazos"],
    fuentes_fin_de_semana: fuentesFinDeSemana(registros, amplia, dataset),
    dias: registros.map(({ fecha, motivo, tipo, fuente }) => ({
      fecha,
      motivo,
      tipo,
      fuente: { ...fuente },
    })),
  };
}
