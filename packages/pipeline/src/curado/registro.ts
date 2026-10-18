import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabilCurado,
  FuenteDof,
  SalarioMinimo,
  TarifaIsr,
  Uma,
} from "@mexicoapi/core";
import type { z } from "zod";
import {
  type ExcepcionCuotaFija,
  esquemaDiaInhabilCurado,
  esquemaSalarioMinimo,
  esquemaTarifaIsr,
  esquemaUma,
} from "./esquemas.js";
import {
  invariantesDias,
  invariantesIsr,
  invariantesSalarioMinimo,
  invariantesUma,
} from "./invariantes.js";

/** Carpeta de `data/` con los YAML que captura una persona. */
export const DIRECTORIO_CURADO = "curado";

/** Lo que el YAML declara además de los registros, para los invariantes. */
export interface ContextoCurado {
  cobertura: CoberturaCurada | null;
  excepciones: readonly ExcepcionCuotaFija[];
}

/**
 * Dataset que una persona transcribe del DOF a `data/curado/<yaml>`. El comando `curar` genera
 * `data/<directorio>/<archivo>` y su manifiesto; `verificar` exige que correspondan al YAML.
 */
export interface DefinicionCurado<T extends { fuente: FuenteDof }> {
  id: string;
  directorio: string;
  archivo: string;
  /** Nombre del archivo dentro de `data/curado/`. */
  yaml: string;
  /** Registro publicado, con la fuente completa en lugar de su clave. */
  esquema: z.ZodType<T>;
  clave(r: T): string;
  /** Los calendarios declaran en el YAML el rango en que su lista está completa. */
  conCobertura: boolean;
  /**
   * Solo en los calendarios de días: su autoridad. `curar` escribe además `calendario.json`, con
   * sus tipos de plazo y las fuentes de sus fines de semana.
   */
  calendario?: AutoridadCurada | undefined;
  /** Las tarifas de ISR pueden declarar `excepciones_cuota_fija` en el YAML. */
  conExcepciones: boolean;
  invariantes(registros: readonly T[], contexto: ContextoCurado): string[];
}

function dias(autoridad: DiaInhabilCurado["autoridad"]): DefinicionCurado<DiaInhabilCurado> {
  return {
    id: `dias-inhabiles.${autoridad}`,
    directorio: `dias-inhabiles-${autoridad}`,
    archivo: "dias-inhabiles.json",
    yaml: `dias-inhabiles-${autoridad}.yaml`,
    esquema: esquemaDiaInhabilCurado,
    clave: (r) => r.fecha,
    conCobertura: true,
    calendario: autoridad,
    conExcepciones: false,
    invariantes: (registros, { cobertura }) => invariantesDias(autoridad)(registros, cobertura),
  };
}

export const curadoDiasCnbv = dias("cnbv");
export const curadoDiasSat = dias("sat");

export const curadoUma: DefinicionCurado<Uma> = {
  id: "constantes.uma",
  directorio: "constantes-uma",
  archivo: "uma.json",
  yaml: "constantes-uma.yaml",
  esquema: esquemaUma,
  clave: (r) => String(r.anio),
  conCobertura: false,
  conExcepciones: false,
  invariantes: invariantesUma,
};

export const curadoSalarioMinimo: DefinicionCurado<SalarioMinimo> = {
  id: "constantes.salario-minimo",
  directorio: "constantes-salario-minimo",
  archivo: "salario-minimo.json",
  yaml: "constantes-salario-minimo.yaml",
  esquema: esquemaSalarioMinimo,
  clave: (r) => `${r.anio}|${r.zona}`,
  conCobertura: false,
  conExcepciones: false,
  invariantes: invariantesSalarioMinimo,
};

export const curadoTarifasIsr: DefinicionCurado<TarifaIsr> = {
  id: "isr.tarifas",
  directorio: "isr-tarifas",
  archivo: "tarifas.json",
  yaml: "isr-tarifas.yaml",
  esquema: esquemaTarifaIsr,
  clave: (r) => `${r.anio}|${r.periodo}`,
  conCobertura: false,
  conExcepciones: true,
  invariantes: (registros, { excepciones }) => invariantesIsr(registros, excepciones),
};

// biome-ignore lint/suspicious/noExplicitAny: la lista mezcla datasets de distintos tipos
export const CURADOS: readonly DefinicionCurado<any>[] = [
  curadoDiasCnbv,
  curadoDiasSat,
  curadoUma,
  curadoSalarioMinimo,
  curadoTarifasIsr,
];
