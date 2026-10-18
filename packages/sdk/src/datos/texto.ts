/**
 * Forma de un nombre para buscarlo: en minúsculas, sin acentos, diéresis ni tilde (NFD sin las
 * marcas combinantes, así que la ñ queda como n) y con cualquier signo o espacio como un solo
 * espacio. "Peñón Blanco", "PEÑON-BLANCO" y "penon  blanco" quedan igual.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
