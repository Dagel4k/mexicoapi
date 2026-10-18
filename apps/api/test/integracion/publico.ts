// Si el `public/` del build salió de los `data/` de hoy. Sin esta revisión, cambiar `data/` y correr
// la integración sin compilar prueba el Worker contra los datos anteriores y pasa.
import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

interface Manifiesto {
  dataset: string;
  data_sha256: string;
}

interface Calendario {
  autoridad: string;
  plazos: unknown;
  fuentes_fin_de_semana: unknown;
}

const leerJson = async <T>(url: URL): Promise<T> => JSON.parse(await readFile(url, "utf8")) as T;

/** El JSON de `url`, o undefined si el archivo no existe. */
async function siExiste<T>(url: URL): Promise<T | undefined> {
  try {
    return await leerJson<T>(url);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Lo que no coincide entre `publico` y `datos`: cada manifiesto de `datos` tiene que estar en
 * `v1/_internos/meta.json` con el mismo `data_sha256`, y nada más; y cada `calendario.json`
 * (coberturas y fuentes de los fines de semana) tiene que ser el del calendario interno de su
 * autoridad, porque la cobertura puede crecer sin que cambien los días. Vacío si coinciden.
 */
export async function diferenciasConDatos(publico: URL, datos: URL): Promise<string[]> {
  const meta = await leerJson<{
    datasets?: Record<string, { data_sha256?: unknown }>;
    curados?: Record<string, { data_sha256?: unknown }>;
  }>(new URL("v1/_internos/meta.json", publico));
  const construidos = new Map(
    Object.entries({ ...meta.datasets, ...meta.curados }).map(([id, d]) => [id, d.data_sha256]),
  );
  const diferencias: string[] = [];
  const enDatos = new Set<string>();
  for (const entrada of await readdir(datos, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const carpeta = new URL(`${entrada.name}/`, datos);
    const manifiesto = await siExiste<Manifiesto>(new URL("manifest.json", carpeta));
    if (manifiesto === undefined) continue;
    const { dataset, data_sha256 } = manifiesto;
    enDatos.add(dataset);
    if (!construidos.has(dataset)) diferencias.push(`${dataset}: no está en public`);
    else if (construidos.get(dataset) !== data_sha256) {
      diferencias.push(`${dataset}: data_sha256 distinto`);
    }
    const calendario = await siExiste<Calendario>(new URL("calendario.json", carpeta));
    if (calendario === undefined) continue;
    const interno = await siExiste<Calendario>(
      new URL(`v1/_internos/calendarios/${calendario.autoridad}.json`, publico),
    );
    const igual =
      interno !== undefined &&
      isDeepStrictEqual(
        [interno.autoridad, interno.plazos, interno.fuentes_fin_de_semana],
        [calendario.autoridad, calendario.plazos, calendario.fuentes_fin_de_semana],
      );
    if (!igual) diferencias.push(`${dataset}: calendario distinto`);
  }
  for (const id of construidos.keys()) {
    if (!enDatos.has(id)) diferencias.push(`${id}: ya no está en data`);
  }
  return diferencias.sort();
}
