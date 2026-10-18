import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Banco,
  DiaInhabilCurado,
  Estado,
  Municipio,
  TipoCambioFix,
  Udi,
} from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirSqlite, type DatosSqlite } from "../../src/sitio/sqlite.js";
import {
  DIAS_CNBV_OFICIALES,
  SALARIOS_OFICIALES,
  TARIFAS_OFICIALES,
  UMA_OFICIALES,
} from "../curado/ejemplos.js";

const estados: Estado[] = [
  { cve_ent: "01", nombre: "Aguascalientes", abreviatura: "Ags.", cvegeo: "01" },
  { cve_ent: "09", nombre: "Ciudad de México", abreviatura: "CDMX", cvegeo: "09" },
];
const municipios: Municipio[] = [
  {
    cvegeo: "01001",
    cve_ent: "01",
    cve_mun: "001",
    nombre: "Aguascalientes",
    cve_cabecera: "0001",
  },
  { cvegeo: "09002", cve_ent: "09", cve_mun: "002", nombre: "Azcapotzalco", cve_cabecera: null },
];
const bancos: Banco[] = [
  {
    codigo: "002",
    codigo_spei: "40002",
    nombre_corto: "BANAMEX",
    razon_social: "Banco Nacional de México",
    sector: "Banca múltiple",
    tipo: "banca_multiple",
    participacion: "directa",
    activo: true,
    baja_detectada: null,
    historial: [
      { codigo_spei: "40002", nombre_corto: "BANAMEX", desde: "2010-01-01", hasta: null },
    ],
  },
  {
    codigo: "099",
    codigo_spei: "90099",
    nombre_corto: "VIEJO",
    razon_social: null,
    sector: null,
    tipo: "otra_entidad",
    participacion: "no_confirmada",
    activo: false,
    baja_detectada: "2020-05-01",
    historial: [
      { codigo_spei: "90098", nombre_corto: "ANTES", desde: "2010-01-01", hasta: "2015-01-01" },
      { codigo_spei: "90099", nombre_corto: "VIEJO", desde: "2015-01-01", hasta: "2020-05-01" },
    ],
  },
];
const tipoCambioFix: TipoCambioFix[] = [
  { fecha_publicacion: "2026-10-15", valor: "18.4870" },
  { fecha_publicacion: "2026-10-16", valor: "18.4250" },
];
const udis: Udi[] = [
  { fecha: "2026-10-15", valor: "8.612345" },
  { fecha: "2026-10-16", valor: "8.613456" },
  { fecha: "2026-10-17", valor: "8.614567" },
];
const datasets = [
  {
    dataset: "bancos",
    as_of: "2026-10-17",
    records: 2,
    data_sha256: "a".repeat(64),
    manifest: '{"x":1}',
  },
];

const vacaciones: DiaInhabilCurado = {
  fecha: "2026-07-20",
  autoridad: "sat",
  motivo: "Primer periodo general de vacaciones de 2026",
  tipo: "vacaciones",
  fuente: {
    nombre: "Primera Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
    fecha_publicacion: "2026-07-09",
    fragmento:
      "III. El primer periodo general de vacaciones de 2026, comprende del 20 al 31 de julio de 2026.",
  },
};
// El 1 de enero lo tienen las dos autoridades: la llave es autoridad y fecha.
const diasInhabiles: DiaInhabilCurado[] = [
  ...DIAS_CNBV_OFICIALES,
  { ...vacaciones, fecha: "2026-01-01", motivo: "1o. de enero", tipo: "descanso" },
  vacaciones,
];

const base: DatosSqlite = {
  estados,
  municipios,
  bancos,
  tipoCambioFix,
  udis,
  diasInhabiles,
  uma: UMA_OFICIALES,
  salarioMinimo: SALARIOS_OFICIALES,
  tarifasIsr: TARIFAS_OFICIALES,
  datasets,
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sqlite-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function abrir(): Promise<DatabaseSync> {
  const bytes = await construirSqlite(base);
  const ruta = join(dir, "x.sqlite");
  await writeFile(ruta, bytes);
  return new DatabaseSync(ruta, { readOnly: true });
}

describe("construirSqlite", () => {
  it("genera un archivo SQLite con los conteos esperados", async () => {
    const db = await abrir();
    const n = (t: string) =>
      (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([
      n("estados"),
      n("municipios"),
      n("bancos"),
      n("bancos_historial"),
      n("tipo_cambio_fix"),
      n("udis"),
      n("dias_inhabiles"),
      n("uma"),
      n("salario_minimo"),
      n("isr_tramos"),
      n("datasets"),
    ]).toEqual([2, 2, 2, 3, 2, 3, 24, 10, 16, 33, 1]);
    db.close();
  });

  it("guarda null, activo 0/1 y la fila de datasets", async () => {
    const db = await abrir();
    expect(db.prepare("SELECT cve_cabecera FROM municipios WHERE cvegeo = '09002'").get()).toEqual({
      cve_cabecera: null,
    });
    expect(
      db.prepare("SELECT codigo, activo, razon_social FROM bancos ORDER BY codigo").all(),
    ).toEqual([
      { codigo: "002", activo: 1, razon_social: "Banco Nacional de México" },
      { codigo: "099", activo: 0, razon_social: null },
    ]);
    expect(db.prepare("SELECT * FROM datasets").get()).toEqual(datasets[0]);
    db.close();
  });

  it("guarda las series con su fecha como llave y el valor como texto", async () => {
    const db = await abrir();
    expect(db.prepare("SELECT * FROM tipo_cambio_fix ORDER BY fecha_publicacion").all()).toEqual(
      tipoCambioFix,
    );
    expect(db.prepare("SELECT * FROM udis ORDER BY fecha").all()).toEqual(udis);
    expect(db.prepare("SELECT typeof(valor) AS t FROM udis LIMIT 1").get()).toEqual({ t: "text" });
    const columnas = (tabla: string) =>
      db
        .prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info('${tabla}') ORDER BY cid`)
        .all();
    expect(columnas("tipo_cambio_fix")).toEqual([
      { name: "fecha_publicacion", type: "TEXT", notnull: 1, pk: 1 },
      { name: "valor", type: "TEXT", notnull: 1, pk: 0 },
    ]);
    expect(columnas("udis")).toEqual([
      { name: "fecha", type: "TEXT", notnull: 1, pk: 1 },
      { name: "valor", type: "TEXT", notnull: 1, pk: 0 },
    ]);
    db.close();
  });

  it("no deja violaciones de llaves foráneas", async () => {
    const db = await abrir();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("usa tablas STRICT", async () => {
    const db = await abrir();
    const tablas = db
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    expect(tablas).toEqual(
      [
        "bancos",
        "bancos_historial",
        "datasets",
        "dias_inhabiles",
        "estados",
        "isr_tramos",
        "municipios",
        "salario_minimo",
        "tipo_cambio_fix",
        "udis",
        "uma",
      ].map((name) => ({
        name,
        strict: 1,
      })),
    );
    db.close();
  });

  it("falla si un municipio apunta a un estado que no existe", async () => {
    await expect(
      construirSqlite({
        ...base,
        municipios: [
          { cvegeo: "30001", cve_ent: "30", cve_mun: "001", nombre: "X", cve_cabecera: null },
        ],
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("falla si una serie repite una fecha", async () => {
    await expect(construirSqlite({ ...base, udis: [...udis, udis[0] as Udi] })).rejects.toThrow(
      /UNIQUE/,
    );
  });

  it("falla si un curado repite su llave", async () => {
    const repetidos: Partial<DatosSqlite>[] = [
      { diasInhabiles: [...diasInhabiles, vacaciones] },
      { uma: [...UMA_OFICIALES, UMA_OFICIALES[0] as DatosSqlite["uma"][number]] },
      {
        salarioMinimo: [
          ...SALARIOS_OFICIALES,
          SALARIOS_OFICIALES[0] as DatosSqlite["salarioMinimo"][number],
        ],
      },
      {
        tarifasIsr: [
          ...TARIFAS_OFICIALES,
          TARIFAS_OFICIALES[0] as DatosSqlite["tarifasIsr"][number],
        ],
      },
    ];
    for (const cambio of repetidos) {
      await expect(construirSqlite({ ...base, ...cambio }), Object.keys(cambio)[0]).rejects.toThrow(
        /UNIQUE/,
      );
    }
  });

  it("guarda los curados con montos como texto, años enteros y la fuente en columnas", async () => {
    const db = await abrir();
    const columnas = (tabla: string) =>
      db
        .prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info('${tabla}') ORDER BY cid`)
        .all()
        .map((c) => Object.values(c).join(" "));
    const fuente = [
      "fuente_nombre TEXT 1 0",
      "fuente_url TEXT 1 0",
      "fuente_fecha_publicacion TEXT 1 0",
      "fuente_fragmento TEXT 1 0",
    ];
    expect(columnas("dias_inhabiles")).toEqual([
      "autoridad TEXT 1 1",
      "fecha TEXT 1 2",
      "motivo TEXT 1 0",
      "tipo TEXT 1 0",
      ...fuente,
    ]);
    expect(columnas("uma")).toEqual([
      "anio INTEGER 0 1",
      "diaria TEXT 1 0",
      "mensual TEXT 1 0",
      "anual TEXT 1 0",
      "vigencia_desde TEXT 1 0",
      ...fuente,
    ]);
    expect(columnas("salario_minimo")).toEqual([
      "anio INTEGER 1 1",
      "zona TEXT 1 2",
      "diario TEXT 1 0",
      "vigencia_desde TEXT 1 0",
      ...fuente,
    ]);
    expect(columnas("isr_tramos")).toEqual([
      "anio INTEGER 1 1",
      "periodo TEXT 1 2",
      "tramo INTEGER 1 3",
      "limite_inferior TEXT 1 0",
      "limite_superior TEXT 0 0",
      "cuota_fija TEXT 1 0",
      "tasa_excedente TEXT 1 0",
      ...fuente,
    ]);

    const [u2026] = UMA_OFICIALES.filter((u) => u.anio === 2026);
    expect(db.prepare("SELECT * FROM uma WHERE anio = 2026").get()).toEqual({
      anio: 2026,
      diaria: "117.31",
      mensual: "3566.22",
      anual: "42794.64",
      vigencia_desde: "2026-02-01",
      fuente_nombre: u2026?.fuente.nombre,
      fuente_url: u2026?.fuente.url,
      fuente_fecha_publicacion: u2026?.fuente.fecha_publicacion,
      fuente_fragmento: u2026?.fuente.fragmento,
    });
    expect(
      db.prepare("SELECT typeof(anio) AS a, typeof(diaria) AS d FROM uma LIMIT 1").get(),
    ).toEqual({ a: "integer", d: "text" });
    expect(
      db.prepare("SELECT zona, diario FROM salario_minimo WHERE anio = 2019 ORDER BY zona").all(),
    ).toEqual([
      { zona: "general", diario: "102.68" },
      { zona: "zlfn", diario: "176.72" },
    ]);
    expect(
      db
        .prepare(
          "SELECT autoridad, fecha, tipo FROM dias_inhabiles WHERE fecha = '2026-01-01' ORDER BY autoridad",
        )
        .all(),
    ).toEqual([
      { autoridad: "cnbv", fecha: "2026-01-01", tipo: "descanso" },
      { autoridad: "sat", fecha: "2026-01-01", tipo: "descanso" },
    ]);
    // Un renglón por tramo, numerado desde 1; el último no tiene límite superior.
    expect(
      db
        .prepare(
          "SELECT tramo, limite_inferior, limite_superior, cuota_fija, tasa_excedente FROM isr_tramos WHERE anio = 2026 AND periodo = 'mensual' AND tramo IN (1, 11) ORDER BY tramo",
        )
        .all(),
    ).toEqual([
      {
        tramo: 1,
        limite_inferior: "0.01",
        limite_superior: "844.59",
        cuota_fija: "0.00",
        tasa_excedente: "1.92",
      },
      {
        tramo: 11,
        limite_inferior: "425642.00",
        limite_superior: null,
        cuota_fija: "133488.54",
        tasa_excedente: "35.00",
      },
    ]);
    expect(
      db
        .prepare("SELECT DISTINCT fuente_fragmento FROM isr_tramos WHERE periodo = 'mensual'")
        .all(),
    ).toEqual([{ fuente_fragmento: TARIFAS_OFICIALES[2]?.fuente.fragmento }]);
    db.close();
  });
});
