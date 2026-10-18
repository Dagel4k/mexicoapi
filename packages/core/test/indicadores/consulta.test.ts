import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TipoCambioFix, Udi } from "../../src/datos/indicadores.js";
import { SerieIncompletaError } from "../../src/errores.js";
import { aDias, deDias, diaSemanaDeDias } from "../../src/fechas.js";
import {
  type CoberturaSerie,
  type Consulta,
  FUENTE_CFF_20,
  fixParaOperacion,
  fixPublicado,
  udiDeFecha,
} from "../../src/indicadores/consulta.js";

const fix = (fecha_publicacion: string, valor: string): TipoCambioFix => ({
  fecha_publicacion,
  valor,
});
const udi = (fecha: string, valor: string): Udi => ({ fecha, valor });
const rango = (desde: string, hasta: string): CoberturaSerie => ({ desde, hasta });

const encontrado = <T>(registro: T): Consulta<T> => ({ tipo: "encontrado", registro });
const SIN_DATO = { tipo: "sin_dato" } as const;
const NO_DISPONIBLE = { tipo: "no_disponible" } as const;

/** Corre `consultar` y devuelve el SerieIncompletaError que lanza; falla si no lanza ese error. */
function errorDeSerie(consultar: () => unknown): SerieIncompletaError {
  try {
    consultar();
  } catch (error) {
    expect(error).toBeInstanceOf(SerieIncompletaError);
    return error as SerieIncompletaError;
  }
  throw new Error("se esperaba SerieIncompletaError");
}

// Valores de ejemplo. Jueves 15, viernes 16 y lunes 19 de octubre de 2026, de una serie que
// empieza en 2020: los tramos no arrancan en cobertura.desde.
const JUE = fix("2026-10-15", "18.4310");
const VIE = fix("2026-10-16", "18.4250");
const LUN = fix("2026-10-19", "18.3975");
const OCTUBRE = [JUE, VIE, LUN];
const HASTA_LUNES = rango("2020-01-02", "2026-10-19");
const HASTA_VIERNES = rango("2020-01-02", "2026-10-16");
// El shard de 2026 recortado a la cobertura.
const TRAMO_LUNES = rango("2026-10-15", "2026-10-19");
const TRAMO_VIERNES = rango("2026-10-15", "2026-10-16");
// Serie completa de tres publicaciones: el tramo es toda la serie.
const SOLO_OCTUBRE = rango("2026-10-15", "2026-10-19");

// Cambio de año: el 1 de enero no hay publicación.
const DIC_30 = fix("2025-12-30", "18.2100");
const DIC_31 = fix("2025-12-31", "18.1950");
const ENE_02 = fix("2026-01-02", "18.2400");
const ENE_05 = fix("2026-01-05", "18.2600");
const CAMBIO_DE_ANIO = [DIC_30, DIC_31, ENE_02, ENE_05];
const TRAMO_2025_2026 = rango("2025-01-01", "2026-10-19");
const TRAMO_2025 = rango("2025-01-01", "2025-12-31");
const TRAMO_2026 = rango("2026-01-01", "2026-10-19");

const FECHAS_INVALIDAS = [
  "2026-02-30",
  "2026-10-1",
  "16-10-2026",
  "2026-13-01",
  " 2026-10-16",
  "2026/10/16",
  "",
  20261016 as unknown as string,
  null as unknown as string,
];

describe("fixPublicado", () => {
  it.each([
    ["jueves con publicación", "2026-10-15", encontrado(JUE)],
    ["lunes, última fecha cargada", "2026-10-19", encontrado(LUN)],
    ["sábado sin publicación", "2026-10-17", SIN_DATO],
    ["domingo sin publicación", "2026-10-18", SIN_DATO],
    ["el día siguiente a hasta", "2026-10-20", NO_DISPONIBLE],
    ["un año después de hasta", "2027-10-19", NO_DISPONIBLE],
    ["antes del inicio de la serie", "2019-12-31", SIN_DATO],
    ["el año 0001", "0001-01-01", SIN_DATO],
  ])("%s (%s)", (_caso, fecha, esperado) => {
    expect(fixPublicado(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, fecha)).toEqual(esperado);
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = fixPublicado(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-16");
    expect(r.tipo === "encontrado" && r.registro).toBe(VIE);
  });

  it("responde en el primer día de la serie", () => {
    expect(fixPublicado(OCTUBRE, SOLO_OCTUBRE, SOLO_OCTUBRE, "2026-10-15")).toEqual(
      encontrado(JUE),
    );
    expect(fixPublicado(OCTUBRE, SOLO_OCTUBRE, SOLO_OCTUBRE, "2026-10-14")).toEqual(SIN_DATO);
  });

  it("cruza el cambio de año con un tramo de dos años", () => {
    const consultar = (fecha: string) =>
      fixPublicado(CAMBIO_DE_ANIO, TRAMO_2025_2026, HASTA_LUNES, fecha);
    expect(consultar("2026-01-01")).toEqual(SIN_DATO);
    expect(consultar("2025-12-31")).toEqual(encontrado(DIC_31));
    expect(consultar("2026-01-02")).toEqual(encontrado(ENE_02));
  });

  describe("después de hasta, solo con fin de semana de por medio", () => {
    it.each([
      ["sábado con hasta en viernes", "2026-10-17"],
      ["domingo con hasta en viernes", "2026-10-18"],
    ])("%s: sin_dato, porque no se espera publicación", (_caso, fecha) => {
      expect(fixPublicado([JUE, VIE], TRAMO_VIERNES, HASTA_VIERNES, fecha)).toEqual(SIN_DATO);
    });

    it.each([
      ["el lunes siguiente", HASTA_VIERNES, "2026-10-19"],
      ["un sábado con un día entre semana sin cargar", HASTA_LUNES, "2026-10-24"],
      ["el sábado de la semana siguiente", HASTA_VIERNES, "2026-10-24"],
    ])("%s: no_disponible", (_caso, cobertura, fecha) => {
      const tramo = cobertura === HASTA_VIERNES ? TRAMO_VIERNES : TRAMO_LUNES;
      expect(
        fixPublicado(
          OCTUBRE.filter((r) => r.fecha_publicacion <= cobertura.hasta),
          tramo,
          cobertura,
          fecha,
        ),
      ).toEqual(NO_DISPONIBLE);
    });

    it("no hace falta que el tramo llegue a la fecha", () => {
      expect(
        fixPublicado(
          [],
          rango("2026-01-01", "2026-01-02"),
          rango("2020-01-02", "2026-01-02"),
          "2026-01-04",
        ),
      ).toEqual(SIN_DATO);
    });
  });

  it("un tramo sin registros que cubre la fecha da sin_dato", () => {
    expect(fixPublicado([], rango("2026-10-17", "2026-10-18"), HASTA_LUNES, "2026-10-17")).toEqual(
      SIN_DATO,
    );
  });

  describe("tramo que no incluye la fecha", () => {
    it("lanza con el tramo del año equivocado", () => {
      const error = errorDeSerie(() =>
        fixPublicado([DIC_30, DIC_31], TRAMO_2025, HASTA_LUNES, "2026-10-16"),
      );
      expect(error.fecha).toBe("2026-10-16");
      expect(error.tramo).toEqual(TRAMO_2025);
    });

    it("lanza con un tramo más viejo que la cobertura", () => {
      // Reproduce un shard que se quedó en el viernes con una meta que ya llega al martes.
      errorDeSerie(() =>
        fixPublicado([JUE, VIE], TRAMO_VIERNES, rango("2020-01-02", "2026-10-20"), "2026-10-19"),
      );
    });

    it("no hace falta el tramo si la fecha queda fuera de la cobertura", () => {
      expect(fixPublicado([], TRAMO_LUNES, HASTA_LUNES, "2019-12-31")).toEqual(SIN_DATO);
      expect(fixPublicado([], TRAMO_LUNES, HASTA_LUNES, "2026-10-20")).toEqual(NO_DISPONIBLE);
    });
  });
});

describe("fixParaOperacion (CFF art. 20)", () => {
  it.each([
    [
      "lunes: la víspera es domingo, aplica el viernes",
      OCTUBRE,
      TRAMO_LUNES,
      HASTA_LUNES,
      "2026-10-19",
      VIE,
    ],
    ["martes: aplica la del lunes", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-20", LUN],
    ["viernes: aplica la del jueves", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-16", JUE],
    ["sábado: aplica la del viernes", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-17", VIE],
    ["domingo: aplica la del viernes", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-18", VIE],
    [
      "lunes con hasta en viernes: el hueco es fin de semana",
      [JUE, VIE],
      TRAMO_VIERNES,
      HASTA_VIERNES,
      "2026-10-19",
      VIE,
    ],
    ["sábado con hasta en viernes", [JUE, VIE], TRAMO_VIERNES, HASTA_VIERNES, "2026-10-17", VIE],
    ["domingo con hasta en viernes", [JUE, VIE], TRAMO_VIERNES, HASTA_VIERNES, "2026-10-18", VIE],
    [
      "el día siguiente al inicio de la serie",
      OCTUBRE,
      SOLO_OCTUBRE,
      SOLO_OCTUBRE,
      "2026-10-16",
      JUE,
    ],
    [
      "un tramo que llega a la víspera aunque no a hasta",
      [JUE, VIE],
      rango("2026-10-15", "2026-10-18"),
      HASTA_LUNES,
      "2026-10-19",
      VIE,
    ],
  ])("%s", (_caso, serie, tramo, cobertura, fecha, esperado) => {
    expect(fixParaOperacion(serie, tramo, cobertura, fecha)).toEqual(encontrado(esperado));
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = fixParaOperacion(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-19");
    expect(r.tipo === "encontrado" && r.registro).toBe(VIE);
  });

  it.each([
    [
      "miércoles con hasta en lunes: falta la publicación del martes",
      OCTUBRE,
      TRAMO_LUNES,
      HASTA_LUNES,
      "2026-10-21",
    ],
    [
      "martes con hasta en viernes: falta la del lunes",
      [JUE, VIE],
      TRAMO_VIERNES,
      HASTA_VIERNES,
      "2026-10-20",
    ],
    ["una semana después de hasta", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-26"],
    ["años después de hasta", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2030-01-01"],
    ["el último día representable", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "9999-12-31"],
    ["sin registros en el tramo", [], TRAMO_LUNES, HASTA_LUNES, "2026-10-21"],
  ])("%s: no da un valor viejo", (_caso, serie, tramo, cobertura, fecha) => {
    expect(fixParaOperacion(serie, tramo, cobertura, fecha)).toEqual(NO_DISPONIBLE);
  });

  it.each([
    ["el primer día de la serie", OCTUBRE, SOLO_OCTUBRE, SOLO_OCTUBRE, "2026-10-15"],
    ["antes de la serie", OCTUBRE, SOLO_OCTUBRE, SOLO_OCTUBRE, "2026-10-14"],
    ["el inicio de una serie que empieza en 2020", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2020-01-02"],
    ["antes de 2020", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2019-06-30"],
    ["el año 0001", OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "0001-01-01"],
    // La cobertura empieza en una fecha sin publicación y el tramo la incluye completa.
    [
      "un desde sin publicación",
      [ENE_02],
      rango("2026-01-01", "2026-01-02"),
      rango("2026-01-01", "2026-01-02"),
      "2026-01-02",
    ],
  ])("%s: no hay publicación anterior", (_caso, serie, tramo, cobertura, fecha) => {
    expect(fixParaOperacion(serie, tramo, cobertura, fecha)).toEqual(SIN_DATO);
  });

  describe("cambio de año", () => {
    it.each([
      ["2 de enero: usa la última publicación de diciembre", "2026-01-02", DIC_31],
      ["1 de enero: usa la del 31 de diciembre", "2026-01-01", DIC_31],
      ["31 de diciembre: usa la del 30", "2025-12-31", DIC_30],
      ["sábado 3 de enero: usa la del 2", "2026-01-03", ENE_02],
      ["lunes 5 de enero: usa la del viernes 2", "2026-01-05", ENE_02],
      ["martes 6 de enero: usa la del lunes 5", "2026-01-06", ENE_05],
    ])("%s", (_caso, fecha, esperado) => {
      expect(fixParaOperacion(CAMBIO_DE_ANIO, TRAMO_2025_2026, HASTA_LUNES, fecha)).toEqual(
        encontrado(esperado),
      );
    });

    it("basta el año de la víspera cuando trae una publicación anterior", () => {
      expect(fixParaOperacion([DIC_30, DIC_31], TRAMO_2025, HASTA_LUNES, "2026-01-01")).toEqual(
        encontrado(DIC_31),
      );
    });

    it("lanza si falta el año anterior", () => {
      const error = errorDeSerie(() =>
        fixParaOperacion([ENE_02, ENE_05], TRAMO_2026, HASTA_LUNES, "2026-01-02"),
      );
      expect(error.codigo).toBe("serie-incompleta");
      expect(error.fecha).toBe("2026-01-02");
      expect(error.tramo).toEqual(TRAMO_2026);
      expect(error.message).toContain("anterior");
    });

    it("lanza con el tramo del año anterior si la víspera ya es del año nuevo", () => {
      // Reproduce el shard de 2025 solo, para una operación del martes 6 de enero de 2026.
      errorDeSerie(() => fixParaOperacion([DIC_30, DIC_31], TRAMO_2025, HASTA_LUNES, "2026-01-06"));
    });

    describe("31 de diciembre en sábado: el shard de 2022 termina el viernes 30", () => {
      const DIC_29_22 = fix("2022-12-29", "19.4400");
      const DIC_30_22 = fix("2022-12-30", "19.3600");
      const ENE_02_23 = fix("2023-01-02", "19.4700");
      const ENE_03_23 = fix("2023-01-03", "19.3200");
      const SHARD_2022 = [DIC_29_22, DIC_30_22];
      const SHARD_2023 = [ENE_02_23, ENE_03_23];
      const TRAMO_2022 = rango("2022-01-01", "2022-12-31");
      const TRAMO_2023 = rango("2023-01-01", "2023-12-31");

      it("el 31 no tiene publicación y la operación del 31 usa la del 30", () => {
        expect(fixPublicado(SHARD_2022, TRAMO_2022, HASTA_LUNES, "2022-12-31")).toEqual(SIN_DATO);
        expect(fixParaOperacion(SHARD_2022, TRAMO_2022, HASTA_LUNES, "2022-12-31")).toEqual(
          encontrado(DIC_30_22),
        );
      });

      it("la operación del 1 de enero usa la del 30 con el shard de 2022", () => {
        expect(fixParaOperacion(SHARD_2022, TRAMO_2022, HASTA_LUNES, "2023-01-01")).toEqual(
          encontrado(DIC_30_22),
        );
      });

      it("la operación del lunes 2 de enero necesita los dos años", () => {
        const dosAnios = [...SHARD_2022, ...SHARD_2023];
        expect(
          fixParaOperacion(dosAnios, rango("2022-01-01", "2023-12-31"), HASTA_LUNES, "2023-01-02"),
        ).toEqual(encontrado(DIC_30_22));
        errorDeSerie(() => fixParaOperacion(SHARD_2022, TRAMO_2022, HASTA_LUNES, "2023-01-02"));
        errorDeSerie(() => fixParaOperacion(SHARD_2023, TRAMO_2023, HASTA_LUNES, "2023-01-02"));
      });

      it("la operación del 3 de enero basta con el shard de 2023", () => {
        expect(fixParaOperacion(SHARD_2023, TRAMO_2023, HASTA_LUNES, "2023-01-03")).toEqual(
          encontrado(ENE_02_23),
        );
      });
    });

    describe("primera publicación del año después del 2 de enero (lunes 4 de enero de 2027)", () => {
      const DIC_31_26 = fix("2026-12-31", "18.9000");
      const ENE_04_27 = fix("2027-01-04", "18.9500");
      const ENE_05_27 = fix("2027-01-05", "18.9300");
      const COBERTURA = rango("2020-01-02", "2027-01-05");
      const TRAMO_2027 = rango("2027-01-01", "2027-01-05");

      it("el 2 de enero no hay publicación y el 4 sí", () => {
        const serie = [ENE_04_27, ENE_05_27];
        expect(fixPublicado(serie, TRAMO_2027, COBERTURA, "2027-01-02")).toEqual(SIN_DATO);
        expect(fixPublicado(serie, TRAMO_2027, COBERTURA, "2027-01-04")).toEqual(
          encontrado(ENE_04_27),
        );
      });

      it("la operación del 4 usa la del 31 de diciembre y necesita 2026", () => {
        errorDeSerie(() =>
          fixParaOperacion([ENE_04_27, ENE_05_27], TRAMO_2027, COBERTURA, "2027-01-04"),
        );
        expect(
          fixParaOperacion(
            [DIC_31_26, ENE_04_27, ENE_05_27],
            rango("2026-01-01", "2027-01-05"),
            COBERTURA,
            "2027-01-04",
          ),
        ).toEqual(encontrado(DIC_31_26));
      });

      it("la operación del 5 usa la del 4 con el shard de 2027", () => {
        expect(
          fixParaOperacion([ENE_04_27, ENE_05_27], TRAMO_2027, COBERTURA, "2027-01-05"),
        ).toEqual(encontrado(ENE_04_27));
      });

      it("la operación del 1 de enero usa la del 31 con el shard de 2026", () => {
        expect(
          fixParaOperacion([DIC_31_26], rango("2026-01-01", "2026-12-31"), COBERTURA, "2027-01-01"),
        ).toEqual(encontrado(DIC_31_26));
      });
    });
  });

  describe("tramo incompleto", () => {
    it("lanza si en el tramo no hay publicación anterior a la fecha", () => {
      const error = errorDeSerie(() =>
        fixParaOperacion(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2026-10-15"),
      );
      expect(error.message).toContain("2026-10-15");
      errorDeSerie(() => fixParaOperacion([], TRAMO_LUNES, HASTA_LUNES, "2026-10-19"));
    });

    it("lanza con un tramo más viejo que la cobertura", () => {
      // Reproduce un shard que se quedó en el viernes con una meta que ya llega al martes.
      const error = errorDeSerie(() =>
        fixParaOperacion(
          [JUE, VIE],
          TRAMO_VIERNES,
          rango("2020-01-02", "2026-10-20"),
          "2026-10-20",
        ),
      );
      expect(error.message).toContain("2026-10-19");
    });

    it("lanza si el tramo no llega a la víspera", () => {
      errorDeSerie(() => fixParaOperacion([JUE, VIE], TRAMO_VIERNES, HASTA_LUNES, "2026-10-19"));
    });

    it("lanza con el tramo de un año posterior a la fecha", () => {
      errorDeSerie(() => fixParaOperacion(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, "2025-06-10"));
    });
  });

  it("revisa pocas posiciones de una serie larga (búsqueda binaria)", () => {
    const base = aDias("2020-01-02");
    const registros = Array.from({ length: 100_000 }, (_, i) => fix(deDias(base + i), "18.0000"));
    const ultima = registros.at(-1) as TipoCambioFix;
    const cobertura = rango("2020-01-02", ultima.fecha_publicacion);
    let lecturas = 0;
    const serie = new Proxy(registros, {
      get(objetivo, propiedad, receptor) {
        if (typeof propiedad === "string" && /^[0-9]+$/.test(propiedad)) lecturas++;
        return Reflect.get(objetivo, propiedad, receptor);
      },
    });
    const fecha = deDias(base + 54_321);
    // log2(100 000) < 17: una lectura por paso, más el primero, el último y el que se devuelve.
    expect(fixParaOperacion(serie, cobertura, cobertura, fecha)).toEqual(
      encontrado(registros[54_320] as TipoCambioFix),
    );
    expect(lecturas).toBeLessThanOrEqual(22);
    lecturas = 0;
    expect(fixPublicado(serie, cobertura, cobertura, fecha)).toEqual(
      encontrado(registros[54_321] as TipoCambioFix),
    );
    expect(lecturas).toBeLessThanOrEqual(22);
  });
});

describe("días sin publicación entre semana (sinPublicacion)", () => {
  // Lunes 16 de noviembre de 2026: feriado bancario. Lo cargado termina el viernes 13.
  const JUE_12 = fix("2026-11-12", "18.3000");
  const VIE_13 = fix("2026-11-13", "18.3100");
  const NOVIEMBRE = [JUE_12, VIE_13];
  const HASTA_13 = rango("2020-01-02", "2026-11-13");
  const TRAMO_13 = rango("2026-01-01", "2026-11-13");
  const FERIADOS = new Set(["2026-04-02", "2026-04-03", "2026-09-16", "2026-11-02", "2026-11-16"]);
  const feriados = { sinPublicacion: (fecha: string) => FERIADOS.has(fecha) };

  it("lunes feriado: la operación del martes usa el viernes en vez de no_disponible", () => {
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17")).toEqual(NO_DISPONIBLE);
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17", feriados)).toEqual(
      encontrado(VIE_13),
    );
  });

  it("lunes feriado: publicado ese lunes es sin_dato en vez de no_disponible", () => {
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-16")).toEqual(NO_DISPONIBLE);
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-16", feriados)).toEqual(SIN_DATO);
  });

  it("un día entre semana que no es feriado sigue sin cargarse: nunca un valor viejo", () => {
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-18", feriados)).toEqual(
      NO_DISPONIBLE,
    );
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17", feriados)).toEqual(
      NO_DISPONIBLE,
    );
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-21", feriados)).toEqual(
      NO_DISPONIBLE,
    );
  });

  it("lunes 2 de noviembre de 2026, con lo cargado hasta el viernes 30 de octubre", () => {
    const VIE_30 = fix("2026-10-30", "18.5000");
    const hasta = rango("2020-01-02", "2026-10-30");
    const tramo = rango("2026-01-01", "2026-10-30");
    expect(fixParaOperacion([VIE_30], tramo, hasta, "2026-11-03", feriados)).toEqual(
      encontrado(VIE_30),
    );
    expect(fixPublicado([VIE_30], tramo, hasta, "2026-11-02", feriados)).toEqual(SIN_DATO);
    expect(fixParaOperacion([VIE_30], tramo, hasta, "2026-11-04", feriados)).toEqual(NO_DISPONIBLE);
  });

  it("un feriado a media semana y dos seguidos antes del fin de semana", () => {
    const MAR_15 = fix("2026-09-15", "18.9000");
    const septiembre = rango("2026-01-01", "2026-09-15");
    const hastaSep = rango("2020-01-02", "2026-09-15");
    expect(fixParaOperacion([MAR_15], septiembre, hastaSep, "2026-09-17", feriados)).toEqual(
      encontrado(MAR_15),
    );
    expect(fixPublicado([MAR_15], septiembre, hastaSep, "2026-09-16", feriados)).toEqual(SIN_DATO);
    // Jueves 2 y viernes 3 de abril, y luego el fin de semana.
    const MIE_1 = fix("2026-04-01", "17.9000");
    const abril = rango("2026-01-01", "2026-04-01");
    const hastaAbr = rango("2020-01-02", "2026-04-01");
    for (const fecha of ["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06"]) {
      expect(fixParaOperacion([MIE_1], abril, hastaAbr, fecha, feriados), fecha).toEqual(
        encontrado(MIE_1),
      );
    }
    expect(fixPublicado([MIE_1], abril, hastaAbr, "2026-04-05", feriados)).toEqual(SIN_DATO);
    expect(fixParaOperacion([MIE_1], abril, hastaAbr, "2026-04-07", feriados)).toEqual(
      NO_DISPONIBLE,
    );
  });

  it("solo pregunta por días entre semana posteriores a lo cargado y anteriores a la respuesta", () => {
    const consultados: string[] = [];
    const opciones = {
      sinPublicacion: (fecha: string) => {
        consultados.push(fecha);
        return FERIADOS.has(fecha);
      },
    };
    fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17", opciones);
    expect(consultados).toEqual(["2026-11-16"]);
    consultados.length = 0;
    fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-20", opciones);
    // Se detiene en el primer día en que pudo haber publicación.
    expect(consultados).toEqual(["2026-11-16", "2026-11-17"]);
    consultados.length = 0;
    // Dentro de lo cargado responde la serie, sin preguntar.
    fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-13", opciones);
    fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-14", opciones);
    expect(consultados).toEqual([]);
  });

  it("solo un true marca un día sin publicación", () => {
    const parecido = { sinPublicacion: () => "sí" as unknown as boolean };
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17", parecido)).toEqual(
      NO_DISPONIBLE,
    );
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-16", parecido)).toEqual(
      NO_DISPONIBLE,
    );
  });

  it("sinPublicacion que no es función lanza TypeError, aunque no haga falta", () => {
    for (const malo of [true, "2026-11-16", 1, {}] as unknown[]) {
      const opciones = { sinPublicacion: malo } as unknown as typeof feriados;
      expect(() => fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-13", opciones)).toThrow(
        TypeError,
      );
      expect(() => fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-13", opciones)).toThrow(
        "sinPublicacion debe ser una función",
      );
    }
  });

  it("opciones vacías o null equivalen a no pasarlas", () => {
    for (const opciones of [undefined, {}, { sinPublicacion: undefined }, null] as unknown[]) {
      const o = opciones as typeof feriados;
      expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-17", o)).toEqual(
        NO_DISPONIBLE,
      );
      expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-11-14", o)).toEqual(SIN_DATO);
    }
  });

  it("el tramo debe alcanzar igual que sin la opción", () => {
    errorDeSerie(() =>
      fixParaOperacion(
        [JUE_12],
        rango("2026-01-01", "2026-11-12"),
        HASTA_13,
        "2026-11-17",
        feriados,
      ),
    );
  });

  it("un hueco de más de 31 días después de lo cargado es no_disponible sin recorrerlo", () => {
    let consultas = 0;
    const siempre = {
      sinPublicacion: () => {
        consultas++;
        return true;
      },
    };
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "9999-12-31", siempre)).toEqual(
      NO_DISPONIBLE,
    );
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "9999-12-31", siempre)).toEqual(
      NO_DISPONIBLE,
    );
    expect(consultas).toBe(0);
    // En el límite: 31 días después del viernes 13 todavía se revisan; 32 ya no.
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-12-15", siempre)).toEqual(
      encontrado(VIE_13),
    );
    expect(fixParaOperacion(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-12-16", siempre)).toEqual(
      NO_DISPONIBLE,
    );
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-12-14", siempre)).toEqual(SIN_DATO);
    expect(fixPublicado(NOVIEMBRE, TRAMO_13, HASTA_13, "2026-12-15", siempre)).toEqual(
      NO_DISPONIBLE,
    );
  });
});

describe("udiDeFecha", () => {
  const ULTIMO_DIC = udi("2025-12-31", "8.640123");
  const ANIO_NUEVO = udi("2026-01-01", "8.641001");
  const ENE_2 = udi("2026-01-02", "8.641879");
  const UDIS = [ULTIMO_DIC, ANIO_NUEVO, ENE_2];
  const COBERTURA_UDIS = rango("2020-01-01", "2026-01-02");
  const TRAMO_UDIS = rango("2025-12-31", "2026-01-02");

  it.each([
    ["dentro de la cobertura", "2026-01-01", encontrado(ANIO_NUEVO)],
    ["el último día cargado", "2026-01-02", encontrado(ENE_2)],
    ["antes de la cobertura", "2019-12-31", SIN_DATO],
    ["después de la cobertura", "2026-01-03", NO_DISPONIBLE],
    ["mucho después de la cobertura", "2099-01-01", NO_DISPONIBLE],
  ])("%s (%s)", (_caso, fecha, esperado) => {
    expect(udiDeFecha(UDIS, TRAMO_UDIS, COBERTURA_UDIS, fecha)).toEqual(esperado);
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = udiDeFecha(UDIS, TRAMO_UDIS, COBERTURA_UDIS, "2025-12-31");
    expect(r.tipo === "encontrado" && r.registro).toBe(ULTIMO_DIC);
  });

  it("responde el primer día de la serie", () => {
    const primero = udi("2020-01-01", "6.399018");
    const serie = rango("2020-01-01", "2020-01-01");
    expect(udiDeFecha([primero], serie, serie, "2020-01-01")).toEqual(encontrado(primero));
  });

  it("un hueco dentro del tramo da sin_dato", () => {
    expect(udiDeFecha([ULTIMO_DIC, ENE_2], TRAMO_UDIS, COBERTURA_UDIS, "2026-01-01")).toEqual(
      SIN_DATO,
    );
  });

  it("lanza si el tramo no incluye la fecha", () => {
    const error = errorDeSerie(() => udiDeFecha(UDIS, TRAMO_UDIS, COBERTURA_UDIS, "2025-06-01"));
    expect(error.fecha).toBe("2025-06-01");
    // Un tramo vacío que no llega a la fecha.
    errorDeSerie(() =>
      udiDeFecha([], rango("2025-01-01", "2025-12-31"), COBERTURA_UDIS, "2026-01-01"),
    );
  });
});

describe("consistencia del tramo", () => {
  it.each([
    [
      "un registro antes del tramo",
      [fix("2026-10-14", "18.5000"), ...OCTUBRE],
      TRAMO_LUNES,
      HASTA_LUNES,
    ],
    ["un registro después del tramo", OCTUBRE, TRAMO_VIERNES, HASTA_LUNES],
    // El shard trae una publicación que la meta todavía no cubre.
    ["un registro después de la cobertura", OCTUBRE, TRAMO_VIERNES, HASTA_VIERNES],
  ])("las tres lanzan SerieIncompletaError con %s", (_caso, serie, tramo, cobertura) => {
    errorDeSerie(() => fixPublicado(serie, tramo, cobertura, "2026-10-16"));
    errorDeSerie(() => fixParaOperacion(serie, tramo, cobertura, "2026-10-16"));
    const udis = serie.map((r) => udi(r.fecha_publicacion, "8.000000"));
    errorDeSerie(() => udiDeFecha(udis, tramo, cobertura, "2026-10-16"));
  });
});

describe("validación de entradas", () => {
  const consultas = [
    ["fixPublicado", (f: string) => fixPublicado(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, f)],
    ["fixParaOperacion", (f: string) => fixParaOperacion(OCTUBRE, TRAMO_LUNES, HASTA_LUNES, f)],
    ["udiDeFecha", (f: string) => udiDeFecha([], TRAMO_LUNES, HASTA_LUNES, f)],
  ] as const;

  it.each(consultas)("%s lanza RangeError con una fecha inválida", (_nombre, consultar) => {
    for (const fecha of FECHAS_INVALIDAS) {
      expect(() => consultar(fecha), String(fecha)).toThrow(RangeError);
    }
    expect(() => consultar("2026-02-30")).toThrow("Fecha ISO inválida: 2026-02-30");
  });

  it.each([
    ["desde posterior a hasta", rango("2026-10-20", "2026-10-19")],
    ["desde inválida", rango("2020-1-2", "2026-10-19")],
    ["hasta inválida", rango("2020-01-02", "2026-02-30")],
  ])("las tres lanzan RangeError con una cobertura o un tramo con %s", (_caso, malo) => {
    expect(() => fixPublicado(OCTUBRE, TRAMO_LUNES, malo, "2026-10-16")).toThrow(RangeError);
    expect(() => fixParaOperacion(OCTUBRE, TRAMO_LUNES, malo, "2026-10-16")).toThrow(RangeError);
    expect(() => udiDeFecha([], TRAMO_LUNES, malo, "2026-10-16")).toThrow(RangeError);
    expect(() => fixPublicado(OCTUBRE, malo, HASTA_LUNES, "2026-10-16")).toThrow(RangeError);
    expect(() => fixParaOperacion(OCTUBRE, malo, HASTA_LUNES, "2026-10-16")).toThrow(RangeError);
    expect(() => udiDeFecha([], malo, HASTA_LUNES, "2026-10-16")).toThrow(RangeError);
  });

  it("lanza RangeError si el tramo sale de la cobertura (por ejemplo, si se invierten)", () => {
    expect(() => fixPublicado(OCTUBRE, HASTA_LUNES, TRAMO_LUNES, "2026-10-16")).toThrow(
      "El tramo debe estar dentro de la cobertura",
    );
    expect(() => fixParaOperacion(OCTUBRE, HASTA_LUNES, TRAMO_LUNES, "2026-10-16")).toThrow(
      RangeError,
    );
    expect(() =>
      udiDeFecha([], rango("2026-10-15", "2026-10-20"), HASTA_LUNES, "2026-10-16"),
    ).toThrow(RangeError);
  });
});

describe("SerieIncompletaError", () => {
  it("lleva código, fecha y tramo, y no es un RangeError", () => {
    const tramo = { desde: "2026-01-01", hasta: "2026-10-19" };
    const error = new SerieIncompletaError("2026-01-02", tramo, "falta el año anterior");
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error.name).toBe("SerieIncompletaError");
    expect(error.codigo).toBe("serie-incompleta");
    expect(error.fecha).toBe("2026-01-02");
    expect(error.tramo).toEqual(tramo);
    expect(error.tramo).not.toBe(tramo);
    expect(Object.isFrozen(error.tramo)).toBe(true);
    expect(error.message).toBe(
      "Serie incompleta para 2026-01-02: falta el año anterior; tramo cargado 2026-01-01 a 2026-10-19.",
    );
  });
});

describe("propiedades", () => {
  const BASE = aDias("2026-09-01");
  const esFinDeSemana = (dia: number) => {
    const semana = diaSemanaDeDias(dia);
    return semana === 0 || semana === 6;
  };
  const fechaDe = (desplazamiento: number) => deDias(BASE + desplazamiento);
  // Serie de prueba: días distintos entre el 1 de septiembre y el 30 de octubre, ordenados, con
  // una cobertura que puede empezar antes del primer registro y terminar después del último.
  const casoArb = fc.record({
    dias: fc.uniqueArray(fc.integer({ min: 0, max: 59 }), { minLength: 1, maxLength: 40 }),
    antes: fc.integer({ min: 0, max: 3 }),
    despues: fc.integer({ min: 0, max: 3 }),
    fecha: fc.integer({ min: -8, max: 70 }),
    // Extremos del tramo como fracción de la cobertura.
    a: fc.double({ min: 0, max: 1, noNaN: true }),
    b: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  /** Respuesta con el tramo recortado: la correcta o SerieIncompletaError, nunca otra. */
  function igualOIncompleta<T>(conTramo: () => Consulta<T>, correcta: Consulta<T>): boolean {
    try {
      expect(conTramo()).toEqual(correcta);
      return true;
    } catch (error) {
      if (!(error instanceof SerieIncompletaError)) throw error;
      return false;
    }
  }

  it("con toda la serie coinciden con un recorrido lineal; con un tramo, aciertan o lanzan", () => {
    let respondidas = 0;
    let incompletas = 0;
    fc.assert(
      fc.property(casoArb, ({ dias, antes, despues, fecha: desplazamiento, a, b }) => {
        const ordenados = [...dias].sort((x, y) => x - y);
        const serie = ordenados.map((d) => fix(fechaDe(d), "18.0000"));
        const udis = ordenados.map((d) => udi(fechaDe(d), "8.000000"));
        const inicio = (ordenados[0] as number) - antes;
        const fin = (ordenados.at(-1) as number) + despues;
        const cobertura = rango(fechaDe(inicio), fechaDe(fin));
        const fecha = fechaDe(desplazamiento);

        // Referencia lineal con la serie completa.
        const hueco: number[] = [];
        for (let d = fin + 1; d < desplazamiento; d++) hueco.push(BASE + d);
        const exacto = serie.find((r) => r.fecha_publicacion === fecha);
        const publicado =
          fecha < cobertura.desde
            ? SIN_DATO
            : fecha > cobertura.hasta
              ? [...hueco, BASE + desplazamiento].every(esFinDeSemana)
                ? SIN_DATO
                : NO_DISPONIBLE
              : exacto
                ? encontrado(exacto)
                : SIN_DATO;
        const anterior = serie.filter((r) => r.fecha_publicacion < fecha).at(-1);
        const operacion =
          fecha <= cobertura.desde
            ? SIN_DATO
            : !hueco.every(esFinDeSemana)
              ? NO_DISPONIBLE
              : anterior
                ? encontrado(anterior)
                : SIN_DATO;
        const exactoUdi = udis.find((r) => r.fecha === fecha);
        const deUdi =
          fecha < cobertura.desde
            ? SIN_DATO
            : fecha > cobertura.hasta
              ? NO_DISPONIBLE
              : exactoUdi
                ? encontrado(exactoUdi)
                : SIN_DATO;

        expect(fixPublicado(serie, cobertura, cobertura, fecha)).toEqual(publicado);
        expect(fixParaOperacion(serie, cobertura, cobertura, fecha)).toEqual(operacion);
        expect(udiDeFecha(udis, cobertura, cobertura, fecha)).toEqual(deUdi);

        // Tramo recortado al principio y al final, con solo sus registros.
        const largo = fin - inicio;
        const x = inicio + Math.round(Math.min(a, b) * largo);
        const y = inicio + Math.round(Math.max(a, b) * largo);
        const tramo = rango(fechaDe(x), fechaDe(y));
        const dentro = (f: string) => f >= tramo.desde && f <= tramo.hasta;
        const parcial = serie.filter((r) => dentro(r.fecha_publicacion));
        const parcialUdi = udis.filter((r) => dentro(r.fecha));
        const resultados = [
          igualOIncompleta(() => fixPublicado(parcial, tramo, cobertura, fecha), publicado),
          igualOIncompleta(() => fixParaOperacion(parcial, tramo, cobertura, fecha), operacion),
          igualOIncompleta(() => udiDeFecha(parcialUdi, tramo, cobertura, fecha), deUdi),
        ];
        for (const r of resultados) {
          if (r) respondidas++;
          else incompletas++;
        }
      }),
      { numRuns: 500 },
    );
    // Las dos ramas se ejercitan.
    expect(respondidas).toBeGreaterThan(0);
    expect(incompletas).toBeGreaterThan(0);
  });

  /** Lo que devuelve o lanza `consultar`, para comparar dos llamadas. */
  function resultadoDe(consultar: () => unknown): unknown {
    try {
      return { devuelve: consultar() };
    } catch (error) {
      return { lanza: (error as Error).name, mensaje: (error as Error).message };
    }
  }

  const feriadosArb = fc.uniqueArray(fc.integer({ min: 0, max: 75 }), { maxLength: 20 });
  // Para que los feriados importen, la mitad de los casos pide una fecha poco después de lo
  // cargado y pone feriados justo ahí.
  const cercaArb = fc.record({
    cerca: fc.boolean(),
    delta: fc.integer({ min: 1, max: 8 }),
    cercanos: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { maxLength: 5 }),
  });
  const finDeSemanaIso = (fecha: string) => esFinDeSemana(aDias(fecha));

  it("sin sinPublicacion el resultado es idéntico al de la versión sin el parámetro", () => {
    fc.assert(
      fc.property(casoArb, ({ dias, antes, despues, fecha: desplazamiento, a, b }) => {
        const ordenados = [...dias].sort((x, y) => x - y);
        const serie = ordenados.map((d) => fix(fechaDe(d), "18.0000"));
        const inicio = (ordenados[0] as number) - antes;
        const fin = (ordenados.at(-1) as number) + despues;
        const cobertura = rango(fechaDe(inicio), fechaDe(fin));
        const fecha = fechaDe(desplazamiento);
        const largo = fin - inicio;
        const tramo = rango(
          fechaDe(inicio + Math.round(Math.min(a, b) * largo)),
          fechaDe(inicio + Math.round(Math.max(a, b) * largo)),
        );
        const parcial = serie.filter(
          (r) => r.fecha_publicacion >= tramo.desde && r.fecha_publicacion <= tramo.hasta,
        );
        const sinEfecto = [
          undefined,
          {},
          { sinPublicacion: undefined },
          { sinPublicacion: () => false },
          // Los fines de semana ya no cuentan: marcarlos no cambia nada.
          { sinPublicacion: finDeSemanaIso },
        ];
        for (const [s, t] of [
          [serie, cobertura],
          [parcial, tramo],
        ] as const) {
          const publicado = resultadoDe(() => fixPublicado(s, t, cobertura, fecha));
          const operacion = resultadoDe(() => fixParaOperacion(s, t, cobertura, fecha));
          for (const opciones of sinEfecto) {
            expect(resultadoDe(() => fixPublicado(s, t, cobertura, fecha, opciones))).toEqual(
              publicado,
            );
            expect(resultadoDe(() => fixParaOperacion(s, t, cobertura, fecha, opciones))).toEqual(
              operacion,
            );
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("con feriados coinciden con un recorrido lineal y solo cambian lo que era no_disponible", () => {
    let cambiadas = 0;
    fc.assert(
      fc.property(
        casoArb,
        feriadosArb,
        cercaArb,
        ({ dias, antes, despues, fecha: alAzar }, lejanos, { cerca, delta, cercanos }) => {
          const ordenados = [...dias].sort((x, y) => x - y);
          const serie = ordenados.map((d) => fix(fechaDe(d), "18.0000"));
          const inicio = (ordenados[0] as number) - antes;
          const fin = (ordenados.at(-1) as number) + despues;
          const cobertura = rango(fechaDe(inicio), fechaDe(fin));
          const desplazamiento = cerca ? fin + delta : alAzar;
          const fecha = fechaDe(desplazamiento);
          const feriados = new Set([...lejanos, ...cercanos.map((k) => fin + k)].map(fechaDe));
          const opciones = { sinPublicacion: (f: string) => feriados.has(f) };
          const sinPublicacion = (d: number) => esFinDeSemana(BASE + d) || feriados.has(fechaDe(d));
          // Un hueco de más de 31 días no se revisa: no_disponible.
          const cabe = (dias: number[]) => dias.length <= 31 && dias.every(sinPublicacion);

          // Referencia lineal: el hueco después de lo cargado solo puede tener días sin publicación.
          const hueco: number[] = [];
          for (let d = fin + 1; d < desplazamiento; d++) hueco.push(d);
          const exacto = serie.find((r) => r.fecha_publicacion === fecha);
          const publicado =
            fecha < cobertura.desde
              ? SIN_DATO
              : fecha > cobertura.hasta
                ? cabe([...hueco, desplazamiento])
                  ? SIN_DATO
                  : NO_DISPONIBLE
                : exacto
                  ? encontrado(exacto)
                  : SIN_DATO;
          const anterior = serie.filter((r) => r.fecha_publicacion < fecha).at(-1);
          const operacion =
            fecha <= cobertura.desde
              ? SIN_DATO
              : !cabe(hueco)
                ? NO_DISPONIBLE
                : anterior
                  ? encontrado(anterior)
                  : SIN_DATO;

          const conPublicado = fixPublicado(serie, cobertura, cobertura, fecha, opciones);
          const conOperacion = fixParaOperacion(serie, cobertura, cobertura, fecha, opciones);
          expect(conPublicado).toEqual(publicado);
          expect(conOperacion).toEqual(operacion);

          // Los feriados solo vuelven cierta una respuesta que sin ellos era no_disponible.
          for (const [con, sin] of [
            [conPublicado, fixPublicado(serie, cobertura, cobertura, fecha)],
            [conOperacion, fixParaOperacion(serie, cobertura, cobertura, fecha)],
          ] as const) {
            if (sin.tipo !== "no_disponible") expect(con).toEqual(sin);
            else if (con.tipo !== "no_disponible") cambiadas++;
          }
        },
      ),
      { numRuns: 1000 },
    );
    expect(cambiadas).toBeGreaterThan(0);
  });

  it("nunca un valor viejo: si no hay publicación en los feriados, parte de la serie responde lo mismo que toda o no_disponible", () => {
    // Fechas de la consulta hasta el día 74 y serie completa conocida hasta el 75: con toda la
    // serie, ninguna respuesta queda pendiente.
    const COMPLETA_HASTA = 75;
    let porFeriados = 0;
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 59 }), { minLength: 1, maxLength: 40 }),
        feriadosArb,
        fc.integer({ min: 0, max: 66 }),
        fc.integer({ min: -8, max: 72 }),
        cercaArb,
        (dias, lejanos, corte, alAzar, { cerca, delta, cercanos }) => {
          const desplazamiento = cerca ? corte + delta : alAzar;
          const feriados = new Set([...lejanos, ...cercanos.map((k) => corte + k)].map(fechaDe));
          // La fuente real: nunca publica en fin de semana ni en un feriado.
          const publicaciones = [...dias]
            .filter((d) => !esFinDeSemana(BASE + d) && !feriados.has(fechaDe(d)))
            .sort((x, y) => x - y);
          fc.pre(publicaciones.length > 0);
          const primero = publicaciones[0] as number;
          fc.pre(corte >= primero);
          const serie = publicaciones.map((d) => fix(fechaDe(d), "18.0000"));
          const completa = rango(fechaDe(primero), fechaDe(COMPLETA_HASTA));
          const cargada = rango(fechaDe(primero), fechaDe(corte));
          const parcial = serie.filter((r) => r.fecha_publicacion <= cargada.hasta);
          const fecha = fechaDe(desplazamiento);
          const opciones = { sinPublicacion: (f: string) => feriados.has(f) };

          for (const consulta of [fixPublicado, fixParaOperacion]) {
            const cierta = consulta(serie, completa, completa, fecha, opciones);
            expect(cierta.tipo).not.toBe("no_disponible");
            const respuesta = consulta(parcial, cargada, cargada, fecha, opciones);
            if (respuesta.tipo === "no_disponible") continue;
            expect(respuesta).toEqual(cierta);
            if (consulta(parcial, cargada, cargada, fecha).tipo === "no_disponible") porFeriados++;
          }
        },
      ),
      { numRuns: 2000 },
    );
    // Hubo respuestas que solo los feriados permitieron dar.
    expect(porFeriados).toBeGreaterThan(0);
  });
});

describe("FUENTE_CFF_20", () => {
  it("cita el párrafo del art. 20 del CFF sobre el tipo de cambio", () => {
    expect(FUENTE_CFF_20.nombre).toBe(
      "Código Fiscal de la Federación, artículo 20, tercer párrafo",
    );
    expect(FUENTE_CFF_20.url).toBe("https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf");
    expect(FUENTE_CFF_20.fragmento).toMatch(/^Para determinar las contribuciones y sus accesorios/);
    expect(FUENTE_CFF_20.fragmento).toContain(
      "se estará al tipo de cambio que el Banco de México publique en el Diario Oficial de la Federación el día anterior a aquél en que se causen las contribuciones.",
    );
    expect(FUENTE_CFF_20.fragmento).toMatch(
      /se aplicará el último tipo de cambio publicado con anterioridad al día en que se causen las contribuciones\.$/,
    );
  });

  it("está congelada", () => {
    expect(Object.isFrozen(FUENTE_CFF_20)).toBe(true);
  });
});
