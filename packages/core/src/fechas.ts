/** Fecha en formato "YYYY-MM-DD". */
export type FechaISO = string;
/** 0 = domingo ... 6 = sábado. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const FORMATO_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MS_POR_DIA = 86_400_000;

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

function diasEnMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

export function esFechaIsoValida(valor: string): boolean {
  if (!FORMATO_ISO.test(valor)) return false;
  return fechaValida(
    Number(valor.slice(0, 4)),
    Number(valor.slice(5, 7)),
    Number(valor.slice(8, 10)),
  );
}

// Date.UTC trata los años 0-99 como 1900-1999, así que se fija el año aparte.
function msUtc(anio: number, mes: number, dia: number): number {
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return fecha.getTime();
}

function aMs(fecha: FechaISO): number {
  if (!esFechaIsoValida(fecha)) {
    throw new RangeError(`Fecha ISO inválida: ${fecha}`);
  }
  return msUtc(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10)));
}

function deMs(ms: number): FechaISO {
  const fecha = new Date(ms);
  const anio = fecha.getUTCFullYear();
  if (anio < 1 || anio > 9999) {
    throw new RangeError("La fecha resultante sale del rango 0001-9999");
  }
  const aa = String(anio).padStart(4, "0");
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getUTCDate()).padStart(2, "0");
  return `${aa}-${mm}-${dd}`;
}

export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  if (!Number.isInteger(dias)) {
    throw new RangeError(`Los días deben ser un entero: ${dias}`);
  }
  return deMs(aMs(fecha) + dias * MS_POR_DIA);
}

export function diaDeLaSemana(fecha: FechaISO): DiaSemana {
  return new Date(aMs(fecha)).getUTCDay() as DiaSemana;
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
  const primero = new Date(msUtc(anio, mes, 1)).getUTCDay();
  const diaDelMes = 1 + ((dia - primero + 7) % 7) + (n - 1) * 7;
  if (diaDelMes > diasEnMes(anio, mes)) {
    throw new RangeError(`No existe el día ${n} de la semana ${dia} en ${anio}-${mes}`);
  }
  return deMs(msUtc(anio, mes, diaDelMes));
}
