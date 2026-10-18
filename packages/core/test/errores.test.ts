import { describe, expect, it } from "vitest";
import {
  CalendarioIncompletoError,
  esErrorDelNucleo,
  FechaFueraDeRangoError,
  SerieIncompletaError,
} from "../src/errores.js";

// Antes de publicar 0.1.0 el campo se llamaba `codigo`; los errores del SDK ya usaban `tipo`.
describe("errores del núcleo", () => {
  it("traen tipo para reconocerlos sin instanceof, y nada llamado codigo", () => {
    const cobertura = { desde: "2026-01-01", hasta: "2026-12-31" };
    const errores = [
      [new FechaFueraDeRangoError(), "fecha-fuera-de-rango"],
      [new SerieIncompletaError("2026-01-02", cobertura, "falta el año"), "serie-incompleta"],
      [new CalendarioIncompletoError("sat", "2027-01-01", cobertura), "calendario-incompleto"],
    ] as const;
    for (const [error, tipo] of errores) {
      expect(error.tipo).toBe(tipo);
      expect("codigo" in error).toBe(false);
    }
  });
});

describe("esErrorDelNucleo", () => {
  it("reconoce el tipo aunque el error venga de otra copia del núcleo", () => {
    const copia = Object.assign(new Error("otra copia"), { tipo: "calendario-incompleto" });
    expect(esErrorDelNucleo(copia, "calendario-incompleto")).toBe(true);
    expect(esErrorDelNucleo(new FechaFueraDeRangoError(), "fecha-fuera-de-rango")).toBe(true);
    expect(esErrorDelNucleo(new FechaFueraDeRangoError(), "calendario-incompleto")).toBe(false);
    for (const otro of [new RangeError("x"), null, undefined, "calendario-incompleto", 3]) {
      expect(esErrorDelNucleo(otro, "calendario-incompleto")).toBe(false);
    }
  });
});
