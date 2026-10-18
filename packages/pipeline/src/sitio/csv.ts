import { ErrorDatos } from "../errores.js";

// Lo que una hoja de cálculo puede tomar como fórmula al inicio de un campo, también en ancho
// completo (＝＋－＠), que algunas convierten a ASCII.
const PELIGROSO = /^[=+\-@\t\r\n＝＋－＠]/;
const NECESITA_COMILLAS = /[,"\r\n]|^\s|\s$/;

function campo(valor: unknown, columna: string, dataset: string | null): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  if (typeof valor === "string" && PELIGROSO.test(texto)) {
    throw new ErrorDatos(
      `valor con riesgo de inyección en hojas de cálculo en la columna ${columna}: ${JSON.stringify(texto)}`,
      dataset,
    );
  }
  return NECESITA_COMILLAS.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** CSV según RFC 4180: UTF-8, `\r\n` al final de cada renglón, `null` como campo vacío. */
export function aCsv(
  columnas: readonly string[],
  filas: readonly object[],
  dataset: string | null = null,
): string {
  const renglones = [columnas.join(",")];
  for (const fila of filas)
    renglones.push(
      columnas.map((c) => campo((fila as Record<string, unknown>)[c], c, dataset)).join(","),
    );
  return `${renglones.join("\r\n")}\r\n`;
}
