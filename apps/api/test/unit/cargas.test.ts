import { CalendarioIncompletoError } from "@mexicoapi/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aniosConstantes,
  calendarioCurado,
  catalogoBancos,
  listaUma,
  metaInterna,
  reiniciarCargas,
  shardFix,
  shardUdis,
} from "../../src/cargas.js";
import { crearAssets, entornoDe } from "./ayudas.js";
import {
  DIAS_SAT,
  FUENTE_CFF,
  FUENTE_CNBV,
  FUENTE_CNBV_2025,
  INTERNA_CURADOS,
  LISTA_UMA,
  META_UMA,
  RUTA_CNBV,
  RUTA_SAT,
  RUTA_UMA,
  SHARD_CNBV,
  SHARD_SAT,
  UMAS,
} from "./curados.js";

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

describe("metaInterna con datos curados", () => {
  it("conserva los curados, sin tocarlos, y no se pueden alterar", async () => {
    const { entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA_CURADOS });
    const interna = await metaInterna(entorno);
    expect(interna).toEqual(INTERNA_CURADOS);
    expect(Object.isFrozen(interna.curados)).toBe(true);
    expect(Object.isFrozen(interna.curados?.["dias-inhabiles.sat"]?.meta.sources[0])).toBe(true);
  });

  it("un meta sin curados también se acepta: las rutas que los necesitan fallan al usarlo", async () => {
    const { entorno } = conAssets({ "/v1/_internos/meta.json": INTERNA });
    expect((await metaInterna(entorno)).curados).toBeUndefined();
  });

  const curado = INTERNA_CURADOS.curados["dias-inhabiles.sat"];
  const conCurado = (valor: unknown) => ({
    datasets: {},
    curados: { "dias-inhabiles.sat": valor },
  });
  for (const [caso, valor] of [
    ["curados no objeto", { datasets: {}, curados: [] }],
    ["curados nulo", { datasets: {}, curados: null }],
    ["curado no objeto", conCurado("x")],
    ["curado sin meta", conCurado({ ...curado, meta: undefined })],
    ["meta del curado sin sources", conCurado({ ...curado, meta: { ...curado.meta, sources: 1 } })],
    ["records no numérico", conCurado({ ...curado, records: "18" })],
    ["sin data_sha256", conCurado({ ...curado, data_sha256: undefined })],
  ] as const) {
    it(`rechaza un meta interno con curados de forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/_internos/meta.json": valor });
      await expect(metaInterna(entorno)).rejects.toThrow();
    });
  }
});

describe("calendarios curados", () => {
  it("lee el shard una vez por isolate y arma un calendario por tipo de plazo", async () => {
    const { assets, entorno } = conAssets({ [RUTA_SAT]: SHARD_SAT });
    const calendario = await calendarioCurado(entorno, "sat");
    expect(calendario.autoridad).toBe("sat");
    expect([...calendario.plazos.keys()]).toEqual(["general", "declaraciones_pagos"]);
    expect(calendario.general).toBe(calendario.plazos.get("general"));
    expect(calendario.general.cobertura).toEqual({ desde: "2026-01-01", hasta: "2026-11-30" });
    expect(calendario.general.excluirTipos).toEqual([]);
    expect(calendario.plazos.get("declaraciones_pagos")?.excluirTipos).toEqual(["vacaciones"]);
    expect(calendario.amplia).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    expect(calendario.dias).toEqual(DIAS_SAT);
    expect(await calendarioCurado(entorno, "sat")).toBe(calendario);
    expect(assets.pedidas).toEqual([RUTA_SAT]);
  });

  it("general cuenta las vacaciones; declaraciones_pagos no, y cubre hasta diciembre", async () => {
    const { entorno } = conAssets({ [RUTA_SAT]: SHARD_SAT });
    const { general, plazos } = await calendarioCurado(entorno, "sat");
    const declaraciones = plazos.get("declaraciones_pagos");
    expect(general.calendario.inhabil("2026-07-20")?.tipo).toBe("vacaciones");
    expect(declaraciones?.calendario.inhabil("2026-07-20")).toBeNull();
    expect(declaraciones?.calendario.inhabil("2026-07-25")?.tipo).toBe("fin_de_semana");
    expect(declaraciones?.calendario.inhabil("2026-12-25")?.tipo).toBe("descanso");
    expect(declaraciones?.calendario.inhabil("2026-12-26")?.fuente).toEqual(FUENTE_CFF);
    // El 25 de diciembre queda fuera de la cobertura de general: no entra a su calendario.
    expect(() => general.calendario.inhabil("2026-12-25")).toThrow(CalendarioIncompletoError);
    expect(() => declaraciones?.calendario.inhabil("2027-01-01")).toThrow(
      CalendarioIncompletoError,
    );
  });

  it("un plazo más corto que la cobertura amplia trae un respaldo con lo publicado hasta ella", async () => {
    const { entorno } = conAssets({ [RUTA_SAT]: SHARD_SAT, [RUTA_CNBV]: SHARD_CNBV });
    const { general, plazos } = await calendarioCurado(entorno, "sat");
    const respaldo = general.respaldo;
    expect(respaldo?.cobertura).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    // Cuenta lo mismo que general (también las vacaciones) y llega a diciembre.
    expect(respaldo?.inhabil("2026-07-20")?.tipo).toBe("vacaciones");
    expect(respaldo?.inhabil("2026-12-25")).toMatchObject({ tipo: "descanso", fuente: FUENTE_CFF });
    expect(respaldo?.inhabil("2026-12-01")).toBeNull();
    expect(Object.isFrozen(respaldo)).toBe(true);
    // El plazo que ya tiene la cobertura amplia no lo necesita.
    expect(plazos.get("declaraciones_pagos")?.respaldo).toBeUndefined();
    expect((await calendarioCurado(entorno, "cnbv")).general.respaldo).toBeUndefined();
  });

  it("cita cada fin de semana con la fuente de su año", async () => {
    const { entorno } = conAssets({ [RUTA_CNBV]: SHARD_CNBV });
    const { general } = await calendarioCurado(entorno, "cnbv");
    expect(general.calendario.inhabil("2025-10-18")).toEqual({
      fecha: "2025-10-18",
      motivo: "Sábado",
      tipo: "fin_de_semana",
      fuente: FUENTE_CNBV_2025,
    });
    expect(general.calendario.inhabil("2026-10-17")?.fuente).toEqual(FUENTE_CNBV);
    // Un día publicado que cae en sábado conserva su propia cita.
    expect(general.calendario.inhabil("2026-12-12")).toMatchObject({
      tipo: "descanso",
      fuente: FUENTE_CNBV,
    });
  });

  it("la CNBV sale de su archivo y no comparte memoria con el SAT", async () => {
    const { assets, entorno } = conAssets({ [RUTA_SAT]: SHARD_SAT, [RUTA_CNBV]: SHARD_CNBV });
    const cnbv = await calendarioCurado(entorno, "cnbv");
    expect(cnbv.autoridad).toBe("cnbv");
    expect([...cnbv.plazos.keys()]).toEqual(["general"]);
    expect(cnbv.amplia).toEqual({ desde: "2025-01-01", hasta: "2026-12-31" });
    expect(cnbv.general.calendario.inhabil("2026-11-02")?.motivo).toBe("2 de noviembre");
    expect((await calendarioCurado(entorno, "sat")).autoridad).toBe("sat");
    expect(assets.pedidas).toEqual([RUTA_CNBV, RUTA_SAT]);
  });

  it("lo que devuelve no se puede alterar y los días solo traen sus campos", async () => {
    const conExtra = {
      ...SHARD_SAT,
      dias: DIAS_SAT.map((d) => ({ ...d, autoridad: "sat", fuente: { ...d.fuente, x: 1 } })),
    };
    const { entorno } = conAssets({ [RUTA_SAT]: conExtra });
    const calendario = await calendarioCurado(entorno, "sat");
    expect(calendario.dias).toEqual(DIAS_SAT);
    for (const parte of [
      calendario,
      calendario.dias,
      calendario.dias[0],
      calendario.dias[0]?.fuente,
      calendario.general,
      calendario.general.cobertura,
      calendario.general.excluirTipos,
      calendario.amplia,
    ]) {
      expect(Object.isFrozen(parte)).toBe(true);
    }
    const plazos = calendario.plazos as unknown as Map<string, unknown>;
    expect(() => plazos.set("otro", {})).toThrow(TypeError);
  });

  it("una carga fallida cancela el cuerpo y no se recuerda", async () => {
    const vacio = conAssets({});
    await expect(calendarioCurado(vacio.entorno, "sat")).rejects.toThrow();
    expect(vacio.assets.canceladas).toEqual([RUTA_SAT]);
    const roto = conAssets({ [RUTA_SAT]: { ...SHARD_SAT, dias: null } });
    await expect(calendarioCurado(roto.entorno, "sat")).rejects.toThrow();
    const { assets, entorno } = conAssets({ [RUTA_SAT]: SHARD_SAT });
    expect((await calendarioCurado(entorno, "sat")).dias).toHaveLength(DIAS_SAT.length);
    expect(assets.pedidas).toEqual([RUTA_SAT]);
  });

  it("reiniciarCargas obliga a leer de nuevo", async () => {
    const { assets, entorno } = conAssets({ [RUTA_CNBV]: SHARD_CNBV });
    await calendarioCurado(entorno, "cnbv");
    reiniciarCargas();
    await calendarioCurado(entorno, "cnbv");
    expect(assets.pedidas).toEqual([RUTA_CNBV, RUTA_CNBV]);
  });

  const { general, declaraciones_pagos } = SHARD_SAT.plazos;
  const conPlazos = (plazos: unknown) => ({ ...SHARD_SAT, plazos });
  const conDias = (dias: unknown) => ({ ...SHARD_SAT, dias });
  const diaUno = DIAS_SAT[0] as (typeof DIAS_SAT)[number];
  const conDia = (cambios: Record<string, unknown>) => conDias([{ ...diaUno, ...cambios }]);
  const conFuente = (cambios: Record<string, unknown>) =>
    conDia({ fuente: { ...diaUno.fuente, ...cambios } });
  const conCobertura = (desde: string, hasta: string) => ({
    ...general,
    cobertura: { desde, hasta },
  });
  for (const [caso, valor] of [
    ["JSON roto", "{"],
    ["no es objeto", []],
    ["de otra autoridad", SHARD_CNBV],
    ["sin autoridad", { ...SHARD_SAT, autoridad: undefined }],
    ["sin plazos", conPlazos(undefined)],
    ["plazos no objeto", conPlazos([])],
    ["días no lista", conDias({})],
    ["sin fuentes de fines de semana", { ...SHARD_SAT, fuentes_fin_de_semana: undefined }],
    ["fuentes de fines de semana en lista", { ...SHARD_SAT, fuentes_fin_de_semana: [FUENTE_CFF] }],
    [
      "fuente de fines de semana sin fragmento",
      { ...SHARD_SAT, fuentes_fin_de_semana: { 2026: { ...FUENTE_CFF, fragmento: undefined } } },
    ],
    ["sin la fuente de un año de la cobertura", { ...SHARD_SAT, fuentes_fin_de_semana: {} }],
    [
      "fuente de fines de semana de un año fuera de la cobertura",
      { ...SHARD_SAT, fuentes_fin_de_semana: { 2026: FUENTE_CFF, 2027: FUENTE_CFF } },
    ],
    [
      "fuente de fines de semana con otro año en la llave",
      { ...SHARD_SAT, fuentes_fin_de_semana: { "2026-01": FUENTE_CFF } },
    ],
    ["plazo desconocido", conPlazos({ general, anual: general })],
    ["plazo nulo", conPlazos({ general, declaraciones_pagos: null })],
    ["plazo sin cobertura", conPlazos({ general: { excluir_tipos: [] } })],
    [
      "cobertura con fecha que no existe",
      conPlazos({ general: conCobertura("2026-01-01", "2026-02-30") }),
    ],
    ["cobertura invertida", conPlazos({ general: conCobertura("2026-12-31", "2026-01-01") })],
    ["excluir_tipos no lista", conPlazos({ general: { ...general, excluir_tipos: "vacaciones" } })],
    [
      "excluir_tipos con fin de semana",
      conPlazos({
        general,
        declaraciones_pagos: { ...declaraciones_pagos, excluir_tipos: ["fin_de_semana"] },
      }),
    ],
    ["sin general", conPlazos({ declaraciones_pagos })],
    ["general que no cuenta las vacaciones", conPlazos({ general: declaraciones_pagos })],
    [
      "ningún plazo contiene a los demás",
      conPlazos({
        general,
        declaraciones_pagos: {
          ...declaraciones_pagos,
          cobertura: { desde: "2026-02-01", hasta: "2026-12-31" },
        },
      }),
    ],
    ["día nulo", conDias([null])],
    ["día sin motivo", conDia({ motivo: undefined })],
    ["día de fin de semana", conDia({ tipo: "fin_de_semana" })],
    ["día con fecha que no existe", conDia({ fecha: "2026-02-30" })],
    ["día sin fuente", conDia({ fuente: undefined })],
    ["fuente sin url", conFuente({ url: undefined })],
    ["fuente sin fecha de publicación", conFuente({ fecha_publicacion: undefined })],
    ["fuente con fecha de publicación inválida", conFuente({ fecha_publicacion: "28/12/2025" })],
    ["días fuera de orden", conDias([DIAS_SAT[1], DIAS_SAT[0]])],
    ["fecha repetida", conDias([diaUno, diaUno])],
    ["día fuera de toda cobertura", conDia({ fecha: "2027-01-01" })],
  ] as const) {
    it(`rechaza un calendario con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_SAT]: valor });
      await expect(calendarioCurado(entorno, "sat")).rejects.toThrow();
    });
  }
});

describe("lista de la UMA", () => {
  it("lee la lista una vez por isolate, con su meta", async () => {
    const { assets, entorno } = conAssets({ [RUTA_UMA]: LISTA_UMA });
    const lista = await listaUma(entorno);
    expect(lista).toEqual({ umas: UMAS, meta: META_UMA });
    expect(await listaUma(entorno)).toBe(lista);
    expect(assets.pedidas).toEqual([RUTA_UMA]);
  });

  it("lo que devuelve no se puede alterar y solo trae los campos de cada UMA", async () => {
    const conExtra = { ...LISTA_UMA, data: UMAS.map((u) => ({ ...u, interno: 1 })) };
    const { entorno } = conAssets({ [RUTA_UMA]: conExtra });
    const lista = await listaUma(entorno);
    expect(lista.umas).toEqual(UMAS);
    for (const parte of [lista, lista.umas, lista.umas[0], lista.umas[0]?.fuente, lista.meta]) {
      expect(Object.isFrozen(parte)).toBe(true);
    }
  });

  it("una carga fallida no se recuerda; reiniciarCargas obliga a leer de nuevo", async () => {
    await expect(listaUma(conAssets({}).entorno)).rejects.toThrow();
    const { assets, entorno } = conAssets({ [RUTA_UMA]: LISTA_UMA });
    await listaUma(entorno);
    reiniciarCargas();
    await listaUma(entorno);
    expect(assets.pedidas).toEqual([RUTA_UMA, RUTA_UMA]);
  });

  type RegistroUma = (typeof UMAS)[number];
  const [u24, u25, u26] = UMAS as [RegistroUma, RegistroUma, RegistroUma];
  const conUmas = (data: unknown) => ({ ...LISTA_UMA, data });
  const conUma = (cambios: Record<string, unknown>) => conUmas([u24, { ...u25, ...cambios }, u26]);
  for (const [caso, valor] of [
    ["JSON roto", "{"],
    ["no es objeto", []],
    ["sin data", { meta: META_UMA }],
    ["data vacía", conUmas([])],
    ["sin meta", { data: UMAS }],
    ["meta sin docs", { ...LISTA_UMA, meta: { ...META_UMA, docs: undefined } }],
    ["registro nulo", conUmas([null])],
    ["año no entero", conUma({ anio: 2025.5 })],
    ["año como texto", conUma({ anio: "2025" })],
    ["año antes de 1900", conUmas([{ ...u24, anio: 1899, vigencia_desde: "1899-02-01" }])],
    ["año después de 2100", conUmas([{ ...u24, anio: 2101, vigencia_desde: "2101-02-01" }])],
    ["diaria sin dos decimales", conUma({ diaria: "113.1" })],
    ["mensual numérica", conUma({ mensual: 3439.46 })],
    ["anual con cero a la izquierda", conUma({ anual: "041273.52" })],
    ["vigencia que no es el 1 de febrero", conUma({ vigencia_desde: "2025-01-01" })],
    ["sin fuente", conUma({ fuente: undefined })],
    ["fuente sin fragmento", conUma({ fuente: { ...u25.fuente, fragmento: 1 } })],
    ["años con hueco", conUmas([u24, u26])],
    ["años repetidos", conUmas([u24, u24])],
    ["años desordenados", conUmas([u25, u24])],
  ] as const) {
    it(`rechaza una lista de la UMA con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_UMA]: valor });
      await expect(listaUma(entorno)).rejects.toThrow();
    });
  }
});

describe("años de las constantes", () => {
  const RUTA = "/v1/_internos/constantes.json";
  const INDICE = {
    "constantes/salario-minimo": [2019, 2020],
    "constantes/uma": [2017, 2018, 2019],
    "isr/tarifa/mensual": [2026],
  };

  it("lee el índice una vez por isolate y no se puede alterar", async () => {
    const { assets, entorno } = conAssets({ [RUTA]: INDICE });
    const anios = await aniosConstantes(entorno);
    expect([...anios]).toEqual(Object.entries(INDICE));
    expect(Object.isFrozen(anios.get("constantes/uma"))).toBe(true);
    expect(() => (anios as unknown as Map<string, unknown>).set("x", [])).toThrow(TypeError);
    expect(await aniosConstantes(entorno)).toBe(anios);
    expect(assets.pedidas).toEqual([RUTA]);
  });

  it("una carga fallida no se recuerda; reiniciarCargas obliga a leer de nuevo", async () => {
    await expect(aniosConstantes(conAssets({}).entorno)).rejects.toThrow();
    const { assets, entorno } = conAssets({ [RUTA]: INDICE });
    await aniosConstantes(entorno);
    reiniciarCargas();
    await aniosConstantes(entorno);
    expect(assets.pedidas).toEqual([RUTA, RUTA]);
  });

  for (const [caso, valor] of [
    ["JSON roto", "{"],
    ["no es objeto", [2026]],
    ["lista vacía", { "constantes/uma": [] }],
    ["años no lista", { "constantes/uma": 2026 }],
    ["año como texto", { "constantes/uma": ["2026"] }],
    ["año no entero", { "constantes/uma": [2026.5] }],
    ["año antes de 1900", { "constantes/uma": [1899] }],
    ["año después de 2100", { "constantes/uma": [2101] }],
    ["años desordenados", { "constantes/uma": [2026, 2025] }],
    ["años repetidos", { "constantes/uma": [2026, 2026] }],
  ] as const) {
    it(`rechaza un índice de años con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA]: valor });
      await expect(aniosConstantes(entorno)).rejects.toThrow();
    });
  }
});
