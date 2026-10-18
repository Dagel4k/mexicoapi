// Tipos de los datos que trae el paquete. Los registros usan los tipos del núcleo.
import type { FechaISO } from "@mexicoapi/core";

export type {
  Banco,
  BancoClabe,
  CoberturaSerie,
  Estado,
  FechaISO,
  Municipio,
  TipoCambioFix,
  Udi,
} from "@mexicoapi/core";

/** Fuente oficial de un dataset, como la cita su manifest en data/. */
export interface FuenteDatos {
  readonly name: string;
  readonly url: string;
  readonly license: string;
  readonly license_url: string;
  readonly citation: string;
}

/**
 * De qué dataset salen los datos del paquete, a qué fecha corresponden, de qué fuentes y dónde
 * se documentan: la misma forma que el `meta` de la API.
 */
export interface MetaDatos {
  /** Identificador del dataset, el mismo que usa la API (`inegi.municipios`, `udis`...). */
  readonly dataset: string;
  /** Fecha de los datos que trae esta versión del paquete. */
  readonly as_of: FechaISO;
  readonly sources: readonly FuenteDatos[];
  /** Página de documentación del dataset, la misma que da la API en `meta.docs`. */
  readonly docs: string;
}
