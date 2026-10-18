import type { FechaISO, PeriodoBanco } from "@mexicoapi/core";
import { ErrorDatos } from "../../errores.js";
import { codigoClabe, type EntradaCep } from "./cep.js";

export interface Observacion {
  fecha: FechaISO;
  entradas: readonly EntradaCep[];
}

const porFecha = (a: Observacion, b: Observacion): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;

const mismoPar = (p: PeriodoBanco, e: EntradaCep): boolean =>
  p.codigo_spei === e[0] && p.nombre_corto === e[1];

/**
 * Aplica una observación a un historial de intervalos semiabiertos [desde, hasta).
 * `entrada` es el par visto hoy para el código, o `null` si no aparece. Pura: no muta.
 * Si el mismo día se abre y se cierra un periodo, se descarta en vez de dejar un
 * intervalo vacío.
 */
export function actualizarHistorial(
  historial: readonly PeriodoBanco[],
  fecha: FechaISO,
  entrada: EntradaCep | null,
): PeriodoBanco[] {
  const copia = historial.map((p) => ({ ...p }));
  const ultimo = copia[copia.length - 1];
  if (ultimo !== undefined) {
    if (fecha < ultimo.desde || (ultimo.hasta !== null && fecha < ultimo.hasta)) {
      throw new RangeError(`El historial solo avanza: ${fecha} es anterior a su último dato`);
    }
  }
  const abierto = ultimo !== undefined && ultimo.hasta === null;
  const nuevo = (e: EntradaCep): PeriodoBanco => ({
    codigo_spei: e[0],
    nombre_corto: e[1],
    desde: fecha,
    hasta: null,
  });

  if (entrada === null) {
    if (ultimo !== undefined && abierto) {
      if (ultimo.desde === fecha) copia.pop();
      else ultimo.hasta = fecha;
    }
    return copia;
  }
  if (ultimo !== undefined && abierto) {
    if (mismoPar(ultimo, entrada)) return copia;
    if (ultimo.desde === fecha) copia.pop();
    else ultimo.hasta = fecha;
    copia.push(nuevo(entrada));
    return copia;
  }
  if (ultimo !== undefined && ultimo.hasta === fecha && mismoPar(ultimo, entrada)) {
    ultimo.hasta = null;
    return copia;
  }
  copia.push(nuevo(entrada));
  return copia;
}

/** Historial por código de 3 dígitos a partir de observaciones en cualquier orden. */
export function historialesDesdeObservaciones(
  observaciones: readonly Observacion[],
): Map<string, PeriodoBanco[]> {
  const resultado = new Map<string, PeriodoBanco[]>();
  for (const obs of [...observaciones].sort(porFecha)) {
    const hoy = new Map<string, EntradaCep>();
    for (const entrada of obs.entradas) {
      const codigo = codigoClabe(entrada[0]);
      if (hoy.has(codigo)) {
        throw new ErrorDatos(
          `El código ${codigo} aparece más de una vez el ${obs.fecha}`,
          "bancos",
        );
      }
      hoy.set(codigo, entrada);
    }
    for (const codigo of new Set([...resultado.keys(), ...hoy.keys()])) {
      const h = actualizarHistorial(
        resultado.get(codigo) ?? [],
        obs.fecha,
        hoy.get(codigo) ?? null,
      );
      if (h.length > 0) resultado.set(codigo, h);
      else resultado.delete(codigo);
    }
  }
  return resultado;
}

const firma = (entradas: readonly EntradaCep[]): string =>
  JSON.stringify([...entradas].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])));

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
