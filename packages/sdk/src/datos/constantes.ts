// Entrada `mexicoapi/datos/constantes`: la UMA, el salario mínimo y las tarifas de ISR que trae el
// paquete, publicadas en el DOF y con su fuente en cada registro.
import { meta as metaSalario, datos as salarios } from "./generados/constantes-salario-minimo.js";
import { datos as listaUma, meta as metaUma } from "./generados/constantes-uma.js";
import { meta as metaIsr, datos as tarifas } from "./generados/isr-tarifas.js";
import type { FechaISO, MetaDatos, SalarioMinimo, TarifaIsr, Uma } from "./tipos.js";

/** Meta de cada dataset de constantes. */
export const meta: Readonly<{ uma: MetaDatos; salarioMinimo: MetaDatos; isr: MetaDatos }> =
  Object.freeze({ uma: metaUma, salarioMinimo: metaSalario, isr: metaIsr });

const VACIO: readonly SalarioMinimo[] = Object.freeze([]);
const unicos = (anios: readonly number[]): readonly number[] =>
  Object.freeze([...new Set(anios)].sort((a, b) => a - b));

/** Los años que trae el paquete de cada constante, en orden. */
export const anios: Readonly<{
  uma: readonly number[];
  salarioMinimo: readonly number[];
  isr: Readonly<Record<TarifaIsr["periodo"], readonly number[]>>;
}> = Object.freeze({
  uma: unicos(listaUma.map((u) => u.anio)),
  salarioMinimo: unicos(salarios.map((s) => s.anio)),
  isr: Object.freeze({
    mensual: unicos(tarifas.filter((t) => t.periodo === "mensual").map((t) => t.anio)),
    anual: unicos(tarifas.filter((t) => t.periodo === "anual").map((t) => t.anio)),
  }),
});

/** La UMA de cada año, en orden. Congelada. */
export function umas(): readonly Uma[] {
  return listaUma;
}

/** La UMA de `anio`: rige del 1 de febrero de ese año al 31 de enero del siguiente. */
export function uma(anio: number): Uma | undefined {
  return listaUma.find((u) => u.anio === anio);
}

/**
 * La UMA vigente en `fecha` (AAAA-MM-DD): en enero, la del año anterior. undefined si la fecha cae
 * antes de la primera o después del 31 de enero siguiente a la última que trae el paquete.
 */
export function umaVigente(fecha: FechaISO): Uma | undefined {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new RangeError(`Fecha ISO inválida: ${String(fecha)}`);
  }
  return uma(Number(fecha.slice(0, 4)) - (fecha.slice(5) < "02-01" ? 1 : 0));
}

/** Todos los salarios mínimos, por año y zona. Congelados. */
export function salariosMinimos(): readonly SalarioMinimo[] {
  return salarios;
}

/** El salario mínimo de `anio`: uno por zona (`general` y `zlfn`). Vacío si no está. */
export function salarioMinimo(anio: number): readonly SalarioMinimo[] {
  const delAnio = salarios.filter((s) => s.anio === anio);
  return delAnio.length === 0 ? VACIO : Object.freeze(delAnio);
}

/** Todas las tarifas de ISR. Congeladas. */
export function tarifasIsr(): readonly TarifaIsr[] {
  return tarifas;
}

/** La tarifa de ISR de un periodo (`mensual` o `anual`) y un año. */
export function tarifaIsr(periodo: TarifaIsr["periodo"], anio: number): TarifaIsr | undefined {
  return tarifas.find((t) => t.periodo === periodo && t.anio === anio);
}

export type { MetaDatos, SalarioMinimo, TarifaIsr, TramoIsr, Uma } from "./tipos.js";
