import { describe, expect, it } from "vitest";
import {
  avisosTransmisionCff,
  avisoTransmisionCff,
  COBERTURA_CFF,
  diasDescansoCff,
  FUENTE_CFF_12,
  VIGENCIA_CFF,
} from "../../src/dias-habiles/cff.js";
import { diasDescansoLft } from "../../src/dias-habiles/lft.js";
import { esFechaIsoValida } from "../../src/fechas.js";

const fechas = (anio: number) => diasDescansoCff(anio).map((d) => d.fecha);

describe("diasDescansoCff", () => {
  it("devuelve los días de 2026 ordenados, los mismos que se capturaron del art. 12", () => {
    expect(fechas(2026)).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-05-05",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
  });

  it("calcula los lunes móviles de 2027 y 2028", () => {
    expect(fechas(2027)).toEqual([
      "2027-01-01",
      "2027-02-01",
      "2027-03-15",
      "2027-05-01",
      "2027-05-05",
      "2027-09-16",
      "2027-11-15",
      "2027-12-25",
    ]);
    const f = fechas(2028);
    expect(f).toContain("2028-02-07");
    expect(f).toContain("2028-03-20");
    expect(f).toContain("2028-11-20");
  });

  it("no descuenta el 1o. de octubre ni el 1o. de diciembre en los años de transmisión", () => {
    for (const anio of [2030, 2036, 2096]) {
      expect(fechas(anio)).toHaveLength(8);
      expect(fechas(anio)).not.toContain(`${anio}-10-01`);
      expect(fechas(anio)).not.toContain(`${anio}-12-01`);
    }
  });

  it("son los de la LFT sin la transmisión y con el 5 de mayo, en cada año de la cobertura", () => {
    for (let anio = 2026; anio <= 2100; anio++) {
      const lft = diasDescansoLft(anio)
        .map((d) => d.fecha)
        .filter((f) => !f.endsWith("-10-01") && !f.endsWith("-12-01"));
      expect(fechas(anio), String(anio)).toEqual([...lft, `${anio}-05-05`].sort());
    }
  });

  it("deja las fechas ordenadas en cada año", () => {
    for (let anio = 2026; anio <= 2100; anio++) {
      const f = fechas(anio);
      expect(f).toEqual([...f].sort());
    }
  });

  it("usa los motivos con que se capturaban y la fuente del art. 12", () => {
    const dias = diasDescansoCff(2026);
    expect(dias.map((d) => d.motivo)).toEqual([
      "1o. de enero",
      "Primer lunes de febrero, en conmemoración del 5 de febrero",
      "Tercer lunes de marzo, en conmemoración del 21 de marzo",
      "1o. de mayo",
      "5 de mayo",
      "16 de septiembre",
      "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
      "25 de diciembre",
    ]);
    for (const d of dias) {
      expect(d.tipo).toBe("descanso");
      expect(d.fuente).toBe(FUENTE_CFF_12);
    }
  });

  it("devuelve un arreglo nuevo en cada llamada", () => {
    const a = diasDescansoCff(2026);
    a.pop();
    expect(diasDescansoCff(2026)).toHaveLength(8);
  });

  it("acepta los extremos 2026 y 2100", () => {
    expect(fechas(2026)[0]).toBe("2026-01-01");
    expect(fechas(2100).at(-1)).toBe("2100-12-25");
  });

  it("lanza RangeError fuera de 2026-2100 o si no es entero", () => {
    for (const anio of [2025, 2101, 2026.5, Number.NaN]) {
      expect(() => diasDescansoCff(anio)).toThrow(RangeError);
    }
  });
});

describe("fuente y cobertura", () => {
  it("cita el primer párrafo del art. 12 vigente", () => {
    expect(FUENTE_CFF_12).toEqual({
      nombre: "Código Fiscal de la Federación, artículo 12",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      fecha_publicacion: "2026-04-09",
      fragmento:
        "Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; el primer lunes de febrero en conmemoración del 5 de febrero; el tercer lunes de marzo en conmemoración del 21 de marzo; el 1o. y 5 de mayo; el 16 de septiembre; el tercer lunes de noviembre en conmemoración del 20 de noviembre; el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo y el 25 de diciembre.",
    });
  });

  it("la vigencia es la fecha de la última reforma del CFF en el DOF", () => {
    expect(VIGENCIA_CFF).toBe("2026-04-09");
    expect(esFechaIsoValida(VIGENCIA_CFF)).toBe(true);
    expect(FUENTE_CFF_12.fecha_publicacion).toBe(VIGENCIA_CFF);
  });

  it("congela las constantes y define la cobertura", () => {
    expect(Object.isFrozen(FUENTE_CFF_12)).toBe(true);
    expect(Object.isFrozen(COBERTURA_CFF)).toBe(true);
    expect(COBERTURA_CFF).toEqual({ desde: "2026-01-01", hasta: "2100-12-31" });
  });
});

describe("avisosTransmisionCff", () => {
  const aviso2030 = avisoTransmisionCff(2030);
  const aviso2036 = avisoTransmisionCff(2036);
  const EXPLICACION =
    "el art. 12 del CFF no cuenta el 1o. de diciembre de cada 6 años cuando corresponde a la transmisión del Poder Ejecutivo, que desde 2024 es el 1o. de octubre.";
  /** 0 = domingo ... 6 = sábado, con Date como referencia independiente. */
  const diaSemana = (anio: number, mes: number) => new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();

  it("da cada aviso con su código", () => {
    expect(aviso2030.codigo).toBe("transmision-poder-ejecutivo");
    expect(aviso2030.texto).toMatch(/^En 2030 no se descuenta el 1o\. de octubre:/);
  });

  it("dice qué no se descuenta y por qué, solo con las fechas que caen entre semana", () => {
    // 2030: el 1o. de diciembre es domingo.
    expect(aviso2030.texto).toBe(
      `En 2030 no se descuenta el 1o. de octubre: ${EXPLICACION} Si el SAT lo declara inhábil, el plazo que lo cruce vence un día hábil después.`,
    );
    // 2036: miércoles y lunes.
    expect(aviso2036.texto).toBe(
      `En 2036 no se descuentan el 1o. de octubre ni el 1o. de diciembre: ${EXPLICACION} Si el SAT declara inhábil alguno de los dos, el plazo que lo cruce vence un día hábil después.`,
    );
    // 2072: el 1o. de octubre es sábado.
    expect(avisoTransmisionCff(2072).texto).toBe(
      `En 2072 no se descuenta el 1o. de diciembre: ${EXPLICACION} Si el SAT lo declara inhábil, el plazo que lo cruce vence un día hábil después.`,
    );
  });

  it("en cada año de transmisión nombra justo las fechas que caen entre semana", () => {
    for (let anio = 2030; anio <= 2096; anio += 6) {
      const { texto } = avisoTransmisionCff(anio);
      const nombradas = texto.slice(0, texto.indexOf(":"));
      const entreSemana = (mes: number) => diaSemana(anio, mes) % 6 !== 0;
      expect(nombradas.includes("octubre"), `${anio}`).toBe(entreSemana(10));
      expect(nombradas.includes("diciembre"), `${anio}`).toBe(entreSemana(12));
    }
  });

  it("avisa si el cálculo pasa por el 1o. de octubre o el 1o. de diciembre de un año de transmisión", () => {
    expect(avisosTransmisionCff("2030-09-30", "2030-10-01")).toEqual([aviso2030]);
    expect(avisosTransmisionCff("2030-09-01", "2030-12-31")).toEqual([aviso2030]);
    expect(avisosTransmisionCff("2036-09-30", "2036-10-05")).toEqual([aviso2036]);
    expect(avisosTransmisionCff("2036-11-28", "2036-12-01")).toEqual([aviso2036]);
  });

  it("no avisa por una fecha que cae en sábado o domingo: ya es inhábil", () => {
    expect(diaSemana(2030, 12)).toBe(0);
    expect(avisosTransmisionCff("2030-11-29", "2030-12-02")).toEqual([]);
    expect(diaSemana(2072, 10)).toBe(6);
    expect(avisosTransmisionCff("2072-09-30", "2072-10-03")).toEqual([]);
    expect(diaSemana(2084, 10)).toBe(0);
    expect(avisosTransmisionCff("2084-09-29", "2084-10-02")).toEqual([]);
    expect(diaSemana(2096, 12)).toBe(6);
    expect(avisosTransmisionCff("2096-11-30", "2096-12-03")).toEqual([]);
    // La otra fecha de esos años sí avisa.
    expect(avisosTransmisionCff("2072-11-30", "2072-12-01")).toEqual([avisoTransmisionCff(2072)]);
    expect(avisosTransmisionCff("2096-09-30", "2096-10-01")).toEqual([avisoTransmisionCff(2096)]);
  });

  it("no cuenta el día de partida, como el cálculo", () => {
    expect(avisosTransmisionCff("2030-10-01", "2030-10-15")).toEqual([]);
    expect(avisosTransmisionCff("2036-12-01", "2037-01-15")).toEqual([]);
  });

  it("no avisa si el cálculo no pasa por esos días", () => {
    expect(avisosTransmisionCff("2030-10-02", "2030-11-30")).toEqual([]);
    expect(avisosTransmisionCff("2026-01-01", "2029-12-31")).toEqual([]);
    expect(avisosTransmisionCff("2031-01-01", "2035-12-31")).toEqual([]);
  });

  it("da un aviso por cada año de transmisión dentro de la cobertura", () => {
    expect(avisosTransmisionCff("2026-01-01", "2037-01-01")).toEqual([aviso2030, aviso2036]);
    expect(avisosTransmisionCff("2024-09-01", "2024-12-31")).toEqual([]);
    expect(avisosTransmisionCff("2096-09-01", "2102-12-31")).toEqual([avisoTransmisionCff(2096)]);
  });
});
