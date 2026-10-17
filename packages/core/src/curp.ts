import { type FechaISO, fechaValida } from "./fechas.js";
import {
  normalizar,
  type ResultadoValidacion,
  resultadoConFormato,
  resultadoInvalido,
} from "./validacion.js";

export const ENTIDADES_CURP: ReadonlyMap<string, string> = new Map([
  ["AS", "Aguascalientes"],
  ["BC", "Baja California"],
  ["BS", "Baja California Sur"],
  ["CC", "Campeche"],
  ["CL", "Coahuila"],
  ["CM", "Colima"],
  ["CS", "Chiapas"],
  ["CH", "Chihuahua"],
  ["DF", "Ciudad de México"],
  ["DG", "Durango"],
  ["GT", "Guanajuato"],
  ["GR", "Guerrero"],
  ["HG", "Hidalgo"],
  ["JC", "Jalisco"],
  ["MC", "Estado de México"],
  ["MN", "Michoacán"],
  ["MS", "Morelos"],
  ["NT", "Nayarit"],
  ["NL", "Nuevo León"],
  ["OC", "Oaxaca"],
  ["PL", "Puebla"],
  ["QT", "Querétaro"],
  ["QR", "Quintana Roo"],
  ["SP", "San Luis Potosí"],
  ["SL", "Sinaloa"],
  ["SR", "Sonora"],
  ["TC", "Tabasco"],
  ["TS", "Tamaulipas"],
  ["TL", "Tlaxcala"],
  ["VZ", "Veracruz"],
  ["YN", "Yucatán"],
  ["ZS", "Zacatecas"],
  ["NE", "Nacido en el extranjero"],
]);

export interface DetalleCurp {
  fecha: FechaISO;
  sexo: "H" | "M" | "X";
  entidad: string;
  nombre_entidad: string;
  diferenciador: string;
}

// El & ocupa el índice 24, así que desplaza una posición a las letras desde la O.
const TABLA = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ";
const ESTRUCTURA = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/;

/** Calcula el dígito verificador de los primeros 17 caracteres. Lanza RangeError si no cumple. */
export function digitoVerificadorCurp(primeros17: string): string {
  if (!/^[0-9A-Z]{17}$/.test(primeros17)) {
    throw new RangeError("Se requieren exactamente 17 caracteres de [0-9A-Z]");
  }
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    suma += TABLA.indexOf(primeros17[i] as string) * (18 - i);
  }
  return String((10 - (suma % 10)) % 10);
}

export function validarCurp(curp: string): ResultadoValidacion<DetalleCurp> {
  const valor = normalizar(curp);
  if (valor.length === 0) return resultadoInvalido(valor, "vacio");
  // La CURP nunca lleva Ñ: RENAPO la sustituye por X.
  if (!/^[A-Z0-9]+$/.test(valor)) return resultadoInvalido(valor, "caracteres");
  if (valor.length !== 18) return resultadoInvalido(valor, "longitud");
  if (!ESTRUCTURA.test(valor)) return resultadoInvalido(valor, "estructura");

  const diferenciador = valor.charAt(16);
  const siglo = /\d/.test(diferenciador) ? 1900 : 2000;
  const anio = siglo + Number(valor.slice(4, 6));
  const mes = Number(valor.slice(6, 8));
  const dia = Number(valor.slice(8, 10));
  if (!fechaValida(anio, mes, dia)) return resultadoInvalido(valor, "fecha");

  const entidad = valor.slice(11, 13);
  const nombreEntidad = ENTIDADES_CURP.get(entidad);
  if (nombreEntidad === undefined) return resultadoInvalido(valor, "entidad");

  const detalle: DetalleCurp = {
    fecha: `${anio}-${valor.slice(6, 8)}-${valor.slice(8, 10)}`,
    sexo: valor.charAt(10) as DetalleCurp["sexo"],
    entidad,
    nombre_entidad: nombreEntidad,
    diferenciador,
  };
  return resultadoConFormato(
    valor,
    detalle,
    digitoVerificadorCurp(valor.slice(0, 17)) === valor.charAt(17),
  );
}
