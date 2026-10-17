import { describe, expect, it } from "vitest";
import { aNfc, jsonCanonico, limpiarTexto, ordenarPorClave, sha256Hex } from "../src/canonico.js";
import { ErrorDatos } from "../src/errores.js";

describe("limpiarTexto", () => {
  it("normaliza a NFC y recorta", () => {
    const r = limpiarTexto("  Culia\u0301can  ");
    expect(r).toBe("Culiácan");
    expect(r.length).toBe("Culiacán".normalize("NFC").length);
  });

  it("colapsa espacios, NBSP, tabs y saltos", () => {
    expect(limpiarTexto("A  B")).toBe("A B");
    expect(limpiarTexto("A\u00a0\u00a0B\t\nC")).toBe("A B C");
  });
});

describe("aNfc", () => {
  it("normaliza strings anidados sin mutar la entrada", () => {
    const entrada = { a: "e\u0301", b: ["e\u0301", { c: "e\u0301" }], n: 1, v: null, ok: true };
    const copia = JSON.parse(JSON.stringify(entrada));
    const r = aNfc(entrada);
    expect(r).toEqual({ a: "é", b: ["é", { c: "é" }], n: 1, v: null, ok: true });
    expect(entrada).toEqual(copia);
    expect(r).not.toBe(entrada);
  });
});

describe("jsonCanonico", () => {
  it("usa 2 espacios y salto final, conservando el orden de llaves", () => {
    expect(jsonCanonico([{ b: 1, a: 2 }])).toBe('[\n  {\n    "b": 1,\n    "a": 2\n  }\n]\n');
  });
});

describe("sha256Hex", () => {
  it("calcula el hash de strings y bytes", () => {
    const esperado = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256Hex("abc")).toBe(esperado);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(esperado);
  });
});

describe("ordenarPorClave", () => {
  it("ordena por unidad de código y es estable", () => {
    const datos = [
      { k: "b", n: 1 },
      { k: "B", n: 2 },
      { k: "a", n: 3 },
      { k: "b", n: 4 },
    ];
    const r = ordenarPorClave(datos, (x) => x.k);
    expect(r.map((x) => x.n)).toEqual([2, 3, 1, 4]);
    expect(datos[0]?.n).toBe(1);
  });
});

describe("ErrorDatos", () => {
  it("guarda el dataset", () => {
    const e = new ErrorDatos("mal", "bancos");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorDatos");
    expect(e.dataset).toBe("bancos");
    expect(new ErrorDatos("x").dataset).toBeNull();
  });
});
