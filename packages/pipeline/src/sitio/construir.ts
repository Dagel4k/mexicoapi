import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Banco, Estado, Manifiesto, Municipio } from "@mexicoapi/core";
import { sha256Hex } from "../canonico.js";
import { ErrorDatos } from "../errores.js";
import { escribirDirectorioAtomico } from "../escritura.js";
import { DATASETS } from "../registro.js";
import { verificarDatos } from "../verificar.js";
import { aCsv } from "./csv.js";
import { FRESCURA_HORAS, type Meta, type MetaInterna, metaDesdeManifiesto } from "./meta.js";
import { documentoOpenApi } from "./openapi.js";
import { construirSqlite, type FilaDataset } from "./sqlite.js";

export interface ResultadoConstruccion {
  archivos: number;
  bytes: number;
}

interface Cargado<T> {
  registros: T[];
  meta: Meta;
  manifiesto: Manifiesto;
  bytesManifiesto: Uint8Array;
  textoManifiesto: string;
  bytesDatos: Uint8Array;
  directorio: string;
}

const COLUMNAS_ESTADOS = ["cve_ent", "nombre", "abreviatura", "cvegeo"];
const COLUMNAS_MUNICIPIOS = ["cvegeo", "cve_ent", "cve_mun", "nombre", "cve_cabecera"];
const COLUMNAS_BANCOS = [
  "codigo",
  "codigo_spei",
  "nombre_corto",
  "razon_social",
  "sector",
  "tipo",
  "participacion",
  "activo",
  "baja_detectada",
];
const COLUMNAS_HISTORIAL = ["codigo", "codigo_spei", "nombre_corto", "desde", "hasta"];

const SEGURIDAD = [
  "Access-Control-Allow-Origin: *",
  "X-Content-Type-Options: nosniff",
  "Content-Security-Policy: default-src 'none'",
  "Cache-Control: public, max-age=3600, stale-while-revalidate=86400",
];

async function cargar<T>(raizDatos: string, id: string): Promise<Cargado<T>> {
  const def = DATASETS.get(id);
  if (def === undefined) throw new ErrorDatos(`dataset no registrado: ${id}`, id);
  const dir = join(raizDatos, def.directorio);
  let bytesManifiesto: Buffer;
  let bytesDatos: Buffer;
  try {
    bytesManifiesto = await readFile(join(dir, "manifest.json"));
    bytesDatos = await readFile(join(dir, def.archivo));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ErrorDatos(`faltan los datos de ${def.directorio}`, id);
    }
    throw error;
  }
  const textoManifiesto = bytesManifiesto.toString("utf8");
  const manifiesto = JSON.parse(textoManifiesto) as Manifiesto;
  return {
    registros: JSON.parse(bytesDatos.toString("utf8")) as T[],
    meta: metaDesdeManifiesto(manifiesto, def.directorio),
    manifiesto,
    bytesManifiesto,
    textoManifiesto,
    bytesDatos,
    directorio: def.directorio,
  };
}

function frescura(id: string): number {
  const horas = FRESCURA_HORAS[id];
  if (horas === undefined) throw new ErrorDatos(`falta FRESCURA_HORAS para ${id}`, id);
  return horas;
}

/** La salida no puede ser la raíz de los datos ni contenerla: se reemplaza por completo. */
function validarSalida(raizDatos: string, salida: string): void {
  const rel = relative(resolve(salida), resolve(raizDatos));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new ErrorDatos(`la salida (${salida}) no puede ser la carpeta de datos ni contenerla`);
  }
}

const json = (valor: unknown): string => JSON.stringify(valor);

function tipoContenido(nombre: string): string {
  if (nombre.endsWith(".json")) return "application/json; charset=utf-8";
  if (nombre.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (nombre.endsWith(".sqlite")) return "application/vnd.sqlite3";
  return "text/plain; charset=utf-8";
}

function encabezados(descargas: readonly string[]): string {
  const reglas = descargas.map(
    (nombre) => `/descargas/${nombre}\n  Content-Type: ${tipoContenido(nombre)}\n`,
  );
  reglas.push(`/descargas/*\n${SEGURIDAD.map((l) => `  ${l}`).join("\n")}\n`);
  return reglas.join("\n");
}

/** Orden por unidades de código UTF-16, igual que el resto de los datos. */
const porNombre = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function construirSitio(opciones: {
  raizDatos: string;
  salida: string;
}): Promise<ResultadoConstruccion> {
  validarSalida(opciones.raizDatos, opciones.salida);
  const problemas = await verificarDatos(opciones.raizDatos);
  if (problemas.length > 0) {
    throw new ErrorDatos(`los datos no verifican: ${problemas.join("; ")}`);
  }
  const estados = await cargar<Estado>(opciones.raizDatos, "inegi.estados");
  const municipios = await cargar<Municipio>(opciones.raizDatos, "inegi.municipios");
  const bancos = await cargar<Banco>(opciones.raizDatos, "bancos");

  const archivos = new Map<string, Uint8Array | string>();
  const shard = (ruta: string, data: unknown, meta: Meta): void => {
    archivos.set(ruta, json({ data, meta }));
  };

  shard("v1/estados.json", estados.registros, estados.meta);
  for (const e of estados.registros) {
    shard(`v1/estados/${e.cve_ent}.json`, e, estados.meta);
    const suyos = municipios.registros.filter((m) => m.cve_ent === e.cve_ent);
    shard(`v1/estados/${e.cve_ent}/municipios.json`, suyos, municipios.meta);
  }
  shard("v1/municipios.json", municipios.registros, municipios.meta);
  for (const m of municipios.registros) shard(`v1/municipios/${m.cvegeo}.json`, m, municipios.meta);
  shard("v1/bancos.json", bancos.registros, bancos.meta);
  for (const b of bancos.registros) shard(`v1/bancos/${b.codigo}.json`, b, bancos.meta);

  const cargados = [estados, municipios, bancos];
  const interna: MetaInterna = { datasets: {} };
  for (const c of cargados) {
    interna.datasets[c.manifiesto.dataset] = {
      meta: c.meta,
      records: c.manifiesto.records,
      data_sha256: c.manifiesto.data_sha256,
      frescura_horas: frescura(c.manifiesto.dataset),
    };
  }
  archivos.set("v1/_internos/meta.json", json(interna));
  archivos.set(
    "v1/openapi.json",
    `${JSON.stringify(documentoOpenApi(), null, 2)}
`,
  );

  const descargas = new Map<string, Uint8Array | string>();
  for (const c of cargados) {
    descargas.set(`${c.directorio}.json`, c.bytesDatos);
    descargas.set(`${c.directorio}.manifest.json`, c.bytesManifiesto);
  }
  descargas.set("inegi-estados.csv", aCsv(COLUMNAS_ESTADOS, estados.registros, "inegi.estados"));
  descargas.set(
    "inegi-municipios.csv",
    aCsv(COLUMNAS_MUNICIPIOS, municipios.registros, "inegi.municipios"),
  );
  descargas.set("bancos.csv", aCsv(COLUMNAS_BANCOS, bancos.registros, "bancos"));
  descargas.set(
    "bancos-historial.csv",
    aCsv(
      COLUMNAS_HISTORIAL,
      bancos.registros.flatMap((b) => b.historial.map((p) => ({ codigo: b.codigo, ...p }))),
      "bancos",
    ),
  );
  const filas: FilaDataset[] = cargados.map((c) => ({
    dataset: c.manifiesto.dataset,
    as_of: c.manifiesto.as_of,
    records: c.manifiesto.records,
    data_sha256: c.manifiesto.data_sha256,
    manifest: c.textoManifiesto,
  }));
  descargas.set(
    "mexicoapi.sqlite",
    await construirSqlite({
      estados: estados.registros,
      municipios: municipios.registros,
      bancos: bancos.registros,
      datasets: filas,
    }),
  );

  const nombres = [...descargas.keys()].sort(porNombre);
  const sumas = nombres.map((n) => `${sha256Hex(descargas.get(n) as Uint8Array | string)}  ${n}\n`);
  descargas.set("SHA256SUMS", sumas.join(""));
  for (const [nombre, contenido] of descargas) archivos.set(`descargas/${nombre}`, contenido);
  archivos.set("_headers", encabezados([...descargas.keys()].sort(porNombre)));

  await escribirDirectorioAtomico(opciones.salida, archivos);

  let bytes = 0;
  for (const contenido of archivos.values()) bytes += Buffer.byteLength(contenido);
  return { archivos: archivos.size, bytes };
}
