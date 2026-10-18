import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  codigoClabe,
  interpretarCep,
  tipoBanco,
  urlCep,
} from "../../../src/datasets/bancos/cep.js";
import { ErrorDatos } from "../../../src/errores.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bancos");
const leer = (n: string) => new Uint8Array(readFileSync(join(dir, n)));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("interpretarCep", () => {
  it("lee el CEP real de 2026-10-17", () => {
    const e = interpretarCep(leer("cep-2026-10-17.json"));
    expect(e).toHaveLength(97);
    expect(e).toContainEqual(["40012", "BBVA MEXICO"]);
    expect(e).toContainEqual(["2001", "BANXICO"]);
  });

  it("rechaza respuestas sin instituciones", () => {
    expect(() => interpretarCep(leer("cep-sin-instituciones.json"))).toThrow(ErrorDatos);
    expect(() => interpretarCep(bytes("<html></html>"))).toThrow(ErrorDatos);
    expect(() => interpretarCep(bytes('{"instituciones":[]}'))).toThrow(ErrorDatos);
  });

  it("rechaza entradas mal formadas", () => {
    expect(() => interpretarCep(bytes('{"instituciones":[["40012"]]}'))).toThrow(ErrorDatos);
    expect(() => interpretarCep(bytes('{"instituciones":[["40012",5]]}'))).toThrow(ErrorDatos);
    expect(() => interpretarCep(bytes('{"instituciones":[["abc","X"]]}'))).toThrow(ErrorDatos);
    expect(() => interpretarCep(bytes('{"instituciones":[["40012","  "]]}'))).toThrow(ErrorDatos);
    expect(() => interpretarCep(new Uint8Array([0xff, 0xfe]))).toThrow(ErrorDatos);
  });

  it("limpia los nombres", () => {
    expect(interpretarCep(bytes('{"instituciones":[["40012","  BBVA   MEXICO "]]}'))).toEqual([
      ["40012", "BBVA MEXICO"],
    ]);
  });
});

describe("urlCep", () => {
  it("usa el formato DD-MM-AAAA", () => {
    expect(urlCep("2026-10-07")).toBe(
      "https://www.banxico.org.mx/cep/instituciones.do?fecha=07-10-2026",
    );
  });
});

describe("codigoClabe", () => {
  it("toma los últimos 3 dígitos", () => {
    expect(codigoClabe("40012")).toBe("012");
    expect(codigoClabe("2001")).toBe("001");
    expect(() => codigoClabe("12")).toThrow(RangeError);
    expect(() => codigoClabe("4001a")).toThrow(RangeError);
  });
});

describe("tipoBanco", () => {
  it("clasifica por prefijo", () => {
    expect(tipoBanco("40012")).toBe("banca_multiple");
    expect(tipoBanco("37006")).toBe("banca_desarrollo");
    expect(tipoBanco("90638")).toBe("otra_entidad");
    expect(tipoBanco("2001")).toBe("banco_central");
    expect(() => tipoBanco("50123")).toThrow(RangeError);
    expect(() => tipoBanco("2002")).toThrow(RangeError);
  });
});
