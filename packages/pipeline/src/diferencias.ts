export interface Cambio<T> {
  clave: string;
  antes: T;
  despues: T;
  campos: string[];
}

export interface Diferencias<T> {
  altas: T[];
  bajas: T[];
  cambios: Cambio<T>[];
}

function camposDistintos(a: object, b: object): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const llaves = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...llaves]
    .filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
    .sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
}

export function diferenciar<T extends object>(
  antes: readonly T[],
  despues: readonly T[],
  clave: (r: T) => string,
): Diferencias<T> {
  const previos = new Map(antes.map((r) => [clave(r), r] as const));
  const nuevos = new Map(despues.map((r) => [clave(r), r] as const));
  const altas: T[] = [];
  const bajas: T[] = [];
  const cambios: Cambio<T>[] = [];

  for (const [k, nuevo] of nuevos) {
    const previo = previos.get(k);
    if (previo === undefined) {
      altas.push(nuevo);
      continue;
    }
    const campos = camposDistintos(previo, nuevo);
    if (campos.length > 0) cambios.push({ clave: k, antes: previo, despues: nuevo, campos });
  }
  for (const [k, previo] of previos) if (!nuevos.has(k)) bajas.push(previo);

  return { altas, bajas, cambios };
}

export function hayDiferencias(d: Diferencias<unknown>): boolean {
  return d.altas.length > 0 || d.bajas.length > 0 || d.cambios.length > 0;
}
