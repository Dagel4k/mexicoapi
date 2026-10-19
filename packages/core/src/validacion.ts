/**
 * La nota común que daban los validadores antes de tener una cada uno.
 * @deprecated Cada validador da la suya: `NOTAS_VALIDACION`.
 */
export const NOTA_VALIDACION =
  "Valida formato y dígito verificador; no confirma que exista ante el SAT, RENAPO, el IMSS o un banco.";

/**
 * La nota (`nota`) de cada validador: qué revisa y ante quién no confirma nada. La CLABE tiene dos:
 * con el catálogo de bancos (`clabe`) y sin él (`clabe_sin_banco`), en la que no se revisa que el
 * banco exista.
 */
export const NOTAS_VALIDACION = Object.freeze({
  clabe: "Valida formato, banco y dígito de control; no confirma que la cuenta exista.",
  clabe_sin_banco:
    "Valida formato y dígito de control, sin revisar que el banco exista (no se pasó el catálogo de bancos); no confirma que la cuenta exista.",
  rfc: "Valida estructura, fecha y dígito verificador (informativo: si no coincide, no invalida el RFC); no confirma que el RFC exista ante el SAT.",
  curp: "Valida estructura, fecha, entidad y dígito verificador; no confirma que la CURP exista ante RENAPO.",
  nss: "Valida los 11 dígitos y el dígito verificador; no confirma que el NSS exista ante el IMSS.",
} as const);

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
export function rechazoPorTipo<D>(entrada: unknown, nota: string): ResultadoValidacion<D> | null {
  if (entrada === null || entrada === undefined) return resultadoInvalido("", "vacio", nota);
  if (typeof entrada !== "string") return resultadoInvalido("", "caracteres", nota);
  return null;
}

/** Resultado inválido por una falla de formato (antes del dígito verificador). */
export function resultadoInvalido<D>(
  valor: string,
  error: CodigoError,
  nota: string,
): ResultadoValidacion<D> {
  return {
    valor,
    valido: false,
    formato_valido: false,
    digito_verificador_valido: null,
    errores: [error],
    nota,
    detalle: null,
  };
}

/**
 * Resultado con formato correcto; `digitoOk` indica si el dígito verificador coincide.
 * Con `digitoInformativo`, un dígito que no coincide se reporta en `errores` pero no
 * invalida el resultado: `valido` queda igual a `formato_valido`.
 */
export function resultadoConFormato<D>(
  valor: string,
  detalle: D,
  digitoOk: boolean,
  nota: string,
  opciones: { digitoInformativo?: boolean } = {},
): ResultadoValidacion<D> {
  return {
    valor,
    valido: digitoOk || opciones.digitoInformativo === true,
    formato_valido: true,
    digito_verificador_valido: digitoOk,
    errores: digitoOk ? [] : ["digito_verificador"],
    nota,
    detalle,
  };
}
