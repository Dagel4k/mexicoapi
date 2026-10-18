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
  const SIN_DATASETS = "El meta interno no tiene datasets.";
  const FORMA = "El meta interno tiene un dataset con forma inesperada.";
  for (const [caso, valor, mensaje] of [
    ["JSON roto", "{", SyntaxError],
    ["no es objeto", [], SIN_DATASETS],
    ["sin datasets", {}, SIN_DATASETS],
    ["datasets nulo", { datasets: null }, SIN_DATASETS],
    ["dataset no objeto", { datasets: { bancos: 1 } }, FORMA],
    ["sin meta", conMeta(undefined), FORMA],
    ["meta sin docs", conMeta({ ...META, docs: 1 }), FORMA],
    ["sources no lista", conMeta({ ...META, sources: {} }), FORMA],
    ["fuente incompleta", conMeta({ ...META, sources: [{ name: "x" }] }), FORMA],
    ["records no numérico", { datasets: { bancos: { ...dataset, records: "2" } } }, FORMA],
    ["sin data_sha256", { datasets: { bancos: { ...dataset, data_sha256: undefined } } }, FORMA],
    ["frescura no numérica", { datasets: { bancos: { ...dataset, frescura_horas: null } } }, FORMA],
    ["cobertura no objeto", conCobertura("2020-01-01"), FORMA],
    ["cobertura sin hasta", conCobertura({ desde: "2020-01-01" }), FORMA],
    [
      "cobertura con fecha que no existe",
      conCobertura({ desde: "2020-01-01", hasta: "2026-02-30" }),
      FORMA,
    ],
    ["cobertura invertida", conCobertura({ desde: "2026-10-16", hasta: "2020-01-02" }), FORMA],
  ] as const) {
    it(`rechaza un meta interno con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/_internos/meta.json": valor });
      await expect(metaInterna(entorno)).rejects.toThrow(mensaje);
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
  const SIN_DATA = "El shard de bancos no tiene data.";
  const REGISTRO = "El shard de bancos tiene un registro con forma inesperada.";
  for (const [caso, valor, mensaje] of [
    ["no es objeto", "null", SIN_DATA],
    ["sin data", { meta: META }, SIN_DATA],
    ["data no lista", { data: {} }, SIN_DATA],
    ["registro nulo", { data: [null] }, REGISTRO],
    ["código no texto", { data: [{ ...banco, codigo: 2 }] }, REGISTRO],
    ["sin nombre corto", { data: [{ ...banco, nombre_corto: undefined }] }, REGISTRO],
    ["activo no booleano", { data: [{ ...banco, activo: "true" }] }, REGISTRO],
  ] as const) {
    it(`rechaza un shard de bancos con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/bancos.json": valor });
      await expect(catalogoBancos(entorno)).rejects.toThrow(mensaje);
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
      await expect(shardFix(entorno, anio, COBERTURA)).rejects.toThrow(
        `El año ${anio} está fuera de la cobertura de fix.`,
      );
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
  const SIN_TRAMO = "El shard fix/2026 no tiene tramo y datos.";
  const FUERA_DEL_ANIO = "El tramo del shard fix/2026 sale de su año.";
  const REGISTRO = "El shard fix/2026 tiene un registro con forma inesperada.";
  const ORDEN = "El shard fix/2026 tiene un registro fuera del tramo o fuera de orden.";
  for (const [caso, valor, mensaje] of [
    ["JSON roto", "{", SyntaxError],
    ["no es objeto", [], SIN_TRAMO],
    ["sin tramo", { datos: [] }, SIN_TRAMO],
    ["tramo sin desde", { tramo: { hasta: "2026-10-16" }, datos: [] }, SIN_TRAMO],
    [
      "tramo con fecha que no existe",
      { tramo: { desde: "2026-01-01", hasta: "2026-02-30" }, datos: [] },
      SIN_TRAMO,
    ],
    [
      "tramo invertido",
      { tramo: { desde: "2026-10-16", hasta: "2026-01-01" }, datos: [] },
      SIN_TRAMO,
    ],
    [
      "tramo que empieza en otro año",
      { tramo: { desde: "2025-12-31", hasta: "2026-10-16" }, datos: [] },
      FUERA_DEL_ANIO,
    ],
    [
      "tramo que termina en otro año",
      { tramo: { desde: "2026-01-01", hasta: "2027-01-01" }, datos: [] },
      FUERA_DEL_ANIO,
    ],
    ["datos no lista", conDatos({}), SIN_TRAMO],
    ["registro nulo", conDatos([null]), REGISTRO],
    ["registro sin fecha", conDatos([{ valor: "18.4250" }]), REGISTRO],
    ["fecha que no existe", conDatos([fix("2026-02-30")]), REGISTRO],
    ["valor numérico", conDatos([fix("2026-01-02", 18.425)]), REGISTRO],
    ["valor con 3 decimales", conDatos([fix("2026-01-02", "18.425")]), REGISTRO],
    ["valor con 6 decimales", conDatos([fix("2026-01-02", "18.425000")]), REGISTRO],
    ["valor negativo", conDatos([fix("2026-01-02", "-18.4250")]), REGISTRO],
    [
      "registro antes del tramo",
      { tramo: { desde: "2026-01-05", hasta: "2026-10-16" }, datos: [fix("2026-01-02")] },
      ORDEN,
    ],
    ["registro después del tramo", conDatos([fix("2026-10-19")]), ORDEN],
    ["fuera de orden", conDatos([fix("2026-01-05"), fix("2026-01-02")]), ORDEN],
    ["fecha repetida", conDatos([fix("2026-01-02"), fix("2026-01-02")]), ORDEN],
  ] as const) {
    it(`rechaza un shard del FIX con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_FIX]: valor });
      await expect(shardFix(entorno, 2026, COBERTURA)).rejects.toThrow(mensaje);
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
      await expect(shardUdis(entorno, 2021, cobertura)).rejects.toThrow(
        "El shard udis/2021 tiene un registro con forma inesperada.",
      );
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
  const FORMA = "El meta interno tiene un dataset curado con forma inesperada.";
  for (const [caso, valor, mensaje] of [
    ["curados no objeto", { datasets: {}, curados: [] }, FORMA],
    ["curados nulo", { datasets: {}, curados: null }, FORMA],
    ["curado no objeto", conCurado("x"), FORMA],
    ["curado sin meta", conCurado({ ...curado, meta: undefined }), FORMA],
    [
      "meta del curado sin sources",
      conCurado({ ...curado, meta: { ...curado.meta, sources: 1 } }),
      FORMA,
    ],
    ["records no numérico", conCurado({ ...curado, records: "18" }), FORMA],
    ["sin data_sha256", conCurado({ ...curado, data_sha256: undefined }), FORMA],
  ] as const) {
    it(`rechaza un meta interno con curados de forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ "/v1/_internos/meta.json": valor });
      await expect(metaInterna(entorno)).rejects.toThrow(mensaje);
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
  const SIN_PARTES = "El shard calendarios/sat no tiene autoridad, plazos, fuentes y días.";
  const FORMA =
    "El shard calendarios/sat tiene un plazo, una fuente o un día con forma inesperada.";
  const SIN_FINES_2026 = "El calendario de sat no cita los fines de semana de 2026.";
  const SIN_GENERAL = "El calendario de sat no tiene un plazo general que cuente todos los días.";
  for (const [caso, valor, mensaje] of [
    ["JSON roto", "{", SyntaxError],
    ["no es objeto", [], SIN_PARTES],
    ["de otra autoridad", SHARD_CNBV, SIN_PARTES],
    ["sin autoridad", { ...SHARD_SAT, autoridad: undefined }, SIN_PARTES],
    ["sin plazos", conPlazos(undefined), SIN_PARTES],
    ["plazos no objeto", conPlazos([]), SIN_PARTES],
    ["días no lista", conDias({}), SIN_PARTES],
    [
      "sin fuentes de fines de semana",
      { ...SHARD_SAT, fuentes_fin_de_semana: undefined },
      SIN_PARTES,
    ],
    [
      "fuentes de fines de semana en lista",
      { ...SHARD_SAT, fuentes_fin_de_semana: [FUENTE_CFF] },
      SIN_PARTES,
    ],
    [
      "fuente de fines de semana sin fragmento",
      { ...SHARD_SAT, fuentes_fin_de_semana: { 2026: { ...FUENTE_CFF, fragmento: undefined } } },
      FORMA,
    ],
    [
      "sin la fuente de un año de la cobertura",
      { ...SHARD_SAT, fuentes_fin_de_semana: {} },
      SIN_FINES_2026,
    ],
    [
      "fuente de fines de semana de un año fuera de la cobertura",
      { ...SHARD_SAT, fuentes_fin_de_semana: { 2026: FUENTE_CFF, 2027: FUENTE_CFF } },
      "El calendario de sat cita fines de semana de años fuera de su cobertura.",
    ],
    [
      "fuente de fines de semana con otro año en la llave",
      { ...SHARD_SAT, fuentes_fin_de_semana: { "2026-01": FUENTE_CFF } },
      SIN_FINES_2026,
    ],
    [
      "plazo desconocido",
      conPlazos({ general, anual: general }),
      "El calendario de sat tiene un tipo de plazo inesperado: anual.",
    ],
    ["plazo nulo", conPlazos({ general, declaraciones_pagos: null }), FORMA],
    ["plazo sin cobertura", conPlazos({ general: { excluir_tipos: [] } }), FORMA],
    [
      "cobertura con fecha que no existe",
      conPlazos({ general: conCobertura("2026-01-01", "2026-02-30") }),
      FORMA,
    ],
    [
      "cobertura invertida",
      conPlazos({ general: conCobertura("2026-12-31", "2026-01-01") }),
      FORMA,
    ],
    [
      "excluir_tipos no lista",
      conPlazos({ general: { ...general, excluir_tipos: "vacaciones" } }),
      FORMA,
    ],
    [
      "excluir_tipos con fin de semana",
      conPlazos({
        general,
        declaraciones_pagos: { ...declaraciones_pagos, excluir_tipos: ["fin_de_semana"] },
      }),
      FORMA,
    ],
    ["sin general", conPlazos({ declaraciones_pagos }), SIN_GENERAL],
    [
      "general que no cuenta las vacaciones",
      conPlazos({ general: declaraciones_pagos }),
      SIN_GENERAL,
    ],
    [
      "ningún plazo contiene a los demás",
      conPlazos({
        general,
        declaraciones_pagos: {
          ...declaraciones_pagos,
          cobertura: { desde: "2026-02-01", hasta: "2026-12-31" },
        },
      }),
      "El calendario de sat no tiene un plazo que contenga a los demás.",
    ],
    ["día nulo", conDias([null]), FORMA],
    ["día sin motivo", conDia({ motivo: undefined }), FORMA],
    ["día de fin de semana", conDia({ tipo: "fin_de_semana" }), FORMA],
    ["día con fecha que no existe", conDia({ fecha: "2026-02-30" }), FORMA],
    ["día sin fuente", conDia({ fuente: undefined }), FORMA],
    ["fuente sin url", conFuente({ url: undefined }), FORMA],
    ["fuente sin fecha de publicación", conFuente({ fecha_publicacion: undefined }), FORMA],
    [
      "fuente con fecha de publicación inválida",
      conFuente({ fecha_publicacion: "28/12/2025" }),
      FORMA,
    ],
    [
      "días fuera de orden",
      conDias([DIAS_SAT[1], DIAS_SAT[0]]),
      "El calendario de sat tiene un día inesperado, repetido o fuera de orden: 2026-01-01.",
    ],
    [
      "fecha repetida",
      conDias([diaUno, diaUno]),
      "El calendario de sat tiene un día inesperado, repetido o fuera de orden: 2026-01-01.",
    ],
    [
      "declaraciones_pagos que cuenta las vacaciones",
      conPlazos({ general, declaraciones_pagos: { ...declaraciones_pagos, excluir_tipos: [] } }),
      "El calendario de sat tiene en declaraciones_pagos excluir_tipos [] y la regla del núcleo pide [vacaciones].",
    ],
    [
      "día fuera de toda cobertura",
      conDia({ fecha: "2027-01-01" }),
      "El calendario de sat tiene un día inesperado, repetido o fuera de orden: 2027-01-01.",
    ],
  ] as const) {
    it(`rechaza un calendario con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_SAT]: valor });
      await expect(calendarioCurado(entorno, "sat")).rejects.toThrow(mensaje);
    });
  }

  it("una llave __proto__ en plazos o en las fuentes llega al núcleo, que la rechaza", async () => {
    // JSON.parse deja `__proto__` como llave propia; cadaValor la conserva con fromEntries (una
    // asignación la perdería en el prototipo) y así el núcleo la ve como un plazo o un año más.
    const texto = JSON.stringify(SHARD_SAT);
    const conLlave = (campo: string, valor: unknown) =>
      texto.replace(`"${campo}":{`, `"${campo}":{"__proto__":${JSON.stringify(valor)},`);
    for (const [cuerpo, mensaje] of [
      [
        conLlave("plazos", general),
        "El calendario de sat tiene un tipo de plazo inesperado: __proto__.",
      ],
      [
        conLlave("fuentes_fin_de_semana", FUENTE_CFF),
        "El calendario de sat cita fines de semana de años fuera de su cobertura.",
      ],
    ] as const) {
      expect(cuerpo).toContain('"__proto__":');
      reiniciarCargas();
      const { entorno } = conAssets({ [RUTA_SAT]: cuerpo });
      await expect(calendarioCurado(entorno, "sat")).rejects.toThrow(mensaje);
    }
    expect(Object.hasOwn(Object.prototype, "general")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "cobertura")).toBe(false);
  });
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
  const SIN_DATA = "La lista de la UMA no tiene data y meta.";
  const REGISTRO = "La lista de la UMA tiene un registro inesperado o años no consecutivos.";
  for (const [caso, valor, mensaje] of [
    ["JSON roto", "{", SyntaxError],
    ["no es objeto", [], SIN_DATA],
    ["sin data", { meta: META_UMA }, SIN_DATA],
    ["data vacía", conUmas([]), SIN_DATA],
    ["sin meta", { data: UMAS }, SIN_DATA],
    ["meta sin docs", { ...LISTA_UMA, meta: { ...META_UMA, docs: undefined } }, SIN_DATA],
    ["registro nulo", conUmas([null]), REGISTRO],
    ["año no entero", conUma({ anio: 2025.5 }), REGISTRO],
    ["año como texto", conUma({ anio: "2025" }), REGISTRO],
    [
      "año antes de 1900",
      conUmas([{ ...u24, anio: 1899, vigencia_desde: "1899-02-01" }]),
      REGISTRO,
    ],
    [
      "año después de 2100",
      conUmas([{ ...u24, anio: 2101, vigencia_desde: "2101-02-01" }]),
      REGISTRO,
    ],
    ["diaria sin dos decimales", conUma({ diaria: "113.1" }), REGISTRO],
    ["mensual numérica", conUma({ mensual: 3439.46 }), REGISTRO],
    ["anual con cero a la izquierda", conUma({ anual: "041273.52" }), REGISTRO],
    ["vigencia que no es el 1 de febrero", conUma({ vigencia_desde: "2025-01-01" }), REGISTRO],
    ["sin fuente", conUma({ fuente: undefined }), REGISTRO],
    ["fuente sin fragmento", conUma({ fuente: { ...u25.fuente, fragmento: 1 } }), REGISTRO],
    ["años con hueco", conUmas([u24, u26]), REGISTRO],
    ["años repetidos", conUmas([u24, u24]), REGISTRO],
    ["años desordenados", conUmas([u25, u24]), REGISTRO],
  ] as const) {
    it(`rechaza una lista de la UMA con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA_UMA]: valor });
      await expect(listaUma(entorno)).rejects.toThrow(mensaje);
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

  const NO_OBJETO = "El índice de años de las constantes no es un objeto.";
  const LISTA = "El índice de años de las constantes tiene una lista inesperada.";
  for (const [caso, valor, mensaje] of [
    ["JSON roto", "{", SyntaxError],
    ["no es objeto", [2026], NO_OBJETO],
    ["lista vacía", { "constantes/uma": [] }, LISTA],
    ["años no lista", { "constantes/uma": 2026 }, LISTA],
    ["año como texto", { "constantes/uma": ["2026"] }, LISTA],
    ["año no entero", { "constantes/uma": [2026.5] }, LISTA],
    ["año antes de 1900", { "constantes/uma": [1899] }, LISTA],
    ["año después de 2100", { "constantes/uma": [2101] }, LISTA],
    ["años desordenados", { "constantes/uma": [2026, 2025] }, LISTA],
    ["años repetidos", { "constantes/uma": [2026, 2026] }, LISTA],
  ] as const) {
    it(`rechaza un índice de años con forma inesperada: ${caso}`, async () => {
      const { entorno } = conAssets({ [RUTA]: valor });
      await expect(aniosConstantes(entorno)).rejects.toThrow(mensaje);
    });
  }
});
