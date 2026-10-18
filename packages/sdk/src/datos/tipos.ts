// Tipos de los datos que trae el paquete. Los registros usan los tipos del núcleo.
import type { FechaISO } from "@mexicoapi/core";
import type { DatosCalendarioCurado } from "@mexicoapi/core/curados";

export type {
  AutoridadCurada,
  Banco,
  BancoClabe,
  Calendario,
  CoberturaSerie,
  DiaInhabil,
  DiaInhabilCurado,
  Estado,
  FechaISO,
  FuenteDof,
  Municipio,
  SalarioMinimo,
  TarifaIsr,
  TipoCambioFix,
  TipoDiaCurado,
  TipoPlazo,
  TramoIsr,
  Udi,
  Uma,
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

/**
 * El `calendario.json` de un calendario curado en data/, que el build copia tal cual: los plazos
 * con su cobertura y la fuente que cita los fines de semana de cada año, lo mismo que usa la API.
 */
export type CalendarioGenerado = Omit<DatosCalendarioCurado, "dias">;
