import { datos } from "./generados/inegi-municipios.js";
import { normalizarBusqueda } from "./texto.js";
import type { Municipio } from "./tipos.js";

export interface OpcionesBusquedaMunicipio {
  /** Clave de 2 dígitos de la entidad (`"25"`) para buscar solo en ella. */
  estado?: string | undefined;
  /** Máximo de resultados, un entero desde 0. Sin él, todos. */
  limite?: number | undefined;
}

const VACIO: readonly Municipio[] = Object.freeze([]);

let porEntidad: ReadonlyMap<string, readonly Municipio[]> | undefined;
let porClave: ReadonlyMap<string, Municipio> | undefined;
let nombres: readonly string[] | undefined;

function agrupar(lista: readonly Municipio[]): ReadonlyMap<string, readonly Municipio[]> {
  const grupos = new Map<string, Municipio[]>();
  for (const m of lista) {
    const grupo = grupos.get(m.cve_ent);
    if (grupo === undefined) grupos.set(m.cve_ent, [m]);
    else grupo.push(m);
  }
  for (const grupo of grupos.values()) Object.freeze(grupo);
  return grupos;
}

/**
 * Municipios y alcaldías en el orden de su cvegeo; con `cve_ent`, solo los de esa entidad (un
 * arreglo vacío si la clave no existe). Arreglos y registros congelados.
 */
export function municipios(cve_ent?: string): readonly Municipio[] {
  if (cve_ent === undefined) return datos;
  porEntidad ??= agrupar(datos);
  return porEntidad.get(cve_ent) ?? VACIO;
}

/** Municipio por su clave geoestadística de 5 dígitos (`"25006"`). */
export function municipio(cvegeo: string): Municipio | undefined {
  porClave ??= new Map(datos.map((m) => [m.cvegeo, m]));
  return porClave.get(cvegeo);
}

/**
 * Busca municipios por nombre sin distinguir mayúsculas, acentos ni signos. Primero los de
 * nombre igual al texto, luego los que empiezan con él y al final los que lo contienen; dentro
 * de cada grupo, en el orden de su cvegeo. Sin texto que buscar (o si no es string) da un
 * arreglo vacío. Lanza RangeError si `limite` no es un entero desde 0.
 */
export function buscarMunicipio(
  texto: string,
  opciones: OpcionesBusquedaMunicipio = {},
): readonly Municipio[] {
  const { estado, limite } = opciones;
  if (limite !== undefined && !(Number.isInteger(limite) && limite >= 0)) {
    throw new RangeError("limite debe ser un entero desde 0");
  }
  const consulta = typeof texto === "string" ? normalizarBusqueda(texto) : "";
  if (consulta === "") return VACIO;
  nombres ??= datos.map((m) => normalizarBusqueda(m.nombre));
  const exactos: Municipio[] = [];
  const empiezan: Municipio[] = [];
  const contienen: Municipio[] = [];
  datos.forEach((m, i) => {
    if (estado !== undefined && m.cve_ent !== estado) return;
    const nombre = (nombres as readonly string[])[i] as string;
    if (nombre === consulta) exactos.push(m);
    else if (nombre.startsWith(consulta)) empiezan.push(m);
    else if (nombre.includes(consulta)) contienen.push(m);
  });
  return Object.freeze([...exactos, ...empiezan, ...contienen].slice(0, limite));
}
