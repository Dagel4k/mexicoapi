import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { esFechaIsoValida } from "@mexicoapi/core";
import { z } from "zod";
import { aNfc, jsonCanonico, sha256Hex } from "./canonico.js";
import { archivosCurado } from "./curado/generar.js";
import { leerCurado } from "./curado/leer.js";
import { CURADOS, type DefinicionCurado, DIRECTORIO_CURADO } from "./curado/registro.js";
import { ErrorDatos } from "./errores.js";
import { DATASETS } from "./registro.js";

const RUTA_CRUDO = /^raw\/[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INSTANTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const fecha = z.string().refine(esFechaIsoValida, "no es una fecha ISO válida");

const esquemaManifiesto = z.strictObject({
  dataset: z.string(),
  schema_version: z.literal(1),
  as_of: fecha,
  fetched_at: z.string().regex(INSTANTE_UTC, "no es un instante ISO en UTC"),
  data_file: z.string(),
  data_sha256: z.string().regex(SHA256),
  records: z.number().int().nonnegative(),
  sources: z.array(
    z.strictObject({
      name: z.string(),
      url: z.string(),
      license: z.string(),
      license_url: z.string(),
      citation: z.string(),
      published_at: fecha.nullable(),
      raw: z.array(
        z.strictObject({ file: z.string(), url: z.string(), sha256: z.string().regex(SHA256) }),
      ),
    }),
  ),
});

async function leerOpcional(ruta: string): Promise<Buffer | null> {
  try {
    return await readFile(ruta);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function archivosDe(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  return entradas
    .filter((e) => !e.isDirectory())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/"),
    );
}

function primerProblema(error: z.ZodError): string {
  const p = error.issues[0];
  return p === undefined ? "" : `${p.path.map(String).join(".")}: ${p.message}`;
}

async function verificarDirectorio(raiz: string, nombre: string): Promise<string[]> {
  const problemas: string[] = [];
  const dir = join(raiz, nombre);
  const falla = (texto: string): void => {
    problemas.push(`${nombre}: ${texto}`);
  };

  const textoManifiesto = await leerOpcional(join(dir, "manifest.json"));
  if (textoManifiesto === null) return [`${nombre}: falta manifest.json`];
  let json: unknown;
  try {
    json = JSON.parse(textoManifiesto.toString("utf8"));
  } catch {
    return [`${nombre}: manifest.json no es JSON válido`];
  }
  const parseado = esquemaManifiesto.safeParse(json);
  if (!parseado.success) {
    return [`${nombre}: manifest.json inválido (${primerProblema(parseado.error)})`];
  }
  const manifiesto = parseado.data;
  if (jsonCanonico(json) !== textoManifiesto.toString("utf8")) {
    falla("manifest.json no está en forma canónica");
  }

  const def = [...DATASETS.values()].find((d) => d.directorio === nombre);
  if (def === undefined) return [`${nombre}: directorio sin dataset registrado`];
  if (manifiesto.dataset !== def.id) {
    falla(`el manifiesto declara el dataset ${manifiesto.dataset}, se esperaba ${def.id}`);
  }
  if (manifiesto.data_file !== def.archivo) {
    falla(`data_file es ${manifiesto.data_file}, se esperaba ${def.archivo}`);
  }

  const permitidos = new Set<string>(["manifest.json", def.archivo]);
  for (const fuente of manifiesto.sources) {
    for (const crudo of fuente.raw) {
      if (!RUTA_CRUDO.test(crudo.file) || crudo.file === "raw/." || crudo.file === "raw/..") {
        falla(`ruta de crudo no permitida: ${crudo.file}`);
        continue;
      }
      permitidos.add(crudo.file);
      const bytes = await leerOpcional(join(dir, crudo.file));
      if (bytes === null) falla(`falta el crudo ${crudo.file}`);
      else if (sha256Hex(bytes) !== crudo.sha256) falla(`el sha256 de ${crudo.file} no coincide`);
    }
  }
  for (const archivo of await archivosDe(dir)) {
    if (!permitidos.has(archivo)) falla(`archivo no declarado: ${archivo}`);
  }

  const bytesDatos = await leerOpcional(join(dir, def.archivo));
  if (bytesDatos === null) {
    falla(`falta el archivo de datos ${def.archivo}`);
    return problemas;
  }
  const texto = bytesDatos.toString("utf8");
  if (sha256Hex(bytesDatos) !== manifiesto.data_sha256) falla("data_sha256 no coincide");

  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    falla(`${def.archivo} no es JSON válido`);
    return problemas;
  }
  const canonico = jsonCanonico(datos) === texto;
  if (!canonico) falla(`${def.archivo} no está en forma canónica`);
  else if (jsonCanonico(aNfc(datos)) !== texto)
    falla(`${def.archivo} trae textos que no están en NFC`);
  if (Array.isArray(datos) && datos.length !== manifiesto.records) {
    falla(`records es ${manifiesto.records} pero el archivo tiene ${datos.length}`);
  }

  const validado = z.array(def.esquema).safeParse(datos);
  if (!validado.success) {
    falla(`esquema inválido (${primerProblema(validado.error)})`);
    return problemas;
  }
  const registros = validado.data;
  if (canonico && jsonCanonico(registros) !== texto) {
    falla(`${def.archivo} no sigue el orden de llaves del esquema o trae llaves de más`);
  }
  const claves = registros.map((r) => def.clave(r));
  for (let i = 1; i < claves.length; i++) {
    const previa = claves[i - 1] as string;
    const actual = claves[i] as string;
    if (actual === previa) falla(`clave duplicada: ${actual}`);
    else if (actual < previa) {
      falla(`registros fuera de orden: ${actual} después de ${previa}`);
      break;
    }
  }
  for (const f of def.invariantes(registros)) falla(`invariante: ${f}`);
  return problemas;
}

/**
 * Compara `dir` byte a byte con los archivos que debería tener; lista vacía si coinciden.
 * `origen` es el YAML del que salen, para el mensaje.
 */
export async function diferenciasConEsperados(
  dir: string,
  esperados: ReadonlyMap<string, string>,
  origen: string,
): Promise<string[]> {
  const problemas: string[] = [];
  for (const [archivo, contenido] of esperados) {
    const bytes = await leerOpcional(join(dir, archivo));
    if (bytes === null) problemas.push(`falta ${archivo}; corre curar`);
    else if (!bytes.equals(Buffer.from(contenido, "utf8"))) {
      problemas.push(`${archivo} no corresponde a ${origen}; corre curar`);
    }
  }
  let presentes: string[] = [];
  try {
    presentes = await archivosDe(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const archivo of presentes.sort()) {
    if (!esperados.has(archivo)) problemas.push(`archivo no declarado: ${archivo}`);
  }
  return problemas;
}

export interface CuradoListo {
  // biome-ignore lint/suspicious/noExplicitAny: cualquier dataset curado
  def: DefinicionCurado<any>;
  /** Lo que `curar` escribe en `data/<directorio>/`. */
  archivos: Map<string, string>;
  registros: number;
  /** Si ya existe la carpeta generada. */
  generado: boolean;
}

/** Nombres de las carpetas de `raizDatos`, ordenados; vacío si no existe. */
export async function directoriosDe(raizDatos: string): Promise<string[]> {
  let entradas: Dirent[];
  try {
    entradas = await readdir(raizDatos, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entradas
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Valida los YAML de `data/curado/`: que no haya archivos ajenos, que cada YAML cumpla su esquema
 * e invariantes, y que no quede una carpeta generada sin su YAML. Un curado sin YAML ni carpeta
 * todavía no existe y no se revisa.
 */
export async function revisarYamlCurados(
  raizDatos: string,
  dirs: ReadonlySet<string>,
): Promise<{ problemas: string[]; listos: CuradoListo[] }> {
  const problemas: string[] = [];
  const listos: CuradoListo[] = [];
  if (dirs.has(DIRECTORIO_CURADO)) {
    const declarados = new Set(CURADOS.map((d) => d.yaml));
    for (const archivo of (await archivosDe(join(raizDatos, DIRECTORIO_CURADO))).sort()) {
      if (!declarados.has(archivo)) {
        problemas.push(`${DIRECTORIO_CURADO}: archivo no declarado: ${archivo}`);
      }
    }
  }
  for (const def of CURADOS) {
    const generado = dirs.has(def.directorio);
    const lectura = await leerCurado(def, raizDatos);
    if (lectura === null) {
      if (generado) problemas.push(`${def.directorio}: falta ${DIRECTORIO_CURADO}/${def.yaml}`);
    } else if (lectura.documento === null) {
      for (const p of lectura.problemas) problemas.push(`${DIRECTORIO_CURADO}/${def.yaml}: ${p}`);
    } else {
      let archivos: Map<string, string>;
      try {
        archivos = archivosCurado(def, lectura.documento);
      } catch (error) {
        if (!(error instanceof ErrorDatos)) throw error;
        problemas.push(`${DIRECTORIO_CURADO}/${def.yaml}: ${error.message}`);
        continue;
      }
      listos.push({ def, archivos, registros: lectura.documento.registros.length, generado });
    }
  }
  return { problemas, listos };
}

/** Cada curado con YAML debe tener su carpeta generada igual a lo que produce `curar`. */
async function verificarCurados(raizDatos: string, dirs: ReadonlySet<string>): Promise<string[]> {
  const { problemas, listos } = await revisarYamlCurados(raizDatos, dirs);
  for (const { def, archivos, generado } of listos) {
    if (!generado) {
      problemas.push(`${def.directorio}: faltan los datos generados; corre curar`);
      continue;
    }
    const origen = `${DIRECTORIO_CURADO}/${def.yaml}`;
    for (const p of await diferenciasConEsperados(
      join(raizDatos, def.directorio),
      archivos,
      origen,
    )) {
      problemas.push(`${def.directorio}: ${p}`);
    }
  }
  return problemas;
}

/** Revisa cada `data/*` contra su manifiesto y los curados contra su YAML; vacía si todo cuadra. */
export async function verificarDatos(raizDatos: string): Promise<string[]> {
  const dirs = await directoriosDe(raizDatos);
  const curados = new Set(CURADOS.map((d) => d.directorio));
  const problemas: string[] = [];
  for (const nombre of dirs) {
    if (nombre === DIRECTORIO_CURADO || curados.has(nombre)) continue;
    problemas.push(...(await verificarDirectorio(raizDatos, nombre)));
  }
  problemas.push(...(await verificarCurados(raizDatos, new Set(dirs))));
  return problemas;
}
