export type Objeto = Record<string, unknown>;

export const esObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/**
 * Congela a fondo lo que el cliente entrega (también lo que guarda en caché). Lo que ya está
 * congelado se da por congelado a fondo, como los datos del paquete.
 */
export function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
