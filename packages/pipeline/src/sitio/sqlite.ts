import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Banco,
  DiaInhabilCurado,
  Estado,
  FuenteDof,
  Municipio,
  SalarioMinimo,
  TarifaIsr,
  TipoCambioFix,
  Udi,
  Uma,
} from "@mexicoapi/core";
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
  tipoCambioFix: readonly TipoCambioFix[];
  udis: readonly Udi[];
  diasInhabiles: readonly DiaInhabilCurado[];
  uma: readonly Uma[];
  salarioMinimo: readonly SalarioMinimo[];
  tarifasIsr: readonly TarifaIsr[];
  datasets: readonly FilaDataset[];
}

// Cada valor curado lleva su cita: la fuente va en columnas en cada renglón.
const FUENTE = `fuente_nombre TEXT NOT NULL, fuente_url TEXT NOT NULL,
  fuente_fecha_publicacion TEXT NOT NULL, fuente_fragmento TEXT NOT NULL`;

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
CREATE TABLE tipo_cambio_fix (fecha_publicacion TEXT PRIMARY KEY, valor TEXT NOT NULL) STRICT;
CREATE TABLE udis (fecha TEXT PRIMARY KEY, valor TEXT NOT NULL) STRICT;
CREATE TABLE dias_inhabiles (
  autoridad TEXT NOT NULL, fecha TEXT NOT NULL, motivo TEXT NOT NULL, tipo TEXT NOT NULL,
  ${FUENTE},
  PRIMARY KEY (autoridad, fecha)
) STRICT;
CREATE TABLE uma (
  anio INTEGER PRIMARY KEY, diaria TEXT NOT NULL, mensual TEXT NOT NULL, anual TEXT NOT NULL,
  vigencia_desde TEXT NOT NULL, ${FUENTE}
) STRICT;
CREATE TABLE salario_minimo (
  anio INTEGER NOT NULL, zona TEXT NOT NULL, diario TEXT NOT NULL, vigencia_desde TEXT NOT NULL,
  ${FUENTE},
  PRIMARY KEY (anio, zona)
) STRICT;
CREATE TABLE isr_tramos (
  anio INTEGER NOT NULL, periodo TEXT NOT NULL, tramo INTEGER NOT NULL,
  limite_inferior TEXT NOT NULL, limite_superior TEXT, cuota_fija TEXT NOT NULL,
  tasa_excedente TEXT NOT NULL, ${FUENTE},
  PRIMARY KEY (anio, periodo, tramo)
) STRICT;
CREATE TABLE datasets (
  dataset TEXT PRIMARY KEY, as_of TEXT NOT NULL, records INTEGER NOT NULL,
  data_sha256 TEXT NOT NULL, manifest TEXT NOT NULL
) STRICT;
`;

const fuente = (f: FuenteDof) => [f.nombre, f.url, f.fecha_publicacion, f.fragmento] as const;

function insertarCurados(db: DatabaseSync, datos: DatosSqlite): void {
  const dia = db.prepare("INSERT INTO dias_inhabiles VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const d of datos.diasInhabiles) {
    dia.run(d.autoridad, d.fecha, d.motivo, d.tipo, ...fuente(d.fuente));
  }
  const uma = db.prepare("INSERT INTO uma VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const u of datos.uma) {
    uma.run(u.anio, u.diaria, u.mensual, u.anual, u.vigencia_desde, ...fuente(u.fuente));
  }
  const salario = db.prepare("INSERT INTO salario_minimo VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const s of datos.salarioMinimo) {
    salario.run(s.anio, s.zona, s.diario, s.vigencia_desde, ...fuente(s.fuente));
  }
  const tramo = db.prepare("INSERT INTO isr_tramos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const t of datos.tarifasIsr) {
    t.tramos.forEach((r, i) => {
      tramo.run(
        t.anio,
        t.periodo,
        i + 1,
        r.limite_inferior,
        r.limite_superior,
        r.cuota_fija,
        r.tasa_excedente,
        ...fuente(t.fuente),
      );
    });
  }
}

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
  const fix = db.prepare("INSERT INTO tipo_cambio_fix VALUES (?, ?)");
  for (const f of datos.tipoCambioFix) fix.run(f.fecha_publicacion, f.valor);
  const udi = db.prepare("INSERT INTO udis VALUES (?, ?)");
  for (const u of datos.udis) udi.run(u.fecha, u.valor);
  insertarCurados(db, datos);
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
