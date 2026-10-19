import { describe, expect, it } from "vitest";
import { PUBLICADO_EN_NPM, porNombre } from "../../src/sitio/comun.js";

describe("lo común del sitio", () => {
  it("ordena por unidades de código UTF-16, no por idioma", () => {
    expect(["b", "a", "B", "á", "a"].sort(porNombre)).toEqual(["B", "a", "a", "b", "á"]);
    expect(porNombre("x", "x")).toBe(0);
  });

  it("los paquetes ya están en npm (0.1.0, 2026-10-18)", () => {
    expect(PUBLICADO_EN_NPM).toBe(true);
  });
});
