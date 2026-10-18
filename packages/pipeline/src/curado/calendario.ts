// El calendario de una autoridad a partir de su YAML curado: lo que `curar` escribe en
// `calendario.json`, lo que el sitio publica para el Worker y lo que el bot usa para saber qué
// días no hay FIX. Se arma siempre con `crearCalendarioCurado` del núcleo, como el Worker y el
// paquete: un YAML que ellos rechazarían falla aquí con el mismo mensaje.
import type {
  AutoridadCurada,
  CoberturaCurada,
  CoberturaSerie,
  DiaInhabilCurado,
  FuenteDof,
} from "@mexicoapi/core";
import {
  type CalendarioCurado,
  crearCalendarioCurado,
  type DatosCalendarioCurado,
  PLAZOS,
  type PlazoCalendario,
  revisarPlazos,
} from "@mexicoapi/core/curados";
import { ErrorDatos } from "../errores.js";
import { anioDe } from "../fecha.js";

export type { PlazoCalendario } from "@mexicoapi/core/curados";

/**
 * `v1/_internos/calendarios/<autoridad>.json`: lo que el Worker pasa a `crearCalendarioCurado`
 * del núcleo, que arma un calendario por tipo de plazo con los días de su cobertura (en el SAT,
 * el 25 de diciembre queda fuera de `general`). Sin `dias` es el `calendario.json` de `curar`.
 */
export interface ShardCalendario extends DatosCalendarioCurado {
  /** `general` siempre; el SAT agrega `declaraciones_pagos`. */
  plazos: { general: PlazoCalendario; declaraciones_pagos?: PlazoCalendario };
  /**
   * Por año de la cobertura amplia (`"2026"`), la publicación que cita los sábados y domingos
   * de ese año. El Worker toma la del año de cada fecha.
   */
  fuentes_fin_de_semana: Record<string, FuenteDof>;
  /** Todos los días curados, por fecha, sin `autoridad`. */
  dias: Omit<DiaInhabilCurado, "autoridad">[];
}

/**
 * Los fines de semana de cada año se citan con la fuente del último día de descanso de ese año
 * (el CFF art. 12 en el SAT, las disposiciones del año en la CNBV), que debe mencionarlos.
 */
function fuentesFinDeSemana(
  registros: readonly DiaInhabilCurado[],
  amplia: CoberturaSerie,
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

/**
 * El shard del calendario de una autoridad y el calendario que arma con él el núcleo;
 * `registros` va ordenado por fecha. Lanza ErrorDatos si falta la cobertura, si los plazos no
 * cuadran o si el núcleo rechaza el shard.
 */
function armar(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): { shard: ShardCalendario; calendario: CalendarioCurado } {
  const dataset = `dias-inhabiles.${autoridad}`;
  if (cobertura === null) throw new ErrorDatos("el calendario está sin cobertura", dataset);
  const { plazos, amplia, fallas } = revisarPlazos(PLAZOS[autoridad], cobertura, registros);
  if (amplia === null || fallas.length > 0) throw new ErrorDatos(fallas.join("; "), dataset);
  const shard: ShardCalendario = {
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
  try {
    return { shard, calendario: crearCalendarioCurado(shard) };
  } catch (error) {
    throw new ErrorDatos(`el núcleo rechaza el calendario: ${(error as Error).message}`, dataset);
  }
}

/** Arma el shard interno del calendario de una autoridad, revisado por el núcleo. */
export function shardCalendario(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): ShardCalendario {
  return armar(autoridad, registros, cobertura).shard;
}

/** El calendario de una autoridad como lo arman el Worker y el paquete. */
export function calendarioCurado(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): CalendarioCurado {
  return armar(autoridad, registros, cobertura).calendario;
}
