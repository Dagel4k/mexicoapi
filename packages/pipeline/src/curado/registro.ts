import type {
  CoberturaCurada,
  DiaInhabilCurado,
  FuenteDof,
  SalarioMinimo,
  TarifaIsr,
  Uma,
} from "@mexicoapi/core";
import type { z } from "zod";
import {
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
  invariantes(registros: readonly T[], cobertura: CoberturaCurada | null): string[];
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
    invariantes: invariantesDias(autoridad),
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
  invariantes: invariantesIsr,
};

// biome-ignore lint/suspicious/noExplicitAny: la lista mezcla datasets de distintos tipos
export const CURADOS: readonly DefinicionCurado<any>[] = [
  curadoDiasCnbv,
  curadoDiasSat,
  curadoUma,
  curadoSalarioMinimo,
  curadoTarifasIsr,
];
