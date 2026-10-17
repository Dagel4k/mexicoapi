export const NOTA_VALIDACION =
  "Valida formato y dígito verificador; no confirma que exista ante el SAT, RENAPO, el IMSS o un banco.";

export type CodigoError =
  | "vacio"
  | "longitud"
  | "caracteres"
  | "estructura"
  | "fecha"
  | "entidad"
  | "banco"
  | "digito_verificador";

export interface ResultadoValidacion<D> {
  valor: string;
  valido: boolean;
  formato_valido: boolean;
  digito_verificador_valido: boolean | null;
  errores: CodigoError[];
  nota: string;
  detalle: D | null;
}

// Sin NFC, NFKC ni toUpperCase(): solo se compone la ñ y se suben a mayúscula a-z y ñ,
// para que ni los dígitos de ancho completo ni letras parecidas (ſ, ı, ß, ligaduras,
// el signo Kelvin) pasen a ASCII. Se quitan los separadores Zs, los controles de
// espacio y los guiones; los caracteres de ancho cero (U+200B, U+FEFF...) se quedan
// para que el validador los rechace.
export function normalizar(valor: string): string {
  return valor
    .replace(/[nN]\u0303/g, "Ñ")
    .replace(/[\p{Zs}\t\n\r\v\f-]/gu, "")
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/ñ/g, "Ñ");
}

/**
 * Guardia para llamadas desde JavaScript, donde la entrada puede no ser string:
 * null o undefined dan `vacio` y cualquier otro tipo da `caracteres`, con `valor: ""`.
 * No convierte números a texto: una CLABE como número ya perdió precisión.
 * Devuelve null si la entrada es string.
 */
export function rechazoPorTipo<D>(entrada: unknown): ResultadoValidacion<D> | null {
  if (entrada === null || entrada === undefined) return resultadoInvalido("", "vacio");
  if (typeof entrada !== "string") return resultadoInvalido("", "caracteres");
  return null;
}

/** Resultado inválido por una falla de formato (antes del dígito verificador). */
export function resultadoInvalido<D>(valor: string, error: CodigoError): ResultadoValidacion<D> {
  return {
    valor,
    valido: false,
    formato_valido: false,
    digito_verificador_valido: null,
    errores: [error],
    nota: NOTA_VALIDACION,
    detalle: null,
  };
}

/** Resultado con formato correcto; `digitoOk` indica si el dígito verificador coincide. */
export function resultadoConFormato<D>(
  valor: string,
  detalle: D,
  digitoOk: boolean,
): ResultadoValidacion<D> {
  return {
    valor,
    valido: digitoOk,
    formato_valido: true,
    digito_verificador_valido: digitoOk,
    errores: digitoOk ? [] : ["digito_verificador"],
    nota: NOTA_VALIDACION,
    detalle,
  };
}
