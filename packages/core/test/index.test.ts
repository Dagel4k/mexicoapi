import { describe, expect, test } from "vitest";
import type {
  ArchivoCrudo,
  Banco,
  Estado,
  FuenteManifiesto,
  Manifiesto,
  Municipio,
  PeriodoBanco,
  TipoBanco,
} from "../src/index.js";
import * as core from "../src/index.js";

const VALORES_PUBLICOS = [
  "validarClabe",
  "validarRfc",
  "validarCurp",
  "validarNss",
  "sumarDiasHabiles",
  "calendarioLft",
  "crearCalendario",
  "diasDescansoLft",
  "CalendarioIncompletoError",
  "digitoControlClabe",
  "digitoVerificadorRfc",
  "digitoVerificadorCurp",
  "digitoVerificadorNss",
  "esFechaIsoValida",
  "sumarDias",
  "diaDeLaSemana",
  "enesimoDiaDeSemana",
  "esBisiesto",
  "fechaValida",
  "ENTIDADES_CURP",
  "COBERTURA_LFT",
  "FUENTE_LFT_74",
  "FUENTE_LFT_715",
  "VIGENCIA_LFT",
  "RFC_GENERICOS",
  "NOTA_VALIDACION",
];

describe("API pública", () => {
  test.each([
    "validarClabe",
    "validarRfc",
    "validarCurp",
    "validarNss",
    "sumarDiasHabiles",
    "calendarioLft",
    "crearCalendario",
    "diasDescansoLft",
    "CalendarioIncompletoError",
    "digitoControlClabe",
    "digitoVerificadorRfc",
    "digitoVerificadorCurp",
    "digitoVerificadorNss",
    "esFechaIsoValida",
    "sumarDias",
    "diaDeLaSemana",
    "enesimoDiaDeSemana",
    "esBisiesto",
    "fechaValida",
  ])("exporta %s como función", (nombre) => {
    expect(typeof (core as Record<string, unknown>)[nombre]).toBe("function");
  });

  test("exporta las constantes públicas", () => {
    expect(core.NOTA_VALIDACION).toContain("no confirma que exista");
    expect(core.RFC_GENERICOS.has("XAXX010101000")).toBe(true);
    expect(core.ENTIDADES_CURP.get("DF")).toBeDefined();
    expect(core.COBERTURA_LFT.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(core.FUENTE_LFT_74).toBeDefined();
    expect(core.FUENTE_LFT_715).toBeDefined();
    expect(core.VIGENCIA_LFT).toBe("2026-05-14");
  });

  test("no expone VERSION ni los ayudantes internos", () => {
    const api = core as Record<string, unknown>;
    expect(api.VERSION).toBeUndefined();
    expect(api.normalizar).toBeUndefined();
    expect(api.resultadoInvalido).toBeUndefined();
    expect(api.resultadoConFormato).toBeUndefined();
    expect(api.rechazoPorTipo).toBeUndefined();
  });
});

describe("tipos de registros y manifiesto", () => {
  test("los tipos nuevos compilan con los valores esperados", () => {
    const estado: Estado = {
      cve_ent: "09",
      nombre: "Ciudad de México",
      abreviatura: "CDMX",
      cvegeo: "09",
    };
    const municipio: Municipio = {
      cvegeo: "09015",
      cve_ent: "09",
      cve_mun: "015",
      nombre: "Cuauhtémoc",
      cve_cabecera: "0001",
    };
    const tipo: TipoBanco = "banca_multiple";
    const periodo: PeriodoBanco = {
      codigo_spei: "002",
      nombre_corto: "BANAMEX",
      desde: "2024-01-01",
      hasta: "2026-10-01",
    };
    const banco: Banco = {
      codigo: "002",
      codigo_spei: "002",
      nombre_corto: "BANAMEX",
      razon_social: null,
      sector: null,
      tipo,
      participacion: "directa",
      activo: true,
      baja_detectada: null,
      historial: [periodo],
    };
    const archivo: ArchivoCrudo = {
      file: "bancos.pdf",
      url: "https://example.com/bancos.pdf",
      sha256: "abc",
    };
    const fuente: FuenteManifiesto = {
      name: "Bancos",
      url: "https://example.com/bancos",
      license: "MIT",
      license_url: "https://example.com/licencia",
      citation: "Fuente de ejemplo",
      published_at: null,
      raw: [archivo],
    };
    const manifiesto: Manifiesto = {
      dataset: "bancos",
      schema_version: 1,
      as_of: "2026-10-17",
      fetched_at: "2026-10-17T00:00:00Z",
      data_file: "data/bancos.json",
      data_sha256: "abc",
      records: 1,
      sources: [fuente],
    };
    expect([estado, municipio, banco, manifiesto].length).toBe(4);
  });

  test("el índice no gana valores de runtime por los tipos nuevos", () => {
    expect(Object.keys(core).sort()).toEqual([...VALORES_PUBLICOS].sort());
  });
});
