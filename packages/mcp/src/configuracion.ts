// El cliente de mexicoapi según el entorno. Las herramientas de datos que caducan consultan la API
// pública de MéxicoAPI (URL_API), o la de MEXICOAPI_BASE si está, con el paquete de respaldo. Con
// MEXICOAPI_SIN_RED=1 (o true, yes, si, on) responden todo con los datos del paquete, sin red,
// aunque haya base.
import { type Cliente, crearCliente, type FetchCompatible, URL_API } from "mexicoapi/cliente";

export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
  }
}

const SI = new Set(["1", "true", "yes", "si", "sí", "on"]);
const NO = new Set(["0", "false", "no", "off", ""]);

/**
 * Si MEXICOAPI_SIN_RED pide no usar la red. Acepta los valores verdaderos y falsos comunes sin
 * distinguir mayúsculas (sin la variable, o vacía, es false). Otro valor lanza ErrorConfiguracion
 * en vez de dejar la red encendida en silencio; el mensaje no repite el valor. La CLI de mexicoapi
 * la lee igual.
 */
export function sinRedPedido(valor: string | undefined): boolean {
  const texto = (valor ?? "").normalize("NFC").trim().toLowerCase();
  if (SI.has(texto)) return true;
  if (NO.has(texto)) return false;
  throw new ErrorConfiguracion(
    "MEXICOAPI_SIN_RED no es válida: usa 1, true, yes, si u on para responder sin red, o 0, false, no, off o nada para consultar la API.",
  );
}

export interface Configuracion {
  cliente: Cliente;
  /** true si el cliente consulta una API; false con MEXICOAPI_SIN_RED=1 (o true, yes, si, on). */
  conApi: boolean;
  /** Lo que se registra al arrancar. Nunca trae la base: podría llevar un token en la ruta. */
  descripcion: string;
}

/**
 * Lanza ErrorConfiguracion si MEXICOAPI_SIN_RED tiene un valor que no se reconoce o si
 * MEXICOAPI_BASE no es una URL que el cliente acepte. El mensaje de la base es el de crearCliente,
 * que nunca la repite: no deja ver credenciales ni tokens.
 */
export function configurar(
  env: Readonly<Record<string, string | undefined>>,
  opciones: { fetch?: FetchCompatible | undefined } = {},
): Configuracion {
  if (sinRedPedido(env.MEXICOAPI_SIN_RED)) {
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
