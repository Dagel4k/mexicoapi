import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type AutoridadCurada,
  type Banco,
  type CoberturaCurada,
  type CoberturaSerie,
  type DiaInhabilCurado,
  type Estado,
  type FechaISO,
  type FuenteDof,
  type Manifiesto,
  type Municipio,
  type SalarioMinimo,
  type TarifaIsr,
  type TipoCambioFix,
  type Udi,
  type Uma,
  validarClabe,
} from "@mexicoapi/core";
import { jsonCanonico, sha256Hex } from "../canonico.js";
import { coberturasDeLaLista, shardCalendario } from "../curado/calendario.js";
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
import { anioDe } from "../fecha.js";
import { DATASETS } from "../registro.js";
import { verificarDatos } from "../verificar.js";
import {
  COBERTURA_LISTA_LFT,
  type CoberturaCalendario,
  coberturasDe,
  DATASET_LFT,
  diasLft,
} from "./calendarios.js";
import { PUBLICADO_EN_NPM, porNombre } from "./comun.js";
import { aCsv } from "./csv.js";
import { LLAVE_INDEXNOW } from "./indexacion.js";
import {
  type AniosConstantes,
  FRESCURA_HORAS,
  type Meta,
  type MetaInterna,
  metaDesdeManifiesto,
} from "./meta.js";
import { documentoOpenApi } from "./openapi.js";
import { paginaCalculadora } from "./paginas/calculadora.js";
import { paginasDeCatalogos } from "./paginas/catalogos.js";
import {
  type CalendarioDePagina,
  calendarioDePagina,
  paginasDeCalendarios,
} from "./paginas/dias-inhabiles.js";
import { archivoEncabezados } from "./paginas/encabezados.js";
import { paginaEstado, RUTA_ESTADO } from "./paginas/estado.js";
import { ESTILO } from "./paginas/estilo.js";
import { FAVICON } from "./paginas/favicon.js";
import { paginasDeIndicadores } from "./paginas/indicadores.js";
import { CLABE_EJEMPLO, paginaInicio, RUTA_INICIO, respuestaRecortada } from "./paginas/inicio.js";
import {
  archivoLlms,
  archivoLlmsCompleto,
  type DocumentoMarkdown,
  ordenLlmsCompleto,
} from "./paginas/llms.js";
import { paginaNoEncontrada } from "./paginas/no-encontrado.js";
import {
  fechaDelSitemap,
  paginaDeDatos,
  registrarPaginas,
  rutasParaEncabezados,
} from "./paginas/pagina-datos.js";
import { ROBOTS } from "./paginas/robots.js";
import { archivoSitemap, fechaMasReciente } from "./paginas/sitemap.js";
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

/**
 * La respuesta de `/v1/clabe/{CLABE_EJEMPLO}` que muestra la página, armada como en el Worker: el
 * mismo validador con el catálogo de bancos. Si la CLABE deja de ser válida, el build falla.
 */
function ejemploClabe(bancos: Cargado<Banco>): unknown {
  const catalogo = new Map(
    bancos.registros.map(({ codigo, nombre_corto, activo }) => [
      codigo,
      { codigo, nombre_corto, activo },
    ]),
  );
  const data = validarClabe(CLABE_EJEMPLO, { bancos: catalogo });
  if (!data.valido) {
    throw new ErrorDatos(
      `la CLABE de los ejemplos (${CLABE_EJEMPLO}) ya no es válida con el catálogo: ${data.errores.join(", ")}`,
      "bancos",
    );
  }
  return respuestaRecortada({ data, meta: bancos.meta });
}

const ultimoDato = (cobertura: CoberturaSerie | undefined): { ultimo_dato?: FechaISO } =>
  cobertura === undefined ? {} : { ultimo_dato: cobertura.hasta };

/**
 * El script del sitio, que se publica tal cual. La ruta vale desde `src/sitio` (pruebas) y desde
 * `dist/sitio` (build): las dos quedan a dos niveles de la raíz del paquete.
 */
const CLIENTE = new URL("../../src/sitio/cliente/sitio.js", import.meta.url);

/** La raíz del repositorio, para las docs de `llms-full.txt`; vale desde `src` y desde `dist`. */
const REPO = new URL("../../../../", import.meta.url);

/** Los Markdown que junta `llms-full.txt`, en su orden y con su ruta desde la raíz. */
async function docsCompletas(): Promise<DocumentoMarkdown[]> {
  const deDatos = (await readdir(new URL("docs/datos/", REPO))).filter((n) => n.endsWith(".md"));
  return Promise.all(
    ordenLlmsCompleto(deDatos).map(async (ruta) => ({
      ruta,
      texto: await readFile(new URL(ruta, REPO), "utf8"),
    })),
  );
}

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

  // Los calendarios de la CNBV y el SAT los arma el Worker con crearCalendarioCurado. Las
  // descargas llevan aparte la cobertura de cada plazo en su lista: la lista de días no dice
  // hasta dónde está completa, y la del SAT solo trae los días del art. 12 de los años que cubre
  // su YAML (el Worker los calcula hasta 2100). La LFT no tiene dataset: su lista sale de la regla
  // del núcleo, como `/v1/dias-inhabiles?autoridad=lft`, y está completa en toda su cobertura.
  const lft = diasLft();
  const coberturasCalendario: CoberturaCalendario[] = [COBERTURA_LISTA_LFT];
  // El calendario de cada autoridad, el mismo que arma el Worker, para sus páginas.
  const calendarios = new Map<AutoridadCurada, CalendarioDePagina>();
  for (const [c, def, autoridad] of [
    [diasCnbv, curadoDiasCnbv, "cnbv"],
    [diasSat, curadoDiasSat, "sat"],
  ] as const) {
    const cobertura = await coberturaDe(raiz, def);
    const calendario = shardCalendario(autoridad, c.registros, cobertura);
    archivos.set(`v1/_internos/calendarios/${autoridad}.json`, json(calendario));
    const plazos = coberturasDeLaLista(autoridad, c.registros, cobertura);
    coberturasCalendario.push(...coberturasDe({ autoridad, plazos }));
    calendarios.set(autoridad, calendarioDePagina(autoridad, c.registros, cobertura, c.meta));
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
  descargas.set("dias-inhabiles-lft.json", jsonCanonico(lft));
  descargas.set(
    "dias-inhabiles-lft.csv",
    aCsv(COLUMNAS_DIAS, lft.map(conFuentePlana), DATASET_LFT),
  );
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
      diasInhabiles: [...lft, ...diasCnbv.registros, ...diasSat.registros],
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

  // Las páginas de datos. "Año actual" es el de la fecha más reciente del FIX en los datos y no el
  // del día del build: dos builds de los mismos datos dan las mismas páginas.
  const anio = anioDe((coberturas.get(fix.manifiesto.dataset) as CoberturaSerie).hasta);
  const registro = registrarPaginas([
    ...paginasDeCalendarios({
      anio,
      sat: calendarios.get("sat") as CalendarioDePagina,
      cnbv: calendarios.get("cnbv") as CalendarioDePagina,
    }),
    paginaCalculadora({
      sat: calendarios.get("sat") as CalendarioDePagina,
      cnbv: calendarios.get("cnbv") as CalendarioDePagina,
    }),
    ...paginasDeIndicadores({ fix, udis, uma, salarioMinimo: salario, isr }),
    ...paginasDeCatalogos({ bancos, estados, municipios }),
  ]);
  for (const pagina of registro.values()) {
    archivos.set(`${pagina.ruta.slice(1)}index.html`, paginaDeDatos(pagina, registro, descargas));
  }
  archivos.set(
    "_headers",
    archivoEncabezados([...descargas.keys()].sort(porNombre), rutasParaEncabezados(registro)),
  );

  const datasets = [
    ...cargados.map((c) => ({ c, tipo: "automatico" as const })),
    ...curados.map((c) => ({ c, tipo: "curado" as const })),
  ].map(({ c, tipo }) => ({
    id: c.manifiesto.dataset,
    directorio: c.directorio,
    tipo,
    as_of: c.manifiesto.as_of,
    // En las series, el último dato no es `as_of`: es el fin de su cobertura.
    ...ultimoDato(coberturas.get(c.manifiesto.dataset)),
    registros: c.manifiesto.records,
    fuentes: c.manifiesto.sources,
    docs: c.meta.docs,
  }));
  archivos.set(
    "index.html",
    paginaInicio({
      datasets,
      descargas,
      ejemplo: ejemploClabe(bancos),
      paginas: [...registro.values()],
    }),
  );
  archivos.set("estado/index.html", paginaEstado());
  archivos.set("sitio.js", await readFile(CLIENTE));
  archivos.set("404.html", paginaNoEncontrada());
  archivos.set("estilo.css", ESTILO);
  archivos.set("favicon.svg", FAVICON);
  archivos.set("robots.txt", ROBOTS);
  // Las páginas que se indexan: la portada y /estado/ con la fecha más reciente de los datos que
  // muestra el sitio, y cada página de datos con la suya (`fechaDelSitemap`).
  const lastmod = fechaMasReciente(datasets.map((d) => d.as_of));
  archivos.set(
    "sitemap.xml",
    archivoSitemap([
      ...[RUTA_INICIO, RUTA_ESTADO].map((ruta) => ({ ruta, lastmod })),
      ...[...registro.values()].map((p) => ({ ruta: p.ruta, lastmod: fechaDelSitemap(p) })),
    ]),
  );
  archivos.set("llms.txt", archivoLlms(datasets, PUBLICADO_EN_NPM, [...registro.values()]));
  archivos.set("llms-full.txt", archivoLlmsCompleto(await docsCompletas(), [...registro.values()]));
  archivos.set(`${LLAVE_INDEXNOW}.txt`, LLAVE_INDEXNOW);

  await escribirDirectorioAtomico(opciones.salida, archivos);

  let bytes = 0;
  for (const contenido of archivos.values()) bytes += Buffer.byteLength(contenido);
  return { archivos: archivos.size, bytes };
}
