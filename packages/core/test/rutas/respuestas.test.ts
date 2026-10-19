import { describe, expect, it, vi } from "vitest";
import { AVISO_LFT_715, diasDescansoLft, VIGENCIA_LFT } from "../../src/dias-habiles/lft.js";
import {
  CalendarioIncompletoError,
  FechaFueraDeRangoError,
  SerieIncompletaError,
} from "../../src/errores.js";
import type { Consulta, OpcionesFix } from "../../src/indicadores/consulta.js";
import {
  consultarConFeriados,
  diasInhabilesLft,
  fechaEnTexto,
  metaLft,
  problemaDeError,
  problemaSinRegistro,
  sinPublicacionFix,
} from "../../src/rutas/respuestas.js";

describe("fechaEnTexto", () => {
  it("escribe la fecha como en las citas: día sin cero, mes en minúsculas y año", () => {
    expect(fechaEnTexto("2026-05-14")).toBe("14 de mayo de 2026");
    expect(fechaEnTexto("2026-01-01")).toBe("1 de enero de 2026");
    expect(fechaEnTexto("2099-12-31")).toBe("31 de diciembre de 2099");
  });

  it("lanza RangeError con una fecha que no existe", () => {
    expect(() => fechaEnTexto("2026-02-30")).toThrow(RangeError);
  });
});

describe("metaLft", () => {
  it("es la meta que da la API, con la fecha de la reforma de VIGENCIA_LFT", () => {
    expect(metaLft("dias-habiles")).toEqual({
      dataset: "dias-inhabiles.lft",
      as_of: "2026-05-14",
      sources: [
        {
          name: "Ley Federal del Trabajo, artículos 74 (descanso obligatorio) y 715 (sábados y domingos)",
          url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
          license:
            "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
          license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
          citation:
            "Ley Federal del Trabajo: del artículo 74, los días de descanso obligatorio; del artículo 715, solo los sábados y domingos. Texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
        },
      ],
      docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#dias-habiles",
    });
    expect(metaLft("dias-inhabiles").docs).toBe(
      "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#dias-inhabiles",
    );
  });

  it("la cita sale de VIGENCIA_LFT, no de una fecha escrita a mano", () => {
    const { as_of, sources } = metaLft("dias-habiles");
    expect(as_of).toBe(VIGENCIA_LFT);
    expect(sources[0]?.citation).toContain(`el ${fechaEnTexto(VIGENCIA_LFT)}.`);
  });

  it("está congelada y es la misma en cada llamada", () => {
    const meta = metaLft("dias-habiles");
    expect(metaLft("dias-habiles")).toBe(meta);
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta.sources)).toBe(true);
    expect(Object.isFrozen(meta.sources[0])).toBe(true);
  });
});

describe("problemaDeError", () => {
  it("un calendario incompleto es 422 con la autoridad, la fecha, la cobertura y su detalle", () => {
    const error = new CalendarioIncompletoError(
      "sat",
      "2031-02-03",
      { desde: "2030-01-01", hasta: "2031-01-31" },
      "Texto del núcleo.",
    );
    expect(problemaDeError(error)).toEqual({
      tipo: "calendario-incompleto",
      detalle: "Texto del núcleo.",
      extras: {
        autoridad: "sat",
        fecha: "2031-02-03",
        cobertura: { desde: "2030-01-01", hasta: "2031-01-31" },
      },
    });
  });

  it("una fecha fuera de rango es 400 en desde", () => {
    expect(problemaDeError(new FechaFueraDeRangoError())).toEqual({
      tipo: "parametro-invalido",
      detalle: "Con estos días, el resultado pasaría del año 9999.",
      extras: { parametro: "desde" },
    });
  });

  it("compara el tipo y no la clase: reconoce el error de otra copia del núcleo", () => {
    const copia = Object.assign(new Error("x"), {
      name: "CalendarioIncompletoError",
      tipo: "calendario-incompleto",
      autoridad: "cnbv",
      fecha: "2027-01-04",
      cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
      detalle: "Detalle de la copia.",
    });
    expect(problemaDeError(copia)).toMatchObject({
      tipo: "calendario-incompleto",
      detalle: "Detalle de la copia.",
    });
  });

  it("cualquier otro error no es un problema de la consulta", () => {
    const serie = new SerieIncompletaError(
      "2026-01-02",
      { desde: "2026-01-01", hasta: "2026-01-31" },
      "x",
    );
    for (const error of [new RangeError("x"), new TypeError("x"), serie, null, "texto", 3]) {
      expect(problemaDeError(error)).toBeNull();
    }
  });
});

describe("problemaSinRegistro", () => {
  it("sin_dato es definitivo (no-encontrado) y no_disponible puede cambiar", () => {
    expect(problemaSinRegistro("sin_dato", "No hubo.")).toEqual({
      tipo: "no-encontrado",
      detalle: "No hubo.",
    });
    expect(problemaSinRegistro("no_disponible", "Todavía no.", { fecha: "2027-01-01" })).toEqual({
      tipo: "dato-no-disponible",
      detalle: "Todavía no.",
      extras: { fecha: "2027-01-01" },
    });
  });
});

describe("sinPublicacionFix", () => {
  it("dice que ese día no hubo FIX y qué consulta da el de una operación de ese día", () => {
    expect(sinPublicacionFix("2026-10-18")).toBe(
      "No hubo publicación del FIX en el DOF el 2026-10-18. Para el FIX que aplica a una operación de ese día, usa operacion=2026-10-18.",
    );
  });
});

describe("consultarConFeriados", () => {
  type C = Consulta<string>;
  const encontrado: C = { tipo: "encontrado", registro: "x" };
  const noDisponible: C = { tipo: "no_disponible" };

  it("si la consulta sin feriados ya responde, no pide los feriados", async () => {
    for (const primera of [encontrado, { tipo: "sin_dato" } as C]) {
      const feriados = vi.fn(async () => () => true);
      const consultar = vi.fn(() => primera);
      expect(await consultarConFeriados(consultar, feriados)).toBe(primera);
      expect(feriados).not.toHaveBeenCalled();
      expect(consultar).toHaveBeenCalledTimes(1);
      expect(consultar).toHaveBeenCalledWith();
    }
  });

  it("con no_disponible repite la consulta con los feriados", async () => {
    const esFeriado = (fecha: string) => fecha === "2027-01-01";
    const consultar = vi.fn((opciones?: OpcionesFix) =>
      opciones === undefined ? noDisponible : encontrado,
    );
    expect(await consultarConFeriados(consultar, async () => esFeriado)).toBe(encontrado);
    expect(consultar).toHaveBeenLastCalledWith({ sinPublicacion: esFeriado });
  });

  it("si los feriados no cargan, se queda con la consulta sin ellos", async () => {
    const consultar = vi.fn(() => noDisponible);
    expect(await consultarConFeriados(consultar, async () => undefined)).toBe(noDisponible);
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});

describe("diasInhabilesLft", () => {
  it("lista los días del art. 74 del año con el aviso del art. 715", () => {
    expect(diasInhabilesLft(2026)).toEqual({
      dias: diasDescansoLft(2026),
      advertencias: [AVISO_LFT_715],
    });
  });

  it("fuera de la cobertura de la LFT lanza CalendarioIncompletoError, como la API", () => {
    expect(() => diasInhabilesLft(2101)).toThrow(CalendarioIncompletoError);
    let lanzado: unknown;
    try {
      diasInhabilesLft(2101);
    } catch (error) {
      lanzado = error;
    }
    expect(problemaDeError(lanzado)).toEqual({
      tipo: "calendario-incompleto",
      detalle: "El calendario de la LFT no cubre el año 2101; cubre del 2007-01-01 al 2100-12-31.",
      extras: {
        autoridad: "lft",
        fecha: "2101-01-01",
        cobertura: { desde: "2007-01-01", hasta: "2100-12-31" },
      },
    });
  });
});
