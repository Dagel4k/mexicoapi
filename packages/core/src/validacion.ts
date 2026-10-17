export const NOTA_VALIDACION =
  "Valida formato y dígito verificador; no confirma que exista ante el SAT, RENAPO, el IMSS o un banco.";

export type CodigoError =
  | "vacio"
  | "longitud"
  | "caracteres"
  | "estructura"
  | "fecha"
  | "entidad"
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

// Sin NFKC ni toUpperCase(): solo se suben a mayúscula a-z y ñ, para que ni los
// dígitos de ancho completo ni letras parecidas (ſ, ı, ß, ligaduras) pasen a ASCII.
export function normalizar(valor: string): string {
  return valor
    .replace(/[\s-]/g, "")
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/ñ/g, "Ñ");
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
