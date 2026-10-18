import type { CoberturaSerie, FechaISO, Manifiesto } from "@mexicoapi/core";

/** El repositorio y sus archivos en `main`: `meta.docs` y las páginas del sitio enlazan aquí. */
export const URL_REPO = "https://github.com/Dagel4k/mexicoapi";
export const URL_ARCHIVOS = `${URL_REPO}/blob/main`;
export const URL_DOCS = `${URL_ARCHIVOS}/docs`;

export interface FuenteMeta {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
}

export interface Meta {
  dataset: string;
  as_of: FechaISO;
  sources: FuenteMeta[];
  docs: string;
}

export interface DatasetInterno {
  meta: Meta;
  records: number;
  data_sha256: string;
  frescura_horas: number;
  /** Solo en las series (FIX y UDIS): fechas del primer y del último registro. */
  cobertura?: CoberturaSerie;
}

/** Un dataset curado: lo actualiza una persona y no un bot, así que no tiene frescura. */
export interface DatasetCurado {
  meta: Meta;
  records: number;
  data_sha256: string;
}

export interface MetaInterna {
  /** Los automáticos; `/v1/status` lista solo estos. */
  datasets: Record<string, DatasetInterno>;
  /** La meta de los curados para sus respuestas, aparte para no aparecer en `/v1/status`. */
  curados: Record<string, DatasetCurado>;
}

/**
 * `v1/_internos/constantes.json`: los años con shard de cada carpeta de constantes
 * (`constantes/uma`, `isr/tarifa/mensual`...), en orden.
 */
export type AniosConstantes = Record<string, number[]>;

/** Horas que un dataset puede pasar sin actualizarse antes de considerarse rancio. */
export const FRESCURA_HORAS: Readonly<Record<string, number>> = {
  "inegi.estados": 216,
  "inegi.municipios": 216,
  bancos: 72,
  "tipo-cambio.fix": 72,
  udis: 72,
};

export function metaDesdeManifiesto(m: Manifiesto, directorio: string): Meta {
  return {
    dataset: m.dataset,
    as_of: m.as_of,
    sources: m.sources.map((s) => ({
      name: s.name,
      url: s.url,
      license: s.license,
      license_url: s.license_url,
      citation: s.citation,
    })),
    docs: `${URL_DOCS}/datos/${directorio}.md`,
  };
}
