import { describe, expect, it } from "vitest";
import { CONSULTAS, revisarConsulta } from "../../src/rutas/consulta.js";
import { cumpleRegla, type ReglaConsulta } from "../../src/rutas/parametros.js";

const REGLAS: Readonly<Record<string, ReglaConsulta>> = {
  a: { patron: /^\d+$/, detalle: "a debe ser un entero.", obligatorio: true },
  b: { patron: /^(?:true|false)$/, detalle: "b debe ser true o false." },
  m: { patron: /^\d+$/, cumple: (v) => Number(v) % 2 === 0, detalle: "m debe ser par." },
};

const revisar = (search: string) => revisarConsulta(REGLAS, search);

describe("revisarConsulta", () => {
  it("devuelve los parámetros declarados y presentes", () => {
    expect(revisar("?a=10&b=true")).toEqual({ consulta: { a: "10", b: "true" } });
    expect(revisar("a=10")).toEqual({ consulta: { a: "10" } });
    expect(revisar("?a=1&m=4")).toEqual({ consulta: { a: "1", m: "4" } });
  });

  it("decodifica como URLSearchParams", () => {
    expect(revisarConsulta({ q: { patron: /^.+$/, detalle: "q" } }, "?q=a%20b+c")).toEqual({
      consulta: { q: "a b c" },
    });
  });

  it("un segmento vacío o sin nombre es inválido y no nombra parámetro", () => {
    for (const search of ["?&", "?&&", "?a=1&&b=true", "?a=1&", "?&a=1", "?=1", "?a=1&=2", "&"]) {
      expect(revisar(search), search).toEqual({
        tipo: "parametro-invalido",
        detalle: "La query tiene un parámetro sin nombre.",
      });
    }
  });

  it("una query vacía o un ? solo no cuentan", () => {
    expect(revisarConsulta({}, "")).toEqual({ consulta: {} });
    expect(revisarConsulta({}, "?")).toEqual({ consulta: {} });
  });

  it("un parámetro no declarado es desconocido, también con nombres de Object", () => {
    expect(revisar("?a=1&c=2")).toEqual({
      tipo: "parametro-desconocido",
      detalle: "Esta ruta no acepta el parámetro c.",
      extras: { parametro: "c" },
    });
    for (const nombre of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(revisar(`?a=1&${nombre}=1`)).toMatchObject({
        tipo: "parametro-desconocido",
        extras: { parametro: nombre },
      });
    }
    expect(revisarConsulta({}, "?a=1")).toMatchObject({ tipo: "parametro-desconocido" });
  });

  it("revisa en el orden de la API: sin nombre, desconocido y luego cada regla en su orden", () => {
    expect(revisar("?z=1&&b=x")).toMatchObject({
      detalle: "La query tiene un parámetro sin nombre.",
    });
    expect(revisar("?b=x&z=1")).toMatchObject({ tipo: "parametro-desconocido" });
    // `a` falta y `b` no cumple: `a` va primero en las reglas.
    expect(revisar("?b=x")).toMatchObject({ tipo: "parametro-faltante" });
    expect(revisar("?m=3&a=x")).toMatchObject({ extras: { parametro: "a" } });
  });

  it("falta un obligatorio", () => {
    expect(revisar("?b=true")).toEqual({
      tipo: "parametro-faltante",
      detalle: "Falta el parámetro a.",
      extras: { parametro: "a" },
    });
  });

  it("repetido o vacío es inválido", () => {
    expect(revisar("?a=1&a=2")).toEqual({
      tipo: "parametro-invalido",
      detalle: "El parámetro a aparece más de una vez.",
      extras: { parametro: "a" },
    });
    expect(revisar("?a=")).toEqual({
      tipo: "parametro-invalido",
      detalle: "El parámetro a está vacío.",
      extras: { parametro: "a" },
    });
    expect(revisar("?a=1&b")).toMatchObject({ extras: { parametro: "b" } });
  });

  it("un valor que no cumple su regla es inválido con el detalle de la regla", () => {
    expect(revisar("?a=1&b=si")).toEqual({
      tipo: "parametro-invalido",
      detalle: "b debe ser true o false.",
      extras: { parametro: "b" },
    });
    expect(revisar("?a=1&m=3")).toEqual({
      tipo: "parametro-invalido",
      detalle: "m debe ser par.",
      extras: { parametro: "m" },
    });
  });
});

describe("CONSULTAS", () => {
  const reglaDe = (ruta: keyof typeof CONSULTAS, nombre: string) =>
    (CONSULTAS[ruta] as Readonly<Record<string, ReglaConsulta>>)[nombre] as ReglaConsulta;

  it("declara la query de cada ruta en el orden en que la API la revisa", () => {
    expect(
      Object.fromEntries(Object.entries(CONSULTAS).map(([r, c]) => [r, Object.keys(c)])),
    ).toEqual({
      "/v1/dias-habiles": ["autoridad", "tipo_plazo", "desde", "dias", "permitir_incompleto"],
      "/v1/dias-inhabiles": ["autoridad", "anio"],
      "/v1/tipo-cambio/fix": ["publicado", "operacion"],
      "/v1/udis": ["fecha"],
      "/v1/constantes/uma": ["fecha"],
    });
  });

  it("marca los obligatorios", () => {
    const obligatorios = Object.fromEntries(
      Object.entries(CONSULTAS).map(([r, c]) => [
        r,
        Object.entries(c)
          .filter(([, regla]) => regla.obligatorio === true)
          .map(([n]) => n),
      ]),
    );
    expect(obligatorios).toEqual({
      "/v1/dias-habiles": ["autoridad", "desde", "dias"],
      "/v1/dias-inhabiles": ["autoridad", "anio"],
      "/v1/tipo-cambio/fix": [],
      "/v1/udis": ["fecha"],
      "/v1/constantes/uma": ["fecha"],
    });
  });

  it("tiene los textos de la API", () => {
    const habiles = (n: string) => reglaDe("/v1/dias-habiles", n).detalle;
    expect(habiles("autoridad")).toBe("Autoridades disponibles: lft, cnbv y sat.");
    expect(habiles("tipo_plazo")).toBe(
      "El tipo de plazo (tipo_plazo) debe ser general o declaraciones_pagos.",
    );
    expect(habiles("desde")).toBe(
      "La fecha de partida (desde) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    expect(habiles("dias")).toBe(
      "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
    );
    expect(habiles("permitir_incompleto")).toBe(
      "El parámetro permitir_incompleto debe ser true o false.",
    );
    expect(reglaDe("/v1/dias-inhabiles", "anio").detalle).toBe(
      "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
    );
    expect(reglaDe("/v1/tipo-cambio/fix", "publicado").detalle).toBe(
      "La fecha de publicación (publicado) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    expect(reglaDe("/v1/tipo-cambio/fix", "operacion").detalle).toBe(
      "La fecha de la operación (operacion) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    expect(reglaDe("/v1/udis", "fecha").detalle).toBe(
      "La fecha del valor (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    expect(reglaDe("/v1/constantes/uma", "fecha").detalle).toBe(
      "La fecha que se consulta (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
  });

  it("acepta lo que acepta la API", () => {
    const acepta = (ruta: keyof typeof CONSULTAS, nombre: string, valor: string) =>
      cumpleRegla(reglaDe(ruta, nombre), valor);
    for (const v of ["lft", "cnbv", "sat"])
      expect(acepta("/v1/dias-habiles", "autoridad", v)).toBe(true);
    for (const v of ["LFT", "imss", "sat "])
      expect(acepta("/v1/dias-habiles", "autoridad", v)).toBe(false);
    for (const v of ["1", "3650", "999"]) expect(acepta("/v1/dias-habiles", "dias", v)).toBe(true);
    for (const v of ["0", "3651", "01", "1.5", "-1", "10000"]) {
      expect(acepta("/v1/dias-habiles", "dias", v), v).toBe(false);
    }
    expect(acepta("/v1/dias-habiles", "desde", "2028-02-29")).toBe(true);
    for (const v of ["2026-02-29", "0000-01-01", "2026-1-01", "２０２６-01-01"]) {
      expect(acepta("/v1/dias-habiles", "desde", v), v).toBe(false);
    }
    expect(acepta("/v1/dias-inhabiles", "anio", "0000")).toBe(false);
    expect(acepta("/v1/dias-habiles", "permitir_incompleto", "1")).toBe(false);
  });

  it("las reglas de enumeración traen sus valores y están congeladas", () => {
    expect(reglaDe("/v1/dias-habiles", "autoridad").valores).toEqual(["lft", "cnbv", "sat"]);
    expect(reglaDe("/v1/dias-habiles", "tipo_plazo").valores).toEqual([
      "general",
      "declaraciones_pagos",
    ]);
    expect(reglaDe("/v1/dias-habiles", "permitir_incompleto").valores).toEqual(["true", "false"]);
    expect(Object.isFrozen(CONSULTAS)).toBe(true);
    for (const reglas of Object.values(CONSULTAS)) {
      expect(Object.isFrozen(reglas)).toBe(true);
      for (const regla of Object.values(reglas)) {
        expect(Object.isFrozen(regla)).toBe(true);
        expect(regla.patron.source).toMatch(/^\^.*\$$/);
        expect(regla.patron.flags).toBe("");
      }
    }
  });
});
