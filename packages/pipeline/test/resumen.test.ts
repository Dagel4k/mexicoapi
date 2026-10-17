import { describe, expect, it } from "vitest";
import type { ResultadoCorrida } from "../src/marco.js";
import { resumenMarkdown } from "../src/resumen.js";

const base: ResultadoCorrida = {
  dataset: "x.y",
  estado: "actualizado",
  altas: 0,
  bajas: 0,
  cambios: 0,
  motivos: [],
  registros: 3,
};

describe("resumenMarkdown", () => {
  it("limita a 20 altas y dice cuantas faltan", () => {
    const altas = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}` }));
    const md = resumenMarkdown(
      [{ ...base, altas: 25, motivos: ["snapshot inicial"] }],
      new Map([["x.y", { altas, bajas: [], cambios: [] }]]),
    );
    expect(md).toContain("x.y");
    expect(md).toContain("snapshot inicial");
    expect(md).toContain('"id":"a19"');
    expect(md).not.toContain('"id":"a20"');
    expect(md).toContain("y 5 más");
  });

  it("muestra bajas y cambios con clave y campos, truncando registros largos", () => {
    const cambios = Array.from({ length: 21 }, (_, i) => ({
      clave: `k${i}`,
      antes: {},
      despues: {},
      campos: ["nombre", "cve"],
    }));
    const md = resumenMarkdown(
      [{ ...base, estado: "requiere_revision", bajas: 1, cambios: 21 }],
      new Map([["x.y", { altas: [], bajas: [{ id: "b", texto: "z".repeat(400) }], cambios }]]),
    );
    expect(md).toContain("k0");
    expect(md).toContain("nombre, cve");
    expect(md).not.toContain("k20");
    expect(md).toContain("y 1 más");
    expect(md).toContain("requiere_revision");
    expect(md.split("\n").every((l) => l.length < 260)).toBe(true);
  });

  it("dice sin cambios cuando no hay diferencias", () => {
    const md = resumenMarkdown([{ ...base, estado: "sin_cambios" }], new Map());
    expect(md).toContain("sin cambios");
  });
});
