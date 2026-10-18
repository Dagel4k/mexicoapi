import type {
  AutoridadCurada,
  CoberturaCurada,
  FechaISO,
  TipoDiaCurado,
  TipoPlazo,
} from "@mexicoapi/core";

export interface RangoFechas {
  desde: FechaISO;
  hasta: FechaISO;
}

export interface PlazoCalendario {
  /** Rango en que la lista está completa para este tipo de plazo. */
  cobertura: RangoFechas;
  /** Tipos de día que en este plazo no cuentan como inhábiles (`excluirTipos` del núcleo). */
  excluir_tipos: TipoDiaCurado[];
}

/** Tipo de plazo → tipos de día que no cuentan en él. */
export type TablaPlazos = Partial<Record<TipoPlazo, readonly TipoDiaCurado[]>>;

/**
 * Tipos de plazo de cada autoridad y los tipos de día que no cuentan en cada uno. En los plazos
 * para presentar declaraciones y pagar contribuciones no se cuentan las vacaciones generales
 * del SAT como inhábiles (CFF art. 12, segundo párrafo).
 */
export const PLAZOS: Readonly<Record<AutoridadCurada, TablaPlazos>> = {
  cnbv: { general: [] },
  sat: { general: [], declaraciones_pagos: ["vacaciones"] },
};

export interface RevisionPlazos {
  /** Vacío si un plazo queda sin cobertura o ninguno contiene a los demás. */
  plazos: Partial<Record<TipoPlazo, PlazoCalendario>>;
  /** La cobertura del plazo que contiene a los demás. */
  amplia: RangoFechas | null;
  fallas: string[];
}

const contiene = (a: RangoFechas, b: RangoFechas): boolean =>
  a.desde <= b.desde && b.hasta <= a.hasta;

/**
 * Lo que el Worker exige al leer el calendario de una autoridad, revisado con los datos curados
 * para fallar antes de publicarlo. La cobertura de un plazo es la intersección de las coberturas
 * de los tipos de día que cuentan en él (con `general` del SAT, hasta donde están publicadas las
 * vacaciones); un plazo debe contener a los demás (la cobertura amplia) y cada día debe caer en
 * ella: un día de afuera haría fallar todas las consultas de la autoridad.
 */
export function revisarPlazos(
  tabla: TablaPlazos,
  cobertura: CoberturaCurada,
  dias: readonly { fecha: FechaISO }[],
): RevisionPlazos {
  const fallas: string[] = [];
  const plazos: Partial<Record<TipoPlazo, PlazoCalendario>> = {};
  for (const [tipo, excluir] of Object.entries(tabla) as [TipoPlazo, TipoDiaCurado[]][]) {
    const [primero, ...resto] = (Object.keys(cobertura) as TipoDiaCurado[])
      .filter((t) => !excluir.includes(t))
      .map((t) => cobertura[t] as RangoFechas);
    if (primero === undefined) {
      fallas.push(`el plazo ${tipo} no tiene cobertura de un tipo de día que cuente`);
      continue;
    }
    let { desde, hasta } = primero;
    for (const r of resto) {
      if (r.desde > desde) desde = r.desde;
      if (r.hasta < hasta) hasta = r.hasta;
    }
    if (desde > hasta) {
      fallas.push(`la cobertura del plazo ${tipo} queda vacía`);
      continue;
    }
    plazos[tipo] = { cobertura: { desde, hasta }, excluir_tipos: [...excluir] };
  }
  if (fallas.length > 0) return { plazos: {}, amplia: null, fallas };
  const coberturas = Object.values(plazos).map((p) => p.cobertura);
  const amplia = coberturas.find((c) => coberturas.every((otra) => contiene(c, otra)));
  if (amplia === undefined) {
    return {
      plazos: {},
      amplia: null,
      fallas: ["ningún tipo de plazo contiene la cobertura de los demás"],
    };
  }
  const lista = Object.entries(plazos)
    .map(([tipo, p]) => `${tipo} del ${p.cobertura.desde} al ${p.cobertura.hasta}`)
    .join("; ");
  for (const { fecha } of dias) {
    if (fecha < amplia.desde || fecha > amplia.hasta) {
      fallas.push(`${fecha}: no cae en la cobertura de ningún tipo de plazo (${lista})`);
    }
  }
  return { plazos, amplia, fallas };
}
