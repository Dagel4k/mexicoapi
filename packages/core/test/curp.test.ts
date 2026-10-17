import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { digitoVerificadorCurp, ENTIDADES_CURP, validarCurp } from "../src/curp.js";
import { NOTA_VALIDACION } from "../src/validacion.js";

const conDigito = (primeros17: string): string => primeros17 + digitoVerificadorCurp(primeros17);

describe("digitoVerificadorCurp", () => {
  // Tabla: 0-9 = 0..9, A..N = 10..23, & = 24, O..Z = 25..36 (el & desplaza desde la O).
  // BOXW310820HNERXN0 con pesos 18..2:
  //   B11*18=198  O25*17=425  X34*16=544  W33*15=495  3*14=42  1*13=13
  //   0*12=0  8*11=88  2*10=20  0*9=0  H17*8=136  N23*7=161
  //   E14*6=84  R28*5=140  X34*4=136  N23*3=69  0*2=0
  //   suma = 2551; 2551 mod 10 = 1; (10 - 1) mod 10 = 9.
  it("calcula el dígito considerando el desplazamiento del &", () => {
    expect(digitoVerificadorCurp("BOXW310820HNERXN0")).toBe("9");
  });
  it.each([
    "",
    "BOXW310820HNERXN",
    "BOXW310820HNERXN09",
    "boxw310820hnerxn0",
    "BOXW310820HNERXÑ0",
    "BOXW310820HNERXN&",
  ])("lanza RangeError con %j", (entrada) => {
    expect(() => digitoVerificadorCurp(entrada)).toThrow(RangeError);
  });
});

describe("ENTIDADES_CURP", () => {
  it("tiene las 33 claves oficiales", () => {
    const esperadas =
      "AS BC BS CC CL CM CS CH DF DG GT GR HG JC MC MN MS NT NL OC PL QT QR SP SL SR TC TS TL VZ YN ZS NE".split(
        " ",
      );
    expect([...ENTIDADES_CURP.keys()].sort()).toEqual([...esperadas].sort());
    expect(ENTIDADES_CURP.size).toBe(33);
  });
  it("mutar la copia exportada no cambia la validación", () => {
    const copia = ENTIDADES_CURP as Map<string, string>;
    copia.set("ZZ", "Inventada");
    copia.delete("NE");
    try {
      expect(validarCurp("BOXW310820HZZRXN09").errores).toEqual(["entidad"]);
      expect(validarCurp("BOXW310820HNERXN09").detalle?.nombre_entidad).toBe(
        "Nacido en el extranjero",
      );
    } finally {
      copia.delete("ZZ");
      copia.set("NE", "Nacido en el extranjero");
    }
  });
  it("usa los nombres acordados", () => {
    expect(ENTIDADES_CURP.get("DF")).toBe("Ciudad de México");
    expect(ENTIDADES_CURP.get("MC")).toBe("Estado de México");
    expect(ENTIDADES_CURP.get("MN")).toBe("Michoacán");
    expect(ENTIDADES_CURP.get("CL")).toBe("Coahuila");
    expect(ENTIDADES_CURP.get("VZ")).toBe("Veracruz");
    expect(ENTIDADES_CURP.get("NE")).toBe("Nacido en el extranjero");
  });
});

describe("validarCurp", () => {
  it("acepta una CURP válida y devuelve el detalle", () => {
    const r = validarCurp("BOXW310820HNERXN09");
    expect(r.valido).toBe(true);
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(true);
    expect(r.errores).toEqual([]);
    expect(r.nota).toBe(NOTA_VALIDACION);
    expect(r.detalle).toEqual({
      fecha: "1931-08-20",
      sexo: "H",
      entidad: "NE",
      nombre_entidad: "Nacido en el extranjero",
      diferenciador: "0",
    });
  });
  it("acepta minúsculas, espacios y guiones", () => {
    const r = validarCurp("boxw310820 hnerxn0-9");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("BOXW310820HNERXN09");
  });
  it("rechaza un dígito verificador incorrecto", () => {
    const r = validarCurp("BOXW310820HNERXN08");
    expect(r.errores).toEqual(["digito_verificador"]);
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(false);
    expect(r.detalle).not.toBeNull();
  });
  it("rechaza una entidad desconocida", () => {
    expect(validarCurp("BOXW310820HZZRXN09").errores).toEqual(["entidad"]);
  });
  it("rechaza una fecha inexistente", () => {
    const r = validarCurp(conDigito("BOXW230229HNERXN0"));
    expect(r.errores).toEqual(["fecha"]);
    expect(r.detalle).toBeNull();
  });
  it("revisa la fecha antes que la entidad", () => {
    const r = validarCurp(conDigito("BOXW230229HZZRXN0"));
    expect(r.errores).toEqual(["fecha"]);
    expect(r.detalle).toBeNull();
  });
  it("usa el siglo 20YY con diferenciador de letra", () => {
    const r = validarCurp(conDigito("BOXW000229HNERXNA"));
    expect(r.valido).toBe(true);
    expect(r.detalle?.fecha).toBe("2000-02-29");
    expect(r.detalle?.diferenciador).toBe("A");
  });
  it("con diferenciador de dígito, 00-02-29 cae en 1900 y no existe", () => {
    expect(validarCurp(conDigito("BOXW000229HNERXN0")).errores).toEqual(["fecha"]);
  });
  it("acepta sexo M y X y resuelve el nombre de la entidad", () => {
    const m = validarCurp(conDigito("BOXW310820MDFRXN0"));
    expect(m.detalle).toMatchObject({
      sexo: "M",
      entidad: "DF",
      nombre_entidad: "Ciudad de México",
    });
    expect(validarCurp(conDigito("BOXW310820XDFRXN0")).detalle?.sexo).toBe("X");
  });
  it.each([
    ["", "vacio"],
    ["BOXW310820HNERXÑ09", "caracteres"],
    ["BOXW310820HNERXN0!", "caracteres"],
    ["BOXW310820HNERXN0", "longitud"],
    ["BOXW310820HNERXN099", "longitud"],
    ["BBXW310820HNERXN09", "estructura"],
    ["BOXW310820QNERXN09", "estructura"],
    ["BOXW310820HNEAXN09", "estructura"],
    ["BOXW31082OHNERXN09", "estructura"],
  ])("%j da %s", (entrada, error) => {
    const r = validarCurp(entrada);
    expect(r.errores).toEqual([error]);
    expect(r.valido).toBe(false);
    expect(r.formato_valido).toBe(false);
    expect(r.digito_verificador_valido).toBeNull();
  });
  it("no lanza con cadenas arbitrarias", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = validarCurp(s);
        expect(r.errores.length).toBeLessThanOrEqual(1);
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const r = validarCurp(s);
        expect(r.errores.length).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("validarCurp: look-alikes Unicode", () => {
  it.each(["ſ", "ı", "ß"])("rechaza %j como caracteres", (c) => {
    expect(validarCurp(`${c}OXW310820HNERXN09`).errores).toEqual(["caracteres"]);
  });
});
