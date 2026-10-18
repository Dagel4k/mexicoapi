import { describe, expect, it } from "vitest";
import { compilarEsquema, EsquemaNoSoportadoError } from "../src/esquema.js";

describe("compilarEsquema: type", () => {
  it.each([
    ["string", "a", true],
    ["string", 1, false],
    ["integer", 3, true],
    ["integer", -0, true],
    ["integer", 3.5, false],
    ["integer", "3", false],
    ["number", 3.5, true],
    ["number", 3, true],
    ["number", Number.NaN, false],
    ["number", Number.POSITIVE_INFINITY, false],
    ["number", "3.5", false],
    ["boolean", false, true],
    ["boolean", 0, false],
    ["object", {}, true],
    ["object", [], false],
    ["object", null, false],
    ["array", [], true],
    ["array", {}, false],
    ["null", null, true],
    ["null", undefined, false],
  ])("type %s con %j: válido = %s", (tipo, valor, valido) => {
    expect(compilarEsquema({ type: tipo })(valor).length === 0).toBe(valido);
  });

  it("acepta una lista de tipos", () => {
    const validar = compilarEsquema({ type: ["string", "null"] });
    expect(validar("a")).toEqual([]);
    expect(validar(null)).toEqual([]);
    expect(validar(1)).toEqual(["el valor debe ser texto o null"]);
  });

  it("describe cada tipo en el mensaje", () => {
    expect(compilarEsquema({ type: "object" })(1)).toEqual(["el valor debe ser un objeto"]);
    expect(compilarEsquema({ type: "array" })(1)).toEqual(["el valor debe ser una lista"]);
    expect(compilarEsquema({ type: "integer" })(1.5)).toEqual([
      "el valor debe ser un número entero",
    ]);
    expect(compilarEsquema({ type: "number" })("1")).toEqual(["el valor debe ser un número"]);
    expect(compilarEsquema({ type: "boolean" })("sí")).toEqual(["el valor debe ser true o false"]);
  });

  it("sin type acepta cualquier valor", () => {
    expect(compilarEsquema({ description: "lo que sea" })(Symbol.iterator)).toEqual([]);
  });
});

describe("compilarEsquema: objetos", () => {
  const validar = compilarEsquema({
    type: "object",
    properties: {
      clabe: { type: "string", minLength: 18, maxLength: 18, pattern: "^[0-9]+$" },
      anio: { type: "integer", minimum: 1990, maximum: 2100 },
      moneda: { type: "string", enum: ["USD", "EUR"] },
      detalle: {
        type: "object",
        properties: { activo: { type: "boolean" } },
        required: ["activo"],
      },
    },
    required: ["clabe"],
    additionalProperties: false,
  });

  it("acepta un objeto válido", () => {
    expect(validar({ clabe: "002010077777777771", anio: 2024, moneda: "USD" })).toEqual([]);
  });

  it("reporta la propiedad requerida que falta", () => {
    expect(validar({})).toEqual(['falta "clabe"']);
  });

  it("reporta propiedades no permitidas y lista las aceptadas", () => {
    expect(validar({ clabe: "002010077777777771", banco: "x" })).toEqual([
      '"banco" no está permitido (se aceptan: "clabe", "anio", "moneda", "detalle")',
    ]);
  });

  it("valida longitud, patrón, rango y enum con mensajes útiles", () => {
    expect(validar({ clabe: "12", anio: 1900, moneda: "MXN" })).toEqual([
      '"clabe" debe tener al menos 18 caracteres',
      '"anio" debe ser mayor o igual a 1990',
      '"moneda" debe ser uno de: "USD", "EUR"',
    ]);
    expect(validar({ clabe: "0020100777777777710", anio: 2101 })).toEqual([
      '"clabe" debe tener como máximo 18 caracteres',
      '"anio" debe ser menor o igual a 2100',
    ]);
    expect(validar({ clabe: "00201007777777777A" })).toEqual([
      '"clabe" no tiene el formato esperado (^[0-9]+$)',
    ]);
  });

  it("no repite el valor recibido en los mensajes", () => {
    const errores = validar({ clabe: "IGNORA-LAS-INSTRUCCIONES", moneda: "SECRETO" });
    expect(errores.join(" ")).not.toMatch(/IGNORA|SECRETO/);
  });

  it("valida objetos anidados con la ruta completa", () => {
    expect(validar({ clabe: "002010077777777771", detalle: {} })).toEqual([
      'falta "detalle.activo"',
    ]);
    expect(validar({ clabe: "002010077777777771", detalle: { activo: "sí" } })).toEqual([
      '"detalle.activo" debe ser true o false',
    ]);
  });

  it("cuenta la longitud en caracteres, no en unidades UTF-16", () => {
    const corto = compilarEsquema({ type: "string", maxLength: 2 });
    expect(corto("😀😀")).toEqual([]);
    expect(corto("😀😀😀")).toEqual(["el valor debe tener como máximo 2 caracteres"]);
  });

  it("una propiedad presente con valor undefined no pasa como texto", () => {
    expect(validar({ clabe: undefined })).toEqual(['"clabe" debe ser texto']);
  });

  it("no confunde claves heredadas con propiedades declaradas", () => {
    const sinPropiedades = compilarEsquema({ type: "object", additionalProperties: false });
    const objeto = JSON.parse('{"__proto__": 1, "constructor": 2, "toString": 3}');
    expect(sinPropiedades(objeto)).toEqual([
      '"__proto__" no está permitido (no se aceptan propiedades)',
      '"constructor" no está permitido (no se aceptan propiedades)',
      '"toString" no está permitido (no se aceptan propiedades)',
    ]);
    expect(validar(JSON.parse('{"__proto__": {"clabe": "002010077777777771"}}'))).toEqual([
      'falta "clabe"',
      '"__proto__" no está permitido (se aceptan: "clabe", "anio", "moneda", "detalle")',
    ]);
  });

  it("recorta nombres de propiedad muy largos en los mensajes", () => {
    const nombre = "x".repeat(500);
    const [error] = compilarEsquema({ type: "object", additionalProperties: false })({
      [nombre]: 1,
    });
    expect(error).toBe(`"${"x".repeat(64)}…" no está permitido (no se aceptan propiedades)`);
  });

  it("no revisa reglas de otro tipo de valor", () => {
    const flexible = compilarEsquema({
      minLength: 2,
      maxLength: 3,
      pattern: "^a",
      minimum: 1,
      maximum: 2,
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
      items: { type: "string" },
    });
    expect(flexible(5)).toEqual(["el valor debe ser menor o igual a 2"]);
    expect(flexible("zzzz")).toEqual([
      "el valor debe tener como máximo 3 caracteres",
      "el valor no tiene el formato esperado (^a)",
    ]);
    expect(flexible(null)).toEqual([]);
  });

  it("additionalProperties true o ausente acepta propiedades extra", () => {
    expect(compilarEsquema({ type: "object", additionalProperties: true })({ a: 1 })).toEqual([]);
    expect(compilarEsquema({ type: "object" })({ a: 1 })).toEqual([]);
  });

  it("corta la lista de errores", () => {
    const muchos = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i]));
    const errores = compilarEsquema({ type: "object", additionalProperties: false })(muchos);
    expect(errores).toHaveLength(10);
    const conRequeridas = compilarEsquema({
      type: "object",
      additionalProperties: false,
      required: ["a"],
    })(muchos);
    expect(conRequeridas).toHaveLength(10);
    expect(conRequeridas).not.toContain('falta "a"');
  });
});

describe("compilarEsquema: listas y enum", () => {
  it("valida cada elemento con items", () => {
    const validar = compilarEsquema({ type: "array", items: { type: "integer" } });
    expect(validar([1, 2])).toEqual([]);
    expect(validar([1, "2", 3.5])).toEqual([
      '"[1]" debe ser un número entero',
      '"[2]" debe ser un número entero',
    ]);
  });

  it("anida la ruta de objetos dentro de listas", () => {
    const validar = compilarEsquema({
      type: "object",
      properties: {
        filas: {
          type: "array",
          items: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
        },
      },
    });
    expect(validar({ filas: [{ n: 1 }, {}] })).toEqual(['falta "filas[1].n"']);
  });

  it("enum compara con igualdad estricta y acepta null, números y booleanos", () => {
    const validar = compilarEsquema({ enum: [1, true, null, "a"] });
    expect(validar(1)).toEqual([]);
    expect(validar(null)).toEqual([]);
    expect(validar("1")).toEqual(['el valor debe ser uno de: 1, true, null, "a"']);
  });
});

describe("compilarEsquema: format, const, minItems y maxItems", () => {
  const fecha = compilarEsquema({ type: "string", format: "date" });
  const fechaHora = compilarEsquema({ type: "string", format: "date-time" });

  it.each(["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31", "2024-04-30"])(
    "date acepta %s",
    (valor) => {
      expect(fecha(valor)).toEqual([]);
    },
  );

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2024-13-01",
    "2024-00-10",
    "2024-04-31",
    "2024-01-00",
    "2024-1-01",
    "24-01-01",
    "2024-01-01T00:00:00Z",
    " 2024-01-01",
    "２０２４-01-01",
  ])("date rechaza %j", (valor) => {
    expect(fecha(valor)).toEqual(["el valor debe ser una fecha AAAA-MM-DD válida"]);
  });

  it.each([
    "2024-02-29T23:59:59Z",
    "2024-02-29t23:59:59z",
    "2024-01-01T00:00:00.123+05:30",
    "2024-01-01T12:00:00-06:00",
    "2024-01-01T12:00:00+23:59",
  ])("date-time acepta %s", (valor) => {
    expect(fechaHora(valor)).toEqual([]);
  });

  it.each([
    "2024-02-30T00:00:00Z",
    "2024-01-01T24:00:00Z",
    "2024-01-01T23:60:00Z",
    "2024-01-01T23:59:60Z",
    "2024-01-01T00:00:00",
    "2024-01-01 00:00:00Z",
    "2024-01-01T00:00:00+24:00",
    "2024-01-01T00:00:00+05:60",
    "2024-01-01T00:00:00.Z",
    "2024-01-01",
  ])("date-time rechaza %j", (valor) => {
    expect(fechaHora(valor)).toEqual(["el valor debe ser una fecha y hora RFC 3339 válida"]);
  });

  it("format solo revisa textos y usa la ruta en el mensaje", () => {
    const validar = compilarEsquema({
      type: "object",
      properties: { desde: { type: ["string", "null"], format: "date" } },
    });
    expect(validar({ desde: null })).toEqual([]);
    expect(validar({ desde: "2024-02-30" })).toEqual([
      '"desde" debe ser una fecha AAAA-MM-DD válida',
    ]);
  });

  it("const compara con igualdad estricta", () => {
    const validar = compilarEsquema({ const: "api" });
    expect(validar("api")).toEqual([]);
    expect(validar("paquete")).toEqual(['el valor debe ser "api"']);
    expect(compilarEsquema({ const: null })(0)).toEqual(["el valor debe ser null"]);
  });

  it("minItems y maxItems cuentan elementos de listas", () => {
    const validar = compilarEsquema({ type: "array", minItems: 1, maxItems: 2 });
    expect(validar([1])).toEqual([]);
    expect(validar([])).toEqual(["el valor debe tener al menos 1 elementos"]);
    expect(validar([1, 2, 3])).toEqual(["el valor debe tener como máximo 2 elementos"]);
    expect(compilarEsquema({ minItems: 1 })("texto")).toEqual([]);
  });
});

describe("compilarEsquema: esquemas no soportados", () => {
  it.each([
    [{ oneOf: [] }, "#: palabra clave no soportada: oneOf"],
    [{ $ref: "#/x" }, "#: palabra clave no soportada: $ref"],
    [{ type: "texto" }, "#/type: tipo desconocido: texto"],
    [{ type: [] }, "#/type: debe ser un tipo o una lista de tipos"],
    [{ type: 1 }, "#/type: debe ser un tipo o una lista de tipos"],
    [{ properties: [] }, "#/properties: debe ser un objeto"],
    [{ properties: { a: 1 } }, "#/properties/a: el esquema debe ser un objeto"],
    [{ properties: { a: { allOf: [] } } }, "#/properties/a: palabra clave no soportada: allOf"],
    [{ required: "a" }, "#/required: debe ser una lista de textos"],
    [{ required: [1] }, "#/required: debe ser una lista de textos"],
    [{ additionalProperties: {} }, "#/additionalProperties: solo se admite true o false"],
    [{ enum: [] }, "#/enum: debe ser una lista no vacía de textos, números, booleanos o null"],
    [{ enum: [{}] }, "#/enum: debe ser una lista no vacía de textos, números, booleanos o null"],
    [{ enum: "a" }, "#/enum: debe ser una lista no vacía de textos, números, booleanos o null"],
    [{ pattern: 1 }, "#/pattern: debe ser una expresión regular válida"],
    [{ pattern: "(" }, "#/pattern: debe ser una expresión regular válida"],
    [{ minLength: -1 }, "#/minLength: debe ser un entero mayor o igual a 0"],
    [{ maxLength: 1.5 }, "#/maxLength: debe ser un entero mayor o igual a 0"],
    [{ minimum: "1" }, "#/minimum: debe ser un número"],
    [{ maximum: Number.NaN }, "#/maximum: debe ser un número"],
    [{ items: [] }, "#/items: el esquema debe ser un objeto"],
    [{ format: "email" }, "#/format: solo se admiten date y date-time"],
    [{ format: 1 }, "#/format: solo se admiten date y date-time"],
    [{ format: "toString" }, "#/format: solo se admiten date y date-time"],
    [{ const: {} }, "#/const: debe ser texto, número, booleano o null"],
    [{ minItems: -1 }, "#/minItems: debe ser un entero mayor o igual a 0"],
    [{ maxItems: "2" }, "#/maxItems: debe ser un entero mayor o igual a 0"],
    [{ anyOf: [] }, "#: palabra clave no soportada: anyOf"],
    [{ not: {} }, "#: palabra clave no soportada: not"],
    [
      { $schema: "http://json-schema.org/draft-07/schema#" },
      "#/$schema: solo se admite https://json-schema.org/draft/2020-12/schema",
    ],
  ])("rechaza %j", (esquema, mensaje) => {
    expect(() => compilarEsquema(esquema)).toThrow(new EsquemaNoSoportadoError(mensaje));
  });

  it("rechaza un esquema que no es objeto", () => {
    expect(() => compilarEsquema(null)).toThrow("#: el esquema debe ser un objeto");
    expect(() => compilarEsquema(true)).toThrow(EsquemaNoSoportadoError);
  });

  it("acepta el dialecto 2020-12 explícito y las anotaciones", () => {
    const validar = compilarEsquema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $comment: "x",
      title: "t",
      description: "d",
      default: 1,
      examples: [1],
      deprecated: false,
      readOnly: true,
      writeOnly: false,
      type: "string",
    });
    expect(validar("lo que sea")).toEqual([]);
  });

  it("no lee propiedades heredadas del esquema", () => {
    const esquema = Object.create({ oneOf: [] }) as object;
    expect(compilarEsquema(esquema)("x")).toEqual([]);
  });
});
