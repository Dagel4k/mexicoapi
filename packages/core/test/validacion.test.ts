import { describe, expect, it } from "vitest";
import { normalizar } from "../src/validacion.js";

describe("normalizar (mayúsculas)", () => {
  it.each(["ſ", "ı", "ß", "ﬀ"])("no convierte %j a ASCII", (c) => {
    expect(normalizar(c)).toBe(c);
  });
  it("quita separadores y pasa a mayúsculas ASCII", () => {
    expect(normalizar("gode-561231 gr8")).toBe("GODE561231GR8");
  });
  it("convierte ñ en Ñ", () => {
    expect(normalizar("ñ")).toBe("Ñ");
  });
});
