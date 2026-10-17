import {
  normalizar,
  type ResultadoValidacion,
  resultadoConFormato,
  resultadoInvalido,
} from "./validacion.js";

/** Calcula el dígito verificador (Luhn) de los primeros 10 dígitos. Lanza RangeError si no son 10 dígitos. */
export function digitoVerificadorNss(primeros10: string): string {
  if (!/^[0-9]{10}$/.test(primeros10)) {
    throw new RangeError("Se requieren exactamente 10 dígitos");
  }
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(primeros10[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return String((10 - (suma % 10)) % 10);
}

export function validarNss(nss: string): ResultadoValidacion<null> {
  const valor = normalizar(nss);
  if (valor.length === 0) return resultadoInvalido(valor, "vacio");
  if (!/^[0-9]+$/.test(valor)) return resultadoInvalido(valor, "caracteres");
  if (valor.length !== 11) return resultadoInvalido(valor, "longitud");
  return resultadoConFormato(valor, null, digitoVerificadorNss(valor.slice(0, 10)) === valor[10]);
}
