/** Valor de un parámetro que la ruta declara como obligatorio; si no está, falla cerrado. */
export function requerido(p: Readonly<Record<string, string>>, nombre: string): string {
  const valor = p[nombre];
  if (valor === undefined) throw new Error(`El contexto no trae el parámetro ${nombre}.`);
  return valor;
}
