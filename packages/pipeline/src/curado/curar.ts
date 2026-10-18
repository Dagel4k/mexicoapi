import { join } from "node:path";
import { escribirDirectorioAtomico } from "../escritura.js";
import { diferenciasConEsperados, directoriosDe, revisarYamlCurados } from "../verificar.js";
import { DIRECTORIO_CURADO } from "./registro.js";

export interface ResultadoCurado {
  dataset: string;
  estado: "sin_cambios" | "actualizado";
  registros: number;
}

/**
 * Genera `data/<directorio>/` (JSON canónico y manifiesto) de cada YAML de `data/curado/`, sin
 * red. Si algún YAML tiene problemas no escribe nada; si todo cuadra, `verificar` pasa para los
 * curados.
 */
export async function curarDatos(
  raizDatos: string,
): Promise<{ resultados: ResultadoCurado[]; problemas: string[] }> {
  const dirs = new Set(await directoriosDe(raizDatos));
  const { problemas, listos } = await revisarYamlCurados(raizDatos, dirs);
  if (problemas.length > 0) return { resultados: [], problemas };
  const resultados: ResultadoCurado[] = [];
  for (const { def, archivos, registros } of listos) {
    const dir = join(raizDatos, def.directorio);
    const origen = `${DIRECTORIO_CURADO}/${def.yaml}`;
    const iguales = (await diferenciasConEsperados(dir, archivos, origen)).length === 0;
    if (!iguales) await escribirDirectorioAtomico(dir, archivos);
    resultados.push({
      dataset: def.id,
      estado: iguales ? "sin_cambios" : "actualizado",
      registros,
    });
  }
  return { resultados, problemas: [] };
}
