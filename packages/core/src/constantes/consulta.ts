// Consultas de las constantes curadas (UMA, salario mínimo, tarifas de ISR) con las reglas y los
// textos de la API. Entra por su subruta del núcleo (constantes) y no por el índice.
import type { Uma } from "../datos/curados.js";
import { esFechaIsoValida, type FechaISO } from "../fechas.js";

/** Rango con los dos extremos incluidos. */
export interface Vigencia {
  readonly desde: FechaISO;
  readonly hasta: FechaISO;
}

/**
 * Lo que da `umaVigente`. `sin_dato` es definitivo: la fecha es anterior a la primera UMA de los
 * datos. `no_disponible` puede cambiar: es posterior a la última y todavía no se carga. `detalle`
 * es el texto de la API. Una fecha que cae en un hueco de la lista no da ninguno de los dos:
 * `umaVigente` lanza RangeError porque la lista está mal formada.
 */
export type ConsultaUma =
  | { tipo: "encontrado"; registro: Uma }
  | { tipo: "sin_dato" | "no_disponible"; cobertura: Vigencia; detalle: string };

/**
 * La UMA vigente en `fecha`. Cada una rige del 1 de febrero de su año al 31 de enero del
 * siguiente (Ley para Determinar el Valor de la UMA, art. 5): en enero aplica la del año
 * anterior. `umas` va en años consecutivos, del más antiguo al más reciente; la cobertura va del
 * 1 de febrero de la primera al 31 de enero siguiente a la última. Lanza RangeError si la fecha
 * no existe o la lista está vacía o tiene un hueco donde cae la fecha.
 */
export function umaVigente(umas: readonly Uma[], fecha: FechaISO): ConsultaUma {
  if (!esFechaIsoValida(fecha)) throw new RangeError(`Fecha ISO inválida: ${fecha}`);
  const primera = umas[0];
  const ultima = umas[umas.length - 1];
  if (primera === undefined || ultima === undefined) {
    throw new RangeError("La lista de la UMA está vacía");
  }
  const cobertura = Object.freeze({
    desde: primera.vigencia_desde,
    hasta: `${ultima.anio + 1}-01-31`,
  });
  if (fecha < cobertura.desde) {
    return {
      tipo: "sin_dato",
      cobertura,
      detalle: `Los datos empiezan con la UMA de ${primera.anio}, vigente desde el ${cobertura.desde}; no incluyen la UMA vigente el ${fecha}.`,
    };
  }
  if (fecha > cobertura.hasta) {
    return {
      tipo: "no_disponible",
      cobertura,
      detalle: `La UMA vigente el ${fecha} todavía no está cargada; la última cargada es la de ${ultima.anio}, vigente hasta el ${cobertura.hasta}.`,
    };
  }
  const anio = Number(fecha.slice(0, 4)) - (fecha.slice(5) < "02-01" ? 1 : 0);
  const registro = umas[anio - primera.anio];
  if (registro?.anio !== anio) {
    throw new RangeError("La lista de la UMA no va en años consecutivos");
  }
  return { tipo: "encontrado", registro };
}

export type ConsultaAnio =
  | { tipo: "encontrado" }
  | { tipo: "sin_dato" | "no_disponible"; detalle: string };

/**
 * Si una constante por año (la UMA, el salario mínimo, una tarifa de ISR) tiene el año `anio`
 * entre los cargados, `anios`, en orden estricto. Si no: antes del primero, o en un hueco, no
 * existe (`sin_dato`); después del último, todavía no se carga (`no_disponible`). `nombre` lleva
 * su artículo: "la UMA", "el salario mínimo". Lanza RangeError si la lista está vacía o
 * desordenada, o si el año no es un entero de 1 a 9999.
 */
export function anioDeConstante(
  anios: readonly number[],
  anio: number,
  nombre: string,
): ConsultaAnio {
  if (
    anios.length === 0 ||
    !anios.every((a, i) => Number.isInteger(a) && (i === 0 || a > (anios[i - 1] as number)))
  ) {
    throw new RangeError("Los años de la constante deben ser enteros en orden estricto");
  }
  if (!Number.isInteger(anio) || anio < 1 || anio > 9999) {
    throw new RangeError(`El año debe ser un entero de 1 a 9999: ${anio}`);
  }
  if (anios.includes(anio)) return { tipo: "encontrado" };
  const primero = anios[0] as number;
  const ultimo = anios[anios.length - 1] as number;
  const cargados =
    primero === ultimo
      ? `el único año cargado es ${primero}`
      : `los años cargados van de ${primero} a ${ultimo}`;
  const texto = String(anio).padStart(4, "0");
  return anio > ultimo
    ? { tipo: "no_disponible", detalle: `Todavía no se carga ${nombre} de ${texto}; ${cargados}.` }
    : { tipo: "sin_dato", detalle: `No existe ${nombre} de ${texto} en los datos; ${cargados}.` };
}
