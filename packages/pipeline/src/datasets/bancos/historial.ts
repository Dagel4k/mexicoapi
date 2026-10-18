import type { FechaISO, PeriodoBanco } from "@mexicoapi/core";
import { ErrorDatos } from "../../errores.js";
import { codigoClabe, type EntradaCep } from "./cep.js";

export interface Observacion {
  fecha: FechaISO;
  entradas: readonly EntradaCep[];
}

const porFecha = (a: Observacion, b: Observacion): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;

/** Agrega la observación al final del historial; devuelve un arreglo nuevo. */
export function extenderHistorial(
  historial: readonly PeriodoBanco[],
  fecha: FechaISO,
  entrada: EntradaCep,
): PeriodoBanco[] {
  const copia = historial.map((p) => ({ ...p }));
  const ultimo = copia[copia.length - 1];
  const [codigo_spei, nombre_corto] = entrada;
  if (ultimo !== undefined && fecha < ultimo.visto_hasta) {
    throw new RangeError(`El historial solo avanza: ${fecha} es anterior a ${ultimo.visto_hasta}`);
  }
  if (
    ultimo !== undefined &&
    ultimo.codigo_spei === codigo_spei &&
    ultimo.nombre_corto === nombre_corto
  ) {
    ultimo.visto_hasta = fecha;
  } else {
    copia.push({ codigo_spei, nombre_corto, visto_desde: fecha, visto_hasta: fecha });
  }
  return copia;
}

/** Historial por código de 3 dígitos a partir de observaciones en cualquier orden. */
export function historialesDesdeObservaciones(
  observaciones: readonly Observacion[],
): Map<string, PeriodoBanco[]> {
  const resultado = new Map<string, PeriodoBanco[]>();
  for (const obs of [...observaciones].sort(porFecha)) {
    const vistos = new Set<string>();
    for (const entrada of obs.entradas) {
      const codigo = codigoClabe(entrada[0]);
      if (vistos.has(codigo)) {
        throw new ErrorDatos(
          `El código ${codigo} aparece más de una vez el ${obs.fecha}`,
          "bancos",
        );
      }
      vistos.add(codigo);
      resultado.set(codigo, extenderHistorial(resultado.get(codigo) ?? [], obs.fecha, entrada));
    }
  }
  return resultado;
}

const firma = (entradas: readonly EntradaCep[]): string =>
  JSON.stringify([...entradas].sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1)));

/** Conserva la primera, la última y cada observación cuya lista cambia. */
export function observacionesCompactas(observaciones: readonly Observacion[]): Observacion[] {
  const orden = [...observaciones].sort(porFecha);
  return orden.filter(
    (obs, i) =>
      i === 0 ||
      i === orden.length - 1 ||
      firma(obs.entradas) !== firma((orden[i - 1] as Observacion).entradas),
  );
}
