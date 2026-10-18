// El cliente de mexicoapi según el entorno: con MEXICOAPI_BASE consulta esa API (con el paquete
// de respaldo); sin ella responde todo con los datos del paquete, sin red.
import { type Cliente, crearCliente, type FetchCompatible } from "mexicoapi/cliente";

export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
  }
}

export interface Configuracion {
  cliente: Cliente;
  /** true si el cliente consulta la API. */
  conApi: boolean;
}

/**
 * Lanza ErrorConfiguracion si MEXICOAPI_BASE no es una URL que el cliente acepte. El mensaje es
 * el de crearCliente, que nunca repite la base: no deja ver credenciales ni tokens.
 */
export function configurar(
  env: Readonly<Record<string, string | undefined>>,
  opciones: { fetch?: FetchCompatible | undefined } = {},
): Configuracion {
  const base = env.MEXICOAPI_BASE;
  if (base === undefined || base.trim() === "") {
    return { cliente: crearCliente({ offline: true }), conApi: false };
  }
  try {
    return { cliente: crearCliente({ base, cache: true, fetch: opciones.fetch }), conApi: true };
  } catch (error) {
    throw new ErrorConfiguracion(`MEXICOAPI_BASE no es válida: ${(error as Error).message}`);
  }
}
