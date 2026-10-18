/** Entidad federativa tal como la publica el INEGI. Claves con ceros a la izquierda. */
export interface Estado {
  cve_ent: string;
  nombre: string;
  abreviatura: string;
  cvegeo: string;
}

/** Municipio o alcaldía. `cvegeo` es la clave geoestadística de 5 dígitos. */
export interface Municipio {
  cvegeo: string;
  cve_ent: string;
  cve_mun: string;
  nombre: string;
  cve_cabecera: string | null;
}
