import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { digitoVerificadorRfc, RFC_GENERICOS, validarRfc } from "../src/rfc.js";
import { NOTAS_VALIDACION } from "../src/validacion.js";

describe("validarRfc", () => {
  it("acepta una persona física válida", () => {
    const r = validarRfc("GODE561231GR8");
    expect(r.valido).toBe(true);
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(true);
    expect(r.errores).toEqual([]);
    expect(r.nota).toBe(NOTAS_VALIDACION.rfc);
    expect(r.detalle).toEqual({ tipo: "fisica", fecha_yymmdd: "561231", homoclave: "GR8" });
  });

  it("su nota nombra solo al SAT y dice que el dígito es informativo", () => {
    expect(NOTAS_VALIDACION.rfc).toContain("no confirma que el RFC exista ante el SAT");
    expect(NOTAS_VALIDACION.rfc).toContain("informativo");
    expect(NOTAS_VALIDACION.rfc).not.toMatch(/RENAPO|IMSS|banco/);
  });

  it("acepta una persona moral válida", () => {
    const r = validarRfc("MAB9307148T4");
    expect(r.valido).toBe(true);
    expect(r.detalle).toEqual({ tipo: "moral", fecha_yymmdd: "930714", homoclave: "8T4" });
  });

  it("mutar la copia exportada de RFC_GENERICOS no cambia la validación", () => {
    const copia = RFC_GENERICOS as Set<string>;
    copia.add("GODE561231GR9");
    copia.delete("XAXX010101000");
    try {
      expect(validarRfc("GODE561231GR9").detalle?.tipo).toBe("fisica");
      expect(validarRfc("GODE561231GR9").digito_verificador_valido).toBe(false);
      expect(validarRfc("XAXX010101000").detalle?.tipo).toBe("generico");
    } finally {
      copia.delete("GODE561231GR9");
      copia.add("XAXX010101000");
    }
  });

  it("acepta los RFC genéricos", () => {
    expect(RFC_GENERICOS.has("XAXX010101000")).toBe(true);
    for (const g of ["XAXX010101000", "XEXX010101000"]) {
      const r = validarRfc(g);
      expect(r.valido).toBe(true);
      expect(r.formato_valido).toBe(true);
      expect(r.digito_verificador_valido).toBe(true);
      expect(r.detalle).toEqual({ tipo: "generico", fecha_yymmdd: "010101", homoclave: "000" });
    }
  });

  it("reporta un dígito verificador incorrecto sin invalidar el RFC", () => {
    const r = validarRfc("GODE561231GR9");
    expect(r.valido).toBe(true);
    expect(r.formato_valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(false);
    expect(r.errores).toEqual(["digito_verificador"]);
    expect(r.detalle?.tipo).toBe("fisica");
  });

  it("valido sigue a formato_valido", () => {
    const moral = validarRfc("MAB9307140T4");
    expect(moral.valido).toBe(true);
    expect(moral.digito_verificador_valido).toBe(false);
    const fecha = validarRfc("GODE560230GR8");
    expect(fecha.valido).toBe(false);
    expect(fecha.formato_valido).toBe(false);
    // Cualquier RFC con formato correcto es válido, coincida o no su dígito verificador.
    const fecha6 = fc
      .date({
        min: new Date(Date.UTC(1950, 0, 1)),
        max: new Date(Date.UTC(2049, 11, 31)),
        noInvalidDate: true,
      })
      .map((f) => f.toISOString().slice(2, 10).replace(/-/g, ""));
    const rfcConFormato = fc
      .tuple(fc.stringMatching(/^[A-Z&Ñ]{3,4}$/), fecha6, fc.stringMatching(/^[A-Z0-9]{2}[0-9A]$/))
      .map((partes) => partes.join(""));
    fc.assert(
      fc.property(rfcConFormato, (rfc) => {
        const r = validarRfc(rfc);
        expect(r.formato_valido).toBe(true);
        expect(r.valido).toBe(true);
      }),
    );
  });

  it("rechaza una fecha inexistente", () => {
    const r = validarRfc("GODE560230GR8");
    expect(r.errores).toEqual(["fecha"]);
    expect(r.formato_valido).toBe(false);
    expect(r.digito_verificador_valido).toBeNull();
    expect(r.detalle).toBeNull();
  });

  it("acepta 29 de febrero si es bisiesto en 19YY o 20YY", () => {
    // 000229 es válido solo como 2000; 010229 no es válido en ningún siglo
    expect(validarRfc("GODE000229GR8").errores).not.toContain("fecha");
    expect(validarRfc("GODE010229GR8").errores).toEqual(["fecha"]);
  });

  it("normaliza espacios, guiones y minúsculas", () => {
    const r = validarRfc(" gode-561231-gr8 ");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("GODE561231GR8");
  });

  it("rechaza vacío", () => {
    expect(validarRfc("  - ").errores).toEqual(["vacio"]);
  });

  it("rechaza caracteres fuera del alfabeto", () => {
    expect(validarRfc("GODЕ561231GR8").errores).toEqual(["caracteres"]); // Е cirílica
    expect(validarRfc("GODE5612@1GR8").errores).toEqual(["caracteres"]);
  });

  it("rechaza longitudes distintas de 12 o 13", () => {
    expect(validarRfc("GODE561231G").errores).toEqual(["longitud"]);
    expect(validarRfc("GODE561231GR88").errores).toEqual(["longitud"]);
  });

  it("rechaza estructura incorrecta", () => {
    expect(validarRfc("GODE561231GR").errores).toEqual(["estructura"]);
    expect(validarRfc("1ODE561231GR8").errores).toEqual(["estructura"]);
    expect(validarRfc("GODE561231GRB").errores).toEqual(["estructura"]);
  });

  it("acepta Ñ y & en la parte del nombre", () => {
    // Moral " ÑAB930714T1": Ñ=38, A=10, B=11, T=30, espacio=37; pesos 13..2
    // 37*13 + 38*12 + 10*11 + 11*10 + 9*9 + 3*8 + 0*7 + 7*6 + 1*5 + 4*4 + 30*3 + 1*2
    // = 481+456+110+110+81+24+0+42+5+16+90+2 = 1417; 1417 mod 11 = 9; 11-9 = 2
    const r = validarRfc("ñab930714t12");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("ÑAB930714T12");
    expect(r.detalle?.tipo).toBe("moral");
    expect(validarRfc("A&B930714T12").formato_valido).toBe(true);
  });

  it("acepta A&B930714T18", () => {
    // Moral " A&B930714T1": espacio=37, A=10, &=24, B=11, T=30; pesos 13..2
    // 37*13 + 10*12 + 24*11 + 11*10 + 9*9 + 3*8 + 0*7 + 7*6 + 1*5 + 4*4 + 30*3 + 1*2
    // = 481+120+264+110+81+24+0+42+5+16+90+2 = 1235; 1235 mod 11 = 3; 11-3 = 8
    expect(digitoVerificadorRfc("A&B930714T1")).toBe("8");
    const r = validarRfc("A&B930714T18");
    expect(r.valido).toBe(true);
    expect(r.digito_verificador_valido).toBe(true);
    expect(r.errores).toEqual([]);
    expect(r.detalle).toEqual({ tipo: "moral", fecha_yymmdd: "930714", homoclave: "T18" });
  });

  it("fija el & en el índice 24 de la tabla", () => {
    // En A&B el & lleva peso 11, así que su valor no cambia el residuo módulo 11.
    // En " &AB930714T1" lleva peso 12: 37*13 + 24*12 + 10*11 + 11*10 + 9*9 + 3*8
    // + 0*7 + 7*6 + 1*5 + 4*4 + 30*3 + 1*2 = 1249; 1249 mod 11 = 6; 11-6 = 5.
    // Con el & en 23 o 25 el dígito sería 6 o 4.
    expect(digitoVerificadorRfc("&AB930714T1")).toBe("5");
    expect(validarRfc("&AB930714T15").digito_verificador_valido).toBe(true);
  });

  it("compone la ñ descompuesta antes de validar", () => {
    const r = validarRfc("n\u0303ab930714t12");
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("ÑAB930714T12");
  });
});

describe("digitoVerificadorRfc", () => {
  it("calcula el dígito de física y moral", () => {
    expect(digitoVerificadorRfc("GODE561231GR")).toBe("8");
    expect(digitoVerificadorRfc("MAB9307148T")).toBe("4");
  });

  it("devuelve 0 y A en los casos extremos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 400 && vistos.size < 2; i++) {
      const d = digitoVerificadorRfc(`AAAA0101${String(i).padStart(2, "0")}AA`.slice(0, 12));
      if (d === "0" || d === "A") vistos.add(d);
    }
    expect(vistos).toEqual(new Set(["0", "A"]));
  });

  it("lanza RangeError con longitud o caracteres inválidos", () => {
    expect(() => digitoVerificadorRfc("ABC")).toThrow(RangeError);
    expect(() => digitoVerificadorRfc("GODE561231G!")).toThrow(RangeError);
    expect(() => digitoVerificadorRfc("gode561231gr")).toThrow(RangeError);
  });
});

describe("validarRfc: look-alikes Unicode", () => {
  it.each(["ſ", "ı", "ß"])("rechaza %j como caracteres", (c) => {
    expect(validarRfc(`GOD${c}561231GR8`).errores).toEqual(["caracteres"]);
  });
});
