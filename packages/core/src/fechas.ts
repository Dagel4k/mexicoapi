import { FechaFueraDeRangoError } from "./errores.js";

/** Fecha en formato "YYYY-MM-DD". */
export type FechaISO = string;
/** 0 = domingo ... 6 = sábado. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const FORMATO_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

export function fechaValida(anio: number, mes: number, dia: number): boolean {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) {
    return false;
  }
  if (anio < 1 || anio > 9999 || mes < 1 || mes > 12 || dia < 1) {
    return false;
  }
  return dia <= diasEnMes(anio, mes);
}

const DIAS_POR_MES = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

// Solo se llama con mes entre 1 y 12.
function diasEnMes(anio: number, mes: number): number {
  return mes === 2 && esBisiesto(anio) ? 29 : (DIAS_POR_MES[mes] as number);
}

export function esFechaIsoValida(valor: string): boolean {
  if (!FORMATO_ISO.test(valor)) return false;
  return fechaValida(
    Number(valor.slice(0, 4)),
    Number(valor.slice(5, 7)),
    Number(valor.slice(8, 10)),
  );
}

// Aritmética entera con días desde 1970-01-01 (sin Date). Algoritmos de Howard Hinnant,
// days_from_civil y civil_from_days (http://howardhinnant.github.io/date_algorithms.html).
const DIA_MIN = -719_162; // 0001-01-01
const DIA_MAX = 2_932_896; // 9999-12-31

const DOS_DIGITOS: readonly string[] = Array.from({ length: 32 }, (_, i) =>
  i < 10 ? `0${i}` : String(i),
);

// Con año >= 1 todos los cocientes son no negativos, así que `| 0` equivale a Math.floor.
function diasDesdeCivil(anio: number, mes: number, dia: number): number {
  const y = mes <= 2 ? anio - 1 : anio;
  const era = (y / 400) | 0;
  const yoe = y - era * 400;
  const doy = (((153 * (mes > 2 ? mes - 3 : mes + 9) + 2) / 5) | 0) + dia - 1;
  const doe = yoe * 365 + ((yoe / 4) | 0) - ((yoe / 100) | 0) + doy;
  return era * 146_097 + doe - 719_468;
}

// Valor del dígito en la posición i, o -1 si el caracter no es un dígito ASCII.
function digito(fecha: string, i: number): number {
  const c = fecha.charCodeAt(i) - 48;
  return c >= 0 && c <= 9 ? c : -1;
}

/** Días desde 1970-01-01; lanza RangeError si la fecha no es ISO válida. */
export function aDias(fecha: FechaISO): number {
  // Misma validación que esFechaIsoValida, sin regex ni subcadenas.
  if (typeof fecha === "string" && fecha.length === 10) {
    const a0 = digito(fecha, 0);
    const a1 = digito(fecha, 1);
    const a2 = digito(fecha, 2);
    const a3 = digito(fecha, 3);
    const m0 = digito(fecha, 5);
    const m1 = digito(fecha, 6);
    const d0 = digito(fecha, 8);
    const d1 = digito(fecha, 9);
    // Cualquier posición no dígito deja el OR en negativo; los separadores deben ser "-".
    if (
      (a0 | a1 | a2 | a3 | m0 | m1 | d0 | d1) >= 0 &&
      fecha.charCodeAt(4) === 45 &&
      fecha.charCodeAt(7) === 45
    ) {
      const anio = a0 * 1000 + a1 * 100 + a2 * 10 + a3;
      const mes = m0 * 10 + m1;
      const dia = d0 * 10 + d1;
      if (fechaValida(anio, mes, dia)) return diasDesdeCivil(anio, mes, dia);
    }
  }
  throw new RangeError(`Fecha ISO inválida: ${fecha}`);
}

/** Fecha ISO del día contado desde 1970-01-01; lanza FechaFueraDeRangoError fuera de 0001-9999. */
export function deDias(dias: number): FechaISO {
  if (!(dias >= DIA_MIN && dias <= DIA_MAX)) throw new FechaFueraDeRangoError();
  const z = dias + 719_468;
  const era = (z / 146_097) | 0;
  const doe = z - era * 146_097;
  const yoe = ((doe - ((doe / 1460) | 0) + ((doe / 36_524) | 0) - ((doe / 146_096) | 0)) / 365) | 0;
  const doy = doe - (365 * yoe + ((yoe / 4) | 0) - ((yoe / 100) | 0));
  const mp = ((5 * doy + 2) / 153) | 0;
  const dia = doy - (((153 * mp + 2) / 5) | 0) + 1;
  const mes = mp < 10 ? mp + 3 : mp - 9;
  const anio = yoe + era * 400 + (mes <= 2 ? 1 : 0);
  const aa = anio >= 1000 ? String(anio) : String(anio).padStart(4, "0");
  return `${aa}-${DOS_DIGITOS[mes]}-${DOS_DIGITOS[dia]}`;
}

/** 0 = domingo ... 6 = sábado, a partir de los días desde 1970-01-01 (jueves). */
export function diaSemanaDeDias(dias: number): DiaSemana {
  return ((((dias + 4) % 7) + 7) % 7) as DiaSemana;
}

export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  if (!Number.isInteger(dias)) {
    throw new RangeError(`Los días deben ser un entero: ${dias}`);
  }
  return deDias(aDias(fecha) + dias);
}

export function diaDeLaSemana(fecha: FechaISO): DiaSemana {
  return diaSemanaDeDias(aDias(fecha));
}

export function enesimoDiaDeSemana(anio: number, mes: number, n: number, dia: DiaSemana): FechaISO {
  if (!fechaValida(anio, mes, 1)) {
    throw new RangeError(`Año o mes inválido: ${anio}-${mes}`);
  }
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new RangeError(`n debe ser un entero de 1 a 5: ${n}`);
  }
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
    throw new RangeError(`Día de la semana inválido: ${dia}`);
  }
  const primero = diaSemanaDeDias(diasDesdeCivil(anio, mes, 1));
  const diaDelMes = 1 + ((dia - primero + 7) % 7) + (n - 1) * 7;
  if (diaDelMes > diasEnMes(anio, mes)) {
    throw new RangeError(`No existe el día ${n} de la semana ${dia} en ${anio}-${mes}`);
  }
  return deDias(diasDesdeCivil(anio, mes, diaDelMes));
}
