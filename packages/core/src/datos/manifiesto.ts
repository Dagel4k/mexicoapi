import type { FechaISO } from "../fechas.js";

/** Archivo original descargado de una fuente, con su hash. */
export interface ArchivoCrudo {
  file: string;
  url: string;
  sha256: string;
}

export interface FuenteManifiesto {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
  published_at: FechaISO | null;
  raw: ArchivoCrudo[];
}

export interface Manifiesto {
  dataset: string;
  schema_version: 1;
  as_of: FechaISO;
  fetched_at: string;
  data_file: string;
  data_sha256: string;
  records: number;
  sources: FuenteManifiesto[];
}
