import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TipoCambioFix, Udi } from "../../src/datos/indicadores.js";
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

const encontrado = <T>(registro: T): Consulta<T> => ({ tipo: "encontrado", registro });
const SIN_DATO = { tipo: "sin_dato" } as const;
const NO_DISPONIBLE = { tipo: "no_disponible" } as const;

// Valores de ejemplo. Jueves 15, viernes 16 y lunes 19 de octubre de 2026.
const JUE = fix("2026-10-15", "18.4310");
const VIE = fix("2026-10-16", "18.4250");
const LUN = fix("2026-10-19", "18.3975");
const OCTUBRE = [JUE, VIE, LUN];

// Tramos de una serie que empieza en 2020: el tramo no arranca en cobertura.desde.
const HASTA_LUNES: CoberturaSerie = { desde: "2020-01-02", hasta: "2026-10-19" };
const HASTA_VIERNES: CoberturaSerie = { desde: "2020-01-02", hasta: "2026-10-16" };
// Serie completa de tres publicaciones.
const SOLO_OCTUBRE: CoberturaSerie = { desde: "2026-10-15", hasta: "2026-10-19" };

// Cambio de año: el 1 de enero no hay publicación.
const DIC_30 = fix("2025-12-30", "18.2100");
const DIC_31 = fix("2025-12-31", "18.1950");
const ENE_02 = fix("2026-01-02", "18.2400");
const ENE_05 = fix("2026-01-05", "18.2600");
const CAMBIO_DE_ANIO = [DIC_30, DIC_31, ENE_02, ENE_05];

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
    expect(fixPublicado(OCTUBRE, HASTA_LUNES, fecha)).toEqual(esperado);
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = fixPublicado(OCTUBRE, HASTA_LUNES, "2026-10-16");
    expect(r.tipo === "encontrado" && r.registro).toBe(VIE);
  });

  it("responde en el primer día de la serie", () => {
    expect(fixPublicado(OCTUBRE, SOLO_OCTUBRE, "2026-10-15")).toEqual(encontrado(JUE));
    expect(fixPublicado(OCTUBRE, SOLO_OCTUBRE, "2026-10-14")).toEqual(SIN_DATO);
  });

  it("cruza el cambio de año con un tramo de dos años", () => {
    expect(fixPublicado(CAMBIO_DE_ANIO, HASTA_LUNES, "2026-01-01")).toEqual(SIN_DATO);
    expect(fixPublicado(CAMBIO_DE_ANIO, HASTA_LUNES, "2025-12-31")).toEqual(encontrado(DIC_31));
    expect(fixPublicado(CAMBIO_DE_ANIO, HASTA_LUNES, "2026-01-02")).toEqual(encontrado(ENE_02));
  });

  it("con la serie vacía y la fecha dentro de la cobertura no hay dato", () => {
    expect(fixPublicado([], HASTA_LUNES, "2026-10-17")).toEqual(SIN_DATO);
  });
});

describe("fixParaOperacion (CFF art. 20)", () => {
  it.each([
    ["lunes: la víspera es domingo, aplica el viernes", OCTUBRE, HASTA_LUNES, "2026-10-19", VIE],
    ["martes: aplica la del lunes", OCTUBRE, HASTA_LUNES, "2026-10-20", LUN],
    ["viernes: aplica la del jueves", OCTUBRE, HASTA_LUNES, "2026-10-16", JUE],
    ["sábado: aplica la del viernes", OCTUBRE, HASTA_LUNES, "2026-10-17", VIE],
    ["domingo: aplica la del viernes", OCTUBRE, HASTA_LUNES, "2026-10-18", VIE],
    [
      "lunes con hasta en viernes: el hueco es fin de semana",
      [JUE, VIE],
      HASTA_VIERNES,
      "2026-10-19",
      VIE,
    ],
    ["sábado con hasta en viernes", [JUE, VIE], HASTA_VIERNES, "2026-10-17", VIE],
    ["domingo con hasta en viernes", [JUE, VIE], HASTA_VIERNES, "2026-10-18", VIE],
    ["el día siguiente al inicio de la serie", OCTUBRE, SOLO_OCTUBRE, "2026-10-16", JUE],
  ])("%s", (_caso, serie, cobertura, fecha, esperado) => {
    expect(fixParaOperacion(serie, cobertura, fecha)).toEqual(encontrado(esperado));
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = fixParaOperacion(OCTUBRE, HASTA_LUNES, "2026-10-19");
    expect(r.tipo === "encontrado" && r.registro).toBe(VIE);
  });

  it.each([
    [
      "miércoles con hasta en lunes: falta la publicación del martes",
      OCTUBRE,
      HASTA_LUNES,
      "2026-10-21",
    ],
    ["martes con hasta en viernes: falta la del lunes", [JUE, VIE], HASTA_VIERNES, "2026-10-20"],
    ["una semana después de hasta", OCTUBRE, HASTA_LUNES, "2026-10-26"],
    ["años después de hasta", OCTUBRE, HASTA_LUNES, "2030-01-01"],
    ["el último día representable", OCTUBRE, HASTA_LUNES, "9999-12-31"],
  ])("%s: no da un valor viejo", (_caso, serie, cobertura, fecha) => {
    expect(fixParaOperacion(serie, cobertura, fecha)).toEqual(NO_DISPONIBLE);
  });

  it.each([
    ["el primer día de la serie", OCTUBRE, SOLO_OCTUBRE, "2026-10-15"],
    ["antes de la serie", OCTUBRE, SOLO_OCTUBRE, "2026-10-14"],
    ["el inicio de una serie que empieza en 2020", OCTUBRE, HASTA_LUNES, "2020-01-02"],
    ["antes de 2020", OCTUBRE, HASTA_LUNES, "2019-06-30"],
    ["el año 0001", OCTUBRE, HASTA_LUNES, "0001-01-01"],
    ["el inicio, con la serie vacía", [], HASTA_LUNES, "2020-01-02"],
  ])("fecha <= desde, %s: no hay publicación anterior", (_caso, serie, cobertura, fecha) => {
    expect(fixParaOperacion(serie, cobertura, fecha)).toEqual(SIN_DATO);
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
      expect(fixParaOperacion(CAMBIO_DE_ANIO, HASTA_LUNES, fecha)).toEqual(encontrado(esperado));
    });

    it("basta el año de la víspera cuando trae una publicación anterior", () => {
      expect(fixParaOperacion([DIC_30, DIC_31], HASTA_LUNES, "2026-01-01")).toEqual(
        encontrado(DIC_31),
      );
    });

    it("lanza si el tramo no trae el año anterior que hace falta", () => {
      expect(() => fixParaOperacion([ENE_02, ENE_05], HASTA_LUNES, "2026-01-02")).toThrow(
        /tramo de la serie no incluye/,
      );
      expect(() => fixParaOperacion([ENE_02, ENE_05], HASTA_LUNES, "2026-01-02")).toThrow(
        RangeError,
      );
    });
  });

  describe("tramo incompleto", () => {
    it("lanza si en el tramo no hay publicación anterior a la fecha", () => {
      expect(() => fixParaOperacion(OCTUBRE, HASTA_LUNES, "2026-10-15")).toThrow(
        /tramo de la serie no incluye la última publicación anterior a 2026-10-15/,
      );
      expect(() => fixParaOperacion([], HASTA_LUNES, "2026-10-19")).toThrow(RangeError);
    });

    it("lanza si la serie termina antes de la fecha y el tramo no llega a hasta", () => {
      expect(() => fixParaOperacion([JUE, VIE], HASTA_LUNES, "2026-10-20")).toThrow(
        /tramo de la serie no incluye/,
      );
    });

    it("acepta un tramo que termina antes de hasta si cubre la víspera", () => {
      expect(fixParaOperacion([JUE, VIE], HASTA_LUNES, "2026-10-19")).toEqual(encontrado(VIE));
    });
  });

  it("revisa pocas posiciones de una serie larga (búsqueda binaria)", () => {
    const base = aDias("2020-01-02");
    const registros = Array.from({ length: 100_000 }, (_, i) => fix(deDias(base + i), "18.0000"));
    const ultima = registros.at(-1) as TipoCambioFix;
    const cobertura = { desde: "2020-01-02", hasta: ultima.fecha_publicacion };
    let lecturas = 0;
    const serie = new Proxy(registros, {
      get(objetivo, propiedad, receptor) {
        if (typeof propiedad === "string" && /^[0-9]+$/.test(propiedad)) lecturas++;
        return Reflect.get(objetivo, propiedad, receptor);
      },
    });
    const fecha = deDias(base + 54_321);
    // log2(100 000) < 17: una lectura por paso más la del registro que se devuelve.
    expect(fixParaOperacion(serie, cobertura, fecha)).toEqual(
      encontrado(registros[54_320] as TipoCambioFix),
    );
    expect(lecturas).toBeLessThanOrEqual(20);
    lecturas = 0;
    expect(fixPublicado(serie, cobertura, fecha)).toEqual(
      encontrado(registros[54_321] as TipoCambioFix),
    );
    expect(lecturas).toBeLessThanOrEqual(20);
  });
});

describe("udiDeFecha", () => {
  const ULTIMO_DIC = udi("2025-12-31", "8.640123");
  const ANIO_NUEVO = udi("2026-01-01", "8.641001");
  const ENE_2 = udi("2026-01-02", "8.641879");
  const UDIS = [ULTIMO_DIC, ANIO_NUEVO, ENE_2];
  const COBERTURA_UDIS: CoberturaSerie = { desde: "2020-01-01", hasta: "2026-01-02" };

  it.each([
    ["dentro de la cobertura", "2026-01-01", encontrado(ANIO_NUEVO)],
    ["el último día cargado", "2026-01-02", encontrado(ENE_2)],
    ["antes de la cobertura", "2019-12-31", SIN_DATO],
    ["después de la cobertura", "2026-01-03", NO_DISPONIBLE],
    ["mucho después de la cobertura", "2099-01-01", NO_DISPONIBLE],
  ])("%s (%s)", (_caso, fecha, esperado) => {
    expect(udiDeFecha(UDIS, COBERTURA_UDIS, fecha)).toEqual(esperado);
  });

  it("devuelve el mismo registro de la serie", () => {
    const r = udiDeFecha(UDIS, COBERTURA_UDIS, "2025-12-31");
    expect(r.tipo === "encontrado" && r.registro).toBe(ULTIMO_DIC);
  });

  it("responde el primer día de la serie", () => {
    const primero = udi("2020-01-01", "6.399018");
    expect(
      udiDeFecha([primero], { desde: "2020-01-01", hasta: "2020-01-01" }, "2020-01-01"),
    ).toEqual(encontrado(primero));
  });

  it("un hueco dentro del tramo da sin_dato", () => {
    expect(udiDeFecha([ULTIMO_DIC, ENE_2], COBERTURA_UDIS, "2026-01-01")).toEqual(SIN_DATO);
  });

  it("lanza si el tramo no incluye la fecha", () => {
    expect(() => udiDeFecha(UDIS, COBERTURA_UDIS, "2025-06-01")).toThrow(
      /tramo de la serie no incluye 2025-06-01/,
    );
    expect(() => udiDeFecha([ULTIMO_DIC], COBERTURA_UDIS, "2026-01-02")).toThrow(RangeError);
    expect(() => udiDeFecha([], COBERTURA_UDIS, "2026-01-01")).toThrow(RangeError);
  });
});

describe("validación de entradas", () => {
  const consultas = [
    ["fixPublicado", (f: string) => fixPublicado(OCTUBRE, HASTA_LUNES, f)],
    ["fixParaOperacion", (f: string) => fixParaOperacion(OCTUBRE, HASTA_LUNES, f)],
    ["udiDeFecha", (f: string) => udiDeFecha([], HASTA_LUNES, f)],
  ] as const;

  it.each(consultas)("%s lanza RangeError con una fecha inválida", (_nombre, consultar) => {
    for (const fecha of FECHAS_INVALIDAS) {
      expect(() => consultar(fecha), String(fecha)).toThrow(RangeError);
    }
    expect(() => consultar("2026-02-30")).toThrow("Fecha ISO inválida: 2026-02-30");
  });

  it.each([
    ["desde posterior a hasta", { desde: "2026-10-20", hasta: "2026-10-19" }],
    ["desde inválida", { desde: "2020-1-2", hasta: "2026-10-19" }],
    ["hasta inválida", { desde: "2020-01-02", hasta: "2026-02-30" }],
  ])("las tres lanzan RangeError con una cobertura con %s", (_caso, cobertura) => {
    expect(() => fixPublicado(OCTUBRE, cobertura, "2026-10-16")).toThrow(RangeError);
    expect(() => fixParaOperacion(OCTUBRE, cobertura, "2026-10-16")).toThrow(RangeError);
    expect(() => udiDeFecha([], cobertura, "2026-10-16")).toThrow(RangeError);
  });
});

describe("propiedades", () => {
  const BASE = aDias("2026-09-01");
  const esFinDeSemana = (dia: number) => {
    const semana = diaSemanaDeDias(dia);
    return semana === 0 || semana === 6;
  };
  // Serie de prueba: días distintos entre el 1 de septiembre y el 30 de octubre, ordenados.
  const serieArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 59 }), { minLength: 1, maxLength: 40 })
    .map((dias) => dias.sort((a, b) => a - b).map((d) => fix(deDias(BASE + d), "18.0000")));

  it("fixPublicado y fixParaOperacion coinciden con un recorrido lineal", () => {
    fc.assert(
      fc.property(
        serieArb,
        fc.integer({ min: -5, max: 70 }),
        fc.integer({ min: 0, max: 5 }),
        (serie, desplazamiento, extra) => {
          const primero = serie[0] as TipoCambioFix;
          const ultimo = serie.at(-1) as TipoCambioFix;
          const cobertura = { desde: primero.fecha_publicacion, hasta: ultimo.fecha_publicacion };
          const fecha = deDias(BASE + desplazamiento);

          const exacto = serie.find((r) => r.fecha_publicacion === fecha);
          const publicado = fixPublicado(serie, cobertura, fecha);
          if (fecha > cobertura.hasta) expect(publicado).toEqual(NO_DISPONIBLE);
          else expect(publicado).toEqual(exacto ? encontrado(exacto) : SIN_DATO);

          const anteriores = serie.filter((r) => r.fecha_publicacion < fecha);
          const operacion = fixParaOperacion(serie, cobertura, fecha);
          const hueco: number[] = [];
          for (let d = aDias(cobertura.hasta) + 1; d < aDias(fecha); d++) hueco.push(d);
          if (fecha <= cobertura.desde) expect(operacion).toEqual(SIN_DATO);
          else if (!hueco.every(esFinDeSemana)) expect(operacion).toEqual(NO_DISPONIBLE);
          else {
            expect(operacion).toEqual(encontrado(anteriores.at(-1)));
            // Un tramo que empieza en la publicación aplicable (o antes) da lo mismo.
            const inicio = Math.max(0, anteriores.length - 1 - extra);
            expect(fixParaOperacion(serie.slice(inicio), cobertura, fecha)).toEqual(operacion);
          }
        },
      ),
    );
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
