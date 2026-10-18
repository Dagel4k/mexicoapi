import { describe, expect, it } from "vitest";
import { PLAZOS, revisarPlazos } from "../../src/curado/plazos.js";

describe("revisarPlazos", () => {
  it("cada autoridad tiene un plazo general que cuenta todos los tipos de día", () => {
    // El Worker rechaza un calendario sin general o con un general que excluye tipos.
    expect(PLAZOS.cnbv).toEqual({ general: [] });
    expect(PLAZOS.sat).toEqual({ general: [], declaraciones_pagos: ["vacaciones"] });
  });

  it("da la cobertura de cada plazo y la amplia, la del plazo que contiene a los demás", () => {
    const revision = revisarPlazos(
      PLAZOS.sat,
      {
        descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
        vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
      },
      [{ fecha: "2026-12-25" }],
    );
    expect(revision).toEqual({
      plazos: {
        general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
        declaraciones_pagos: {
          cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
          excluir_tipos: ["vacaciones"],
        },
      },
      amplia: { desde: "2026-01-01", hasta: "2026-12-31" },
      fallas: [],
    });
  });

  it("falla si ningún plazo contiene la cobertura de los demás", () => {
    const revision = revisarPlazos(
      { general: [], declaraciones_pagos: ["vacaciones"], otro: ["descanso"] } as never,
      {
        descanso: { desde: "2026-01-01", hasta: "2026-06-30" },
        vacaciones: { desde: "2026-03-01", hasta: "2026-12-31" },
      },
      [],
    );
    expect(revision).toEqual({
      plazos: {},
      amplia: null,
      fallas: ["ningún tipo de plazo contiene la cobertura de los demás"],
    });
  });
});
