import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabil,
  DiaInhabilCurado,
  FuenteDof,
} from "@mexicoapi/core";
import { PLAZOS, type PlazoCalendario, revisarPlazos } from "../curado/plazos.js";
import { ErrorDatos } from "../errores.js";

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
  fuente_fin_de_semana: FuenteDof;
  /** Todos los días curados, por fecha, sin `autoridad`. */
  dias: DiaInhabil[];
}

/**
 * Los fines de semana se citan con la fuente del último día de descanso (el CFF art. 12 en el
 * SAT, las disposiciones más recientes en la CNBV), que debe mencionarlos.
 */
function fuenteFinDeSemana(registros: readonly DiaInhabilCurado[], dataset: string): FuenteDof {
  const ultimo = registros.filter((r) => r.tipo === "descanso").at(-1);
  if (ultimo === undefined) {
    throw new ErrorDatos("el calendario está sin días de descanso", dataset);
  }
  const { fuente } = ultimo;
  if (!/sábados/i.test(fuente.fragmento) || !/domingos/i.test(fuente.fragmento)) {
    throw new ErrorDatos(
      `la fuente de los fines de semana (${fuente.nombre}) no menciona los sábados y domingos`,
      dataset,
    );
  }
  return { ...fuente };
}

/** Arma el shard interno del calendario de una autoridad; `registros` va ordenado por fecha. */
export function shardCalendario(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): ShardCalendario {
  const dataset = `dias-inhabiles.${autoridad}`;
  if (cobertura === null) throw new ErrorDatos("el calendario está sin cobertura", dataset);
  const { plazos, fallas } = revisarPlazos(PLAZOS[autoridad], cobertura, registros);
  if (fallas.length > 0) throw new ErrorDatos(fallas.join("; "), dataset);
  return {
    autoridad,
    plazos: plazos as ShardCalendario["plazos"],
    fuente_fin_de_semana: fuenteFinDeSemana(registros, dataset),
    dias: registros.map(({ fecha, motivo, tipo, fuente }) => ({
      fecha,
      motivo,
      tipo,
      fuente: { ...fuente },
    })),
  };
}
