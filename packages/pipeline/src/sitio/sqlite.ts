import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Banco, Estado, Municipio } from "@mexicoapi/core";
import { borrarSiPuede } from "../escritura.js";

export interface FilaDataset {
  dataset: string;
  as_of: string;
  records: number;
  data_sha256: string;
  manifest: string;
}

export interface DatosSqlite {
  estados: readonly Estado[];
  municipios: readonly Municipio[];
  bancos: readonly Banco[];
  datasets: readonly FilaDataset[];
}

const ESQUEMA = `
CREATE TABLE estados (
  cve_ent TEXT PRIMARY KEY, nombre TEXT NOT NULL, abreviatura TEXT NOT NULL, cvegeo TEXT NOT NULL
) STRICT;
CREATE TABLE municipios (
  cvegeo TEXT PRIMARY KEY, cve_ent TEXT NOT NULL REFERENCES estados (cve_ent),
  cve_mun TEXT NOT NULL, nombre TEXT NOT NULL, cve_cabecera TEXT
) STRICT;
CREATE TABLE bancos (
  codigo TEXT PRIMARY KEY, codigo_spei TEXT NOT NULL, nombre_corto TEXT NOT NULL,
  razon_social TEXT, sector TEXT, tipo TEXT NOT NULL, participacion TEXT NOT NULL,
  activo INTEGER NOT NULL, baja_detectada TEXT
) STRICT;
CREATE TABLE bancos_historial (
  codigo TEXT NOT NULL REFERENCES bancos (codigo), codigo_spei TEXT NOT NULL,
  nombre_corto TEXT NOT NULL, desde TEXT NOT NULL, hasta TEXT,
  PRIMARY KEY (codigo, desde)
) STRICT;
CREATE TABLE datasets (
  dataset TEXT PRIMARY KEY, as_of TEXT NOT NULL, records INTEGER NOT NULL,
  data_sha256 TEXT NOT NULL, manifest TEXT NOT NULL
) STRICT;
`;

function insertar(db: DatabaseSync, datos: DatosSqlite): void {
  const estado = db.prepare("INSERT INTO estados VALUES (?, ?, ?, ?)");
  for (const e of datos.estados) estado.run(e.cve_ent, e.nombre, e.abreviatura, e.cvegeo);
  const municipio = db.prepare("INSERT INTO municipios VALUES (?, ?, ?, ?, ?)");
  for (const m of datos.municipios) {
    municipio.run(m.cvegeo, m.cve_ent, m.cve_mun, m.nombre, m.cve_cabecera);
  }
  const banco = db.prepare("INSERT INTO bancos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const periodo = db.prepare("INSERT INTO bancos_historial VALUES (?, ?, ?, ?, ?)");
  for (const b of datos.bancos) {
    banco.run(
      b.codigo,
      b.codigo_spei,
      b.nombre_corto,
      b.razon_social,
      b.sector,
      b.tipo,
      b.participacion,
      b.activo ? 1 : 0,
      b.baja_detectada,
    );
    for (const p of b.historial) {
      periodo.run(b.codigo, p.codigo_spei, p.nombre_corto, p.desde, p.hasta);
    }
  }
  const dataset = db.prepare("INSERT INTO datasets VALUES (?, ?, ?, ?, ?)");
  for (const d of datos.datasets) {
    dataset.run(d.dataset, d.as_of, d.records, d.data_sha256, d.manifest);
  }
}

/** Genera el archivo SQLite con todos los datasets y devuelve sus bytes. */
export async function construirSqlite(datos: DatosSqlite): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "mexicoapi-sqlite-"));
  const ruta = join(dir, "mexicoapi.sqlite");
  try {
    const db = new DatabaseSync(ruta);
    try {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(ESQUEMA);
      db.exec("BEGIN");
      try {
        insertar(db, datos);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const violaciones = db.prepare("PRAGMA foreign_key_check").all();
      if (violaciones.length > 0) {
        throw new Error(`foreign key check falló: ${JSON.stringify(violaciones)}`);
      }
      db.exec("VACUUM");
    } finally {
      db.close();
    }
    return new Uint8Array(await readFile(ruta));
  } finally {
    await borrarSiPuede(dir);
  }
}
