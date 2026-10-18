import { datos } from "./generados/inegi-estados.js";
import type { Estado } from "./tipos.js";

// Meta del dataset, para quien carga solo este módulo (el cliente HTTP).
export { meta } from "./generados/inegi-estados.js";

let porClave: ReadonlyMap<string, Estado> | undefined;

/** Las 32 entidades federativas, en el orden de su clave. Arreglo y registros congelados. */
export function estados(): readonly Estado[] {
  return datos;
}

/** Entidad por su clave INEGI de 2 dígitos, con el cero a la izquierda (`"01"`, `"25"`). */
export function estado(cve_ent: string): Estado | undefined {
  porClave ??= new Map(datos.map((e) => [e.cve_ent, e]));
  return porClave.get(cve_ent);
}
