import { describe, expect, test } from "vitest";
import type {
  ArchivoCrudo,
  Banco,
  CoberturaSerie,
  Consulta,
  Estado,
  FuenteManifiesto,
  Manifiesto,
  Municipio,
  PeriodoBanco,
  TipoBanco,
  TipoCambioFix,
  TipoPlazo,
  Udi,
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
  "FechaFueraDeRangoError",
  "SerieIncompletaError",
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
  "AVISO_LFT_715",
  "COBERTURA_LFT",
  "FUENTE_LFT_74",
  "FUENTE_LFT_715",
  "VIGENCIA_LFT",
  "COBERTURA_CFF",
  "diasDescansoCff",
  "FUENTE_CFF_12",
  "VIGENCIA_CFF",
  "RFC_GENERICOS",
  "NOTA_VALIDACION",
  "fixPublicado",
  "fixParaOperacion",
  "udiDeFecha",
  "FUENTE_CFF_20",
  // Los catálogos de los calendarios, de los que salen sus tipos, y el nombre de cada autoridad.
  "AUTORIDADES",
  "TIPOS_PLAZO",
  "TIPOS_DIA_CURADO",
  "NOMBRE_AUTORIDAD",
  // Las reglas entre parámetros de la API, que el MCP y la CLI toman de mexicoapi.
  "revisarTipoPlazo",
  "revisarFix",
  // La CLABE como la revisa validarClabe y el texto en una línea: los usan la CLI y el MCP.
  "normalizarClabe",
  "enLinea",
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
    "diasDescansoCff",
    "CalendarioIncompletoError",
    "FechaFueraDeRangoError",
    "SerieIncompletaError",
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
    "fixPublicado",
    "fixParaOperacion",
    "udiDeFecha",
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
    expect(core.AVISO_LFT_715).toContain("art. 715");
    expect(core.FUENTE_CFF_20.fragmento).toContain("el día anterior a aquél");
    expect(core.COBERTURA_CFF).toEqual({ desde: "2026-01-01", hasta: "2100-12-31" });
    expect(core.FUENTE_CFF_12.fragmento).toContain("no se contarán los sábados");
    expect(core.VIGENCIA_CFF).toBe("2026-04-09");
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
    const fix: TipoCambioFix = { fecha_publicacion: "2026-10-16", valor: "18.4250" };
    const udi: Udi = { fecha: "2026-10-16", valor: "8.123456" };
    const cobertura: CoberturaSerie = { desde: "2020-01-02", hasta: "2026-10-16" };
    const consulta: Consulta<Udi> = { tipo: "encontrado", registro: udi };
    const plazos: TipoPlazo[] = ["general", "declaraciones_pagos"];
    expect([estado, municipio, banco, manifiesto, fix, cobertura, consulta, plazos].length).toBe(8);
  });

  test("el índice no gana valores de runtime por los tipos nuevos", () => {
    expect(Object.keys(core).sort()).toEqual([...VALORES_PUBLICOS].sort());
  });
});
