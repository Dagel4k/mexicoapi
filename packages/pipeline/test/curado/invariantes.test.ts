import { readFile } from "node:fs/promises";
import type {
  CoberturaCurada,
  DiaInhabilCurado,
  SalarioMinimo,
  TarifaIsr,
  Uma,
} from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import type { ExcepcionCuotaFija } from "../../src/curado/esquemas.js";
import {
  invariantesDias,
  invariantesIsr,
  invariantesSalarioMinimo,
  invariantesUma,
  TOLERANCIA_CUOTA_FIJA,
} from "../../src/curado/invariantes.js";
import { interpretarCurado } from "../../src/curado/leer.js";
import { curadoDiasSat } from "../../src/curado/registro.js";
import {
  DIAS_CNBV_OFICIALES,
  EXCEPCIONES_OFICIALES,
  SALARIOS_OFICIALES,
  TARIFAS_OFICIALES,
  UMA_OFICIALES,
} from "./ejemplos.js";

const uma2026 = (): Uma => structuredClone(UMA_OFICIALES.at(-1) as Uma);

describe("UMA", () => {
  it("los valores publicados de 2017 a 2026 cumplen diaria × 30.4 y mensual × 12", () => {
    expect(UMA_OFICIALES).toHaveLength(10);
    expect(invariantesUma(UMA_OFICIALES)).toEqual([]);
  });

  it("detecta una UMA mal multiplicada o con un dígito cambiado", () => {
    const mensual = { ...uma2026(), mensual: "3566.23" };
    expect(invariantesUma([mensual])).toContain(
      "2026: mensual es 3566.23, se esperaba 3566.22 (diaria × 30.4)",
    );
    const anual = { ...uma2026(), anual: "42794.46" };
    expect(invariantesUma([anual])).toContain(
      "2026: anual es 42794.46, se esperaba 42794.64 (mensual × 12)",
    );
    // Un dígito cambiado en la diaria rompe la mensual.
    const diaria = { ...uma2026(), diaria: "117.13" };
    expect(invariantesUma([diaria]).join("\n")).toContain(
      "mensual es 3566.22, se esperaba 3560.75",
    );
  });

  it("exige vigencia desde el 1 de febrero, publicación previa y el monto en el fragmento", () => {
    const vigencia = { ...uma2026(), vigencia_desde: "2026-01-01" };
    expect(invariantesUma([vigencia])).toContain(
      "2026: vigencia_desde es 2026-01-01, se esperaba 2026-02-01",
    );
    const tardia = uma2026();
    tardia.fuente.fecha_publicacion = "2026-02-02";
    expect(invariantesUma([tardia])).toContain(
      "2026: la fuente se publicó (2026-02-02) después de vigencia_desde (2026-02-01)",
    );
    // La fuente de otro año no trae las cifras del registro.
    const otraFuente = { ...uma2026(), fuente: (UMA_OFICIALES[0] as Uma).fuente };
    const fallas = invariantesUma([otraFuente]);
    expect(fallas).toContain("2026: el fragmento de la fuente no contiene la diaria 117.31");
    expect(fallas).toContain("2026: el fragmento de la fuente no contiene la mensual 3,566.22");
    expect(fallas).toContain("2026: el fragmento de la fuente no contiene la anual 42,794.64");
  });

  it("no confunde un monto con otro que lo contiene", () => {
    const uma = uma2026();
    uma.fuente.fragmento = uma.fuente.fragmento.replace("$117.31", "$1117.31");
    expect(invariantesUma([uma])).toEqual([
      "2026: el fragmento de la fuente no contiene la diaria 117.31",
    ]);
  });
});

describe("salario mínimo", () => {
  const de = (anio: number, zona: string): SalarioMinimo =>
    structuredClone(
      SALARIOS_OFICIALES.find((s) => s.anio === anio && s.zona === zona) as SalarioMinimo,
    );

  it("los valores publicados de 2019 a 2026 cumplen", () => {
    expect(SALARIOS_OFICIALES).toHaveLength(16);
    expect(invariantesSalarioMinimo(SALARIOS_OFICIALES)).toEqual([]);
  });

  it("exige las dos zonas en cada año y vigencia desde el 1 de enero", () => {
    expect(invariantesSalarioMinimo([de(2026, "general")])).toEqual(["2026: falta la zona zlfn"]);
    expect(invariantesSalarioMinimo([de(2026, "zlfn")])).toEqual(["2026: falta la zona general"]);
    const vigencia = { ...de(2026, "zlfn"), vigencia_desde: "2026-02-01" };
    expect(invariantesSalarioMinimo([de(2026, "general"), vigencia])).toEqual([
      "2026 zlfn: vigencia_desde es 2026-02-01, se esperaba 2026-01-01",
    ]);
  });

  it("detecta zonas intercambiadas y un monto que no está en el fragmento", () => {
    const general = { ...de(2026, "general"), diario: "440.87" };
    const zlfn = { ...de(2026, "zlfn"), diario: "315.04" };
    expect(invariantesSalarioMinimo([general, zlfn])).toEqual([
      "2026: el salario de la zlfn (315.04) no es mayor que el general (440.87)",
    ]);
    const typo = { ...de(2026, "general"), diario: "315.40" };
    expect(invariantesSalarioMinimo([typo, de(2026, "zlfn")])).toEqual([
      "2026 general: el fragmento de la fuente no contiene el diario 315.40",
    ]);
  });

  it("exige que la fuente se publique antes de la vigencia", () => {
    const tardia = de(2026, "general");
    tardia.fuente.fecha_publicacion = "2026-01-02";
    expect(invariantesSalarioMinimo([tardia, de(2026, "zlfn")])).toEqual([
      "2026 general: la fuente se publicó (2026-01-02) después de vigencia_desde (2026-01-01)",
    ]);
  });
});

describe("tarifas de ISR", () => {
  const mensual = (): TarifaIsr => structuredClone(TARIFAS_OFICIALES[2] as TarifaIsr);
  const tramo = (t: TarifaIsr, i: number) => t.tramos[i] as TarifaIsr["tramos"][number];

  const anual2025 = (): TarifaIsr => structuredClone(TARIFAS_OFICIALES[0] as TarifaIsr);
  const excepcion = (cambios: Partial<ExcepcionCuotaFija> = {}): ExcepcionCuotaFija => ({
    ...(EXCEPCIONES_OFICIALES[0] as ExcepcionCuotaFija),
    ...cambios,
  });

  it("las tarifas mensual 2026, anual 2026 y anual 2025 publicadas cumplen con su excepción", () => {
    expect(TARIFAS_OFICIALES.map((t) => t.tramos.length)).toEqual([11, 11, 11]);
    expect(invariantesIsr(TARIFAS_OFICIALES, EXCEPCIONES_OFICIALES)).toEqual([]);
    expect(invariantesIsr([])).toEqual([]);
  });

  it("la tolerancia es de 1 centavo y la excepción de la anual 2025 hace falta, solo ahí", () => {
    expect(TOLERANCIA_CUOTA_FIJA).toBe(1n);
    // Tramo 10 de la anual 2025: 271,981.99 + 375,975.61 × 32 % = 392,294.19; se publicó 392,294.17.
    expect(invariantesIsr(TARIFAS_OFICIALES, [])).toEqual([
      "2025 anual, tramo 10: cuota_fija es 392294.17, se esperaba 392294.19 ± 0.01",
    ]);
  });

  it("fija el límite: −1 pasa, −2 solo con excepción, −3 falla aunque haya excepción", () => {
    const t = mensual();
    // Tramo 6 de la mensual 2026: se calcula 1856.85 y se publicó 1856.84 (−1).
    expect(invariantesIsr([t])).toEqual([]);
    tramo(t, 5).cuota_fija = "1856.83";
    expect(invariantesIsr([t])).toContain(
      "2026 mensual, tramo 6: cuota_fija es 1856.83, se esperaba 1856.85 ± 0.01",
    );
    const conExcepcion = excepcion({
      anio: 2026,
      periodo: "mensual",
      tramo: 6,
      publicada: "1856.83",
      calculada: "1856.85",
    });
    expect(invariantesIsr([t], [conExcepcion]).join("\n")).not.toContain("tramo 6");
    const a = anual2025();
    tramo(a, 9).cuota_fija = "392294.16";
    expect(invariantesIsr([a], EXCEPCIONES_OFICIALES)).toContain(
      "2025 anual, tramo 10: la excepción dice publicada 392294.17 y calculada 392294.19; el YAML trae 392294.16 y se calcula 392294.19",
    );
  });

  it("un error de 3 centavos en la cuota fija ya no pasa", () => {
    const t = mensual();
    tramo(t, 5).cuota_fija = "1856.87";
    expect(invariantesIsr([t])).toContain(
      "2026 mensual, tramo 6: cuota_fija es 1856.87, se esperaba 1856.85 ± 0.01",
    );
  });

  it("rechaza excepciones sin usar, innecesarias o repetidas", () => {
    expect(invariantesIsr([mensual()], EXCEPCIONES_OFICIALES)).toEqual([
      "2025 anual, tramo 10: excepción de cuota_fija sin usar",
    ]);
    const innecesaria = excepcion({
      anio: 2026,
      periodo: "mensual",
      tramo: 6,
      publicada: "1856.84",
      calculada: "1856.85",
    });
    expect(invariantesIsr([mensual()], [innecesaria])).toEqual([
      "2026 mensual, tramo 6: la excepción no hace falta (diferencia de -0.01)",
    ]);
    expect(invariantesIsr([anual2025()], [excepcion(), excepcion()])).toEqual([
      "2025 anual, tramo 10: excepción de cuota_fija repetida",
    ]);
  });

  it("exige la misma columna de tasas en todas las tarifas", () => {
    const t = mensual();
    tramo(t, 10).tasa_excedente = "53.00";
    expect(invariantesIsr([anual2025(), t], EXCEPCIONES_OFICIALES)).toEqual([
      "2026 mensual, tramo 11: la tasa 53.00 no coincide con la de 2025 anual (35.00)",
    ]);
    const corta = mensual();
    corta.tramos.pop();
    (corta.tramos.at(-1) as TarifaIsr["tramos"][number]).limite_superior = null;
    expect(invariantesIsr([anual2025(), corta], EXCEPCIONES_OFICIALES)).toEqual([
      "2026 mensual: tiene 10 tramos y 2025 anual tiene 11",
    ]);
  });

  it("exige que el fragmento mencione el año de la tarifa", () => {
    const comoDe2026 = { ...anual2025(), anio: 2026 };
    expect(invariantesIsr([comoDe2026], [])).toContain(
      "2026 anual: el fragmento de la fuente no menciona el año 2026",
    );
  });

  it("detecta un tramo que no empata con el anterior", () => {
    const t = mensual();
    tramo(t, 3).limite_inferior = "12598.04";
    expect(invariantesIsr([t])).toContain(
      "2026 mensual, tramo 4: limite_inferior es 12598.04, se esperaba 12598.03",
    );
    const u = mensual();
    tramo(u, 2).limite_superior = "12589.02";
    expect(invariantesIsr([u])).toContain(
      "2026 mensual, tramo 4: limite_inferior es 12598.03, se esperaba 12589.03",
    );
  });

  it("detecta un dígito cambiado en la cuota fija o en la tasa", () => {
    const t = mensual();
    tramo(t, 5).cuota_fija = "1865.84";
    const fallas = invariantesIsr([t]);
    expect(fallas).toContain(
      "2026 mensual, tramo 6: cuota_fija es 1865.84, se esperaba 1856.85 ± 0.01",
    );
    expect(fallas.join("\n")).toContain("tramo 7: cuota_fija es 5665.16");
    const u = mensual();
    tramo(u, 1).tasa_excedente = "6.04";
    expect(invariantesIsr([u]).join("\n")).toContain("tramo 3: cuota_fija es 420.95");
  });

  it("exige inicio en 0.01 con cuota 0.00, tasas crecientes y solo el último abierto", () => {
    const t = mensual();
    tramo(t, 0).limite_inferior = "0.00";
    tramo(t, 0).cuota_fija = "0.01";
    tramo(t, 4).tasa_excedente = "16.00";
    tramo(t, 6).limite_superior = null;
    tramo(t, 10).limite_superior = "999999.99";
    const fallas = invariantesIsr([t]);
    expect(fallas).toContain("2026 mensual, tramo 1: limite_inferior es 0.00, se esperaba 0.01");
    expect(fallas).toContain("2026 mensual, tramo 1: cuota_fija es 0.01, se esperaba 0.00");
    expect(fallas).toContain(
      "2026 mensual, tramo 5: la tasa 16.00 no es mayor que la del tramo anterior (16.00)",
    );
    expect(fallas).toContain(
      "2026 mensual, tramo 7: solo el último tramo puede no tener límite superior",
    );
    expect(fallas).toContain(
      "2026 mensual, tramo 11: el último tramo no debe tener límite superior",
    );
  });

  it("exige límite superior mayor que el inferior y tasas de hasta 100", () => {
    const t = mensual();
    tramo(t, 0).limite_superior = "0.01";
    tramo(t, 10).tasa_excedente = "100.01";
    const fallas = invariantesIsr([t]);
    expect(fallas).toContain(
      "2026 mensual, tramo 1: limite_superior no es mayor que limite_inferior",
    );
    expect(fallas).toContain("2026 mensual, tramo 11: la tasa 100.01 pasa de 100");
  });
});

describe("días inhábiles", () => {
  const cobertura: CoberturaCurada = { descanso: { desde: "2025-01-01", hasta: "2026-12-31" } };
  const cnbv = invariantesDias("cnbv");
  const dia = (fecha: string, motivo: string, cambios: Partial<DiaInhabilCurado> = {}) => ({
    ...(DIAS_CNBV_OFICIALES[0] as DiaInhabilCurado),
    fecha,
    motivo,
    ...cambios,
  });

  it("los 22 días de la CNBV de 2025 y 2026 cumplen, incluidas las fechas de regla", () => {
    expect(DIAS_CNBV_OFICIALES).toHaveLength(22);
    expect(cnbv(DIAS_CNBV_OFICIALES, cobertura)).toEqual([]);
  });

  it("detecta una fecha de regla mal calculada", () => {
    const malo = dia("2026-02-09", "Primer lunes de febrero, en conmemoración del 5 de febrero");
    expect(cnbv([malo], cobertura)).toEqual([
      "2026-02-09: el motivo dice primer lunes de febrero, que en 2026 es 2026-02-02",
    ]);
    const otro = dia(
      "2025-11-16",
      "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
    );
    expect(cnbv([otro], cobertura)).toEqual([
      "2025-11-16: el motivo dice tercer lunes de noviembre, que en 2025 es 2025-11-17",
    ]);
  });

  it("reconoce las reglas sin importar mayúsculas ni el día de la semana", () => {
    // 2026-10-25 es el cuarto domingo de octubre; 2026-10-28 el cuarto miércoles.
    expect(cnbv([dia("2026-10-25", "Cuarto domingo de octubre")], cobertura)).toEqual([]);
    expect(cnbv([dia("2026-10-28", "el CUARTO miércoles de Octubre")], cobertura)).toEqual([]);
    expect(cnbv([dia("2026-10-27", "Cuarto miércoles de octubre")], cobertura)).toHaveLength(1);
    expect(cnbv([dia("2025-11-17", "Tercer lunes del mes de noviembre")], cobertura)).toEqual([]);
    // No existe un quinto lunes en febrero de 2026.
    expect(cnbv([dia("2026-02-23", "Quinto lunes de febrero")], cobertura)).toEqual([
      "2026-02-23: el motivo dice quinto lunes de febrero, que no existe en 2026",
    ]);
  });

  it("no deja pasar una regla que no reconoce", () => {
    const aviso = (fecha: string, mencion: string) =>
      `${fecha}: regla no reconocida ("${mencion}"); nombra el mes y el día de la semana, por ejemplo "tercer lunes de noviembre"`;
    // Las cuatro redacciones con una fecha equivocada (el tercer lunes es 2025-11-17).
    expect(
      cnbv([dia("2025-11-16", "El 2 de noviembre y el tercer lunes de dicho mes")], cobertura),
    ).toEqual([aviso("2025-11-16", "tercer lunes")]);
    expect(cnbv([dia("2025-11-16", "Tercer lunes del mes de noviembre")], cobertura)).toEqual([
      "2025-11-16: el motivo dice tercer lunes del mes de noviembre, que en 2025 es 2025-11-17",
    ]);
    expect(cnbv([dia("2025-11-16", "3er lunes de noviembre")], cobertura)).toEqual([
      aviso("2025-11-16", "3er lunes"),
    ]);
    expect(cnbv([dia("2025-11-16", "Lunes 17 de noviembre (tercer lunes)")], cobertura)).toEqual([
      aviso("2025-11-16", "tercer lunes"),
    ]);
    // Aunque la fecha sea la correcta, la regla debe nombrar el mes con el ordinal en letra.
    expect(cnbv([dia("2025-11-17", "3er lunes de noviembre")], cobertura)).toEqual([
      aviso("2025-11-17", "3er lunes"),
    ]);
    expect(cnbv([dia("2025-11-17", "Último lunes antes del 20 de noviembre")], cobertura)).toEqual([
      aviso("2025-11-17", "último lunes"),
    ]);
    // La redacción literal del DOF sí se reconoce.
    const literal = "El primer lunes de febrero en conmemoración del 5 de febrero";
    expect(cnbv([dia("2025-02-03", literal)], cobertura)).toEqual([]);
  });

  it("exige la autoridad del dataset y fechas dentro de la cobertura de su tipo", () => {
    expect(cnbv([dia("2026-01-01", "1o. de enero", { autoridad: "sat" })], cobertura)).toEqual([
      "2026-01-01: la autoridad es sat, se esperaba cnbv",
    ]);
    expect(cnbv([dia("2027-01-01", "1o. de enero")], cobertura)).toEqual([
      "2027-01-01: está fuera de la cobertura de descanso (2025-01-01 a 2026-12-31)",
    ]);
    expect(cnbv([dia("2026-07-20", "Vacaciones", { tipo: "vacaciones" })], cobertura)).toEqual([
      "2026-07-20: no hay cobertura para el tipo vacaciones",
    ]);
    expect(cnbv([dia("2026-01-01", "1o. de enero")], null)).toEqual([
      "2026-01-01: no hay cobertura para el tipo descanso",
    ]);
  });
});

describe("días inhábiles y tipos de plazo", () => {
  const sat = invariantesDias("sat");
  const vacaciones = (fecha: string): DiaInhabilCurado => ({
    ...(DIAS_CNBV_OFICIALES[0] as DiaInhabilCurado),
    fecha,
    autoridad: "sat",
    motivo: "Segundo periodo general de vacaciones de 2026",
    tipo: "vacaciones",
  });

  it("rechaza un día en la cobertura de su tipo pero fuera de la de todos los tipos de plazo", () => {
    // general es la intersección de descanso y vacaciones; declaraciones_pagos, la de descanso.
    const cobertura: CoberturaCurada = {
      descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
      vacaciones: { desde: "2026-01-01", hasta: "2027-01-04" },
    };
    expect(sat([vacaciones("2026-12-31"), vacaciones("2027-01-04")], cobertura)).toEqual([
      "2027-01-04: no cae en la cobertura de ningún tipo de plazo (general del 2026-01-01 al 2026-12-31; declaraciones_pagos del 2026-01-01 al 2026-12-31)",
    ]);
  });

  it("rechaza un plazo sin cobertura de un tipo de día que cuente o con la cobertura vacía", () => {
    expect(
      sat([vacaciones("2026-07-20")], {
        vacaciones: { desde: "2026-01-01", hasta: "2026-12-31" },
      }),
    ).toEqual(["el plazo declaraciones_pagos no tiene cobertura de un tipo de día que cuente"]);
    expect(
      sat([vacaciones("2025-07-21")], {
        descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
        vacaciones: { desde: "2025-01-01", hasta: "2025-12-31" },
      }),
    ).toEqual(["la cobertura del plazo general queda vacía"]);
  });

  it("el YAML real con vacaciones hasta 2027 sin extender descanso no pasa", async () => {
    const yaml = await readFile(
      new URL("../../../../data/curado/dias-inhabiles-sat.yaml", import.meta.url),
      "utf8",
    );
    const linea = "vacaciones: { desde: 2026-01-01, hasta: 2026-11-30 }";
    expect(yaml).toContain(linea);
    const fechas = [
      ...Array.from({ length: 8 }, (_, i) => `2026-12-${17 + i}`),
      ...Array.from({ length: 6 }, (_, i) => `2026-12-${26 + i}`),
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ];
    const extra = fechas.map(
      (f) =>
        `  - { fecha: ${f}, autoridad: sat, motivo: "Segundo periodo general de vacaciones de 2026", tipo: vacaciones, fuente: primera-rm-2026 }`,
    );
    const cambiado = [
      yaml.replace(linea, "vacaciones: { desde: 2026-01-01, hasta: 2027-01-04 }").trimEnd(),
      ...extra,
      "",
    ].join("\n");
    const { documento, problemas } = interpretarCurado(curadoDiasSat, cambiado);
    expect(documento).toBeNull();
    expect(problemas).toEqual(
      ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"].map(
        (f) =>
          `invariante: ${f}: no cae en la cobertura de ningún tipo de plazo (general del 2026-01-01 al 2026-12-31; declaraciones_pagos del 2026-01-01 al 2026-12-31)`,
      ),
    );
  });
});
