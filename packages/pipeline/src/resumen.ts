import type { Diferencias } from "./diferencias.js";
import type { ResultadoCorrida } from "./marco.js";

const MAXIMO = 20;
const LARGO_LINEA = 160;

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
      for (const m of r.motivos) salida.push(`- ${m}`);
    }
    const d = detalles.get(r.dataset);
    if (d === undefined) continue;
    salida.push(...lista("Altas", d.altas, compacto));
    salida.push(...lista("Bajas", d.bajas, compacto));
    salida.push(...lista("Cambios", d.cambios, (c) => `${c.clave}: ${c.campos.join(", ")}`));
  }
  return `${salida.join("\n")}\n`;
}
