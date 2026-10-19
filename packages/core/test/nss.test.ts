import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { digitoVerificadorNss, validarNss } from "../src/nss.js";
import { NOTAS_VALIDACION } from "../src/validacion.js";

describe("digitoVerificadorNss", () => {
  it("calcula el dígito verificador", () => {
    expect(digitoVerificadorNss("1234567890")).toBe("3");
    expect(digitoVerificadorNss("4800853112")).toBe("0");
  });
  it.each(["", "123456789", "12345678901", "123456789A", "１２３４５６７８９０"])(
    "lanza RangeError con %j",
    (entrada) => {
      expect(() => digitoVerificadorNss(entrada)).toThrow(RangeError);
    },
  );
});

describe("validarNss", () => {
  it.each(["12345678903", "48008531120"])("%s es válido", (nss) => {
    expect(validarNss(nss)).toEqual({
      valor: nss,
      valido: true,
      formato_valido: true,
      digito_verificador_valido: true,
      errores: [],
      nota: NOTAS_VALIDACION.nss,
      detalle: null,
    });
  });
  it("su nota nombra solo al IMSS", () => {
    expect(validarNss("12345678904").nota).toBe(NOTAS_VALIDACION.nss);
    expect(NOTAS_VALIDACION.nss).toContain("no confirma que el NSS exista ante el IMSS");
    expect(NOTAS_VALIDACION.nss).not.toMatch(/SAT|RENAPO|banco/);
  });
  it("dígito verificador incorrecto", () => {
    const r = validarNss("12345678904");
    expect(r.errores).toEqual(["digito_verificador"]);
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(false);
    expect(r.detalle).toBeNull();
  });
  it("acepta guiones y espacios", () => {
    const r = validarNss("1234-5678-903");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("12345678903");
  });
  it("vacío", () => {
    expect(validarNss(" - ").errores).toEqual(["vacio"]);
  });
  it.each(["1234567890", "123456789012"])("longitud: %s", (nss) => {
    expect(validarNss(nss).errores).toEqual(["longitud"]);
  });
  it.each(["1234567890A", "１２３４５６７８９０３"])("caracteres: %s", (nss) => {
    const r = validarNss(nss);
    expect(r.errores).toEqual(["caracteres"]);
    expect(r.formato_valido).toBe(false);
    expect(r.digito_verificador_valido).toBeNull();
  });
  it("nunca lanza y es consistente con el dígito", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => validarNss(s)).not.toThrow();
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{10}$/), (p) => {
        expect(validarNss(p + digitoVerificadorNss(p)).valido).toBe(true);
      }),
    );
  });
});
