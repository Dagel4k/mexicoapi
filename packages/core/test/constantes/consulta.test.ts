import { describe, expect, it } from "vitest";
import {
  anioDeConstante,
  coberturaAnual,
  coberturaUma,
  umaVigente,
} from "../../src/constantes/consulta.js";
import type { Uma } from "../../src/datos/curados.js";

const uma = (anio: number, diaria: string): Uma => ({
  anio,
  diaria,
  mensual: "1.00",
  anual: "12.00",
  vigencia_desde: `${anio}-02-01`,
  fuente: {
    nombre: "INEGI. Unidad de medida y actualización",
    url: "https://dof.gob.mx/",
    fecha_publicacion: `${anio}-01-09`,
    fragmento: `[...] el valor diario de la Unidad de Medida y Actualización es de $${diaria} [...]`,
  },
});

const UMAS = [uma(2024, "108.57"), uma(2025, "113.14"), uma(2026, "117.31")];
const COBERTURA = { desde: "2024-02-01", hasta: "2027-01-31" };

describe("umaVigente", () => {
  // Cada UMA rige del 1 de febrero de su año al 31 de enero del siguiente.
  it.each([
    ["2026-01-05", 2025],
    ["2026-01-31", 2025],
    ["2026-02-01", 2026],
    ["2026-12-31", 2026],
    ["2027-01-31", 2026],
    ["2025-01-31", 2024],
    ["2025-02-01", 2025],
    ["2024-02-01", 2024],
    ["2024-02-29", 2024],
  ] as const)("el %s rige la UMA de %i", (fecha, anio) => {
    expect(umaVigente(UMAS, fecha)).toEqual({
      tipo: "encontrado",
      registro: UMAS.find((u) => u.anio === anio),
    });
  });

  it.each(["2024-01-31", "2017-02-01", "0001-01-01"])(
    "%s, antes de la primera UMA: sin_dato con la cobertura",
    (fecha) => {
      expect(umaVigente(UMAS, fecha)).toEqual({
        tipo: "sin_dato",
        cobertura: COBERTURA,
        detalle: `Los datos empiezan con la UMA de 2024, vigente desde el 2024-02-01; no incluyen la UMA vigente el ${fecha}.`,
      });
    },
  );

  it.each(["2027-02-01", "2028-06-15", "9999-12-31"])(
    "%s, después de la vigencia de la última: no_disponible con la cobertura",
    (fecha) => {
      expect(umaVigente(UMAS, fecha)).toEqual({
        tipo: "no_disponible",
        cobertura: COBERTURA,
        detalle: `La UMA vigente el ${fecha} todavía no está cargada; la última cargada es la de 2026, vigente hasta el 2027-01-31.`,
      });
    },
  );

  it.each(["2026-02-30", "2026-13-01", "2026-2-1", "0000-02-01", "15/01/2026", ""])(
    "%s no es una fecha real: RangeError",
    (fecha) => {
      expect(() => umaVigente(UMAS, fecha)).toThrow(RangeError);
    },
  );

  it("una lista vacía o con un hueco entre años es RangeError", () => {
    expect(() => umaVigente([], "2026-03-01")).toThrow(RangeError);
    expect(() => umaVigente([UMAS[0] as Uma, UMAS[2] as Uma], "2025-03-01")).toThrow(
      /años consecutivos/,
    );
  });
});

describe("coberturaUma", () => {
  it("va del 1 de febrero de la primera UMA al 31 de enero siguiente a la última", () => {
    expect(coberturaUma(UMAS)).toEqual(COBERTURA);
    expect(coberturaUma([uma(2026, "117.31")])).toEqual({
      desde: "2026-02-01",
      hasta: "2027-01-31",
    });
    expect(Object.isFrozen(coberturaUma(UMAS))).toBe(true);
  });

  it("una lista vacía es RangeError", () => {
    expect(() => coberturaUma([])).toThrow(RangeError);
  });
});

describe("coberturaAnual", () => {
  // El salario mínimo y las tarifas de ISR rigen del 1 de enero al 31 de diciembre de su año.
  it("va del 1 de enero del primer año al 31 de diciembre del último", () => {
    expect(coberturaAnual([2019, 2020, 2026])).toEqual({
      desde: "2019-01-01",
      hasta: "2026-12-31",
    });
    expect(coberturaAnual([26])).toEqual({ desde: "0026-01-01", hasta: "0026-12-31" });
  });

  it.each([
    ["una lista vacía", []],
    ["una lista desordenada", [2026, 2025]],
    ["un año fuera de 1 a 9999", [0, 2026]],
  ])("%s es RangeError", (_caso, anios) => {
    expect(() => coberturaAnual(anios)).toThrow(RangeError);
  });
});

describe("anioDeConstante", () => {
  const anios = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

  it("encuentra un año cargado", () => {
    expect(anioDeConstante(anios, 2020, "la UMA")).toEqual({ tipo: "encontrado" });
  });

  it.each([
    [
      anios,
      2016,
      "la UMA",
      "No existe la UMA de 2016 en los datos; los años cargados van de 2017 a 2026.",
    ],
    [
      anios,
      1,
      "la UMA",
      "No existe la UMA de 0001 en los datos; los años cargados van de 2017 a 2026.",
    ],
    [
      [2026],
      2025,
      "la tarifa mensual de ISR",
      "No existe la tarifa mensual de ISR de 2025 en los datos; el único año cargado es 2026.",
    ],
    // Un año que falta entre los cargados tampoco existe.
    [
      [2017, 2019],
      2018,
      "la UMA",
      "No existe la UMA de 2018 en los datos; los años cargados van de 2017 a 2019.",
    ],
  ] as const)(
    "antes del primer año o en un hueco: sin_dato (%#)",
    (lista, anio, nombre, detalle) => {
      expect(anioDeConstante(lista, anio, nombre)).toEqual({ tipo: "sin_dato", detalle });
    },
  );

  it.each([
    [
      anios,
      2027,
      "la UMA",
      "Todavía no se carga la UMA de 2027; los años cargados van de 2017 a 2026.",
    ],
    [
      [2026],
      2027,
      "la tarifa mensual de ISR",
      "Todavía no se carga la tarifa mensual de ISR de 2027; el único año cargado es 2026.",
    ],
    [
      [2025, 2026],
      9999,
      "la tarifa anual de ISR",
      "Todavía no se carga la tarifa anual de ISR de 9999; los años cargados van de 2025 a 2026.",
    ],
  ] as const)("después del último año: no_disponible (%#)", (lista, anio, nombre, detalle) => {
    expect(anioDeConstante(lista, anio, nombre)).toEqual({ tipo: "no_disponible", detalle });
  });

  it.each([
    ["una lista vacía", [], 2026],
    ["años desordenados", [2026, 2025], 2026],
    ["años repetidos", [2026, 2026], 2026],
    ["un año no entero en la lista", [2025.5], 2026],
    ["un año 0", anios, 0],
    ["un año de 5 cifras", anios, 10_000],
    ["un año no entero", anios, 2026.5],
  ])("%s es RangeError", (_caso, lista, anio) => {
    expect(() => anioDeConstante(lista, anio, "la UMA")).toThrow(RangeError);
  });
});
