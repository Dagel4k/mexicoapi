import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Banco, digitoControlClabe, type Plaza, validarClabe } from "../src/clabe.js";
import { NOTA_VALIDACION, normalizar } from "../src/validacion.js";

describe("normalizar", () => {
  it("quita espacios y guiones y pasa a mayúsculas", () => {
    expect(normalizar(" ab-c d\t")).toBe("ABCD");
  });
  it("no convierte dígitos de ancho completo", () => {
    expect(normalizar("１２")).toBe("１２");
  });
});

describe("digitoControlClabe", () => {
  it("calcula el dígito de control", () => {
    expect(digitoControlClabe("00218001234567890")).toBe("6");
  });
  it.each([
    "",
    "1234",
    "0021800123456789A",
    "002180012345678901",
    "０１２３４５６７８９０１２３４５６７",
  ])("lanza RangeError con %j", (entrada) => {
    expect(() => digitoControlClabe(entrada)).toThrow(RangeError);
  });
});

describe("validarClabe", () => {
  it.each(["002180012345678906", "012180001234567899", "721180000000000005"])(
    "acepta %s",
    (clabe) => {
      const r = validarClabe(clabe);
      expect(r.valido).toBe(true);
      expect(r.formato_valido).toBe(true);
      expect(r.digito_verificador_valido).toBe(true);
      expect(r.errores).toEqual([]);
      expect(r.nota).toBe(NOTA_VALIDACION);
      expect(r.detalle).toMatchObject({
        codigo_banco: clabe.slice(0, 3),
        codigo_plaza: clabe.slice(3, 6),
        cuenta: clabe.slice(6, 17),
        digito_control: clabe.slice(17),
      });
    },
  );

  it("normaliza espacios", () => {
    const r = validarClabe("002 180 01234567890 6");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("002180012345678906");
  });

  it("detecta dígito de control incorrecto", () => {
    const r = validarClabe("002180012345678907");
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(false);
    expect(r.valido).toBe(false);
    expect(r.errores).toEqual(["digito_verificador"]);
    expect(r.detalle).not.toBeNull();
  });

  it("rechaza longitud incorrecta", () => {
    const r = validarClabe("00218001234567890");
    expect(r.errores).toEqual(["longitud"]);
    expect(r.formato_valido).toBe(false);
    expect(r.digito_verificador_valido).toBeNull();
    expect(r.detalle).toBeNull();
    expect(r.valido).toBe(false);
  });

  it.each(["00218001234567890A", "００２１８００１２３４５６７８９０６"])(
    "rechaza caracteres no válidos: %s",
    (clabe) => {
      expect(validarClabe(clabe).errores).toEqual(["caracteres"]);
    },
  );

  it.each(["", "   ", "-"])("rechaza vacío: %j", (clabe) => {
    const r = validarClabe(clabe);
    expect(r.errores).toEqual(["vacio"]);
    expect(r.valor).toBe("");
  });

  it("resuelve banco y plaza con catálogos", () => {
    const bancos = new Map<string, Banco>([["002", { codigo: "002", nombre_corto: "BANAMEX" }]]);
    const plazas = new Map<string, Plaza>([
      ["180", { codigo: "180", plaza: "Ciudad de México", estado: "CDMX" }],
    ]);
    const r = validarClabe("002180012345678906", { bancos, plazas });
    expect(r.detalle?.banco?.nombre_corto).toBe("BANAMEX");
    expect(r.detalle?.plaza?.estado).toBe("CDMX");
  });

  it("devuelve copias de banco y plaza, no los objetos del catálogo", () => {
    const bancos = new Map<string, Banco>([["002", { codigo: "002", nombre_corto: "BANAMEX" }]]);
    const plazas = new Map<string, Plaza>([
      ["180", { codigo: "180", plaza: "Ciudad de México", estado: "CDMX" }],
    ]);
    const r = validarClabe("002180012345678906", { bancos, plazas });
    const banco = r.detalle?.banco;
    const plaza = r.detalle?.plaza;
    expect(banco).toEqual({ codigo: "002", nombre_corto: "BANAMEX" });
    expect(plaza).toEqual({ codigo: "180", plaza: "Ciudad de México", estado: "CDMX" });
    if (banco) banco.nombre_corto = "ALTERADO";
    if (plaza) plaza.estado = "ALTERADO";
    expect(bancos.get("002")?.nombre_corto).toBe("BANAMEX");
    expect(plazas.get("180")?.estado).toBe("CDMX");
  });

  it("devuelve banco y plaza null sin catálogo", () => {
    const r = validarClabe("002180012345678906");
    expect(r.detalle?.banco).toBeNull();
    expect(r.detalle?.plaza).toBeNull();
  });

  describe("con catálogo de bancos", () => {
    const bancos = new Map<string, Banco>([
      ["002", { codigo: "002", nombre_corto: "BANAMEX" }],
      ["012", { codigo: "012", nombre_corto: "BBVA MEXICO" }],
    ]);

    it("da error banco si el código no está en el catálogo", () => {
      const r = validarClabe("721180000000000005", { bancos });
      expect(r.errores).toEqual(["banco"]);
      expect(r.valido).toBe(false);
      expect(r.formato_valido).toBe(false);
      expect(r.digito_verificador_valido).toBeNull();
      expect(r.detalle).toBeNull();
      expect(r.valor).toBe("721180000000000005");
    });

    it("sin catálogo la misma CLABE es válida", () => {
      expect(validarClabe("721180000000000005").valido).toBe(true);
    });

    it("revisa el banco después de la longitud y antes del dígito", () => {
      expect(validarClabe("72118000000000000", { bancos }).errores).toEqual(["longitud"]);
      expect(validarClabe("721180000000000006", { bancos }).errores).toEqual(["banco"]);
    });

    it("con plaza desconocida sigue siendo válida y plaza es null", () => {
      const r = validarClabe("012180001234567899", { bancos, plazas: new Map() });
      expect(r.valido).toBe(true);
      expect(r.detalle?.banco?.nombre_corto).toBe("BBVA MEXICO");
      expect(r.detalle?.plaza).toBeNull();
    });

    it("un catálogo vacío no reconoce ningún banco", () => {
      expect(validarClabe("012180001234567899", { bancos: new Map() }).errores).toEqual(["banco"]);
    });
  });

  it("propiedad: el dígito calculado siempre valida y otro dígito no", () => {
    const digitos17 = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 17, maxLength: 17 })
      .map((a) => a.join(""));
    fc.assert(
      fc.property(digitos17, fc.integer({ min: 1, max: 9 }), (p, delta) => {
        const c = digitoControlClabe(p);
        expect(validarClabe(p + c).valido).toBe(true);
        const otro = String((Number(c) + delta) % 10);
        const r = validarClabe(p + otro);
        expect(r.digito_verificador_valido).toBe(false);
        expect(r.valido).toBe(false);
      }),
    );
  });
});
