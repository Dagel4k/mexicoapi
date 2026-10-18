import {
  calendarioLft,
  diasDescansoLft,
  FUENTE_LFT_74,
  FUENTE_LFT_715,
  sumarDiasHabiles,
} from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { manejar } from "../../src/index.js";
import { CACHE_DATOS } from "../../src/respuestas.js";
import { crearAssets, entornoDe, peticion, SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

const META_LFT = {
  dataset: "dias-inhabiles.lft",
  as_of: "2026-05-14",
  sources: [
    {
      name: "Ley Federal del Trabajo, artículos 74 y 715",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
      license:
        "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
      license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      citation:
        "Ley Federal del Trabajo, artículos 74 y 715, texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
    },
  ],
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#dias-habiles",
};

const META_INHABILES = {
  ...META_LFT,
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#dias-inhabiles",
};

const COBERTURA = { desde: "2007-01-01", hasta: "2100-12-31" };

/** Las rutas de días nunca tocan ASSETS. */
async function pedir(ruta: string, init?: RequestInit) {
  const assets = crearAssets();
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  expect(assets.pedidas, ruta).toEqual([]);
  return respuesta;
}

/** El mismo cálculo que hace el núcleo, como lo serializa la API. */
const delNucleo = (desde: string, dias: number, permitirIncompleto = false) =>
  JSON.parse(
    JSON.stringify(
      sumarDiasHabiles({ calendario: calendarioLft(), desde, dias, permitirIncompleto }),
    ),
  );

const habiles = (query: string) => `/v1/dias-habiles?${query}`;
const inhabiles = (query: string) => `/v1/dias-inhabiles?${query}`;

describe("meta de días", () => {
  it("cita los artículos 74 y 715 de la LFT", () => {
    expect(META_LFT.sources[0]?.url).toBe(FUENTE_LFT_74.url);
    expect(META_LFT.sources[0]?.url).toBe(FUENTE_LFT_715.url);
  });
});

describe("GET /v1/dias-habiles", () => {
  it("salta el puente de la LFT: 2026-11-13 más 1 día hábil es 2026-11-17", async () => {
    const r = await pedir(habiles("autoridad=lft&desde=2026-11-13&dias=1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
    const texto = await r.text();
    expect(Object.keys(JSON.parse(texto))).toEqual(["data", "meta"]);
    expect(JSON.parse(texto)).toEqual({
      data: {
        autoridad: "lft",
        desde: "2026-11-13",
        dias: 1,
        resultado: "2026-11-17",
        inhabiles_saltados: [
          {
            fecha: "2026-11-16",
            motivo: "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
            tipo: "descanso",
            fuente: { ...FUENTE_LFT_74 },
          },
        ],
        advertencias: [],
      },
      meta: META_LFT,
    });
  });

  for (const [desde, dias, resultado] of [
    ["2026-11-13", 5, "2026-11-23"],
    ["2026-12-24", 1, "2026-12-28"],
    ["2026-01-30", 1, "2026-02-03"],
    ["2026-03-13", 1, "2026-03-17"],
    ["2026-12-31", 1, "2027-01-04"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2026-11-13", 3650, "2041-03-07"],
  ] as const) {
    it(`${desde} más ${dias} da ${resultado}, igual que el núcleo`, async () => {
      const r = await pedir(habiles(`autoridad=lft&desde=${desde}&dias=${dias}`));
      expect(r.status).toBe(200);
      const { data } = (await r.json()) as { data: { resultado: string } };
      expect(data.resultado).toBe(resultado);
      expect(data).toEqual(delNucleo(desde, dias));
    });
  }

  it("permitir_incompleto=false es lo mismo que omitirlo; el orden de la query no importa", async () => {
    const sin = await (await pedir(habiles("autoridad=lft&desde=2026-11-13&dias=1"))).text();
    const con = await pedir(
      habiles("dias=1&permitir_incompleto=false&desde=2026-11-13&autoridad=lft"),
    );
    expect(con.status).toBe(200);
    expect(await con.text()).toBe(sin);
  });

  it("fuera de la cobertura da 422 con autoridad, fecha y cobertura", async () => {
    for (const [query, fecha] of [
      ["autoridad=lft&desde=2100-12-30&dias=5", "2101-01-01"],
      ["autoridad=lft&desde=2006-12-29&dias=1", "2006-12-30"],
      ["autoridad=lft&desde=2100-12-30&dias=5&permitir_incompleto=false", "2101-01-01"],
    ] as const) {
      const r = await pedir(habiles(query));
      expect(r.status, query).toBe(422);
      expect(r.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
      expect(await r.json(), query).toEqual({
        type: `${TIPO}calendario-incompleto`,
        title: "Calendario incompleto",
        status: 422,
        detail: `El calendario de lft no cubre ${fecha}; cubre del 2007-01-01 al 2100-12-31.`,
        instance: "/v1/dias-habiles",
        autoridad: "lft",
        fecha,
        cobertura: COBERTURA,
      });
    }
  });

  it("con permitir_incompleto=true, fuera de la cobertura da 200 con advertencias", async () => {
    const r = await pedir(
      habiles("autoridad=lft&desde=2100-12-30&dias=5&permitir_incompleto=true"),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      data: {
        autoridad: "lft",
        desde: "2100-12-30",
        dias: 5,
        resultado: "2101-01-06",
        inhabiles_saltados: [],
        advertencias: ["Calendario incompleto: lft 2101; solo se descontaron fines de semana."],
      },
      meta: META_LFT,
    });
  });

  it("un resultado después del año 9999 da 400 en desde, no 500", async () => {
    for (const query of [
      "autoridad=lft&desde=9999-12-31&dias=1",
      "autoridad=lft&desde=9999-12-31&dias=1&permitir_incompleto=true",
      "autoridad=lft&desde=9999-12-20&dias=3650&permitir_incompleto=true",
    ]) {
      const r = await pedir(habiles(query));
      expect(r.status, query).toBe(400);
      expect(await r.json(), query).toEqual({
        type: `${TIPO}parametro-invalido`,
        title: "Parámetro inválido",
        status: 400,
        detail: "Con estos días, el resultado pasaría del año 9999.",
        instance: "/v1/dias-habiles",
        parametro: "desde",
      });
    }
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    const ruta = habiles("autoridad=lft&desde=2026-11-13&dias=1");
    const get = await pedir(ruta);
    const head = await pedir(ruta, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect([...head.headers]).toEqual([...get.headers]);
  });

  describe("query rara: 400 que nombra el parámetro", () => {
    const BASE = { autoridad: "lft", desde: "2026-11-13", dias: "1" };
    const con = (cambios: Record<string, string | null>) =>
      Object.entries({ ...BASE, ...cambios })
        .filter((par): par is [string, string] => par[1] !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");

    const DETALLES: Record<string, string> = {
      autoridad: "Autoridades disponibles: lft.",
      desde: "La fecha de partida (desde) debe ser una fecha válida con formato AAAA-MM-DD.",
      dias: "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
      permitir_incompleto: "El parámetro permitir_incompleto debe ser true o false.",
    };

    const casos: ReadonlyArray<readonly [string, string, string]> = [
      // [query, parámetro, detalle esperado]
      ...["0", "3651", "01", "-1", "1.5", "1e3", "10000", "+1", "%201", "%EF%BC%91", "uno"].map(
        (v) => [con({ dias: v }), "dias", DETALLES.dias as string] as const,
      ),
      ...[
        "2026-02-30",
        "2025-02-29",
        "2026-13-01",
        "2026-00-10",
        "2026-11-00",
        "0000-01-01",
        "2026-2-3",
        "20261113",
        "2026-11-13T00:00:00Z",
        "2026%2F11%2F13",
        "%EF%BC%92026-11-13",
      ].map((v) => [con({ desde: v }), "desde", DETALLES.desde as string] as const),
      ...["sat", "cnbv", "LFT", "lft%20", "%20lft"].map(
        (v) => [con({ autoridad: v }), "autoridad", DETALLES.autoridad as string] as const,
      ),
      ...["1", "0", "TRUE", "si", "yes"].map(
        (v) =>
          [
            con({ permitir_incompleto: v }),
            "permitir_incompleto",
            DETALLES.permitir_incompleto as string,
          ] as const,
      ),
      ...["autoridad", "desde", "dias", "permitir_incompleto"].map(
        (p) => [con({ [p]: "" }), p, `El parámetro ${p} está vacío.`] as const,
      ),
      [`${con({})}&dias=2`, "dias", "El parámetro dias aparece más de una vez."],
      [`${con({})}&autoridad=lft`, "autoridad", "El parámetro autoridad aparece más de una vez."],
      [`${con({})}&desde=2026-11-13`, "desde", "El parámetro desde aparece más de una vez."],
    ];

    for (const [query, parametro, detalle] of casos) {
      it(`${query} da 400 en ${parametro}`, async () => {
        const r = await pedir(habiles(query));
        expect(r.status).toBe(400);
        expect(await r.json()).toEqual({
          type: `${TIPO}parametro-invalido`,
          title: "Parámetro inválido",
          status: 400,
          detail: detalle,
          instance: "/v1/dias-habiles",
          parametro,
        });
      });
    }

    for (const parametro of ["autoridad", "desde", "dias"]) {
      it(`sin ${parametro} da 400 parametro-faltante`, async () => {
        const r = await pedir(habiles(con({ [parametro]: null })));
        expect(r.status).toBe(400);
        expect(await r.json()).toEqual({
          type: `${TIPO}parametro-faltante`,
          title: "Falta un parámetro obligatorio",
          status: 400,
          detail: `Falta el parámetro ${parametro}.`,
          instance: "/v1/dias-habiles",
          parametro,
        });
      });
    }

    for (const [extra, parametro] of [
      ["fecha=2026-11-13", "fecha"],
      ["x=1", "x"],
      ["Dias=1", "Dias"],
      ["constructor=1", "constructor"],
    ] as const) {
      it(`un parámetro desconocido (${parametro}) da 400 parametro-desconocido`, async () => {
        const r = await pedir(habiles(`${con({})}&${extra}`));
        expect(r.status).toBe(400);
        expect(await r.json()).toMatchObject({
          type: `${TIPO}parametro-desconocido`,
          parametro,
        });
      });
    }

    it("sin ningún parámetro da parametro-faltante en autoridad", async () => {
      const r = await pedir("/v1/dias-habiles");
      expect(await r.json()).toMatchObject({
        type: `${TIPO}parametro-faltante`,
        parametro: "autoridad",
      });
    });

    it("segmentos vacíos dan 400 parametro-invalido", async () => {
      for (const query of [`${con({})}&&permitir_incompleto=true`, `&${con({})}`, `${con({})}&`]) {
        const r = await pedir(habiles(query));
        expect(r.status, query).toBe(400);
        expect(await r.json(), query).toMatchObject({
          type: `${TIPO}parametro-invalido`,
          detail: "La query tiene un parámetro sin nombre.",
        });
      }
    });
  });
});

describe("GET /v1/dias-inhabiles", () => {
  it("lista los días de descanso de 2026, exactamente los del núcleo", async () => {
    const r = await pedir(inhabiles("autoridad=lft&anio=2026"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
    const cuerpo = (await r.json()) as { data: Array<{ fecha: string }>; meta: unknown };
    expect(Object.keys(cuerpo)).toEqual(["data", "meta"]);
    expect(cuerpo.data.map((d) => d.fecha)).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
    expect(cuerpo.data).toEqual(JSON.parse(JSON.stringify(diasDescansoLft(2026))));
    expect(cuerpo.meta).toEqual(META_INHABILES);
  });

  it("acepta los extremos de la cobertura, 2007 y 2100", async () => {
    for (const anio of [2007, 2100]) {
      const r = await pedir(inhabiles(`autoridad=lft&anio=${anio}`));
      expect(r.status).toBe(200);
      const { data } = (await r.json()) as { data: unknown };
      expect(data).toEqual(JSON.parse(JSON.stringify(diasDescansoLft(anio))));
    }
  });

  it("un año fuera de la cobertura da 422 con fecha el 1 de enero de ese año", async () => {
    for (const anio of ["2006", "2101", "0001", "9999"]) {
      const r = await pedir(inhabiles(`autoridad=lft&anio=${anio}`));
      expect(r.status, anio).toBe(422);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json(), anio).toEqual({
        type: `${TIPO}calendario-incompleto`,
        title: "Calendario incompleto",
        status: 422,
        detail: `El calendario de lft no cubre el año ${anio}; cubre del 2007-01-01 al 2100-12-31.`,
        instance: "/v1/dias-inhabiles",
        autoridad: "lft",
        fecha: `${anio}-01-01`,
        cobertura: COBERTURA,
      });
    }
  });

  it("un año que no tiene 4 dígitos, o es 0000, da 400 en anio", async () => {
    for (const anio of [
      "0000",
      "26",
      "02026",
      "2026.0",
      "-2026",
      "%EF%BC%92%EF%BC%90%EF%BC%92%EF%BC%96",
      "dos",
    ]) {
      const r = await pedir(inhabiles(`autoridad=lft&anio=${anio}`));
      expect(r.status, anio).toBe(400);
      expect(await r.json(), anio).toEqual({
        type: `${TIPO}parametro-invalido`,
        title: "Parámetro inválido",
        status: 400,
        detail: "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
        instance: "/v1/dias-inhabiles",
        parametro: "anio",
      });
    }
  });

  it("autoridad distinta de lft, faltante, repetida o desconocida da 400 con el parámetro", async () => {
    for (const [query, tipo, parametro] of [
      ["autoridad=sat&anio=2026", "parametro-invalido", "autoridad"],
      ["anio=2026", "parametro-faltante", "autoridad"],
      ["autoridad=lft", "parametro-faltante", "anio"],
      ["autoridad=lft&anio=2026&anio=2027", "parametro-invalido", "anio"],
      ["autoridad=lft&anio=", "parametro-invalido", "anio"],
      ["autoridad=lft&anio=2026&desde=2026-01-01", "parametro-desconocido", "desde"],
    ] as const) {
      const r = await pedir(inhabiles(query));
      expect(r.status, query).toBe(400);
      expect(await r.json(), query).toMatchObject({ type: `${TIPO}${tipo}`, parametro });
    }
    const sat = await pedir(inhabiles("autoridad=sat&anio=2026"));
    expect(await sat.json()).toMatchObject({ detail: "Autoridades disponibles: lft." });
  });
});
