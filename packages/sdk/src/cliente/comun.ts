import type { Origen } from "./tipos.js";

export type Objeto = Record<string, unknown>;

/**
 * Una respuesta antes de completarla (interna): la arman la consulta a la API, la caché y el
 * paquete. `ejecutar` (cliente.ts) le agrega las advertencias del cálculo y los `avisos`, y lo que
 * entrega es una `RespuestaSinMeta` o una `Respuesta`.
 */
export interface RespuestaPrevia {
  readonly data: unknown;
  readonly meta?: unknown;
  readonly origen: Origen;
  readonly advertencias: readonly string[];
  /**
   * Los avisos de primer nivel que mandó la API, tal como llegaron: el cliente conserva sus
   * códigos (los del catálogo) por el texto de cada advertencia.
   */
  readonly avisos?: unknown;
}

/** Comienzo de la advertencia de una respuesta del paquete porque la API falló (la CLI la busca). */
export const AVISO_RESPALDO = "Respuesta de los datos del paquete porque la API falló";

/**
 * El umbral de datos viejos de las series del paquete (FIX y UDIS), en días: el único, para el
 * cliente y el MCP. El cliente lo cuenta desde el último dato de la serie hasta hoy: si pasan más,
 * la respuesta del paquete advierte que la API puede tener datos más recientes. El MCP sin API lo
 * cuenta desde la fecha pedida hasta el último dato: a esa distancia o menos, la consulta puede
 * buscar una publicación que el paquete todavía no trae. Miden cosas distintas y las dos
 * advertencias pueden salir juntas.
 */
export const DIAS_DATOS_RECIENTES = 7;

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
