import { createHash } from "node:crypto";

/** NFC, colapsa cualquier espacio (incluido NBSP) a uno solo y recorta. */
export function limpiarTexto(texto: string): string {
  return texto
    .normalize("NFC")
    .replace(/[\s\p{Zs}]+/gu, " ")
    .trim();
}

/** Pasa a NFC cada string de un valor JSON, sin mutar la entrada. */
export function aNfc<T>(valor: T): T {
  return normalizar(valor) as T;
}

function normalizar(valor: unknown): unknown {
  if (typeof valor === "string") return valor.normalize("NFC");
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor !== null && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) salida[k.normalize("NFC")] = normalizar(v);
    return salida;
  }
  return valor;
}

export function jsonCanonico(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}

export function sha256Hex(datos: Uint8Array | string): string {
  return createHash("sha256").update(datos).digest("hex");
}

/** Orden estable por unidades de código UTF-16, sin depender de la configuración regional. */
export function ordenarPorClave<T>(registros: readonly T[], clave: (r: T) => string): T[] {
  const conClave = registros.map((r) => ({ r, k: clave(r) }));
  conClave.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return conClave.map((x) => x.r);
}
