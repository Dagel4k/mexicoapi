/**
 * Cómo aplica Cloudflare un `_headers` a una petición de assets: todas las reglas cuya ruta
 * coincide, en el orden del archivo; `! Nombre` quita el encabezado y uno que ya puso otra regla
 * se junta con coma. Copia del motor de reglas de los assets de Workers (el `*` vale por
 * cualquier texto), para probar el archivo sin desplegarlo.
 */
export interface ReglaEncabezados {
  ruta: string;
  poner: [string, string][];
  quitar: string[];
}

export function leerReglas(texto: string): ReglaEncabezados[] {
  const reglas: ReglaEncabezados[] = [];
  for (const linea of texto.split("\n")) {
    if (linea.trim() === "" || linea.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(linea)) {
      reglas.push({ ruta: linea, poner: [], quitar: [] });
      continue;
    }
    const regla = reglas.at(-1);
    if (regla === undefined) throw new Error(`encabezado sin regla: ${linea}`);
    const contenido = linea.trim();
    if (contenido.startsWith("! ")) {
      regla.quitar.push(contenido.slice(2).trim());
      continue;
    }
    const dos = contenido.indexOf(":");
    if (dos <= 0) throw new Error(`encabezado sin nombre: ${linea}`);
    regla.poner.push([contenido.slice(0, dos).trim(), contenido.slice(dos + 1).trim()]);
  }
  return reglas;
}

const escapar = (texto: string): string => texto.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

export const coincide = (regla: string, ruta: string): boolean =>
  new RegExp(`^${regla.split("*").map(escapar).join(".*")}$`).test(ruta);

/** Los valores de cada encabezado (en minúsculas) que recibe `ruta`; más de uno es un choque. */
export function encabezadosDe(reglas: ReglaEncabezados[], ruta: string): Map<string, string[]> {
  const resultado = new Map<string, string[]>();
  for (const regla of reglas) {
    if (!coincide(regla.ruta, ruta)) continue;
    for (const nombre of regla.quitar) resultado.delete(nombre.toLowerCase());
    for (const [nombre, valor] of regla.poner) {
      const clave = nombre.toLowerCase();
      resultado.set(clave, [...(resultado.get(clave) ?? []), valor]);
    }
  }
  return resultado;
}
