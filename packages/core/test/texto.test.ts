import { describe, expect, it } from "vitest";
import { normalizarClabe, validarClabe } from "../src/clabe.js";
import * as core from "../src/index.js";
import { enLinea } from "../src/texto.js";

describe("enLinea", () => {
  it("cambia cada racha de saltos y caracteres de control por un espacio y recorta", () => {
    expect(enLinea("Banco\nde México")).toBe("Banco de México");
    expect(enLinea("  a\r\n\tb  ")).toBe("a b");
    const [linea, parrafo] = [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)];
    expect(enLinea(`a${linea}b${parrafo}c`)).toBe("a b c");
    expect(enLinea("sin cambios")).toBe("sin cambios");
  });

  it("quita las secuencias de escape de la terminal (ESC, CSI de 8 bits, OSC)", () => {
    const texto = enLinea("\u001b[31mrojo\u001b[0m \u009b2J \u001b]8;;https://x\u0007enlace");
    const control = (c: string) => (c.codePointAt(0) as number) < 0x20 || /\p{Cc}/u.test(c);
    expect([...texto].filter(control)).toEqual([]);
    // Los espacios que ya estaban se quedan: solo cambian los controles.
    expect(texto).toBe("[31mrojo [0m  2J  ]8;;https://x enlace");
  });
});

describe("normalizarClabe", () => {
  it("quita espacios, tabuladores, saltos y guiones, como validarClabe", () => {
    expect(normalizarClabe("002 010-077777777771")).toBe("002010077777777771");
    expect(normalizarClabe("\t002010077777777771\n")).toBe("002010077777777771");
    for (const entrada of [
      "002 010 077 777 777 771",
      "002-010-077777777771",
      "00201007777777777a",
    ]) {
      expect(normalizarClabe(entrada)).toBe(validarClabe(entrada).valor);
    }
  });

  it("deja los caracteres de ancho cero para que el validador los rechace", () => {
    const conCero = `002${String.fromCodePoint(0x200b)}010077777777771`;
    expect(normalizarClabe(conCero)).toBe(conCero);
  });
});

describe("índice del núcleo", () => {
  it("exporta enLinea y normalizarClabe, que usan la CLI y el MCP", () => {
    expect(core.enLinea).toBe(enLinea);
    expect(core.normalizarClabe).toBe(normalizarClabe);
  });
});
