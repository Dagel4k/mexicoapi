import {
  normalizar,
  type ResultadoValidacion,
  rechazoPorTipo,
  resultadoConFormato,
  resultadoInvalido,
} from "./validacion.js";

export interface BancoClabe {
  codigo: string;
  nombre_corto: string;
}

export interface Plaza {
  codigo: string;
  plaza: string;
  estado: string;
}

export interface DetalleClabe {
  codigo_banco: string;
  codigo_plaza: string;
  cuenta: string;
  digito_control: string;
  banco: BancoClabe | null;
  plaza: Plaza | null;
}

const PESOS = [3, 7, 1] as const;

/**
 * La CLABE como la revisa validarClabe: sin espacios, tabuladores, saltos de línea ni guiones.
 * Los caracteres de ancho cero se quedan, para que la validación los rechace.
 */
export function normalizarClabe(clabe: string): string {
  return normalizar(clabe);
}

/** Calcula el dígito de control de los primeros 17 dígitos. Lanza RangeError si no son 17 dígitos. */
export function digitoControlClabe(primeros17: string): string {
  if (!/^[0-9]{17}$/.test(primeros17)) {
    throw new RangeError("Se requieren exactamente 17 dígitos");
  }
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    suma += Number(primeros17[i]) * (PESOS[i % 3] as number);
  }
  return String((10 - (suma % 10)) % 10);
}

/**
 * Con `catalogos.bancos`, un código de banco que no está en el catálogo es una falla de
 * formato (`banco`), revisada después de la longitud y antes del dígito de control.
 * La plaza solo es informativa: si no está en `catalogos.plazas`, queda en null.
 */
export function validarClabe(
  clabe: string,
  catalogos?: { bancos?: ReadonlyMap<string, BancoClabe>; plazas?: ReadonlyMap<string, Plaza> },
): ResultadoValidacion<DetalleClabe> {
  const rechazo = rechazoPorTipo<DetalleClabe>(clabe);
  if (rechazo) return rechazo;
  const valor = normalizarClabe(clabe);
  if (valor.length === 0) return resultadoInvalido(valor, "vacio");
  if (!/^[0-9]+$/.test(valor)) return resultadoInvalido(valor, "caracteres");
  if (valor.length !== 18) return resultadoInvalido(valor, "longitud");

  const codigo_banco = valor.slice(0, 3);
  const codigo_plaza = valor.slice(3, 6);
  const banco = catalogos?.bancos?.get(codigo_banco) ?? null;
  if (catalogos?.bancos && banco === null) return resultadoInvalido(valor, "banco");
  const plaza = catalogos?.plazas?.get(codigo_plaza) ?? null;

  // Copias, para que quien reciba el resultado no altere el catálogo.
  const detalle: DetalleClabe = {
    codigo_banco,
    codigo_plaza,
    cuenta: valor.slice(6, 17),
    digito_control: valor.slice(17),
    banco: banco ? { ...banco } : null,
    plaza: plaza ? { ...plaza } : null,
  };
  return resultadoConFormato(
    valor,
    detalle,
    digitoControlClabe(valor.slice(0, 17)) === detalle.digito_control,
  );
}
