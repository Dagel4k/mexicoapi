import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Banco, Estado, Municipio } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirSqlite } from "../../src/sitio/sqlite.js";

const estados: Estado[] = [
  { cve_ent: "01", nombre: "Aguascalientes", abreviatura: "Ags.", cvegeo: "01" },
  { cve_ent: "09", nombre: "Ciudad de México", abreviatura: "CDMX", cvegeo: "09" },
];
const municipios: Municipio[] = [
  { cvegeo: "01001", cve_ent: "01", cve_mun: "001", nombre: "Aguascalientes", cve_cabecera: "0001" },
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
    historial: [{ codigo_spei: "40002", nombre_corto: "BANAMEX", desde: "2010-01-01", hasta: null }],
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
const datasets = [
  { dataset: "bancos", as_of: "2026-10-17", records: 2, data_sha256: "a".repeat(64), manifest: '{"x":1}' },
];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sqlite-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function abrir(): Promise<DatabaseSync> {
  const bytes = await construirSqlite({ estados, municipios, bancos, datasets });
  const ruta = join(dir, "x.sqlite");
  await writeFile(ruta, bytes);
  return new DatabaseSync(ruta, { readOnly: true });
}

describe("construirSqlite", () => {
  it("genera un archivo SQLite con los conteos esperados", async () => {
    const db = await abrir();
    const n = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([n("estados"), n("municipios"), n("bancos"), n("bancos_historial"), n("datasets")]).toEqual(
      [2, 2, 2, 3, 1],
    );
    db.close();
  });

  it("guarda null, activo 0/1 y la fila de datasets", async () => {
    const db = await abrir();
    expect(db.prepare("SELECT cve_cabecera FROM municipios WHERE cvegeo = '09002'").get()).toEqual({
      cve_cabecera: null,
    });
    expect(db.prepare("SELECT codigo, activo, razon_social FROM bancos ORDER BY codigo").all()).toEqual([
      { codigo: "002", activo: 1, razon_social: "Banco Nacional de México" },
      { codigo: "099", activo: 0, razon_social: null },
    ]);
    expect(db.prepare("SELECT * FROM datasets").get()).toEqual(datasets[0]);
    db.close();
  });

  it("no deja violaciones de llaves foráneas", async () => {
    const db = await abrir();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("usa tablas STRICT", async () => {
    const db = await abrir();
    expect(() => db.exec("INSERT INTO estados VALUES (1, 2, 3, 4)")).toThrow();
    db.close();
  });

  it("falla si un municipio apunta a un estado que no existe", async () => {
    await expect(
      construirSqlite({
        estados,
        municipios: [{ ...municipios[0]!, cve_ent: "30" }],
        bancos,
        datasets,
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
