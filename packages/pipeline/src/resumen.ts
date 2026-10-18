import type { Diferencias } from "./diferencias.js";
import type { ResultadoCorrida } from "./marco.js";

const MAXIMO = 20;
const LARGO_LINEA = 160;
/** Espacio de ancho cero: tras una @ evita que GitHub la tome por mención. */
const SIN_MENCION = "@\u200b";

export interface ErrorDeDataset {
  dataset: string;
  mensaje: string;
}

/**
 * Un texto que viene de una fuente (o de un error) como código en línea de Markdown, para el
 * resumen que el bot pone en PRs, comentarios e issues. Queda en una línea, sin menciones, y con
 * un cerco de backticks más largo que cualquiera de adentro, así que no se puede cerrar el código
 * ni meter enlaces, encabezados o menciones.
 */
export function codigoEnLinea(texto: string): string {
  const limpio = texto.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replaceAll("@", SIN_MENCION);
  if (limpio === "") return "` `";
  const mayor = Math.max(0, ...Array.from(limpio.matchAll(/`+/g), (m) => m[0].length));
  const cerco = "`".repeat(mayor + 1);
  // Si empieza o termina con backtick o espacio, Markdown quita un espacio de cada lado.
  const relleno = /^[` ]|[` ]$/.test(limpio) ? " " : "";
  return `${cerco}${relleno}${limpio}${relleno}${cerco}`;
}

function compacto(registro: unknown): string {
  const texto = JSON.stringify(registro);
  return texto.length > LARGO_LINEA ? `${texto.slice(0, LARGO_LINEA - 3)}...` : texto;
}

function lista<T>(titulo: string, items: readonly T[], linea: (i: T) => string): string[] {
  if (items.length === 0) return [];
  const salida = ["", `#### ${titulo} (${items.length})`, ""];
  for (const item of items.slice(0, MAXIMO)) salida.push(`- ${linea(item)}`);
  if (items.length > MAXIMO) salida.push(`- y ${items.length - MAXIMO} más`);
  return salida;
}

export function resumenMarkdown(
  resultados: readonly ResultadoCorrida[],
  detalles: ReadonlyMap<string, Diferencias<unknown>>,
  errores: readonly ErrorDeDataset[] = [],
): string {
  const salida: string[] = ["# Resumen de la corrida"];
  for (const r of resultados) {
    salida.push("", `## ${r.dataset}`, "");
    if (r.estado === "sin_cambios") {
      salida.push(`Estado: sin cambios (${r.registros} registros).`);
      continue;
    }
    salida.push(
      `Estado: ${r.estado}`,
      `Registros: ${r.registros}. Altas: ${r.altas}. Bajas: ${r.bajas}. Cambios: ${r.cambios}.`,
    );
    if (r.motivos.length > 0) {
      salida.push("", "Motivos:");
      for (const m of r.motivos) salida.push(`- ${codigoEnLinea(m)}`);
    }
    const d = detalles.get(r.dataset);
    if (d === undefined) continue;
    const registro = (x: unknown) => codigoEnLinea(compacto(x));
    salida.push(...lista("Altas", d.altas, registro));
    salida.push(...lista("Bajas", d.bajas, registro));
    salida.push(
      ...lista(
        "Cambios",
        d.cambios,
        (c) => `${codigoEnLinea(c.clave)}: ${codigoEnLinea(c.campos.join(", "))}`,
      ),
    );
  }
  if (errores.length > 0) {
    salida.push("", "## Errores", "");
    for (const e of errores) salida.push(`- ${e.dataset}: ${codigoEnLinea(e.mensaje)}`);
  }
  return `${salida.join("\n")}\n`;
}
