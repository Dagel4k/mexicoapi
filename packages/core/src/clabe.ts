import {
  NOTAS_VALIDACION,
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

/**
 * El resultado de `validarClabe`. `banco_revisado` dice si se revisó el código de banco contra el
 * catálogo: sin él (`false`), `valido: true` no garantiza que el banco exista.
 */
export type ResultadoValidacionClabe = ResultadoValidacion<DetalleClabe> & {
  banco_revisado: boolean;
};

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

/** `r` con `banco_revisado`, junto a los demás campos de la validación. */
function conBanco(
  { errores, nota, detalle, ...inicio }: ResultadoValidacion<DetalleClabe>,
  banco_revisado: boolean,
): ResultadoValidacionClabe {
  return { ...inicio, banco_revisado, errores, nota, detalle };
}

/**
 * Con `catalogos.bancos`, un código de banco que no está en el catálogo es una falla de
 * formato (`banco`), revisada después de la longitud y antes del dígito de control. Sin él no se
 * revisa el banco: el resultado lo dice con `banco_revisado: false` y en su nota.
 * La plaza solo es informativa: si no está en `catalogos.plazas`, queda en null.
 */
export function validarClabe(
  clabe: string,
  catalogos?: { bancos?: ReadonlyMap<string, BancoClabe>; plazas?: ReadonlyMap<string, Plaza> },
): ResultadoValidacionClabe {
  const revisado = catalogos?.bancos !== undefined;
  return conBanco(validar(clabe, catalogos, revisado), revisado);
}

function validar(
  clabe: string,
  catalogos: Parameters<typeof validarClabe>[1],
  revisado: boolean,
): ResultadoValidacion<DetalleClabe> {
  const nota = revisado ? NOTAS_VALIDACION.clabe : NOTAS_VALIDACION.clabe_sin_banco;
  const rechazo = rechazoPorTipo<DetalleClabe>(clabe, nota);
  if (rechazo) return rechazo;
  const valor = normalizarClabe(clabe);
  if (valor.length === 0) return resultadoInvalido(valor, "vacio", nota);
  if (!/^[0-9]+$/.test(valor)) return resultadoInvalido(valor, "caracteres", nota);
  if (valor.length !== 18) return resultadoInvalido(valor, "longitud", nota);

  const codigo_banco = valor.slice(0, 3);
  const codigo_plaza = valor.slice(3, 6);
  const banco = catalogos?.bancos?.get(codigo_banco) ?? null;
  if (revisado && banco === null) return resultadoInvalido(valor, "banco", nota);
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
    nota,
  );
}
