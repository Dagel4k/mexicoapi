// Copia del catálogo en SQLite, si este Node trae node:sqlite (sin bandera desde 22.13): las 15
// columnas oficiales en UTF-8 más el CVEGEO de INEGI de cada fila.
import { municipio } from "../datos/municipios.js";
import { COLUMNAS, type FilaSepomex } from "./txt.js";

export type ModuloSqlite = typeof import("node:sqlite");

/** Si esta versión de Node trae node:sqlite sin bandera (desde 22.13 y 23.4). */
export function nodeConSqlite(version: string): boolean {
  const [mayor = 0, menor = 0] = version.split(".").map(Number);
  return mayor > 23 || (mayor === 23 && menor >= 4) || (mayor === 22 && menor >= 13);
}

/** node:sqlite, o por qué no se puede usar: entonces la caché queda solo en JSON. */
export async function cargarSqlite(
  version: string = process.versions.node,
): Promise<{ modulo: ModuloSqlite } | { motivo: string }> {
  if (!nodeConSqlite(version)) {
    return {
      motivo: `Node ${version} no trae node:sqlite sin bandera (llegó en 22.13): la caché queda solo en JSON.`,
    };
  }
  try {
    return { modulo: await import("node:sqlite") };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { motivo: `No se pudo cargar node:sqlite (${mensaje}): la caché queda solo en JSON.` };
  }
}

/**
 * Escribe en `ruta` (un archivo nuevo) la tabla `asentamientos` (una fila por fila del TXT, con
 * `cvegeo` null si el municipio no está en INEGI) y la tabla `meta` (clave y valor en JSON).
 */
export function escribirSqlite(
  modulo: ModuloSqlite,
  ruta: string,
  filas: readonly FilaSepomex[],
  meta: Readonly<Record<string, unknown>>,
): void {
  const db = new modulo.DatabaseSync(ruta);
  try {
    const columnas = COLUMNAS.map((c) => `"${c}" TEXT NOT NULL`).join(", ");
    db.exec(
      `CREATE TABLE asentamientos (${columnas}, cvegeo TEXT);
       CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);`,
    );
    const insertar = db.prepare(
      `INSERT INTO asentamientos VALUES (${[...COLUMNAS, "cvegeo"].map(() => "?").join(", ")})`,
    );
    const insertarMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
    db.exec("BEGIN");
    for (const fila of filas) {
      const clave = fila.c_estado + fila.c_mnpio;
      insertar.run(...COLUMNAS.map((c) => fila[c]), municipio(clave) ? clave : null);
    }
    for (const [clave, valor] of Object.entries(meta)) {
      insertarMeta.run(clave, JSON.stringify(valor));
    }
    db.exec("COMMIT");
    db.exec(
      `CREATE INDEX asentamientos_d_codigo ON asentamientos ("d_codigo");
       CREATE INDEX asentamientos_cvegeo ON asentamientos (cvegeo);`,
    );
  } finally {
    db.close();
  }
}
