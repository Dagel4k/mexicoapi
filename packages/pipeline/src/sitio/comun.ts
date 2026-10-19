/** Lo que comparten el build del sitio y sus páginas. */

/**
 * Cambia a `true` cuando `mexicoapi` y `mexicoapi-mcp` estén en npm. Mientras sea `false`, la
 * página de inicio y `llms.txt` no muestran comandos de instalación.
 */
export const PUBLICADO_EN_NPM = true;

/** Orden por unidades de código UTF-16, igual que el resto de los datos y SHA256SUMS. */
export const porNombre = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
