import type { CoberturaSerie, FechaISO, Manifiesto } from "@mexicoapi/core";

export const URL_DOCS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs";

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

export interface MetaInterna {
  datasets: Record<string, DatasetInterno>;
}

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
