import { describe, expect, it } from "vitest";
import {
  diaDeLaSemana,
  enesimoDiaDeSemana,
  esBisiesto,
  esFechaIsoValida,
  fechaValida,
  sumarDias,
} from "../src/fechas.js";

describe("esFechaIsoValida", () => {
  it("acepta fechas reales", () => {
    expect(esFechaIsoValida("2024-02-29")).toBe(true);
  });
  it.each([
    "2023-02-29",
    "2026-13-01",
    "2026-1-01",
    "2026-01-01T00:00",
    " 2026-01-01",
    "2026-01-01 ",
    "２０２６-01-01",
    "0000-01-01",
    "",
  ])("rechaza %j", (v) => {
    expect(esFechaIsoValida(v)).toBe(false);
  });
});

describe("fechaValida", () => {
  it("valida rangos", () => {
    expect(fechaValida(2026, 12, 31)).toBe(true);
    expect(fechaValida(1, 1, 1)).toBe(true);
    expect(fechaValida(9999, 12, 31)).toBe(true);
    expect(fechaValida(0, 1, 1)).toBe(false);
    expect(fechaValida(10000, 1, 1)).toBe(false);
    expect(fechaValida(2026, 0, 1)).toBe(false);
    expect(fechaValida(2026, 13, 1)).toBe(false);
    expect(fechaValida(2026, 4, 31)).toBe(false);
    expect(fechaValida(2026, 1, 0)).toBe(false);
    expect(fechaValida(2026.5, 1, 1)).toBe(false);
    expect(fechaValida(2026, 1.5, 1)).toBe(false);
    expect(fechaValida(2026, 1, 1.5)).toBe(false);
    expect(fechaValida(Number.NaN, 1, 1)).toBe(false);
  });
});

describe("sumarDias", () => {
  it("cruza de año y de febrero bisiesto", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2024-03-01", -1)).toBe("2024-02-29");
    expect(sumarDias("2026-10-17", 0)).toBe("2026-10-17");
  });
  it("conserva años menores a 1000 con cero a la izquierda", () => {
    expect(sumarDias("0099-12-31", 1)).toBe("0100-01-01");
  });
  it("lanza RangeError con fecha inválida", () => {
    expect(() => sumarDias("2026-02-30", 1)).toThrow(RangeError);
  });
  it("lanza RangeError con días no enteros", () => {
    expect(() => sumarDias("2026-01-01", 1.5)).toThrow(RangeError);
    expect(() => sumarDias("2026-01-01", Number.NaN)).toThrow(RangeError);
  });
  it("lanza RangeError si el resultado sale de 1-9999", () => {
    expect(() => sumarDias("9999-12-31", 1)).toThrow(RangeError);
    expect(() => sumarDias("0001-01-01", -1)).toThrow(RangeError);
  });
});

describe("diaDeLaSemana", () => {
  it("devuelve 0 para domingo y 6 para sábado", () => {
    expect(diaDeLaSemana("2026-10-17")).toBe(6);
    expect(diaDeLaSemana("2026-10-18")).toBe(0);
  });
  it("lanza RangeError con fecha inválida", () => {
    expect(() => diaDeLaSemana("2026-02-30")).toThrow(RangeError);
  });
});

describe("enesimoDiaDeSemana", () => {
  it("calcula feriados móviles", () => {
    expect(enesimoDiaDeSemana(2026, 2, 1, 1)).toBe("2026-02-02");
    expect(enesimoDiaDeSemana(2026, 3, 3, 1)).toBe("2026-03-16");
    expect(enesimoDiaDeSemana(2026, 11, 3, 1)).toBe("2026-11-16");
  });
  it("acepta el 5.º día cuando existe", () => {
    expect(enesimoDiaDeSemana(2026, 3, 5, 1)).toBe("2026-03-30");
  });
  it("lanza RangeError si el n-ésimo día no existe", () => {
    expect(() => enesimoDiaDeSemana(2026, 2, 5, 1)).toThrow(RangeError);
  });
  it("lanza RangeError con argumentos fuera de rango", () => {
    expect(() => enesimoDiaDeSemana(2026, 0, 1, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 13, 1, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1.5, 1, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1, 0, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1, 6, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1, 1.5, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(0, 1, 1, 1)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1, 1, 7 as never)).toThrow(RangeError);
    expect(() => enesimoDiaDeSemana(2026, 1, 1, 1.5 as never)).toThrow(RangeError);
  });
});

describe("esBisiesto", () => {
  it("aplica la regla gregoriana", () => {
    expect(esBisiesto(1900)).toBe(false);
    expect(esBisiesto(2000)).toBe(true);
    expect(esBisiesto(2024)).toBe(true);
    expect(esBisiesto(2026)).toBe(false);
  });
});
