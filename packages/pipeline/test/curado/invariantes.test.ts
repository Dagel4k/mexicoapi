import type {
  CoberturaCurada,
  DiaInhabilCurado,
  SalarioMinimo,
  TarifaIsr,
  Uma,
} from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import {
  invariantesDias,
  invariantesIsr,
  invariantesSalarioMinimo,
  invariantesUma,
  TOLERANCIA_CUOTA_FIJA,
} from "../../src/curado/invariantes.js";
import {
  DIAS_CNBV_OFICIALES,
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

  it("las tarifas mensual 2026, anual 2026 y anual 2025 publicadas cumplen", () => {
    expect(TARIFAS_OFICIALES.map((t) => t.tramos.length)).toEqual([11, 11, 11]);
    expect(invariantesIsr(TARIFAS_OFICIALES)).toEqual([]);
  });

  it("la tolerancia de la cuota fija es de 2 centavos y la anual 2025 la necesita", () => {
    expect(TOLERANCIA_CUOTA_FIJA).toBe(2n);
    // Tramo 10 de la anual 2025: 271,981.99 + 375,975.61 × 32 % = 392,294.19; se publicó 392,294.17.
    const anual2025 = TARIFAS_OFICIALES[0] as TarifaIsr;
    expect(tramo(anual2025, 9).cuota_fija).toBe("392294.17");
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
      "2026 mensual, tramo 6: cuota_fija es 1865.84, se esperaba 1856.85 ± 0.02",
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
    // No existe un quinto lunes en febrero de 2026.
    expect(cnbv([dia("2026-02-23", "Quinto lunes de febrero")], cobertura)).toEqual([
      "2026-02-23: el motivo dice quinto lunes de febrero, que no existe en 2026",
    ]);
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
