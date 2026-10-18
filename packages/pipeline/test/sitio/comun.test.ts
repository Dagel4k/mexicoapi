import { describe, expect, it } from "vitest";
import { PUBLICADO_EN_NPM, porNombre } from "../../src/sitio/comun.js";

describe("lo común del sitio", () => {
  it("ordena por unidades de código UTF-16, no por idioma", () => {
    expect(["b", "a", "B", "á", "a"].sort(porNombre)).toEqual(["B", "a", "a", "b", "á"]);
    expect(porNombre("x", "x")).toBe(0);
  });

  it("los paquetes todavía no están en npm", () => {
    expect(PUBLICADO_EN_NPM).toBe(false);
  });
});
