import { describe, expect, it } from "vitest";
import { requerido } from "../../src/parametros.js";

describe("requerido", () => {
  it("devuelve el valor que el enrutador validó y falla cerrado si no está", () => {
    expect(requerido({ id: "25" }, "id")).toBe("25");
    expect(() => requerido({}, "id")).toThrow();
  });
});
