import { beforeEach, describe, expect, it } from "vitest";
import { catalogoBancos, metaInterna, reiniciarCargas } from "../../src/cargas.js";
import { crearAssets, entornoDe } from "./ayudas.js";

const META = {
  dataset: "bancos",
  as_of: "2026-10-17",
  sources: [
    {
      name: "Banxico",
      url: "https://www.banxico.org.mx/",
      license: "Términos de Banxico",
      license_url: "https://www.banxico.org.mx/terminos",
      citation: "Banco de México.",
    },
  ],
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/bancos.md",
};

const INTERNA = {
  datasets: {
    bancos: { meta: META, records: 2, data_sha256: "a".repeat(64), frescura_horas: 72 },
  },
};

const BANCOS = {
  data: [
    {
      codigo: "002",
      codigo_spei: "40002",
      nombre_corto: "BANAMEX",
      razon_social: "Banco Nacional de México",
      sector: null,
      tipo: "banco",
      participacion: "directa",
      activo: true,
      baja_detectada: null,
      historial: [],
    },
    { codigo: "999", nombre_corto: "VIEJO", activo: false },
  ],
  meta: META,
};

function conAssets(mapa: Record<string, unknown>, status?: number) {
  const assets = crearAssets(
    Object.fromEntries(
      Object.entries(mapa).map(([ruta, cuerpo]) => [
        ruta,
        {
          cuerpo: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
          ...(status === undefined ? {} : { status }),
        },
      ]),
    ),
  );
  return { assets, entorno: entornoDe(assets) };
}

beforeEach(() => reiniciarCargas());

describe("metaInterna", () => {
  it("lee el meta interno una vez por isolate", async () => {
    const { assets, entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA });
    expect(await metaInterna(entorno)).toEqual(INTERNA);
    expect(await metaInterna(entorno)).toEqual(INTERNA);
    expect(assets.pedidas).toEqual(["/v1/_internos/meta.json"]);
  });

  it("lo que devuelve no se puede alterar", async () => {
    const { entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA });
    const interna = await metaInterna(entorno);
    expect(Object.isFrozen(interna)).toBe(true);
    expect(Object.isFrozen(interna.datasets)).toBe(true);
    expect(Object.isFrozen(interna.datasets.bancos?.meta.sources[0])).toBe(true);
  });

  it("reiniciarCargas obliga a leer de nuevo", async () => {
    const { assets, entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA });
    await metaInterna(entorno);
    reiniciarCargas();
    await metaInterna(entorno);
    expect(assets.pedidas).toHaveLength(2);
  });

  it("un asset que no está falla y la falla no se recuerda", async () => {
    await expect(metaInterna(conAssets({}).entorno)).rejects.toThrow();
    const { entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA });
    expect(await metaInterna(entorno)).toEqual(INTERNA);
  });

  it("un estado distinto de 200, aun sin cuerpo, falla", async () => {
    for (const status of [500, 304]) {
      const { entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA }, status);
      await expect(metaInterna(entorno)).rejects.toThrow();
    }
  });

  const dataset = INTERNA.datasets.bancos;
  const conMeta = (meta: unknown) => ({ datasets: { bancos: { ...dataset, meta } } });
  for (const [caso, valor] of [
    ["JSON roto", "{"],
    ["no es objeto", []],
    ["sin datasets", {}],
    ["datasets nulo", { datasets: null }],
    ["dataset no objeto", { datasets: { bancos: 1 } }],
    ["sin meta", conMeta(undefined)],
    ["meta sin docs", conMeta({ ...META, docs: 1 })],
    ["sources no lista", conMeta({ ...META, sources: {} })],
    ["fuente incompleta", conMeta({ ...META, sources: [{ name: "x" }] })],
    ["records no numérico", { datasets: { bancos: { ...dataset, records: "2" } } }],
    ["sin data_sha256", { datasets: { bancos: { ...dataset, data_sha256: undefined } } }],
    ["frescura no numérica", { datasets: { bancos: { ...dataset, frescura_horas: null } } }],
  ] as const) {
    it(`rechaza un meta interno con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/_internos/meta.json": valor });
      await expect(metaInterna(entorno)).rejects.toThrow();
    });
  }
});

describe("catalogoBancos", () => {
  it("mapea código a {codigo, nombre_corto, activo}, una vez por isolate", async () => {
    const { assets, entorno } = conAssets({ "/v1/bancos.json": BANCOS });
    const catalogo = await catalogoBancos(entorno);
    expect([...catalogo]).toEqual([
      ["002", { codigo: "002", nombre_corto: "BANAMEX", activo: true }],
      ["999", { codigo: "999", nombre_corto: "VIEJO", activo: false }],
    ]);
    expect(Object.isFrozen(catalogo.get("002"))).toBe(true);
    expect(await catalogoBancos(entorno)).toBe(catalogo);
    expect(assets.pedidas).toEqual(["/v1/bancos.json"]);
  });

  it("reiniciarCargas obliga a leer de nuevo", async () => {
    const { assets, entorno } = conAssets({ "/v1/bancos.json": BANCOS });
    await catalogoBancos(entorno);
    reiniciarCargas();
    await catalogoBancos(entorno);
    expect(assets.pedidas).toHaveLength(2);
  });

  it("un asset que no está falla", async () => {
    await expect(catalogoBancos(conAssets({}).entorno)).rejects.toThrow();
  });

  const banco = { codigo: "002", nombre_corto: "BANAMEX", activo: true };
  for (const [caso, valor] of [
    ["no es objeto", "null"],
    ["sin data", { meta: META }],
    ["data no lista", { data: {} }],
    ["registro nulo", { data: [null] }],
    ["código no texto", { data: [{ ...banco, codigo: 2 }] }],
    ["sin nombre corto", { data: [{ ...banco, nombre_corto: undefined }] }],
    ["activo no booleano", { data: [{ ...banco, activo: "true" }] }],
  ] as const) {
    it(`rechaza un shard de bancos con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/bancos.json": valor });
      await expect(catalogoBancos(entorno)).rejects.toThrow();
    });
  }
});
