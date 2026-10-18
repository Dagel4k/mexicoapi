// Tipos de los datos que trae el paquete. Los registros usan los tipos del núcleo.
import type {
  AutoridadCurada,
  CoberturaSerie,
  FechaISO,
  FuenteDof,
  TipoDiaCurado,
  TipoPlazo,
} from "@mexicoapi/core";

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

/** Un tipo de plazo de un calendario curado: hasta dónde está completo y qué días no cuenta. */
export interface PlazoGenerado {
  readonly cobertura: CoberturaSerie;
  readonly excluir_tipos: readonly TipoDiaCurado[];
}

/**
 * Lo que el build arma de un calendario curado además de sus días: los plazos y la fuente que
 * cita los fines de semana de cada año, lo mismo que usa la API.
 */
export interface CalendarioGenerado {
  readonly autoridad: AutoridadCurada;
  readonly plazos: Readonly<Partial<Record<TipoPlazo, PlazoGenerado>>>;
  readonly fuentes_fin_de_semana: Readonly<Record<string, FuenteDof>>;
}
