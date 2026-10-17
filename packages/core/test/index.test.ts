import { describe, expect, test } from "vitest";
import * as core from "../src/index.js";

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
  });

  test("no expone VERSION ni los ayudantes internos", () => {
    const api = core as Record<string, unknown>;
    expect(api.VERSION).toBeUndefined();
    expect(api.normalizar).toBeUndefined();
    expect(api.resultadoInvalido).toBeUndefined();
    expect(api.resultadoConFormato).toBeUndefined();
  });
});
