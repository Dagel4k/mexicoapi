import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  Banco,
  CoberturaCurada,
  CoberturaSerie,
  DiaInhabilCurado,
  Estado,
  FechaISO,
  FuenteDof,
  Manifiesto,
  Municipio,
  SalarioMinimo,
  TarifaIsr,
  TipoCambioFix,
  Udi,
  Uma,
} from "@mexicoapi/core";
import { jsonCanonico, sha256Hex } from "../canonico.js";
import { shardCalendario } from "../curado/calendario.js";
import { leerCurado } from "../curado/leer.js";
import {
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
  type DefinicionCurado,
  DIRECTORIO_CURADO,
} from "../curado/registro.js";
import { ErrorDatos } from "../errores.js";
import { escribirDirectorioAtomico } from "../escritura.js";
import { DATASETS } from "../registro.js";
import { verificarDatos } from "../verificar.js";
import { type CoberturaCalendario, coberturasDe } from "./calendarios.js";
import { aCsv } from "./csv.js";
import {
  type AniosConstantes,
  FRESCURA_HORAS,
  type Meta,
  type MetaInterna,
  metaDesdeManifiesto,
} from "./meta.js";
import { documentoOpenApi } from "./openapi.js";
import { archivoEncabezados } from "./paginas/encabezados.js";
import { ESTILO } from "./paginas/estilo.js";
import { FAVICON } from "./paginas/favicon.js";
import { paginaInicio } from "./paginas/inicio.js";
import { paginaNoEncontrada } from "./paginas/no-encontrado.js";
import { ROBOTS } from "./paginas/robots.js";
import { partirPorAnio } from "./series.js";
import { construirSqlite, type FilaDataset } from "./sqlite.js";

export interface ResultadoConstruccion {
  archivos: number;
  bytes: number;
}

/** Dónde vive un dataset en `data/`: el de DATASETS o el de CURADOS. */
interface Ubicacion {
  id: string;
  directorio: string;
  archivo: string;
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
const COLUMNAS_FIX = ["fecha_publicacion", "valor"];
const COLUMNAS_UDIS = ["fecha", "valor"];
const COLUMNAS_FUENTE = [
  "fuente_nombre",
  "fuente_url",
  "fuente_fecha_publicacion",
  "fuente_fragmento",
];
const COLUMNAS_DIAS = ["fecha", "autoridad", "motivo", "tipo", ...COLUMNAS_FUENTE];
const COLUMNAS_COBERTURAS = ["autoridad", "tipo_plazo", "desde", "hasta"];
const COLUMNAS_UMA = ["anio", "diaria", "mensual", "anual", "vigencia_desde", ...COLUMNAS_FUENTE];
const COLUMNAS_SALARIO = ["anio", "zona", "diario", "vigencia_desde", ...COLUMNAS_FUENTE];
// Un renglón por tramo, numerado desde 1.
const COLUMNAS_ISR = [
  "anio",
  "periodo",
  "tramo",
  "limite_inferior",
  "limite_superior",
  "cuota_fija",
  "tasa_excedente",
  ...COLUMNAS_FUENTE,
];

function automatico(id: string): Ubicacion {
  const def = DATASETS.get(id);
  if (def === undefined) throw new ErrorDatos(`dataset no registrado: ${id}`, id);
  return def;
}

async function cargar<T>(raizDatos: string, def: Ubicacion): Promise<Cargado<T>> {
  const dir = join(raizDatos, def.directorio);
  let bytesManifiesto: Buffer;
  let bytesDatos: Buffer;
  try {
    bytesManifiesto = await readFile(join(dir, "manifest.json"));
    bytesDatos = await readFile(join(dir, def.archivo));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ErrorDatos(`faltan los datos de ${def.directorio}`, def.id);
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

/** La cobertura por tipo de día vive en el YAML: el JSON generado solo trae los días. */
async function coberturaDe(
  raizDatos: string,
  def: DefinicionCurado<DiaInhabilCurado>,
): Promise<CoberturaCurada | null> {
  const origen = `${DIRECTORIO_CURADO}/${def.yaml}`;
  const lectura = await leerCurado(def, raizDatos);
  if (lectura === null) throw new ErrorDatos(`falta ${origen}`, def.id);
  if (lectura.documento === null) {
    throw new ErrorDatos(`${origen}: ${lectura.problemas.join("; ")}`, def.id);
  }
  return lectura.documento.cobertura;
}

/** El registro con su fuente en columnas `fuente_*`, para el CSV. */
function conFuentePlana<T extends { fuente: FuenteDof }>({ fuente, ...resto }: T) {
  return {
    ...resto,
    fuente_nombre: fuente.nombre,
    fuente_url: fuente.url,
    fuente_fecha_publicacion: fuente.fecha_publicacion,
    fuente_fragmento: fuente.fragmento,
  };
}

function frescura(id: string): number {
  const horas = FRESCURA_HORAS[id];
  if (horas === undefined) throw new ErrorDatos(`falta FRESCURA_HORAS para ${id}`, id);
  return horas;
}

/** `ruta` es `carpeta` o está dentro de ella. Una carpeta llamada `..algo` no es la de arriba. */
function dentroDe(carpeta: string, ruta: string): boolean {
  const rel = relative(resolve(carpeta), resolve(ruta));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * La salida se reemplaza por completo: no puede ser la raíz de los datos, contenerla ni estar
 * dentro de ella.
 */
function validarSalida(raizDatos: string, salida: string): void {
  if (dentroDe(salida, raizDatos) || dentroDe(raizDatos, salida)) {
    throw new ErrorDatos(
      `la salida (${salida}) no puede ser la carpeta de datos, contenerla ni estar dentro de ella`,
    );
  }
}

const json = (valor: unknown): string => JSON.stringify(valor);

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
  const raiz = opciones.raizDatos;
  const estados = await cargar<Estado>(raiz, automatico("inegi.estados"));
  const municipios = await cargar<Municipio>(raiz, automatico("inegi.municipios"));
  const bancos = await cargar<Banco>(raiz, automatico("bancos"));
  const fix = await cargar<TipoCambioFix>(raiz, automatico("tipo-cambio.fix"));
  const udis = await cargar<Udi>(raiz, automatico("udis"));
  const diasCnbv = await cargar<DiaInhabilCurado>(raiz, curadoDiasCnbv);
  const diasSat = await cargar<DiaInhabilCurado>(raiz, curadoDiasSat);
  const uma = await cargar<Uma>(raiz, curadoUma);
  const salario = await cargar<SalarioMinimo>(raiz, curadoSalarioMinimo);
  const isr = await cargar<TarifaIsr>(raiz, curadoTarifasIsr);

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

  // Las series se sirven por año desde el Worker: cada shard lleva su tramo y meta interna la
  // cobertura de la serie completa.
  const coberturas = new Map<string, CoberturaSerie>();
  const porAnio = <T>(carpeta: string, c: Cargado<T>, fechaDe: (registro: T) => FechaISO): void => {
    const { cobertura, shards } = partirPorAnio(c.registros, fechaDe, c.manifiesto.dataset);
    coberturas.set(c.manifiesto.dataset, cobertura);
    for (const { anio, tramo, datos } of shards) {
      archivos.set(`v1/_internos/${carpeta}/${anio}.json`, json({ tramo, datos }));
    }
  };
  porAnio("fix", fix, (r) => r.fecha_publicacion);
  porAnio("udis", udis, (r) => r.fecha);

  // Los calendarios de la CNBV y el SAT los arma el Worker con crearCalendario. Las descargas
  // llevan aparte la cobertura de cada plazo: la lista de días no dice hasta dónde está completa.
  const coberturasCalendario: CoberturaCalendario[] = [];
  for (const [c, def, autoridad] of [
    [diasCnbv, curadoDiasCnbv, "cnbv"],
    [diasSat, curadoDiasSat, "sat"],
  ] as const) {
    const calendario = shardCalendario(autoridad, c.registros, await coberturaDe(raiz, def));
    archivos.set(`v1/_internos/calendarios/${autoridad}.json`, json(calendario));
    coberturasCalendario.push(...coberturasDe(calendario));
  }

  // `uma.json` es la lista completa: con ella el Worker responde la UMA vigente en una fecha.
  shard("v1/constantes/uma.json", uma.registros, uma.meta);
  for (const u of uma.registros) shard(`v1/constantes/uma/${u.anio}.json`, u, uma.meta);
  const salarioPorAnio = new Map<number, SalarioMinimo[]>();
  for (const s of salario.registros) {
    salarioPorAnio.set(s.anio, [...(salarioPorAnio.get(s.anio) ?? []), s]);
  }
  for (const [anio, zonas] of salarioPorAnio) {
    shard(`v1/constantes/salario-minimo/${anio}.json`, zonas, salario.meta);
  }
  for (const t of isr.registros) shard(`v1/isr/tarifa/${t.periodo}/${t.anio}.json`, t, isr.meta);
  // Los años de cada carpeta de constantes: con ellos el Worker distingue un año anterior a los
  // datos (no existe) de uno posterior al último cargado (todavía no se carga).
  const anios = new Map<string, number[]>([
    ["constantes/salario-minimo", [...salarioPorAnio.keys()]],
    ["constantes/uma", uma.registros.map((u) => u.anio)],
  ]);
  for (const t of isr.registros) {
    const carpeta = `isr/tarifa/${t.periodo}`;
    anios.set(carpeta, [...(anios.get(carpeta) ?? []), t.anio]);
  }
  const indice: AniosConstantes = Object.fromEntries(
    [...anios]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([carpeta, lista]) => [carpeta, [...lista].sort((a, b) => a - b)]),
  );
  archivos.set("v1/_internos/constantes.json", json(indice));

  const cargados = [estados, municipios, bancos, fix, udis];
  const curados = [diasCnbv, diasSat, uma, salario, isr];
  const interna: MetaInterna = { datasets: {}, curados: {} };
  for (const c of cargados) {
    const cobertura = coberturas.get(c.manifiesto.dataset);
    interna.datasets[c.manifiesto.dataset] = {
      meta: c.meta,
      records: c.manifiesto.records,
      data_sha256: c.manifiesto.data_sha256,
      frescura_horas: frescura(c.manifiesto.dataset),
      ...(cobertura === undefined ? {} : { cobertura }),
    };
  }
  for (const c of curados) {
    interna.curados[c.manifiesto.dataset] = {
      meta: c.meta,
      records: c.manifiesto.records,
      data_sha256: c.manifiesto.data_sha256,
    };
  }
  archivos.set("v1/_internos/meta.json", json(interna));
  archivos.set(
    "v1/openapi.json",
    `${JSON.stringify(documentoOpenApi(), null, 2)}
`,
  );

  const descargas = new Map<string, Uint8Array | string>();
  for (const c of [...cargados, ...curados]) {
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
  descargas.set("tipo-cambio-fix.csv", aCsv(COLUMNAS_FIX, fix.registros, "tipo-cambio.fix"));
  descargas.set("udis.csv", aCsv(COLUMNAS_UDIS, udis.registros, "udis"));
  const csvCurado = (
    columnas: readonly string[],
    c: Cargado<unknown>,
    filas: readonly { fuente: FuenteDof }[],
  ): void => {
    descargas.set(
      `${c.directorio}.csv`,
      aCsv(columnas, filas.map(conFuentePlana), c.manifiesto.dataset),
    );
  };
  csvCurado(COLUMNAS_DIAS, diasCnbv, diasCnbv.registros);
  csvCurado(COLUMNAS_DIAS, diasSat, diasSat.registros);
  descargas.set("dias-inhabiles-coberturas.json", jsonCanonico(coberturasCalendario));
  descargas.set("dias-inhabiles-coberturas.csv", aCsv(COLUMNAS_COBERTURAS, coberturasCalendario));
  csvCurado(COLUMNAS_UMA, uma, uma.registros);
  csvCurado(COLUMNAS_SALARIO, salario, salario.registros);
  const tramos = isr.registros.flatMap((t) =>
    t.tramos.map((tramo, i) => ({
      anio: t.anio,
      periodo: t.periodo,
      tramo: i + 1,
      ...tramo,
      fuente: t.fuente,
    })),
  );
  csvCurado(COLUMNAS_ISR, isr, tramos);
  const filas: FilaDataset[] = [...cargados, ...curados].map((c) => ({
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
      tipoCambioFix: fix.registros,
      udis: udis.registros,
      diasInhabiles: [...diasCnbv.registros, ...diasSat.registros],
      coberturasCalendario,
      uma: uma.registros,
      salarioMinimo: salario.registros,
      tarifasIsr: isr.registros,
      datasets: filas,
    }),
  );

  const nombres = [...descargas.keys()].sort(porNombre);
  const sumas = nombres.map((n) => `${sha256Hex(descargas.get(n) as Uint8Array | string)}  ${n}\n`);
  descargas.set("SHA256SUMS", sumas.join(""));
  for (const [nombre, contenido] of descargas) archivos.set(`descargas/${nombre}`, contenido);
  archivos.set("_headers", archivoEncabezados([...descargas.keys()].sort(porNombre)));

  archivos.set(
    "index.html",
    paginaInicio({
      datasets: [...cargados, ...curados].map((c) => ({
        id: c.manifiesto.dataset,
        directorio: c.directorio,
        as_of: c.manifiesto.as_of,
        registros: c.manifiesto.records,
        fuentes: c.manifiesto.sources,
        docs: c.meta.docs,
      })),
      descargas,
    }),
  );
  archivos.set("404.html", paginaNoEncontrada());
  archivos.set("estilo.css", ESTILO);
  archivos.set("favicon.svg", FAVICON);
  archivos.set("robots.txt", ROBOTS);

  await escribirDirectorioAtomico(opciones.salida, archivos);

  let bytes = 0;
  for (const contenido of archivos.values()) bytes += Buffer.byteLength(contenido);
  return { archivos: archivos.size, bytes };
}
