/**
 * Qué salió mal con el catálogo de SEPOMEX:
 * - `bloqueado`: Correos de México no permitió la descarga automática (403, 429, CAPTCHA).
 * - `sin-respuesta`: no se pudo conectar, se agotó el tiempo o el sitio respondió con un 5xx.
 * - `pagina-inesperada`: la página o la respuesta no tienen la forma conocida.
 * - `archivo-invalido`: el ZIP o el TXT están dañados, cambiaron de forma o pasan de los límites.
 * - `sin-datos`: todavía no hay catálogo guardado en el directorio.
 * - `cache-invalida`: el catálogo guardado está dañado.
 */
export type TipoErrorSepomex =
  | "bloqueado"
  | "sin-respuesta"
  | "pagina-inesperada"
  | "archivo-invalido"
  | "sin-datos"
  | "cache-invalida";

export class SepomexError extends Error {
  override readonly name = "SepomexError";
  readonly tipo: TipoErrorSepomex;

  constructor(tipo: TipoErrorSepomex, mensaje: string, opciones?: { cause?: unknown }) {
    super(mensaje, opciones);
    this.tipo = tipo;
  }
}

/** Un ZIP o un TXT que no se puede usar. */
export const archivoInvalido = (mensaje: string, causa?: unknown): SepomexError =>
  new SepomexError("archivo-invalido", mensaje, causa === undefined ? undefined : { cause: causa });

/** Tamaño legible para los mensajes: bytes hasta 1 MB, luego MB con un decimal. */
export function tamanoLegible(bytes: number): string {
  return bytes < 1_048_576 ? `${bytes} bytes` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}
