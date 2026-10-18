import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PeriodoBanco } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { type EntradaCep, interpretarCep } from "../../../src/datasets/bancos/cep.js";
import {
  extenderHistorial,
  historialesDesdeObservaciones,
  type Observacion,
  observacionesCompactas,
} from "../../../src/datasets/bancos/historial.js";
import { ErrorDatos } from "../../../src/errores.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bancos");
const cep = (n: string) => interpretarCep(new Uint8Array(readFileSync(join(dir, n))));
const observaciones: Observacion[] = [
  { fecha: "2012-01-03", entradas: cep("cep-2012-01-03.json") },
  { fecha: "2019-01-02", entradas: cep("cep-2019-01-02.json") },
  { fecha: "2026-10-17", entradas: cep("cep-2026-10-17.json") },
];
const p = (s: string, n: string, d: string, h: string): PeriodoBanco => ({
  codigo_spei: s,
  nombre_corto: n,
  visto_desde: d as PeriodoBanco["visto_desde"],
  visto_hasta: h as PeriodoBanco["visto_hasta"],
});

describe("historialesDesdeObservaciones con CEP reales", () => {
  const h = historialesDesdeObservaciones(observaciones);

  it("102: The Royal Bank pasa a Accendo", () => {
    expect(h.get("102")).toEqual([
      p("40102", "THE ROYAL BANK", "2012-01-03", "2012-01-03"),
      p("40102", "ACCENDO BANCO", "2019-01-02", "2019-01-02"),
    ]);
  });

  it("012: cambio de nombre", () => {
    expect(h.get("012")).toEqual([
      p("40012", "BBVA BANCOMER", "2012-01-03", "2019-01-02"),
      p("40012", "BBVA MEXICO", "2026-10-17", "2026-10-17"),
    ]);
  });

  it("638: cambia el código SPEI", () => {
    expect(h.get("638")).toEqual([
      p("90638", "AKALA", "2012-01-03", "2019-01-02"),
      p("40638", "NUBANK", "2026-10-17", "2026-10-17"),
    ]);
  });

  it("072: tres periodos", () => {
    expect(h.get("072")?.map((x) => x.nombre_corto)).toEqual(["BANORTE", "BANORTE/IXE", "BANORTE"]);
  });

  it("no depende del orden de entrada", () => {
    expect(historialesDesdeObservaciones([...observaciones].reverse())).toEqual(h);
  });

  it("rechaza un código de 3 dígitos repetido en una fecha", () => {
    const malo: Observacion = {
      fecha: "2020-01-01",
      entradas: [
        ["40012", "A"],
        ["90012", "B"],
      ],
    };
    expect(() => historialesDesdeObservaciones([malo])).toThrow(ErrorDatos);
  });
});

describe("extenderHistorial", () => {
  const e: EntradaCep = ["40012", "BBVA"];

  it("extiende visto_hasta con la misma entrada", () => {
    const base = [p("40012", "BBVA", "2020-01-01", "2020-01-01")];
    const r = extenderHistorial(base, "2021-01-01", e);
    expect(r).toEqual([p("40012", "BBVA", "2020-01-01", "2021-01-01")]);
    expect(base[0]?.visto_hasta).toBe("2020-01-01");
  });

  it("abre un periodo si cambia el nombre", () => {
    const base = [p("40012", "OTRO", "2020-01-01", "2020-01-01")];
    const r = extenderHistorial(base, "2021-01-01", e);
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual(p("40012", "BBVA", "2021-01-01", "2021-01-01"));
    expect(base).toHaveLength(1);
  });

  it("empieza desde un historial vacío", () => {
    expect(extenderHistorial([], "2021-01-01", e)).toEqual([
      p("40012", "BBVA", "2021-01-01", "2021-01-01"),
    ]);
  });

  it("no retrocede en el tiempo", () => {
    const base = [p("40012", "BBVA", "2020-01-01", "2021-01-01")];
    expect(() => extenderHistorial(base, "2020-06-01", e)).toThrow(RangeError);
  });

  it("la misma entrada el mismo día no cambia nada", () => {
    const base = [p("40012", "BBVA", "2020-01-01", "2021-01-01")];
    expect(extenderHistorial(base, "2021-01-01", e)).toEqual(base);
  });

  it("otra entrada el mismo día abre un periodo y deja intacto el anterior", () => {
    const base = [p("40012", "OTRO", "2020-01-01", "2021-01-01")];
    const r = extenderHistorial(base, "2021-01-01", e);
    expect(r).toEqual([
      p("40012", "OTRO", "2020-01-01", "2021-01-01"),
      p("40012", "BBVA", "2021-01-01", "2021-01-01"),
    ]);
  });
});

describe("historialesDesdeObservaciones, casos de borde", () => {
  it("dos observaciones del mismo día conservan su orden de entrada", () => {
    const h = historialesDesdeObservaciones([
      { fecha: "2020-01-01", entradas: [["40012", "A"]] },
      { fecha: "2020-01-01", entradas: [["40012", "B"]] },
    ]);
    expect(h.get("012")).toEqual([
      p("40012", "A", "2020-01-01", "2020-01-01"),
      p("40012", "B", "2020-01-01", "2020-01-01"),
    ]);
  });

  it("un código que desaparece y vuelve con el mismo nombre es un solo periodo", () => {
    const h = historialesDesdeObservaciones([
      { fecha: "2020-01-01", entradas: [["40012", "A"]] },
      { fecha: "2020-02-01", entradas: [["40014", "X"]] },
      { fecha: "2020-03-01", entradas: [["40012", "A"]] },
    ]);
    expect(h.get("012")).toEqual([p("40012", "A", "2020-01-01", "2020-03-01")]);
  });
});

describe("observacionesCompactas", () => {
  const A: EntradaCep[] = [
    ["40012", "A"],
    ["40014", "B"],
  ];
  const Ar: EntradaCep[] = [...A].reverse();
  const B: EntradaCep[] = [["40012", "C"]];
  const o = (fecha: string, entradas: EntradaCep[]) => ({ fecha, entradas }) as Observacion;

  it("conserva primera, cambio y última", () => {
    const entrada = [
      o("2020-01-01", A),
      o("2020-01-02", A),
      o("2020-01-03", B),
      o("2020-01-04", B),
      o("2020-01-05", B),
    ];
    const r = observacionesCompactas(entrada);
    expect(r.map((x) => x.fecha)).toEqual(["2020-01-01", "2020-01-03", "2020-01-05"]);
    expect(entrada).toHaveLength(5);
  });

  it("ignora el orden de las entradas y de las fechas", () => {
    const r = observacionesCompactas([o("2020-01-03", A), o("2020-01-01", Ar), o("2020-01-02", A)]);
    expect(r.map((x) => x.fecha)).toEqual(["2020-01-01", "2020-01-03"]);
  });

  it("conserva un cambio que vuelve al estado anterior", () => {
    const r = observacionesCompactas([o("2020-01-01", A), o("2020-01-02", B), o("2020-01-03", A)]);
    expect(r.map((x) => x.fecha)).toEqual(["2020-01-01", "2020-01-02", "2020-01-03"]);
  });

  it("maneja listas vacías y de un elemento", () => {
    expect(observacionesCompactas([])).toEqual([]);
    expect(observacionesCompactas([o("2020-01-01", A)])).toHaveLength(1);
  });
});
