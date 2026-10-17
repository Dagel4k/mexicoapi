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
  it("compone la ñ descompuesta (n o N más U+0303)", () => {
    expect(normalizar("n\u0303")).toBe("Ñ");
    expect(normalizar("N\u0303ab")).toBe("ÑAB");
  });
  it("no aplica NFKC: el signo Kelvin no pasa a K", () => {
    expect(normalizar("\u212A")).toBe("\u212A");
  });
});

describe("normalizar (separadores)", () => {
  it("quita NBSP y U+3000", () => {
    expect(normalizar("GODE\u00A0561231\u3000GR8")).toBe("GODE561231GR8");
  });
  it("quita tabulador, saltos de línea y guiones", () => {
    expect(normalizar("a\tb\nc\rd\ve\ff-g")).toBe("ABCDEFG");
  });
  it.each([
    ["U+200B", "\u200B"],
    ["U+200C", "\u200C"],
    ["U+200D", "\u200D"],
    ["U+2060", "\u2060"],
    ["U+FEFF", "\uFEFF"],
  ])("deja el carácter de ancho cero %s", (_nombre, c) => {
    expect(normalizar(`A${c}B`)).toBe(`A${c}B`);
  });
});
