import { crearCalendario, sumarDiasHabiles } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reiniciarCargas } from "../../src/cargas.js";
import { manejar } from "../../src/index.js";
import { CACHE_DATOS } from "../../src/respuestas.js";
import { crearAssets, entornoDe, peticion, SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";
import {
  assetsCurados,
  DIAS_CNBV,
  DIAS_SAT,
  DOCS,
  FUENTE_CFF,
  INTERNA_CURADOS,
  META_CNBV,
  META_SAT,
  RUTA_CNBV,
  RUTA_META,
  RUTA_SAT,
  SHARD_CNBV,
  SHARD_SAT,
} from "./curados.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
const DOCS_HABILES = `${DOCS}/api/README.md#dias-habiles`;
const DOCS_INHABILES = `${DOCS}/api/README.md#dias-inhabiles`;

const COBERTURA_GENERAL = { desde: "2026-01-01", hasta: "2026-11-30" };
const COBERTURA_DECLARACIONES = { desde: "2026-01-01", hasta: "2026-12-31" };
const COBERTURA_CNBV = { desde: "2025-01-01", hasta: "2026-12-31" };

const AVISO_GENERAL =
  "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.";

const DETALLE_GENERAL = (fecha: string) =>
  `El calendario del SAT para tipo_plazo=general no cubre ${fecha}; cubre del 2026-01-01 al 2026-11-30 porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre del 2026-01-01 al 2026-12-31.`;

const ADVERTENCIA_SAT_2026 =
  "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa.";

type Cambios = Parameters<typeof assetsCurados>[0];

// biome-ignore lint/suspicious/noExplicitAny: los cuerpos JSON se inspeccionan de forma dinámica.
type Obj = Record<string, any>;

async function pedir(ruta: string, cambios?: Cambios, init?: RequestInit) {
  const assets = crearAssets(assetsCurados(cambios));
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  return { respuesta, assets };
}

/** Pide la ruta y devuelve el cuerpo; comprueba los encabezados de una respuesta de datos. */
async function datos(ruta: string, cambios?: Cambios) {
  const { respuesta, assets } = await pedir(ruta, cambios);
  expect(respuesta.status, ruta).toBe(200);
  expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
  expect(respuesta.headers.get("etag")).toBeNull();
  expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
  return { cuerpo: (await respuesta.json()) as Obj, pedidas: assets.pedidas };
}

/** Pide la ruta y comprueba el 422 con la autoridad, la fecha y la cobertura. */
async function incompleto(
  ruta: string,
  esperado: { autoridad: string; fecha: string; cobertura: object; detail: string },
  cambios?: Cambios,
) {
  const { respuesta } = await pedir(ruta, cambios);
  expect(respuesta.status, ruta).toBe(422);
  expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  expect(respuesta.headers.get("cache-control")).toBe("no-store");
  expect(await respuesta.json(), ruta).toEqual({
    type: `${TIPO}calendario-incompleto`,
    title: "Calendario incompleto",
    status: 422,
    instance: new URL(ruta, "https://api.test").pathname,
    ...esperado,
  });
}

/** Pide la ruta y comprueba un 500 genérico; devuelve lo que se registró. */
async function errorInterno(ruta: string, cambios?: Cambios) {
  const consola = vi.spyOn(console, "error").mockImplementation(() => {});
  consola.mockClear();
  const { respuesta, assets } = await pedir(ruta, cambios);
  expect(respuesta.status, ruta).toBe(500);
  expect(await respuesta.json()).toEqual({
    type: `${TIPO}error-interno`,
    title: "Error interno",
    status: 500,
    detail: "Ocurrió un error interno.",
    instance: new URL(ruta, "https://api.test").pathname,
  });
  return { lineas: consola.mock.calls.map((c) => String(c[0])), pedidas: assets.pedidas };
}

beforeEach(() => reiniciarCargas());
afterEach(() => {
  vi.restoreAllMocks();
});

const habiles = (query: string) => `/v1/dias-habiles?${query}`;
const inhabiles = (query: string) => `/v1/dias-inhabiles?${query}`;
const sat = (tipo: string, desde: string, dias: number, extra = "") =>
  habiles(`autoridad=sat&tipo_plazo=${tipo}&desde=${desde}&dias=${dias}${extra}`);
const cnbv = (desde: string, dias: number, extra = "") =>
  habiles(`autoridad=cnbv&desde=${desde}&dias=${dias}${extra}`);

interface ShardDePrueba {
  autoridad: string;
  plazos: Record<string, { cobertura: { desde: string; hasta: string }; excluir_tipos: string[] }>;
  fuente_fin_de_semana: typeof FUENTE_CFF;
  dias: ReadonlyArray<{ fecha: string; motivo: string; tipo: string; fuente: typeof FUENTE_CFF }>;
}

/** El cálculo del núcleo con el calendario de prueba, como lo serializa la API. */
function delNucleo(shard: ShardDePrueba, tipo: string, desde: string, dias: number) {
  const plazo = shard.plazos[tipo];
  if (plazo === undefined) throw new Error(tipo);
  const { cobertura, excluir_tipos } = plazo;
  const calendario = crearCalendario({
    autoridad: shard.autoridad as "sat" | "cnbv",
    cobertura,
    dias: shard.dias
      .filter((d) => d.fecha >= cobertura.desde && d.fecha <= cobertura.hasta)
      .map((d) => ({ ...d, tipo: d.tipo as "descanso" | "vacaciones" })),
    fuenteFinDeSemana: shard.fuente_fin_de_semana,
    excluirTipos: excluir_tipos as "vacaciones"[],
  });
  return JSON.parse(JSON.stringify(sumarDiasHabiles({ calendario, desde, dias })));
}

const fechas = (dias: ReadonlyArray<{ fecha: string }>) => dias.map((d) => d.fecha);
const PRIMER_PERIODO = Array.from({ length: 12 }, (_, i) => `2026-07-${20 + i}`);

describe("GET /v1/dias-habiles?autoridad=sat", () => {
  it("un plazo que cruza el primer periodo de vacaciones: general lo salta, declaraciones_pagos no", async () => {
    const general = await datos(sat("general", "2026-07-15", 10));
    expect(general.cuerpo).toEqual({
      data: delNucleo(SHARD_SAT, "general", "2026-07-15", 10),
      meta: { ...META_SAT, docs: DOCS_HABILES },
    });
    expect(general.cuerpo.data).toMatchObject({
      autoridad: "sat",
      desde: "2026-07-15",
      dias: 10,
      resultado: "2026-08-12",
      advertencias: [],
    });
    expect(fechas(general.cuerpo.data.inhabiles_saltados)).toEqual(PRIMER_PERIODO);
    expect(general.pedidas).toEqual([RUTA_META, RUTA_SAT]);

    const declaraciones = await datos(sat("declaraciones_pagos", "2026-07-15", 10));
    expect(declaraciones.cuerpo.data).toEqual(
      delNucleo(SHARD_SAT, "declaraciones_pagos", "2026-07-15", 10),
    );
    expect(declaraciones.cuerpo.data).toMatchObject({
      resultado: "2026-07-29",
      inhabiles_saltados: [],
      advertencias: [],
    });
  });

  it.each([
    ["general", "2026-07-17", "2026-08-03"],
    ["declaraciones_pagos", "2026-07-17", "2026-07-20"],
    // 2 y 3 de abril: vacaciones del SAT, hábiles en declaraciones y pagos.
    ["general", "2026-04-01", "2026-04-06"],
    ["declaraciones_pagos", "2026-04-01", "2026-04-02"],
    // El tercer lunes de noviembre es descanso en los dos.
    ["general", "2026-11-13", "2026-11-17"],
    ["declaraciones_pagos", "2026-11-13", "2026-11-17"],
    ["declaraciones_pagos", "2026-12-24", "2026-12-28"],
  ] as const)("%s: %s más 1 día hábil es %s", async (tipo, desde, resultado) => {
    const { cuerpo } = await datos(sat(tipo, desde, 1));
    expect(cuerpo.data.resultado).toBe(resultado);
    expect(cuerpo.data).toEqual(delNucleo(SHARD_SAT, tipo, desde, 1));
  });

  it("el 25 de diciembre se salta con su cita del CFF", async () => {
    const { cuerpo } = await datos(sat("declaraciones_pagos", "2026-12-24", 1));
    expect(cuerpo.data.inhabiles_saltados).toEqual([
      { fecha: "2026-12-25", motivo: "25 de diciembre", tipo: "descanso", fuente: FUENTE_CFF },
    ]);
  });

  it("general después del 30 de noviembre: 422 que dice por qué y hasta dónde llega declaraciones_pagos", async () => {
    for (const ruta of [
      sat("general", "2026-11-27", 2),
      sat("general", "2026-11-27", 2, "&permitir_incompleto=false"),
      sat("general", "2026-12-24", 1),
    ]) {
      const fecha = ruta.includes("12-24") ? "2026-12-25" : "2026-12-01";
      await incompleto(ruta, {
        autoridad: "sat",
        fecha,
        cobertura: COBERTURA_GENERAL,
        detail: DETALLE_GENERAL(fecha),
      });
    }
  });

  describe("general con permitir_incompleto=true después del 30 de noviembre", () => {
    const permitir = (desde: string, dias: number) =>
      sat("general", desde, dias, "&permitir_incompleto=true");

    it("salta el 25 de diciembre publicado, con su cita, y advierte lo que puede faltar", async () => {
      const { cuerpo } = await datos(permitir("2026-12-24", 1));
      expect(cuerpo.data).toEqual({
        autoridad: "sat",
        desde: "2026-12-24",
        dias: 1,
        resultado: "2026-12-28",
        inhabiles_saltados: [
          { fecha: "2026-12-25", motivo: "25 de diciembre", tipo: "descanso", fuente: FUENTE_CFF },
        ],
        advertencias: [AVISO_GENERAL],
      });
    });

    it("cruzar el 30 de noviembre da el día hábil siguiente con la advertencia", async () => {
      const { cuerpo } = await datos(permitir("2026-11-27", 2));
      expect(cuerpo.data).toMatchObject({
        resultado: "2026-12-01",
        inhabiles_saltados: [],
        advertencias: [AVISO_GENERAL],
      });
    });

    it("un rango que llega a 2027 lleva las dos advertencias", async () => {
      const { cuerpo } = await datos(permitir("2026-12-24", 5));
      expect(cuerpo.data).toMatchObject({
        resultado: "2027-01-01",
        advertencias: [
          AVISO_GENERAL,
          "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
        ],
      });
      expect(fechas(cuerpo.data.inhabiles_saltados)).toEqual(["2026-12-25"]);
    });

    it("dentro de la cobertura de general no hay advertencias", async () => {
      const { cuerpo } = await datos(permitir("2026-07-15", 10));
      expect(cuerpo.data).toEqual(delNucleo(SHARD_SAT, "general", "2026-07-15", 10));
    });

    it("si empieza después de la cobertura amplia, solo queda la advertencia del núcleo", async () => {
      const { cuerpo } = await datos(permitir("2026-12-31", 1));
      expect(cuerpo.data).toMatchObject({
        resultado: "2027-01-01",
        advertencias: ["Calendario incompleto: SAT 2027; solo se descontaron fines de semana."],
      });
    });

    it("antes de la cobertura amplia, solo la advertencia del núcleo para ese año", async () => {
      const { cuerpo } = await datos(permitir("2025-12-30", 2));
      expect(cuerpo.data).toMatchObject({
        resultado: "2026-01-02",
        advertencias: ["Calendario incompleto: SAT 2025; solo se descontaron fines de semana."],
      });
    });
  });

  it("declaraciones_pagos cubre diciembre; después del 31, 422 con su cobertura", async () => {
    const { cuerpo } = await datos(sat("declaraciones_pagos", "2026-11-27", 2));
    expect(cuerpo.data).toMatchObject({ resultado: "2026-12-01", advertencias: [] });
    await incompleto(sat("declaraciones_pagos", "2026-12-31", 1), {
      autoridad: "sat",
      fecha: "2027-01-01",
      cobertura: COBERTURA_DECLARACIONES,
      detail:
        "El calendario del SAT para tipo_plazo=declaraciones_pagos no cubre 2027-01-01; cubre del 2026-01-01 al 2026-12-31.",
    });
    // Sin respaldo: con permitir_incompleto solo descuenta fines de semana después del 31.
    const permitido = await datos(
      sat("declaraciones_pagos", "2026-12-31", 1, "&permitir_incompleto=true"),
    );
    expect(permitido.cuerpo.data.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
    ]);
  });

  it("antes del inicio de toda cobertura, 422 sin explicación de otros plazos", async () => {
    await incompleto(sat("general", "2025-12-30", 1), {
      autoridad: "sat",
      fecha: "2025-12-31",
      cobertura: COBERTURA_GENERAL,
      detail:
        "El calendario del SAT para tipo_plazo=general no cubre 2025-12-31; cubre del 2026-01-01 al 2026-11-30.",
    });
  });

  describe("calendarios armados para casos que el SAT 2026 no tiene", () => {
    const conPlazos = (general: object, declaraciones: object, dias = DIAS_SAT) => ({
      [RUTA_SAT]: {
        ...SHARD_SAT,
        plazos: {
          general: { ...SHARD_SAT.plazos.general, ...general },
          declaraciones_pagos: { ...SHARD_SAT.plazos.declaraciones_pagos, ...declaraciones },
        },
        dias,
      },
    });
    // General empieza en febrero: enero solo lo cubre declaraciones_pagos.
    const desdeFebrero = conPlazos({ cobertura: { desde: "2026-02-01", hasta: "2026-11-30" } }, {});
    // Declaraciones_pagos cuenta todo: fuera de general no falta ningún tipo de día.
    const sinExcluir = conPlazos({}, { excluir_tipos: [] });

    it("un hueco al inicio de la cobertura: advertencia con permitir_incompleto y 422 sin él", async () => {
      const { cuerpo } = await datos(
        sat("general", "2026-01-05", 1, "&permitir_incompleto=true"),
        desdeFebrero,
      );
      expect(cuerpo.data).toMatchObject({
        resultado: "2026-01-06",
        advertencias: [
          "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-02-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.",
        ],
      });
      reiniciarCargas();
      await incompleto(
        sat("general", "2026-01-05", 1),
        {
          autoridad: "sat",
          fecha: "2026-01-06",
          cobertura: { desde: "2026-02-01", hasta: "2026-11-30" },
          detail:
            "El calendario del SAT para tipo_plazo=general no cubre 2026-01-06; cubre del 2026-02-01 al 2026-11-30 porque los días de tipo vacaciones anteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre del 2026-01-01 al 2026-12-31.",
        },
        desdeFebrero,
      );
    });

    it("si ningún tipo de día puede faltar, ni advertencia ni explicación", async () => {
      const { cuerpo } = await datos(
        sat("general", "2026-12-24", 1, "&permitir_incompleto=true"),
        sinExcluir,
      );
      expect(cuerpo.data).toMatchObject({ resultado: "2026-12-28", advertencias: [] });
      reiniciarCargas();
      await incompleto(
        sat("general", "2026-11-27", 2),
        {
          autoridad: "sat",
          fecha: "2026-12-01",
          cobertura: COBERTURA_GENERAL,
          detail:
            "El calendario del SAT para tipo_plazo=general no cubre 2026-12-01; cubre del 2026-01-01 al 2026-11-30.",
        },
        sinExcluir,
      );
    });
  });

  it("un resultado después del año 9999 sigue siendo 400 en desde", async () => {
    const { respuesta } = await pedir(sat("general", "9999-12-31", 1, "&permitir_incompleto=true"));
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}parametro-invalido`,
      parametro: "desde",
    });
  });
});

describe("GET /v1/dias-habiles?autoridad=cnbv", () => {
  it("salta el 2 de noviembre de la CNBV, con la meta de su calendario", async () => {
    const { cuerpo, pedidas } = await datos(cnbv("2026-10-30", 1));
    expect(cuerpo).toEqual({
      data: delNucleo(SHARD_CNBV, "general", "2026-10-30", 1),
      meta: { ...META_CNBV, docs: DOCS_HABILES },
    });
    expect(cuerpo.data.resultado).toBe("2026-11-03");
    expect(cuerpo.data.inhabiles_saltados).toEqual([DIAS_CNBV[1]]);
    expect(pedidas).toEqual([RUTA_META, RUTA_CNBV]);
  });

  it("salta el 12 de diciembre de 2026, sábado publicado como inhábil, con su cita", async () => {
    const { cuerpo } = await datos(cnbv("2026-12-11", 1));
    expect(cuerpo.data).toMatchObject({ resultado: "2026-12-14", advertencias: [] });
    expect(cuerpo.data.inhabiles_saltados).toEqual([DIAS_CNBV[2]]);
    expect(cuerpo.data).toEqual(delNucleo(SHARD_CNBV, "general", "2026-12-11", 1));
  });

  it("fuera de la cobertura da 422; con permitir_incompleto=true, 200 con advertencia", async () => {
    await incompleto(cnbv("2026-12-31", 1), {
      autoridad: "cnbv",
      fecha: "2027-01-01",
      cobertura: COBERTURA_CNBV,
      detail: "El calendario de la CNBV no cubre 2027-01-01; cubre del 2025-01-01 al 2026-12-31.",
    });
    await incompleto(cnbv("2024-12-30", 1), {
      autoridad: "cnbv",
      fecha: "2024-12-31",
      cobertura: COBERTURA_CNBV,
      detail: "El calendario de la CNBV no cubre 2024-12-31; cubre del 2025-01-01 al 2026-12-31.",
    });
    const { cuerpo } = await datos(cnbv("2026-12-31", 1, "&permitir_incompleto=true"));
    expect(cuerpo.data).toMatchObject({
      resultado: "2027-01-01",
      advertencias: ["Calendario incompleto: CNBV 2027; solo se descontaron fines de semana."],
    });
  });
});

describe("GET /v1/dias-habiles: carga de los calendarios", () => {
  it("cada calendario y el meta se leen una vez por isolate", async () => {
    const assets = crearAssets(assetsCurados());
    for (const ruta of [
      sat("general", "2026-07-15", 10),
      sat("declaraciones_pagos", "2026-07-15", 10),
      cnbv("2026-10-30", 1),
      inhabiles("autoridad=sat&anio=2026"),
      inhabiles("autoridad=cnbv&anio=2026"),
      sat("general", "2026-11-27", 2),
    ]) {
      await manejar(peticion(ruta), entornoDe(assets));
    }
    expect(assets.pedidas).toEqual([RUTA_META, RUTA_SAT, RUTA_CNBV]);
  });

  it("una falla al leer el calendario da 500 y no se recuerda", async () => {
    const { lineas } = await errorInterno(sat("general", "2026-07-15", 10), { [RUTA_SAT]: "{" });
    expect(lineas).toEqual(["mexicoapi: error interno: SyntaxError en /v1/dias-habiles"]);
    const { cuerpo } = await datos(sat("general", "2026-07-15", 10));
    expect(cuerpo.data.resultado).toBe("2026-08-12");
  });

  it.each([
    ["sin el calendario", { [RUTA_SAT]: undefined }],
    ["un calendario de otra autoridad", { [RUTA_SAT]: SHARD_CNBV }],
    ["un meta interno sin curados", { [RUTA_META]: { datasets: {} } }],
    [
      "un meta interno sin el calendario",
      {
        [RUTA_META]: {
          datasets: {},
          curados: { "dias-inhabiles.cnbv": INTERNA_CURADOS.curados["dias-inhabiles.cnbv"] },
        },
      },
    ],
  ])("con %s: 500 genérico", async (_, cambios) => {
    const { lineas } = await errorInterno(sat("general", "2026-07-15", 10), cambios);
    expect(lineas).toEqual(["mexicoapi: error interno: Error en /v1/dias-habiles"]);
  });

  it("un calendario del SAT sin declaraciones_pagos: 500 en ese plazo, general responde", async () => {
    // Sin ese plazo, el 25 de diciembre quedaría fuera de toda cobertura.
    const sinDeclaraciones = {
      [RUTA_SAT]: {
        ...SHARD_SAT,
        plazos: { general: SHARD_SAT.plazos.general },
        dias: DIAS_SAT.filter((d) => d.fecha <= "2026-11-30"),
      },
    };
    await errorInterno(sat("declaraciones_pagos", "2026-07-15", 10), sinDeclaraciones);
    reiniciarCargas();
    const { cuerpo } = await datos(sat("general", "2026-07-15", 10), sinDeclaraciones);
    expect(cuerpo.data.resultado).toBe("2026-08-12");
  });

  it("los errores de parámetros no tocan ASSETS", async () => {
    for (const [ruta, tipo] of [
      [habiles("autoridad=sat&desde=2026-07-15&dias=10"), "parametro-faltante"],
      [habiles("autoridad=cnbv&tipo_plazo=general&desde=2026-07-15&dias=10"), "parametro-invalido"],
      [habiles("autoridad=sat&tipo_plazo=anual&desde=2026-07-15&dias=10"), "parametro-invalido"],
      [inhabiles("autoridad=sat&anio=0000"), "parametro-invalido"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toMatchObject({
        type: `${TIPO}${tipo}`,
        parametro: ruta.includes("anio") ? "anio" : "tipo_plazo",
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    for (const ruta of [
      sat("general", "2026-07-15", 10),
      sat("general", "2026-11-27", 2),
      inhabiles("autoridad=sat&anio=2026"),
    ]) {
      const get = (await pedir(ruta)).respuesta;
      const { respuesta } = await pedir(ruta, undefined, { method: "HEAD" });
      expect(respuesta.status, ruta).toBe(get.status);
      expect(respuesta.body, ruta).toBeNull();
      expect([...respuesta.headers], ruta).toEqual([...get.headers]);
    }
  });
});

describe("GET /v1/dias-inhabiles con calendarios curados", () => {
  it("cnbv: los días del año con su cita, sin advertencias", async () => {
    const { cuerpo, pedidas } = await datos(inhabiles("autoridad=cnbv&anio=2026"));
    expect(Object.keys(cuerpo)).toEqual(["data", "advertencias", "meta"]);
    expect(cuerpo).toEqual({
      data: DIAS_CNBV.slice(1),
      advertencias: [],
      meta: { ...META_CNBV, docs: DOCS_INHABILES },
    });
    expect(pedidas).toEqual([RUTA_META, RUTA_CNBV]);
    const anterior = await datos(inhabiles("autoridad=cnbv&anio=2025"));
    expect(anterior.cuerpo.data).toEqual(DIAS_CNBV.slice(0, 1));
  });

  it("sat 2026: la lista conocida, con la advertencia de las vacaciones que pueden faltar", async () => {
    const { cuerpo } = await datos(inhabiles("autoridad=sat&anio=2026"));
    expect(cuerpo).toEqual({
      data: DIAS_SAT,
      advertencias: [ADVERTENCIA_SAT_2026],
      meta: { ...META_SAT, docs: DOCS_INHABILES },
    });
  });

  it("sin advertencias si el plazo general cubre todo el año", async () => {
    const completo = {
      [RUTA_SAT]: {
        ...SHARD_SAT,
        plazos: {
          ...SHARD_SAT.plazos,
          general: { ...SHARD_SAT.plazos.general, cobertura: COBERTURA_DECLARACIONES },
        },
      },
    };
    const { cuerpo } = await datos(inhabiles("autoridad=sat&anio=2026"), completo);
    expect(cuerpo.advertencias).toEqual([]);
  });

  it("sin advertencias si el plazo que cubre el año cuenta todos los tipos de día", async () => {
    const declaraciones = { ...SHARD_SAT.plazos.declaraciones_pagos, excluir_tipos: [] };
    const cambios = {
      [RUTA_SAT]: {
        ...SHARD_SAT,
        plazos: { ...SHARD_SAT.plazos, declaraciones_pagos: declaraciones },
      },
    };
    const { cuerpo } = await datos(inhabiles("autoridad=sat&anio=2026"), cambios);
    expect(cuerpo.advertencias).toEqual([]);
  });

  it.each([
    ["sat", "2025", "2025-01-01", COBERTURA_DECLARACIONES],
    ["sat", "2027", "2027-01-01", COBERTURA_DECLARACIONES],
    ["sat", "0001", "0001-01-01", COBERTURA_DECLARACIONES],
    ["cnbv", "2024", "2024-01-01", COBERTURA_CNBV],
    ["cnbv", "2027", "2027-01-01", COBERTURA_CNBV],
    ["cnbv", "9999", "9999-01-01", COBERTURA_CNBV],
  ] as const)(
    "%s %s, fuera de toda cobertura: 422 desde %s",
    async (autoridad, anio, fecha, cobertura) => {
      await incompleto(inhabiles(`autoridad=${autoridad}&anio=${anio}`), {
        autoridad,
        fecha,
        cobertura,
        detail: `El calendario ${autoridad === "sat" ? "del SAT" : "de la CNBV"} no cubre el año ${anio}; cubre del ${cobertura.desde} al ${cobertura.hasta}.`,
      });
    },
  );

  it("un año cubierto en parte: 422 con el primer día que falta", async () => {
    const plazo = (desde: string, hasta: string) => ({
      [RUTA_CNBV]: {
        ...SHARD_CNBV,
        plazos: { general: { cobertura: { desde, hasta }, excluir_tipos: [] } },
        dias: DIAS_CNBV.slice(1, 2),
      },
    });
    await incompleto(
      inhabiles("autoridad=cnbv&anio=2026"),
      {
        autoridad: "cnbv",
        fecha: "2026-12-01",
        cobertura: { desde: "2026-01-01", hasta: "2026-11-30" },
        detail:
          "El calendario de la CNBV no cubre el año 2026; cubre del 2026-01-01 al 2026-11-30.",
      },
      plazo("2026-01-01", "2026-11-30"),
    );
    reiniciarCargas();
    await incompleto(
      inhabiles("autoridad=cnbv&anio=2026"),
      {
        autoridad: "cnbv",
        fecha: "2026-01-01",
        cobertura: { desde: "2026-03-01", hasta: "2026-12-31" },
        detail:
          "El calendario de la CNBV no cubre el año 2026; cubre del 2026-03-01 al 2026-12-31.",
      },
      plazo("2026-03-01", "2026-12-31"),
    );
  });

  it("un meta interno sin el calendario: 500 genérico", async () => {
    const { lineas } = await errorInterno(inhabiles("autoridad=cnbv&anio=2026"), {
      [RUTA_META]: {
        datasets: {},
        curados: { "dias-inhabiles.sat": INTERNA_CURADOS.curados["dias-inhabiles.sat"] },
      },
    });
    expect(lineas).toEqual(["mexicoapi: error interno: Error en /v1/dias-inhabiles"]);
  });
});
