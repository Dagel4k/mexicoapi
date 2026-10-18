import { beforeEach, describe, expect, it } from "vitest";
import {
  catalogoBancos,
  metaInterna,
  reiniciarCargas,
  shardFix,
  shardUdis,
} from "../../src/cargas.js";
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

  it("conserva la cobertura de las series", async () => {
    const cobertura = { desde: "2020-01-02", hasta: "2026-10-16" };
    const conSerie = { datasets: { fix: { ...INTERNA.datasets.bancos, cobertura } } };
    const { entorno } = conAssets({ "/v1/_internos/meta.json": conSerie });
    const interna = await metaInterna(entorno);
    expect(interna.datasets.fix?.cobertura).toEqual(cobertura);
    expect(Object.isFrozen(interna.datasets.fix?.cobertura)).toBe(true);
  });

  const dataset = INTERNA.datasets.bancos;
  const conMeta = (meta: unknown) => ({ datasets: { bancos: { ...dataset, meta } } });
  const conCobertura = (cobertura: unknown) => ({
    datasets: { bancos: { ...dataset, cobertura } },
  });
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
    ["cobertura no objeto", conCobertura("2020-01-01")],
    ["cobertura sin hasta", conCobertura({ desde: "2020-01-01" })],
    [
      "cobertura con fecha que no existe",
      conCobertura({ desde: "2020-01-01", hasta: "2026-02-30" }),
    ],
    ["cobertura invertida", conCobertura({ desde: "2026-10-16", hasta: "2020-01-02" })],
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

  it("una carga fallida cancela el cuerpo y no se recuerda", async () => {
    const vacio = conAssets({});
    await expect(catalogoBancos(vacio.entorno)).rejects.toThrow();
    expect(vacio.assets.canceladas).toEqual(["/v1/bancos.json"]);
    const { assets, entorno } = conAssets({ "/v1/bancos.json": BANCOS });
    expect((await catalogoBancos(entorno)).get("002")?.nombre_corto).toBe("BANAMEX");
    expect(assets.pedidas).toEqual(["/v1/bancos.json"]);
  });

  it("el catálogo compartido no se puede alterar", async () => {
    const { entorno } = conAssets({ "/v1/bancos.json": BANCOS });
    const catalogo = await catalogoBancos(entorno);
    const comoMapa = catalogo as unknown as Map<string, unknown>;
    const otro = { codigo: "001", nombre_corto: "OTRO", activo: true };
    expect(() => comoMapa.set("001", otro)).toThrow(TypeError);
    expect(() => comoMapa.delete("002")).toThrow(TypeError);
    expect(() => comoMapa.clear()).toThrow(TypeError);
    expect(() => Map.prototype.set.call(comoMapa, "001", otro)).toThrow(TypeError);
    expect(Object.isFrozen(catalogo)).toBe(true);
    const otraVez = await catalogoBancos(entorno);
    expect(otraVez.size).toBe(2);
    expect(otraVez.has("001")).toBe(false);
    expect(otraVez.has("002")).toBe(true);
  });

  it("se lee como un ReadonlyMap", async () => {
    const { entorno } = conAssets({ "/v1/bancos.json": BANCOS });
    const catalogo = await catalogoBancos(entorno);
    expect([...catalogo.keys()]).toEqual(["002", "999"]);
    expect([...catalogo.values()].map((b) => b.activo)).toEqual([true, false]);
    expect([...catalogo.entries()].map(([codigo]) => codigo)).toEqual(["002", "999"]);
    const vistos: string[] = [];
    const contexto = { prefijo: ">" };
    catalogo.forEach(function (this: typeof contexto, banco, codigo, mapa) {
      vistos.push(`${this.prefijo}${codigo}:${banco.nombre_corto}:${mapa === catalogo}`);
    }, contexto);
    expect(vistos).toEqual([">002:BANAMEX:true", ">999:VIEJO:true"]);
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

describe("shards anuales de las series", () => {
  const COBERTURA = { desde: "2020-01-02", hasta: "2026-10-16" };
  const SHARD_FIX = {
    tramo: { desde: "2026-01-01", hasta: "2026-10-16" },
    datos: [
      { fecha_publicacion: "2026-01-02", valor: "18.0012" },
      { fecha_publicacion: "2026-10-16", valor: "18.4250" },
    ],
  };
  const SHARD_UDIS = {
    tramo: { desde: "2021-01-01", hasta: "2021-12-31" },
    datos: [
      { fecha: "2021-01-01", valor: "6.606023" },
      { fecha: "2021-01-02", valor: "6.606458" },
    ],
  };
  const RUTA_FIX = "/v1/_internos/fix/2026.json";
  const RUTA_UDIS = "/v1/_internos/udis/2021.json";

  it("lee el shard del año una vez por isolate, con su tramo y sus datos", async () => {
    const { assets, entorno } = conAssets({ [RUTA_FIX]: SHARD_FIX });
    const shard = await shardFix(entorno, 2026, COBERTURA);
    expect(shard).toEqual(SHARD_FIX);
    expect(await shardFix(entorno, 2026, COBERTURA)).toBe(shard);
    expect(assets.pedidas).toEqual([RUTA_FIX]);
  });

  it("las UDIS salen de su carpeta y no comparten memoria con el FIX", async () => {
    const { assets, entorno } = conAssets({
      [RUTA_UDIS]: SHARD_UDIS,
      "/v1/_internos/fix/2021.json": { tramo: SHARD_UDIS.tramo, datos: [] },
    });
    const cobertura = { desde: "2020-01-01", hasta: "2026-10-25" };
    expect(await shardUdis(entorno, 2021, cobertura)).toEqual(SHARD_UDIS);
    expect((await shardFix(entorno, 2021, cobertura)).datos).toEqual([]);
    expect(assets.pedidas).toEqual([RUTA_UDIS, "/v1/_internos/fix/2021.json"]);
  });

  it("lo que devuelve no se puede alterar y solo trae los campos del registro", async () => {
    const conExtra = {
      ...SHARD_FIX,
      datos: SHARD_FIX.datos.map((r) => ({ ...r, interno: "x" })),
    };
    const { entorno } = conAssets({ [RUTA_FIX]: conExtra });
    const shard = await shardFix(entorno, 2026, COBERTURA);
    expect(shard.datos).toEqual(SHARD_FIX.datos);
    for (const parte of [shard, shard.tramo, shard.datos, shard.datos[0]]) {
      expect(Object.isFrozen(parte)).toBe(true);
    }
  });

  it("un año fuera de la cobertura falla sin pedir nada", async () => {
    const { assets, entorno } = conAssets({ [RUTA_FIX]: SHARD_FIX });
    for (const anio of [2019, 2027, Number.NaN]) {
      await expect(shardFix(entorno, anio, COBERTURA)).rejects.toThrow();
    }
    expect(assets.pedidas).toEqual([]);
  });

  it("una carga fallida cancela el cuerpo y no se recuerda", async () => {
    const vacio = conAssets({});
    await expect(shardFix(vacio.entorno, 2026, COBERTURA)).rejects.toThrow();
    expect(vacio.assets.canceladas).toEqual([RUTA_FIX]);
    const roto = conAssets({ [RUTA_FIX]: SHARD_FIX }, 500);
    await expect(shardFix(roto.entorno, 2026, COBERTURA)).rejects.toThrow();
    const { assets, entorno } = conAssets({ [RUTA_FIX]: SHARD_FIX });
    expect((await shardFix(entorno, 2026, COBERTURA)).datos).toHaveLength(2);
    expect(assets.pedidas).toEqual([RUTA_FIX]);
  });

  it("reiniciarCargas obliga a leer de nuevo", async () => {
    const { assets, entorno } = conAssets({ [RUTA_FIX]: SHARD_FIX });
    await shardFix(entorno, 2026, COBERTURA);
    reiniciarCargas();
    await shardFix(entorno, 2026, COBERTURA);
    expect(assets.pedidas).toEqual([RUTA_FIX, RUTA_FIX]);
  });

  const fix = (fecha_publicacion: unknown, valor: unknown = "18.4250") => ({
    fecha_publicacion,
    valor,
  });
  const conDatos = (datos: unknown) => ({ tramo: SHARD_FIX.tramo, datos });
  for (const [caso, valor] of [
    ["JSON roto", "{"],
    ["no es objeto", []],
    ["sin tramo", { datos: [] }],
    ["tramo sin desde", { tramo: { hasta: "2026-10-16" }, datos: [] }],
    [
      "tramo con fecha que no existe",
      { tramo: { desde: "2026-01-01", hasta: "2026-02-30" }, datos: [] },
    ],
    ["tramo invertido", { tramo: { desde: "2026-10-16", hasta: "2026-01-01" }, datos: [] }],
    [
      "tramo que empieza en otro año",
      { tramo: { desde: "2025-12-31", hasta: "2026-10-16" }, datos: [] },
    ],
    [
      "tramo que termina en otro año",
      { tramo: { desde: "2026-01-01", hasta: "2027-01-01" }, datos: [] },
    ],
    ["datos no lista", conDatos({})],
    ["registro nulo", conDatos([null])],
    ["registro sin fecha", conDatos([{ valor: "18.4250" }])],
    ["fecha que no existe", conDatos([fix("2026-02-30")])],
    ["valor numérico", conDatos([fix("2026-01-02", 18.425)])],
    ["valor con 3 decimales", conDatos([fix("2026-01-02", "18.425")])],
    ["valor con 6 decimales", conDatos([fix("2026-01-02", "18.425000")])],
    ["valor negativo", conDatos([fix("2026-01-02", "-18.4250")])],
    [
      "registro antes del tramo",
      { tramo: { desde: "2026-01-05", hasta: "2026-10-16" }, datos: [fix("2026-01-02")] },
    ],
    ["registro después del tramo", conDatos([fix("2026-10-19")])],
    ["fuera de orden", conDatos([fix("2026-01-05"), fix("2026-01-02")])],
    ["fecha repetida", conDatos([fix("2026-01-02"), fix("2026-01-02")])],
  ] as const) {
    it(`rechaza un shard del FIX con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_FIX]: valor });
      await expect(shardFix(entorno, 2026, COBERTURA)).rejects.toThrow();
    });
  }

  it("rechaza en las UDIS un valor sin 6 decimales o un registro del FIX", async () => {
    const cobertura = { desde: "2020-01-01", hasta: "2026-10-25" };
    for (const datos of [
      [{ fecha: "2021-01-01", valor: "6.6060" }],
      [{ fecha_publicacion: "2021-01-01", valor: "6.606023" }],
    ]) {
      reiniciarCargas();
      const { entorno } = conAssets({ [RUTA_UDIS]: { tramo: SHARD_UDIS.tramo, datos } });
      await expect(shardUdis(entorno, 2021, cobertura)).rejects.toThrow();
    }
  });
});
