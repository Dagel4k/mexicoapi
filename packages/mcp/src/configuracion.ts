// El cliente de mexicoapi según el entorno. Las herramientas de datos que caducan consultan la API
// pública de MéxicoAPI (URL_API), o la de MEXICOAPI_BASE si está, con el paquete de respaldo. Con
// MEXICOAPI_SIN_RED=1 responden todo con los datos del paquete, sin red, aunque haya base.
import { type Cliente, crearCliente, type FetchCompatible, URL_API } from "mexicoapi/cliente";

export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
  }
}

export interface Configuracion {
  cliente: Cliente;
  /** true si el cliente consulta una API; false con MEXICOAPI_SIN_RED=1. */
  conApi: boolean;
  /** Lo que se registra al arrancar. Nunca trae la base: podría llevar un token en la ruta. */
  descripcion: string;
}

/**
 * Lanza ErrorConfiguracion si MEXICOAPI_BASE no es una URL que el cliente acepte. El mensaje es
 * el de crearCliente, que nunca repite la base: no deja ver credenciales ni tokens.
 */
export function configurar(
  env: Readonly<Record<string, string | undefined>>,
  opciones: { fetch?: FetchCompatible | undefined } = {},
): Configuracion {
  if (env.MEXICOAPI_SIN_RED === "1") {
    return {
      cliente: crearCliente({ offline: true }),
      conApi: false,
      descripcion: "datos del paquete, sin red",
    };
  }
  const base = env.MEXICOAPI_BASE;
  if (base === undefined || base.trim() === "") {
    return {
      cliente: crearCliente({ base: URL_API, cache: true, fetch: opciones.fetch }),
      conApi: true,
      descripcion: "consulta la API pública de MéxicoAPI",
    };
  }
  try {
    return {
      cliente: crearCliente({ base, cache: true, fetch: opciones.fetch }),
      conApi: true,
      descripcion: "consulta la API de MEXICOAPI_BASE",
    };
  } catch (error) {
    throw new ErrorConfiguracion(`MEXICOAPI_BASE no es válida: ${(error as Error).message}`);
  }
}
