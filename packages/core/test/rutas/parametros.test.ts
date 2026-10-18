import { describe, expect, it } from "vitest";
import * as core from "../../src/index.js";
import { revisarFix, revisarTipoPlazo } from "../../src/rutas/combinaciones.js";
import { cumpleRegla, REGLAS_RUTA, type ReglaParametro } from "../../src/rutas/parametros.js";

describe("cumpleRegla", () => {
  const regla: ReglaParametro = {
    patron: /^\d+$/,
    cumple: (v) => Number(v) <= 10,
    detalle: "n va de 0 a 10.",
  };

  it("exige el patrón y la comprobación extra", () => {
    expect(cumpleRegla(regla, "10")).toBe(true);
    expect(cumpleRegla(regla, "11")).toBe(false);
    expect(cumpleRegla(regla, "x")).toBe(false);
    expect(cumpleRegla({ patron: /^a$/, detalle: "a" }, "a")).toBe(true);
  });
});

describe("REGLAS_RUTA", () => {
  const casos: [keyof typeof REGLAS_RUTA, string[], string[], string][] = [
    [
      "cve_ent",
      ["01", "32"],
      ["1", "001", "aa", "０１"],
      "La clave de estado (cve_ent) debe tener 2 dígitos.",
    ],
    [
      "cvegeo",
      ["25006"],
      ["2500", "250066", "2500a"],
      "La clave de municipio (cvegeo) debe tener 5 dígitos.",
    ],
    ["codigo", ["002"], ["02", "0002", "00a"], "El código de banco debe tener 3 dígitos."],
    [
      "clabe",
      ["002010077777777771"],
      ["00201007777777777", "00201007777777777a"],
      "La CLABE debe tener 18 dígitos.",
    ],
    [
      "anio",
      ["0001", "2026", "9999"],
      ["0000", "26", "20266", "２０２６"],
      "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
    ],
    [
      "periodo",
      ["mensual", "anual"],
      ["semanal", "Mensual", ""],
      "El periodo de la tarifa debe ser mensual o anual.",
    ],
  ];

  it.each(casos)(
    "%s acepta lo que pide la API y rechaza lo demás",
    (nombre, buenos, malos, detalle) => {
      const regla = REGLAS_RUTA[nombre];
      for (const v of buenos) expect(cumpleRegla(regla, v), v).toBe(true);
      for (const v of malos) expect(cumpleRegla(regla, v), v).toBe(false);
      expect(regla.detalle).toBe(detalle);
    },
  );

  it("cada patrón está anclado y sin banderas, y la tabla no se puede alterar", () => {
    expect(Object.keys(REGLAS_RUTA).sort()).toEqual(casos.map(([n]) => n).sort());
    for (const regla of Object.values(REGLAS_RUTA)) {
      expect(regla.patron.source).toMatch(/^\^.*\$$/);
      expect(regla.patron.flags).toBe("");
      expect(Object.isFrozen(regla)).toBe(true);
    }
    expect(Object.isFrozen(REGLAS_RUTA)).toBe(true);
  });

  it("una regla con valores los acepta exactamente, como el enum del OpenAPI", () => {
    expect(REGLAS_RUTA.periodo.valores).toEqual(["mensual", "anual"]);
  });
});

describe("revisarTipoPlazo", () => {
  it("con el SAT el tipo de plazo es obligatorio", () => {
    expect(revisarTipoPlazo("sat", undefined)).toEqual({
      tipo: "parametro-faltante",
      detalle: "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
      extras: { parametro: "tipo_plazo" },
    });
    expect(revisarTipoPlazo("sat", "general")).toBeNull();
    expect(revisarTipoPlazo("sat", "declaraciones_pagos")).toBeNull();
  });

  it("con las demás autoridades no se acepta", () => {
    for (const autoridad of ["lft", "cnbv"] as const) {
      expect(revisarTipoPlazo(autoridad, "general")).toEqual({
        tipo: "parametro-invalido",
        detalle: "El parámetro tipo_plazo solo se acepta con autoridad=sat.",
        extras: { parametro: "tipo_plazo" },
      });
      expect(revisarTipoPlazo(autoridad, undefined)).toBeNull();
    }
  });

  it("nombra la autoridad y el tipo de plazo como cada superficie", () => {
    const cli = { autoridad: (a: string) => `--autoridad ${a}`, tipoPlazo: "--tipo-plazo" };
    expect(revisarTipoPlazo("sat", undefined, cli)?.detalle).toBe(
      "Con --autoridad sat falta --tipo-plazo: general o declaraciones_pagos.",
    );
    expect(revisarTipoPlazo("lft", "general", cli)?.detalle).toBe(
      "--tipo-plazo solo se acepta con --autoridad sat.",
    );
    const sdk = { autoridad: (a: string) => `autoridad=${a}`, tipoPlazo: "tipoPlazo" };
    expect(revisarTipoPlazo("sat", undefined, sdk)?.detalle).toBe(
      "Con autoridad=sat falta tipoPlazo: general o declaraciones_pagos.",
    );
  });
});

describe("revisarFix", () => {
  it("pide exactamente uno de publicado u operacion", () => {
    expect(revisarFix("2026-10-12", undefined)).toBeNull();
    expect(revisarFix(undefined, "2026-10-13")).toBeNull();
    expect(revisarFix("2026-10-12", "2026-10-13")).toEqual({
      tipo: "parametro-invalido",
      detalle: "Indica solo uno de publicado u operacion.",
    });
    expect(revisarFix(undefined, undefined)).toEqual({
      tipo: "parametro-faltante",
      detalle: "Indica publicado u operacion.",
    });
  });
});

describe("índice del núcleo", () => {
  it("exporta las reglas que el MCP y la CLI toman de mexicoapi", () => {
    expect(core.revisarTipoPlazo).toBe(revisarTipoPlazo);
    expect(core.revisarFix).toBe(revisarFix);
  });
});
