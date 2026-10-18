import { CalendarioIncompletoError } from "../errores.js";
import { aDias, deDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";
import type { Calendario } from "./calendario.js";
import { type Autoridad, type DiaInhabil, SIGLAS_AUTORIDAD } from "./tipos.js";

export interface ResultadoDiasHabiles {
  autoridad: Autoridad;
  desde: FechaISO;
  dias: number;
  resultado: FechaISO;
  /** Inhábiles saltados, sin los de tipo "fin_de_semana". */
  inhabiles_saltados: DiaInhabil[];
  advertencias: string[];
}

const DIAS_MAX = 3650;

export function sumarDiasHabiles(parametros: {
  calendario: Calendario;
  desde: FechaISO;
  dias: number;
  permitirIncompleto?: boolean;
}): ResultadoDiasHabiles {
  const { calendario, desde, dias, permitirIncompleto = false } = parametros;
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAX) {
    throw new RangeError(`Los días deben ser un entero de 1 a ${DIAS_MAX}: ${dias}`);
  }
  if (!esFechaIsoValida(desde)) {
    throw new RangeError(`Fecha ISO inválida: ${desde}`);
  }

  const { autoridad, cobertura, faltaFuera } = calendario;
  const falta = faltaFuera === undefined ? "" : ` ${faltaFuera}`;
  const saltados: DiaInhabil[] = [];
  const advertencias: string[] = [];
  const aniosAvisados = new Set<string>();
  let contados = 0;
  let numero = aDias(desde);
  let actual = desde;

  while (contados < dias) {
    numero += 1;
    actual = deDias(numero);
    let inhabil: Pick<DiaInhabil, "tipo"> | null;
    if (actual < cobertura.desde || actual > cobertura.hasta) {
      if (!permitirIncompleto) {
        throw new CalendarioIncompletoError(autoridad, actual, cobertura);
      }
      const anio = actual.slice(0, 4);
      if (!aniosAvisados.has(anio)) {
        aniosAvisados.add(anio);
        advertencias.push(
          `Calendario incompleto: ${SIGLAS_AUTORIDAD[autoridad]} ${anio}; solo se descontaron fines de semana.${falta}`,
        );
      }
      const semana = diaSemanaDeDias(numero);
      inhabil = semana === 0 || semana === 6 ? { tipo: "fin_de_semana" } : null;
    } else {
      inhabil = calendario.inhabil(actual);
    }
    if (inhabil === null) {
      contados += 1;
    } else if (inhabil.tipo !== "fin_de_semana") {
      saltados.push(inhabil as DiaInhabil);
    }
  }

  if (calendario.avisos !== undefined) advertencias.push(...calendario.avisos(desde, actual));
  return {
    autoridad,
    desde,
    dias,
    resultado: actual,
    inhabiles_saltados: saltados,
    advertencias,
  };
}
