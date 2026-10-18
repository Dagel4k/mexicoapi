import { describe, expect, it } from "vitest";
import {
  AVISO_LFT_715,
  COBERTURA_LFT,
  diasDescansoLft,
  FUENTE_LFT_74,
  FUENTE_LFT_715,
  VIGENCIA_LFT,
} from "../../src/dias-habiles/lft.js";
import { esFechaIsoValida } from "../../src/fechas.js";

const fechas = (anio: number) => diasDescansoLft(anio).map((d) => d.fecha);

describe("diasDescansoLft", () => {
  it("devuelve los días de 2026 ordenados", () => {
    expect(fechas(2026)).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
  });

  it("incluye la transmisión del Poder Ejecutivo en 2024 y 2030", () => {
    expect(fechas(2024)).toContain("2024-10-01");
    expect(fechas(2030)).toContain("2030-10-01");
    expect(fechas(2027)).toHaveLength(7);
    expect(fechas(2027).some((f) => f.endsWith("-10-01"))).toBe(false);
  });

  it("incluye el 1 de diciembre de 2012 y 2018, no de 2019", () => {
    expect(fechas(2018)).toContain("2018-12-01");
    expect(fechas(2012)).toContain("2012-12-01");
    expect(fechas(2019)).not.toContain("2019-12-01");
    expect(fechas(2018)).not.toContain("2018-10-01");
  });

  it("calcula los lunes móviles de 2025", () => {
    const f = fechas(2025);
    expect(f).toContain("2025-02-03");
    expect(f).toContain("2025-03-17");
    expect(f).toContain("2025-11-17");
  });

  it("deja las fechas ordenadas en 2024 y 2018", () => {
    for (const anio of [2024, 2018]) {
      const f = fechas(anio);
      expect(f).toEqual([...f].sort());
    }
  });

  it("usa los motivos y la fuente del art. 74", () => {
    const dias = diasDescansoLft(2024);
    expect(dias.map((d) => d.motivo)).toEqual([
      "1 de enero",
      "Primer lunes de febrero, en conmemoración del 5 de febrero",
      "Tercer lunes de marzo, en conmemoración del 21 de marzo",
      "1 de mayo",
      "16 de septiembre",
      "1 de octubre de cada seis años, transmisión del Poder Ejecutivo Federal",
      "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
      "25 de diciembre",
    ]);
    expect(diasDescansoLft(2018).map((d) => d.motivo)).toContain(
      "1 de diciembre de cada seis años, transmisión del Poder Ejecutivo Federal",
    );
    for (const d of dias) {
      expect(d.tipo).toBe("descanso");
      expect(d.fuente).toBe(FUENTE_LFT_74);
    }
  });

  it("devuelve un arreglo nuevo en cada llamada", () => {
    const a = diasDescansoLft(2026);
    a.pop();
    expect(diasDescansoLft(2026)).toHaveLength(7);
  });

  it("acepta los extremos 2007 y 2100", () => {
    expect(fechas(2007)[0]).toBe("2007-01-01");
    expect(fechas(2100)[0]).toBe("2100-01-01");
  });

  it("lanza RangeError fuera de 2007-2100 o si no es entero", () => {
    for (const anio of [2006, 2101, 2006.5, Number.NaN]) {
      expect(() => diasDescansoLft(anio)).toThrow(RangeError);
    }
  });
});

describe("fuentes y cobertura", () => {
  it("cita los artículos 74 y 715", () => {
    expect(FUENTE_LFT_74.fragmento).toContain("cada seis años");
    expect(FUENTE_LFT_715.nombre).toBe("Ley Federal del Trabajo, artículo 715");
    expect(FUENTE_LFT_715.fragmento).toContain("con excepción de los sábados y domingos");
    expect(FUENTE_LFT_715.url).toBe(FUENTE_LFT_74.url);
  });

  it("el aviso dice qué se descuenta y qué no del art. 715", () => {
    expect(AVISO_LFT_715).toBe(
      "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715), como la Semana Santa o sus vacaciones. Revisa el calendario del tribunal o del centro de conciliación.",
    );
  });

  it("la vigencia es la fecha de la última reforma de la LFT en el DOF", () => {
    expect(VIGENCIA_LFT).toBe("2026-05-14");
    expect(esFechaIsoValida(VIGENCIA_LFT)).toBe(true);
    expect(VIGENCIA_LFT >= COBERTURA_LFT.desde && VIGENCIA_LFT <= COBERTURA_LFT.hasta).toBe(true);
  });

  it("congela las constantes y define la cobertura", () => {
    expect(Object.isFrozen(FUENTE_LFT_74)).toBe(true);
    expect(Object.isFrozen(FUENTE_LFT_715)).toBe(true);
    expect(Object.isFrozen(COBERTURA_LFT)).toBe(true);
    expect(COBERTURA_LFT).toEqual({ desde: "2007-01-01", hasta: "2100-12-31" });
  });
});
