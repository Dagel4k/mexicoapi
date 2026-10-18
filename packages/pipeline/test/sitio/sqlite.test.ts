import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Banco, Estado, Municipio, TipoCambioFix, Udi } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirSqlite } from "../../src/sitio/sqlite.js";

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

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sqlite-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function abrir(): Promise<DatabaseSync> {
  const bytes = await construirSqlite({
    estados,
    municipios,
    bancos,
    tipoCambioFix,
    udis,
    datasets,
  });
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
      n("datasets"),
    ]).toEqual([2, 2, 2, 3, 2, 3, 1]);
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
        "estados",
        "municipios",
        "tipo_cambio_fix",
        "udis",
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
        estados,
        municipios: [
          { cvegeo: "30001", cve_ent: "30", cve_mun: "001", nombre: "X", cve_cabecera: null },
        ],
        bancos,
        tipoCambioFix,
        udis,
        datasets,
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("falla si una serie repite una fecha", async () => {
    await expect(
      construirSqlite({
        estados,
        municipios,
        bancos,
        tipoCambioFix,
        udis: [...udis, udis[0] as Udi],
        datasets,
      }),
    ).rejects.toThrow(/UNIQUE/);
  });
});
