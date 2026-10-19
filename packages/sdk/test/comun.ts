// Pruebas de la entrada `mexicoapi` que corren igual sobre src (proyecto sdk) y sobre dist
// (pruebas del paquete): así el build no puede perder ni cambiar una exportación.
import { beforeAll, describe, expect, it } from "vitest";
import type * as Mexicoapi from "../src/index.js";
import type { CoberturaSerie, Consulta, DiaInhabil, TipoCambioFix, Udi } from "../src/index.js";

export type Modulo = typeof Mexicoapi;

export const FUNCIONES = [
  "validarClabe",
  "digitoControlClabe",
  "validarRfc",
  "digitoVerificadorRfc",
  "validarCurp",
  "digitoVerificadorCurp",
  "validarNss",
  "digitoVerificadorNss",
  "esFechaIsoValida",
  "calendarioLft",
  "crearCalendario",
  "sumarDiasHabiles",
  "diasDescansoLft",
  "fixPublicado",
  "fixParaOperacion",
  "udiDeFecha",
  // La fecha de hoy en la Ciudad de México, la de las fechas de la API.
  "hoyEnMexico",
  // Las reglas de la API entre parámetros, la CLABE como la revisa validarClabe y el texto en una
  // línea: los usan la CLI y el MCP.
  "revisarTipoPlazo",
  "revisarFix",
  "normalizarClabe",
  "aUnaLinea",
] as const;

export const ERRORES = [
  "CalendarioIncompletoError",
  "FechaFueraDeRangoError",
  "SerieIncompletaError",
] as const;

export const CONSTANTES = [
  "AVISO_SIN_API",
  "NOTA_VALIDACION",
  "NOTAS_VALIDACION",
  "ENTIDADES_CURP",
  "RFC_GENERICOS",
  "COBERTURA_LFT",
  "VIGENCIA_LFT",
  "FUENTE_LFT_74",
  "FUENTE_LFT_715",
  "FUENTE_CFF_20",
  // Los catálogos de los calendarios y el nombre de cada autoridad.
  "AUTORIDADES",
  "TIPOS_PLAZO",
  "TIPOS_DIA_CURADO",
  "NOMBRE_AUTORIDAD",
] as const;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Miércoles 14 a viernes 16 de octubre de 2026.
const COBERTURA: CoberturaSerie = { desde: "2026-10-14", hasta: "2026-10-16" };
const FIX: TipoCambioFix[] = [
  { fecha_publicacion: "2026-10-14", valor: "18.1000" },
  { fecha_publicacion: "2026-10-15", valor: "18.2000" },
  { fecha_publicacion: "2026-10-16", valor: "18.3000" },
];
const UDIS: Udi[] = [
  { fecha: "2026-10-14", valor: "8.500000" },
  { fecha: "2026-10-15", valor: "8.501000" },
  { fecha: "2026-10-16", valor: "8.502000" },
];

function registro<T>(consulta: Consulta<T>): T | undefined {
  return consulta.tipo === "encontrado" ? consulta.registro : undefined;
}

export function probarModulo(cargar: () => Promise<Modulo>): void {
  let m: Modulo;

  beforeAll(async () => {
    m = await cargar();
  });

  it("exporta exactamente la API pública", () => {
    expect(Object.keys(m).sort()).toEqual([...FUNCIONES, ...ERRORES, ...CONSTANTES].sort());
    for (const nombre of [...FUNCIONES, ...ERRORES]) {
      expect(typeof m[nombre], nombre).toBe("function");
    }
  });

  it("trae las reglas de la API entre parámetros y los catálogos de los calendarios", () => {
    expect(m.AUTORIDADES).toEqual(["lft", "cnbv", "sat"]);
    expect(m.TIPOS_PLAZO).toEqual(["general", "declaraciones_pagos"]);
    expect(m.TIPOS_DIA_CURADO).toEqual(["descanso", "vacaciones"]);
    expect(m.NOMBRE_AUTORIDAD.sat).toBe("el SAT");
    expect(m.revisarTipoPlazo("sat", undefined)).toEqual({
      tipo: "parametro-faltante",
      detalle: "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
      extras: { parametro: "tipo_plazo" },
    });
    expect(m.revisarTipoPlazo("lft", undefined)).toBeNull();
    expect(m.revisarFix("2026-10-12", "2026-10-13")?.detalle).toBe(
      "Indica solo uno de publicado u operacion.",
    );
    expect(m.normalizarClabe("002 010-077777777771")).toBe("002010077777777771");
    expect(m.aUnaLinea("a\u001b[2Jb\nc")).toBe("a [2Jb c");
  });

  it("da la fecha de hoy en la Ciudad de México", () => {
    expect(m.hoyEnMexico(Date.parse("2026-10-19T01:03:00Z"))).toBe("2026-10-18");
    expect(m.hoyEnMexico()).toMatch(FECHA);
  });

  describe("validadores", () => {
    it("valida una CLABE y calcula su dígito de control", () => {
      const r = m.validarClabe("002010077777777771");
      expect(r.valido).toBe(true);
      expect(r.detalle?.codigo_banco).toBe("002");
      // Sin el catálogo no revisa el banco y lo dice.
      expect(r.banco_revisado).toBe(false);
      expect(r.nota).toBe(m.NOTAS_VALIDACION.clabe_sin_banco);
      expect(m.validarClabe("002010077777777771", { bancos: new Map() }).banco_revisado).toBe(true);
      expect(m.digitoControlClabe("00201007777777777")).toBe("1");
    });

    it("valida un RFC y conoce los genéricos", () => {
      const r = m.validarRfc("GODE561231GR8");
      expect(r.valido).toBe(true);
      expect(r.detalle?.tipo).toBe("fisica");
      expect(m.digitoVerificadorRfc("GODE561231GR")).toBe("8");
      expect(m.RFC_GENERICOS.has("XAXX010101000")).toBe(true);
    });

    it("valida una CURP y nombra su entidad", () => {
      const r = m.validarCurp("BOXW310820HNERXN09");
      expect(r.valido).toBe(true);
      expect(m.digitoVerificadorCurp("BOXW310820HNERXN0")).toBe("9");
      expect(m.ENTIDADES_CURP.get("SL")).toBe("Sinaloa");
    });

    it("valida un NSS", () => {
      expect(m.validarNss("12345678903").valido).toBe(true);
      expect(m.digitoVerificadorNss("1234567890")).toBe("3");
    });

    it("no lanza con una entrada que no es string", () => {
      const r = m.validarClabe(12 as unknown as string);
      expect(r.valido).toBe(false);
      expect(r.errores.length).toBeGreaterThan(0);
    });
  });

  describe("días hábiles", () => {
    it("suma días hábiles con el calendario de la LFT", () => {
      const r = m.sumarDiasHabiles({ calendario: m.calendarioLft(), desde: "2026-11-13", dias: 3 });
      expect(r.resultado).toBe("2026-11-19");
      expect(r.inhabiles_saltados.map((d) => d.fecha)).toEqual(["2026-11-16"]);
      expect(r.inhabiles_saltados[0]?.fuente).toEqual(m.FUENTE_LFT_74);
    });

    it("lista los días de descanso de la LFT de un año", () => {
      const dias = m.diasDescansoLft(2026).map((d) => d.fecha);
      expect(dias).toContain("2026-11-16");
      expect(dias).toContain("2026-12-25");
      expect(m.COBERTURA_LFT).toEqual({ desde: "2007-01-01", hasta: "2100-12-31" });
      expect(m.VIGENCIA_LFT).toMatch(FECHA);
      expect(m.FUENTE_LFT_715.nombre).toContain("715");
    });

    it("crea un calendario propio", () => {
      const asueto: DiaInhabil = {
        fecha: "2026-11-17",
        motivo: "Asueto de prueba",
        tipo: "vacaciones",
        fuente: { nombre: "Prueba", url: "https://ejemplo.mx" },
      };
      const calendario = m.crearCalendario({
        autoridad: "sat",
        cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
        dias: [asueto],
        fuenteFinDeSemana: m.FUENTE_LFT_715,
      });
      const r = m.sumarDiasHabiles({ calendario, desde: "2026-11-16", dias: 1 });
      expect(r.resultado).toBe("2026-11-18");
    });

    it("lanza CalendarioIncompletoError fuera de la cobertura", () => {
      const calendario = m.calendarioLft();
      expect(() => m.sumarDiasHabiles({ calendario, desde: "2100-12-30", dias: 5 })).toThrow(
        m.CalendarioIncompletoError,
      );
    });

    it("distingue FechaFueraDeRangoError de otros RangeError", () => {
      const error = new m.FechaFueraDeRangoError();
      expect(error).toBeInstanceOf(RangeError);
      // Se llamaba `codigo`; ahora es `tipo`, como en MexicoApiError.
      expect(error.tipo).toBe("fecha-fuera-de-rango");
      expect("codigo" in error).toBe(false);
    });

    it("revisa fechas ISO", () => {
      expect(m.esFechaIsoValida("2028-02-29")).toBe(true);
      expect(m.esFechaIsoValida("2026-02-29")).toBe(false);
    });
  });

  describe("FIX y UDIS", () => {
    it("consulta el FIX publicado y el aplicable a una operación", () => {
      expect(registro(m.fixPublicado(FIX, COBERTURA, COBERTURA, "2026-10-15"))?.valor).toBe(
        "18.2000",
      );
      expect(m.fixPublicado(FIX, COBERTURA, COBERTURA, "2026-10-17").tipo).toBe("sin_dato");
      const operacion = m.fixParaOperacion(FIX, COBERTURA, COBERTURA, "2026-10-19");
      expect(registro(operacion)?.fecha_publicacion).toBe("2026-10-16");
      expect(m.fixParaOperacion(FIX, COBERTURA, COBERTURA, "2026-10-21").tipo).toBe(
        "no_disponible",
      );
      expect(m.FUENTE_CFF_20.nombre).toContain("artículo 20");
    });

    it("consulta la UDI de un día", () => {
      expect(registro(m.udiDeFecha(UDIS, COBERTURA, COBERTURA, "2026-10-15"))?.valor).toBe(
        "8.501000",
      );
    });

    it("lanza SerieIncompletaError si el tramo no alcanza", () => {
      const tramo: CoberturaSerie = { desde: "2026-10-14", hasta: "2026-10-14" };
      expect(() => m.udiDeFecha(UDIS.slice(0, 1), tramo, COBERTURA, "2026-10-16")).toThrow(
        m.SerieIncompletaError,
      );
    });
  });
}
