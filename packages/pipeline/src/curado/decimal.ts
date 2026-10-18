// Aritmética exacta en centavos con BigInt: los montos curados nunca pasan por `number`.

export const MONTO = /^(0|[1-9]\d*)\.\d{2}$/;

/** Monto no negativo con exactamente dos decimales y sin ceros a la izquierda ("117.31"). */
export function esMonto(texto: string): boolean {
  return MONTO.test(texto);
}

export function aCentavos(monto: string): bigint {
  if (!esMonto(monto)) throw new RangeError(`Monto inválido: ${monto}`);
  return BigInt(monto.replace(".", ""));
}

export function deCentavos(centavos: bigint): string {
  const signo = centavos < 0n ? "-" : "";
  const absoluto = (centavos < 0n ? -centavos : centavos).toString().padStart(3, "0");
  return `${signo}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}

/** `numerador / divisor` redondeado a la mitad hacia arriba (0.5 sube). */
export function dividirRedondeando(numerador: bigint, divisor: bigint): bigint {
  if (numerador < 0n || divisor <= 0n) {
    throw new RangeError("Se espera numerador no negativo y divisor positivo");
  }
  return (numerador * 2n + divisor) / (divisor * 2n);
}

/** "42794.64" → "42,794.64", como aparecen los montos en el DOF. */
export function conMiles(monto: string): string {
  const [entero = "", decimales = ""] = monto.split(".");
  return `${entero.replace(/\B(?=(\d{3})+$)/g, ",")}.${decimales}`;
}
