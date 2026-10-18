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
  // Una copia del núcleo tiene la misma clase con otra identidad: el mismo name y el mismo tipo.
  it("reconoce el tipo aunque el error venga de otra copia del núcleo", () => {
    const copia = Object.assign(new Error("otra copia"), {
      name: "CalendarioIncompletoError",
      tipo: "calendario-incompleto",
    });
    expect(esErrorDelNucleo(copia, "calendario-incompleto")).toBe(true);
    expect(esErrorDelNucleo(new FechaFueraDeRangoError(), "fecha-fuera-de-rango")).toBe(true);
    expect(esErrorDelNucleo(new FechaFueraDeRangoError(), "calendario-incompleto")).toBe(false);
    for (const otro of [new RangeError("x"), null, undefined, "calendario-incompleto", 3]) {
      expect(esErrorDelNucleo(otro, "calendario-incompleto")).toBe(false);
    }
  });

  it("no confunde un MexicoApiError del cliente, que trae el mismo tipo con otra forma", () => {
    // El problema de la API: la cobertura va en `problema`, no en el error.
    const delCliente = Object.assign(new Error("422 Calendario incompleto: …"), {
      name: "MexicoApiError",
      tipo: "calendario-incompleto",
      status: 422,
      problema: { cobertura: { desde: "2026-01-01", hasta: "2026-12-31" } },
    });
    expect(esErrorDelNucleo(delCliente, "calendario-incompleto")).toBe(false);
    const sinNombre = Object.assign(new Error("x"), { tipo: "fecha-fuera-de-rango" });
    expect(esErrorDelNucleo(sinNombre, "fecha-fuera-de-rango")).toBe(false);
  });
});
