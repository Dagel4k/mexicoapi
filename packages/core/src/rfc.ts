import { fechaValida } from "./fechas.js";
import {
  normalizar,
  type ResultadoValidacion,
  rechazoPorTipo,
  resultadoConFormato,
  resultadoInvalido,
} from "./validacion.js";

export type TipoRfc = "fisica" | "moral" | "generico";

export interface DetalleRfc {
  tipo: TipoRfc;
  fecha_yymmdd: string;
  homoclave: string;
}

export const RFC_GENERICOS: ReadonlySet<string> = new Set(["XAXX010101000", "XEXX010101000"]);

const TABLA = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";
const ESTRUCTURA = /^([A-ZÑ&]{3,4})([0-9]{6})([A-Z0-9]{2}[0-9A])$/;

/** Calcula el dígito verificador de 11 (moral) o 12 (física) caracteres. Lanza RangeError si no cumple. */
export function digitoVerificadorRfc(sinDigito: string): string {
  if (!/^[A-Z0-9Ñ&]{11,12}$/.test(sinDigito)) {
    throw new RangeError("Se requieren 11 o 12 caracteres de [A-Z0-9Ñ&]");
  }
  const completo = sinDigito.padStart(12, " ");
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += TABLA.indexOf(completo[i] as string) * (13 - i);
  }
  const r = suma % 11;
  if (r === 0) return "0";
  return r === 1 ? "A" : String(11 - r);
}

function fechaRfcValida(yymmdd: string): boolean {
  const aa = Number(yymmdd.slice(0, 2));
  const mes = Number(yymmdd.slice(2, 4));
  const dia = Number(yymmdd.slice(4, 6));
  return fechaValida(1900 + aa, mes, dia) || fechaValida(2000 + aa, mes, dia);
}

export function validarRfc(rfc: string): ResultadoValidacion<DetalleRfc> {
  const rechazo = rechazoPorTipo<DetalleRfc>(rfc);
  if (rechazo) return rechazo;
  const valor = normalizar(rfc);
  if (valor.length === 0) return resultadoInvalido(valor, "vacio");
  if (!/^[A-Z0-9Ñ&]+$/.test(valor)) return resultadoInvalido(valor, "caracteres");
  if (valor.length !== 12 && valor.length !== 13) return resultadoInvalido(valor, "longitud");

  const partes = ESTRUCTURA.exec(valor);
  const nombre = partes?.[1] as string;
  const fecha = partes?.[2] as string;
  const homoclave = partes?.[3] as string;
  if (partes === null || nombre.length !== valor.length - 9) {
    return resultadoInvalido(valor, "estructura");
  }
  if (!fechaRfcValida(fecha)) return resultadoInvalido(valor, "fecha");

  if (RFC_GENERICOS.has(valor)) {
    return resultadoConFormato(valor, { tipo: "generico", fecha_yymmdd: fecha, homoclave }, true);
  }
  const detalle: DetalleRfc = {
    tipo: valor.length === 13 ? "fisica" : "moral",
    fecha_yymmdd: fecha,
    homoclave,
  };
  // El dígito se reporta pero no invalida: python-stdnum desactiva esa revisión por
  // defecto porque alrededor de 1.5 % de los RFC en uso tienen dígito inválido, y
  // rechazar un RFC real es peor que aceptar un error de dedo.
  return resultadoConFormato(
    valor,
    detalle,
    digitoVerificadorRfc(valor.slice(0, -1)) === homoclave.slice(-1),
    { digitoInformativo: true },
  );
}
