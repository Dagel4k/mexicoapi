import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PeriodoBanco } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { type EntradaCep, interpretarCep } from "../../../src/datasets/bancos/cep.js";
import {
  actualizarHistorial,
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
const p = (s: string, n: string, d: string, h: string | null): PeriodoBanco => ({
  codigo_spei: s,
  nombre_corto: n,
  desde: d,
  hasta: h,
});

describe("historialesDesdeObservaciones con CEP reales", () => {
  const h = historialesDesdeObservaciones(observaciones);

  it("102: The Royal Bank pasa a Accendo y desaparece en 2026", () => {
    expect(h.get("102")).toEqual([
      p("40102", "THE ROYAL BANK", "2012-01-03", "2019-01-02"),
      p("40102", "ACCENDO BANCO", "2019-01-02", "2026-10-17"),
    ]);
  });

  it("012: cambio de nombre", () => {
    expect(h.get("012")).toEqual([
      p("40012", "BBVA BANCOMER", "2012-01-03", "2026-10-17"),
      p("40012", "BBVA MEXICO", "2026-10-17", null),
    ]);
  });

  it("638: cambia el código SPEI", () => {
    expect(h.get("638")).toEqual([
      p("90638", "AKALA", "2012-01-03", "2026-10-17"),
      p("40638", "NUBANK", "2026-10-17", null),
    ]);
  });

  it("072: tres periodos", () => {
    expect(h.get("072")).toEqual([
      p("40072", "BANORTE", "2012-01-03", "2019-01-02"),
      p("40072", "BANORTE/IXE", "2019-01-02", "2026-10-17"),
      p("40072", "BANORTE", "2026-10-17", null),
    ]);
  });

  it("134: WAL-MART desaparece en 2019", () => {
    expect(h.get("134")).toEqual([p("40134", "WAL-MART", "2012-01-03", "2019-01-02")]);
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

describe("actualizarHistorial", () => {
  const e: EntradaCep = ["40012", "BBVA"];

  it("1: sin entrada cierra el periodo abierto; si no, no cambia", () => {
    const base = [p("40012", "BBVA", "2020-01-01", null)];
    expect(actualizarHistorial(base, "2021-01-01", null)).toEqual([
      p("40012", "BBVA", "2020-01-01", "2021-01-01"),
    ]);
    expect(base[0]?.hasta).toBeNull();
    const cerrado = [p("40012", "BBVA", "2020-01-01", "2021-01-01")];
    expect(actualizarHistorial(cerrado, "2022-01-01", null)).toEqual(cerrado);
    expect(actualizarHistorial([], "2022-01-01", null)).toEqual([]);
  });

  it("1: sin entrada el mismo día en que se abrió descarta el periodo vacío", () => {
    const base = [p("40012", "BBVA", "2021-01-01", null)];
    expect(actualizarHistorial(base, "2021-01-01", null)).toEqual([]);
  });

  it("2: el mismo par que el abierto no cambia nada", () => {
    const base = [p("40012", "BBVA", "2020-01-01", null)];
    expect(actualizarHistorial(base, "2025-05-05", e)).toEqual(base);
  });

  it("3: otro par cierra el abierto y abre uno nuevo", () => {
    const base = [p("40012", "OTRO", "2020-01-01", null)];
    expect(actualizarHistorial(base, "2021-01-01", e)).toEqual([
      p("40012", "OTRO", "2020-01-01", "2021-01-01"),
      p("40012", "BBVA", "2021-01-01", null),
    ]);
    expect(base).toEqual([p("40012", "OTRO", "2020-01-01", null)]);
  });

  it("3: si el abierto nació ese mismo día, se reemplaza", () => {
    const base = [p("40012", "OTRO", "2021-01-01", null)];
    expect(actualizarHistorial(base, "2021-01-01", e)).toEqual([
      p("40012", "BBVA", "2021-01-01", null),
    ]);
  });

  it("4: sin historial abre un periodo", () => {
    expect(actualizarHistorial([], "2021-01-01", e)).toEqual([
      p("40012", "BBVA", "2021-01-01", null),
    ]);
  });

  it("4: tras una ausencia real abre un periodo nuevo", () => {
    const base = [p("40012", "BBVA", "2020-01-01", "2020-06-01")];
    expect(actualizarHistorial(base, "2021-01-01", e)).toEqual([
      p("40012", "BBVA", "2020-01-01", "2020-06-01"),
      p("40012", "BBVA", "2021-01-01", null),
    ]);
  });

  it("4: cerrado ese mismo día con el mismo par, se reabre", () => {
    const base = [p("40012", "BBVA", "2020-01-01", "2021-01-01")];
    expect(actualizarHistorial(base, "2021-01-01", e)).toEqual([
      p("40012", "BBVA", "2020-01-01", null),
    ]);
  });

  it("4: cerrado ese día con otro par, abre uno nuevo", () => {
    const base = [p("40012", "OTRO", "2020-01-01", "2021-01-01")];
    expect(actualizarHistorial(base, "2021-01-01", e)).toHaveLength(2);
  });

  it("5: no retrocede", () => {
    const abierto = [p("40012", "BBVA", "2020-01-01", null)];
    expect(() => actualizarHistorial(abierto, "2019-01-01", e)).toThrow(RangeError);
    const cerrado = [p("40012", "BBVA", "2020-01-01", "2021-01-01")];
    expect(() => actualizarHistorial(cerrado, "2020-06-01", null)).toThrow(RangeError);
  });
});

describe("historialesDesdeObservaciones, casos de borde", () => {
  it("dos observaciones del mismo día: la última prevalece sin intervalos vacíos", () => {
    const h = historialesDesdeObservaciones([
      { fecha: "2020-01-01", entradas: [["40012", "A"]] },
      { fecha: "2020-01-01", entradas: [["40012", "B"]] },
    ]);
    expect(h.get("012")).toEqual([p("40012", "B", "2020-01-01", null)]);
  });

  it("un código que desaparece y vuelve abre un periodo nuevo", () => {
    const h = historialesDesdeObservaciones([
      { fecha: "2020-01-01", entradas: [["40012", "A"]] },
      { fecha: "2020-02-01", entradas: [["40014", "X"]] },
      { fecha: "2020-03-01", entradas: [["40012", "A"]] },
    ]);
    expect(h.get("012")).toEqual([
      p("40012", "A", "2020-01-01", "2020-02-01"),
      p("40012", "A", "2020-03-01", null),
    ]);
  });

  it("un código visto y borrado el mismo día no deja historial", () => {
    const h = historialesDesdeObservaciones([
      { fecha: "2020-01-01", entradas: [["40012", "A"]] },
      { fecha: "2020-01-01", entradas: [["40014", "X"]] },
    ]);
    expect(h.has("012")).toBe(false);
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

  it("ordena las entradas por unidades de código, no según el idioma", () => {
    // localeCompare da 0 entre formas canónicamente equivalentes; con él, el orden de llegada
    // cambiaría la firma de una misma lista.
    const X: EntradaCep = ["40012", "É"];
    const Y: EntradaCep = ["40012", "É"];
    const r = observacionesCompactas([
      o("2020-01-01", [X, Y]),
      o("2020-01-02", [Y, X]),
      o("2020-01-03", B),
    ]);
    expect(r.map((x) => x.fecha)).toEqual(["2020-01-01", "2020-01-03"]);
  });

  it("maneja listas vacías y de un elemento", () => {
    expect(observacionesCompactas([])).toEqual([]);
    expect(observacionesCompactas([o("2020-01-01", A)])).toHaveLength(1);
  });
});
