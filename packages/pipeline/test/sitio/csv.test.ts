import { describe, expect, it } from "vitest";
import { ErrorDatos } from "../../src/errores.js";
import { aCsv } from "../../src/sitio/csv.js";

describe("aCsv", () => {
  it("escribe encabezado, renglones y \r\n también al final", () => {
    expect(
      aCsv(
        ["a", "b"],
        [
          { a: "x", b: "y" },
          { a: "z", b: "w" },
        ],
      ),
    ).toBe("a,b\r\nx,y\r\nz,w\r\n");
  });

  it("solo con encabezado cuando no hay filas", () => {
    expect(aCsv(["a"], [])).toBe("a\r\n");
  });

  it("entrecomilla por coma, comilla, saltos y espacios en los bordes", () => {
    const filas = [
      { a: "uno, dos", b: 'di "hola"' },
      { a: "línea\nnueva", b: "retorno\rcarro" },
      { a: " inicio", b: "fin " },
    ];
    expect(aCsv(["a", "b"], filas)).toBe(
      'a,b\r\n"uno, dos","di ""hola"""\r\n"línea\nnueva","retorno\rcarro"\r\n" inicio","fin "\r\n',
    );
  });

  it("deja espacios internos sin comillas", () => {
    expect(aCsv(["a"], [{ a: "San Luis" }])).toBe("a\r\nSan Luis\r\n");
  });

  it("escribe null como campo vacío, booleanos y números", () => {
    expect(aCsv(["a", "b", "c", "d"], [{ a: null, b: true, c: false, d: 7 }])).toBe(
      "a,b,c,d\r\n,true,false,7\r\n",
    );
  });

  it("trata un campo ausente como vacío", () => {
    expect(aCsv(["a", "b"], [{ a: "x" }])).toBe("a,b\r\nx,\r\n");
  });

  it.each(["=SUMA(1)", "+52", "-x", "@a", "\tx", "\rx", "\nx", "＝SUMA(1)", "＋52", "－x", "＠a"])(
    "rechaza %j",
    (valor) => {
      expect(() => aCsv(["a"], [{ a: valor }])).toThrow(ErrorDatos);
    },
  );

  it("acepta esos caracteres fuera del inicio", () => {
    expect(aCsv(["a"], [{ a: "x=+-@＝＋－＠" }])).toBe("a\r\nx=+-@＝＋－＠\r\n");
  });
});
