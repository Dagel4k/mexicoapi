/**
 * Un texto de los datos o de la API listo para mostrarse en una línea: cada racha de saltos de
 * línea y caracteres de control (C0, DEL, C1 y los separadores de línea y párrafo) queda en un
 * espacio, y se recortan los extremos. Así un dato no parte la línea ni mueve el cursor o cambia
 * los colores de la terminal (ESC, CSI, OSC). Lo usan la CLI y el MCP antes de imprimir.
 */
export function enLinea(texto: string): string {
  return texto.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}
