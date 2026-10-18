import { describe, expect, it } from "vitest";
import { interpretarCurado } from "../../src/curado/leer.js";
import { CURADOS, DIRECTORIO_CURADO } from "../../src/curado/registro.js";
import { DATASETS } from "../../src/registro.js";
import { YAML_CNBV, YAML_ISR, YAML_SALARIO, YAML_SAT, YAML_UMA } from "./ejemplos.js";

describe("CURADOS", () => {
  it("registra los cinco datasets curados con nombres que no chocan", () => {
    expect(CURADOS.map((d) => d.id)).toEqual([
      "dias-inhabiles.cnbv",
      "dias-inhabiles.sat",
      "constantes.uma",
      "constantes.salario-minimo",
      "isr.tarifas",
    ]);
    const automaticos = [...DATASETS.values()];
    for (const def of CURADOS) {
      expect(def.directorio).toBe(def.id.replace(".", "-"));
      expect(def.yaml).toBe(`${def.directorio}.yaml`);
      expect(def.archivo).toMatch(/^[a-z-]+\.json$/);
      expect(DATASETS.has(def.id)).toBe(false);
      expect(automaticos.some((d) => d.directorio === def.directorio)).toBe(false);
      expect(def.directorio).not.toBe(DIRECTORIO_CURADO);
    }
  });

  it("cada dataset acepta su YAML de ejemplo", () => {
    const ejemplos = [YAML_CNBV, YAML_SAT, YAML_UMA, YAML_SALARIO, YAML_ISR];
    CURADOS.forEach((def, i) => {
      expect(interpretarCurado(def, ejemplos[i] as string).problemas, def.id).toEqual([]);
    });
  });

  it("los días de la CNBV no aceptan días del SAT y viceversa", () => {
    const [cnbv, sat] = CURADOS;
    const comoSat = YAML_CNBV.replace(
      "dataset: dias-inhabiles.cnbv",
      "dataset: dias-inhabiles.sat",
    );
    expect(interpretarCurado(sat as (typeof CURADOS)[number], comoSat).problemas).toContain(
      "invariante: 2026-01-01: la autoridad es cnbv, se esperaba sat",
    );
    expect(cnbv?.clave({ fecha: "2026-01-01" })).toBe("2026-01-01");
  });
});
