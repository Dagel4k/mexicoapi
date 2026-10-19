import type { RespuestaPrevia } from "./comun.js";

export interface Guardado {
  respuesta: RespuestaPrevia;
  /** Para pedirla otra vez con If-None-Match cuando caduque. */
  etag: string | null;
  /** Cuándo llegó o se revalidó (milisegundos de Date.now). */
  guardadoEn: number;
  /** Hasta cuándo se usa sin preguntar a la API. */
  expira: number;
  /** Cuánto después de `expira` se puede usar si la API falla (stale-if-error). */
  rancioMs: number;
}

export interface Cache {
  /** La entrada, aunque haya caducado (su ETag sirve); cuenta como uso reciente. */
  leer(clave: string): Guardado | undefined;
  guardar(clave: string, guardado: Guardado): void;
}

/** Caché en memoria por URL; al pasar de `maxEntradas` sale la que lleva más tiempo sin usarse. */
export function crearCache(maxEntradas: number): Cache {
  // Un Map recorre en orden de inserción: la primera clave es la menos usada.
  const entradas = new Map<string, Guardado>();
  const usar = (clave: string, guardado: Guardado): void => {
    entradas.delete(clave);
    entradas.set(clave, guardado);
  };
  return {
    leer(clave) {
      const guardado = entradas.get(clave);
      if (guardado !== undefined) usar(clave, guardado);
      return guardado;
    },
    guardar(clave, guardado) {
      usar(clave, guardado);
      if (entradas.size > maxEntradas) entradas.delete(entradas.keys().next().value as string);
    },
  };
}
