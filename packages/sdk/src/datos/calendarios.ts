// Entrada `mexicoapi/datos/calendarios`: los calendarios de días inhábiles de la CNBV y el SAT que
// trae el paquete, armados con las reglas del núcleo que usa la API (los mismos tipos de plazo,
// coberturas y respaldo), listos para sumarDiasHabiles:
// `sumarDiasHabiles({ calendario: calendario("sat", "general"), ... })`.
import {
  type CalendarioCurado as CalendarioDelNucleo,
  crearCalendarioCurado,
  exigirCurada,
  feriadosBancarios,
  plazoDe,
} from "@mexicoapi/core/curados";
import * as cnbv from "./generados/dias-inhabiles-cnbv.js";
import * as sat from "./generados/dias-inhabiles-sat.js";
import type { AutoridadCurada, Calendario, FechaISO, MetaDatos, TipoPlazo } from "./tipos.js";

/**
 * El calendario de una autoridad con un `Calendario` por tipo de plazo, como lo arma la API, y la
 * meta de sus publicaciones en el DOF.
 */
export interface CalendarioCurado extends CalendarioDelNucleo {
  readonly meta: MetaDatos;
}

const GENERADOS = { cnbv, sat } as const;
const memoria = new Map<AutoridadCurada, CalendarioCurado>();

/** Meta de cada calendario: sus publicaciones en el DOF. */
export const meta: Readonly<Record<AutoridadCurada, MetaDatos>> = Object.freeze({
  cnbv: cnbv.meta,
  sat: sat.meta,
});

/** El calendario de `autoridad` con todos sus tipos de plazo. Se arma una vez y está congelado. */
export function calendarioCurado(autoridad: AutoridadCurada): CalendarioCurado {
  exigirCurada(autoridad);
  let curado = memoria.get(autoridad);
  if (curado === undefined) {
    const { datos, calendario } = GENERADOS[autoridad];
    // El núcleo copia de cada día solo sus campos: la autoridad queda arriba.
    curado = Object.freeze({
      ...crearCalendarioCurado({ ...calendario, dias: datos }),
      meta: meta[autoridad],
    });
    memoria.set(autoridad, curado);
  }
  return curado;
}

/**
 * El calendario de un tipo de plazo, para `sumarDiasHabiles`. Fuera de su cobertura lanza
 * CalendarioIncompletoError, como la API. Con el SAT el tipo de plazo es obligatorio, como en la
 * API: sin él lanza TypeError. Lanza RangeError si la autoridad no tiene ese plazo (la CNBV solo
 * tiene `general`, que es el de omisión).
 *
 * Con `permitirIncompleto`, fuera de la cobertura del plazo solo se descuentan fines de semana y
 * la advertencia nombra lo que puede faltar (en el SAT, los días del art. 12 y las vacaciones). No
 * sigue con el `respaldo` del plazo como la API: el respaldo no sabe hasta dónde están publicadas
 * las vacaciones y, usado solo, daría el resultado sin ese aviso. Para el resultado y las
 * advertencias de la API, usa el cliente (`crearCliente`, también sin red).
 */
export function calendario(autoridad: "cnbv", tipoPlazo?: "general"): Calendario;
export function calendario(autoridad: "sat", tipoPlazo: TipoPlazo): Calendario;
export function calendario(autoridad: AutoridadCurada, tipoPlazo: TipoPlazo): Calendario;
export function calendario(autoridad: AutoridadCurada, tipoPlazo?: TipoPlazo): Calendario {
  const curado = calendarioCurado(autoridad);
  const { plazos } = curado;
  if (tipoPlazo === undefined) {
    if (plazos.size > 1) {
      const tipos = [...plazos.keys()].join(" o ");
      throw new TypeError(`Con autoridad=${autoridad} falta tipoPlazo: ${tipos}.`);
    }
    tipoPlazo = "general";
  }
  return plazoDe(curado, tipoPlazo).calendario;
}

let feriados: ((fecha: FechaISO) => boolean) | undefined;

/**
 * Si `fecha` es un día de descanso de la CNBV dentro de su calendario: el DOF no publica el FIX
 * en los feriados bancarios. Es el `sinPublicacion` de fixPublicado y fixParaOperacion que usa la
 * API: `fixParaOperacion(serie, tramo, cobertura, fecha, { sinPublicacion: feriadoBancario })`.
 * Fuera del calendario da false: ahí solo cuentan los fines de semana.
 */
export function feriadoBancario(fecha: FechaISO): boolean {
  feriados ??= feriadosBancarios(calendarioCurado("cnbv"));
  return feriados(fecha);
}

export type { PlazoCurado } from "@mexicoapi/core/curados";
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
