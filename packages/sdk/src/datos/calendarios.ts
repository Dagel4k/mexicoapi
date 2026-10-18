// Entrada `mexicoapi/datos/calendarios`: los calendarios de días inhábiles de la CNBV y el SAT que
// trae el paquete, con los mismos tipos de plazo y coberturas que la API, listos para
// sumarDiasHabiles del núcleo: `sumarDiasHabiles({ calendario: calendario("sat", "general"), ... })`.
import {
  type AutoridadCurada,
  type Calendario,
  type CoberturaSerie,
  crearCalendario,
  type DiaInhabil,
  type FechaISO,
  type FuenteDof,
  type TipoDiaCurado,
  type TipoPlazo,
} from "@mexicoapi/core";
import * as cnbv from "./generados/dias-inhabiles-cnbv.js";
import * as sat from "./generados/dias-inhabiles-sat.js";
import type { MetaDatos, PlazoGenerado } from "./tipos.js";

export interface PlazoCurado {
  /** Rango en que la lista está completa para este tipo de plazo. */
  readonly cobertura: CoberturaSerie;
  /** Tipos de día que en este plazo no son inhábiles. */
  readonly excluirTipos: readonly TipoDiaCurado[];
  readonly calendario: Calendario;
  /**
   * Solo si la cobertura del plazo es más corta que la amplia: el mismo plazo con la cobertura
   * amplia y todos los días publicados en ella. Calcula con lo conocido fuera de la cobertura del
   * plazo (el 25 de diciembre del SAT) en vez de descontar solo fines de semana.
   */
  readonly respaldo?: Calendario;
}

/** El calendario de una autoridad con cada tipo de plazo, como lo arma la API. */
export interface CalendarioCurado {
  readonly autoridad: AutoridadCurada;
  /** `general` siempre; el SAT agrega `declaraciones_pagos`. En ese orden. */
  readonly plazos: Readonly<Partial<Record<TipoPlazo, PlazoCurado>>>;
  /** Cuenta todos los tipos de día: en su cobertura la lista está completa. */
  readonly general: PlazoCurado;
  /** La cobertura del plazo que contiene a las de los demás. */
  readonly amplia: CoberturaSerie;
  /** Los días publicados, en orden, sin los fines de semana. */
  readonly dias: readonly DiaInhabil[];
  readonly meta: MetaDatos;
}

const GENERADOS = { cnbv, sat } as const;
const memoria = new Map<AutoridadCurada, CalendarioCurado>();

/** Meta de cada calendario: sus publicaciones en el DOF. */
export const meta: Readonly<Record<AutoridadCurada, MetaDatos>> = Object.freeze({
  cnbv: cnbv.meta,
  sat: sat.meta,
});

const contiene = (a: CoberturaSerie, b: CoberturaSerie): boolean =>
  a.desde <= b.desde && b.hasta <= a.hasta;
const dentro = (fecha: FechaISO, { desde, hasta }: CoberturaSerie): boolean =>
  fecha >= desde && fecha <= hasta;

function armar(autoridad: AutoridadCurada): CalendarioCurado {
  const { datos, calendario } = GENERADOS[autoridad];
  const dias: readonly DiaInhabil[] = Object.freeze(
    datos.map(({ fecha, motivo, tipo, fuente }) => Object.freeze({ fecha, motivo, tipo, fuente })),
  );
  const leidos = Object.entries(calendario.plazos) as [TipoPlazo, PlazoGenerado][];
  const coberturas = leidos.map(([, p]) => p.cobertura);
  // El build exige que un plazo contenga a los demás.
  const amplia = coberturas.find((c) => coberturas.every((o) => contiene(c, o))) as CoberturaSerie;
  const fuenteDe = (anio: number): FuenteDof =>
    calendario.fuentes_fin_de_semana[String(anio)] as FuenteDof;
  const crear = (cobertura: CoberturaSerie, excluirTipos: readonly TipoDiaCurado[]) =>
    crearCalendario({
      autoridad,
      cobertura,
      dias: dias.filter((d) => dentro(d.fecha, cobertura)),
      fuenteFinDeSemana: fuenteDe,
      excluirTipos,
    });
  const plazos: Partial<Record<TipoPlazo, PlazoCurado>> = {};
  for (const [tipo, { cobertura, excluir_tipos }] of leidos) {
    const base = {
      cobertura,
      excluirTipos: excluir_tipos,
      calendario: crear(cobertura, excluir_tipos),
    };
    plazos[tipo] = Object.freeze(
      contiene(cobertura, amplia) ? base : { ...base, respaldo: crear(amplia, excluir_tipos) },
    );
  }
  return Object.freeze({
    autoridad,
    plazos: Object.freeze(plazos),
    general: plazos.general as PlazoCurado,
    amplia,
    dias,
    meta: meta[autoridad],
  });
}

function revisarAutoridad(autoridad: string): asserts autoridad is AutoridadCurada {
  if (!Object.hasOwn(GENERADOS, autoridad)) {
    throw new RangeError(`El paquete trae los calendarios de cnbv y sat, no de ${autoridad}.`);
  }
}

/** El calendario de `autoridad` con todos sus tipos de plazo. Se arma una vez y está congelado. */
export function calendarioCurado(autoridad: AutoridadCurada): CalendarioCurado {
  revisarAutoridad(autoridad);
  let curado = memoria.get(autoridad);
  if (curado === undefined) {
    curado = armar(autoridad);
    memoria.set(autoridad, curado);
  }
  return curado;
}

/**
 * El calendario de un tipo de plazo, para `sumarDiasHabiles`. Fuera de su cobertura lanza
 * CalendarioIncompletoError, como la API. Lanza RangeError si la autoridad no tiene ese plazo
 * (la CNBV solo tiene `general`).
 */
export function calendario(
  autoridad: AutoridadCurada,
  tipoPlazo: TipoPlazo = "general",
): Calendario {
  const plazo = calendarioCurado(autoridad).plazos[tipoPlazo];
  if (plazo === undefined) {
    throw new RangeError(`El calendario de ${autoridad} no tiene el tipo de plazo ${tipoPlazo}.`);
  }
  return plazo.calendario;
}

export type {
  AutoridadCurada,
  Calendario,
  CoberturaSerie,
  DiaInhabil,
  DiaInhabilCurado,
  FuenteDof,
  MetaDatos,
  TipoDiaCurado,
  TipoPlazo,
} from "./tipos.js";
