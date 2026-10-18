import { ErrorDatos } from "../errores.js";

const PELIGROSO = /^[=+\-@\t\r]/;
const NECESITA_COMILLAS = /[,"\r\n]|^\s|\s$/;

function campo(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  if (typeof valor === "string" && PELIGROSO.test(texto)) {
    throw new ErrorDatos(
      `valor con riesgo de inyección en hojas de cálculo: ${JSON.stringify(texto)}`,
    );
  }
  return NECESITA_COMILLAS.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** CSV según RFC 4180: UTF-8, `\r\n` al final de cada renglón, `null` como campo vacío. */
export function aCsv(
  columnas: readonly string[],
  filas: readonly Record<string, unknown>[],
): string {
  const renglones = [columnas.join(",")];
  for (const fila of filas) renglones.push(columnas.map((c) => campo(fila[c])).join(","));
  return `${renglones.join("\r\n")}\r\n`;
}
