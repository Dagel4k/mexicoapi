import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabil,
  DiaInhabilCurado,
  FechaISO,
  FuenteDof,
  TipoDiaCurado,
} from "@mexicoapi/core";
import { ErrorDatos } from "../errores.js";

export type TipoPlazo = "general" | "declaraciones_pagos";

export interface PlazoCalendario {
  /** Rango en que la lista está completa para este tipo de plazo. */
  cobertura: { desde: FechaISO; hasta: FechaISO };
  /** Tipos de día que en este plazo no cuentan como inhábiles (`excluirTipos` del núcleo). */
  excluir_tipos: TipoDiaCurado[];
}

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
 * Tipos de plazo de cada autoridad y los tipos de día que no cuentan en cada uno. En los plazos
 * para presentar declaraciones y pagar contribuciones no se cuentan las vacaciones generales
 * del SAT como inhábiles (CFF art. 12, segundo párrafo).
 */
const PLAZOS: Readonly<Record<AutoridadCurada, Partial<Record<TipoPlazo, TipoDiaCurado[]>>>> = {
  cnbv: { general: [] },
  sat: { general: [], declaraciones_pagos: ["vacaciones"] },
};

/**
 * La cobertura de un plazo es la intersección de las coberturas de los tipos de día que cuentan
 * en él: con `general` del SAT, hasta donde están publicadas las vacaciones.
 */
function plazo(
  tipo: TipoPlazo,
  excluir: readonly TipoDiaCurado[],
  cobertura: CoberturaCurada,
  dataset: string,
): PlazoCalendario {
  const [primero, ...resto] = (Object.keys(cobertura) as TipoDiaCurado[])
    .filter((t) => !excluir.includes(t))
    .map((t) => cobertura[t] as { desde: FechaISO; hasta: FechaISO });
  if (primero === undefined) {
    throw new ErrorDatos(
      `el plazo ${tipo} no tiene cobertura de un tipo de día que cuente`,
      dataset,
    );
  }
  let { desde, hasta } = primero;
  for (const r of resto) {
    if (r.desde > desde) desde = r.desde;
    if (r.hasta < hasta) hasta = r.hasta;
  }
  if (desde > hasta) throw new ErrorDatos(`la cobertura del plazo ${tipo} queda vacía`, dataset);
  return { cobertura: { desde, hasta }, excluir_tipos: [...excluir] };
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
  const plazos: Partial<Record<TipoPlazo, PlazoCalendario>> = {};
  for (const [tipo, excluir] of Object.entries(PLAZOS[autoridad]) as [
    TipoPlazo,
    TipoDiaCurado[],
  ][]) {
    plazos[tipo] = plazo(tipo, excluir, cobertura, dataset);
  }
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
