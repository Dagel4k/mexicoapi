// Genera los módulos de datos del paquete desde data/: uno por cada declaración que hay en
// src/datos/generados, con los registros y su meta congelados. El conjunto de datasets lo deciden
// esas declaraciones (que llevan los tipos); este script no tiene nada propio de ningún dataset.
// Un calendario curado exporta además `calendario`: su `calendario.json`, que `curar` del pipeline
// escribe junto a los días (los plazos con su cobertura y las fuentes de los fines de semana).
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
//
//   node scripts/datos.ts    después de tsc: escribe dist/datos/generados
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Prefijo de los módulos virtuales con los que `pluginDatos` sirve los datos en las pruebas. */
export const PREFIJO_VIRTUAL = "\0mexicoapi-datos:";

const CARPETA_DECLARACIONES = join("src", "datos", "generados");
const CARPETA_DESTINO = join("dist", "datos", "generados");
const NOMBRE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARCHIVO = /^[A-Za-z0-9._-]+\.json$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CAMPOS_FUENTE = ["name", "url", "license", "license_url", "citation"] as const;
// Escapes para meter JSON en una cadena JS entre comillas simples.
const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "'": "\\'",
  "\n": "\\n",
  "\r": "\\r",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
// Congela a fondo: los datos se comparten entre todos los que importan el paquete.
const CONGELAR =
  'const congelar = (v) => { if (typeof v === "object" && v !== null) { ' +
  "for (const h of Object.values(v)) congelar(h); Object.freeze(v); } return v; };";

const USO = "uso: node scripts/datos.ts\n";
// La misma página que da la API en `meta.docs` para los datos de cada carpeta de data/.
const URL_DOCS_DATOS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos";

export interface FuenteMeta {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
}

/** Lo que el paquete publica del manifest de un dataset, con su documentación como en la API. */
export interface MetaDatos {
  dataset: string;
  as_of: string;
  sources: FuenteMeta[];
  docs: string;
}

export interface DatasetLeido {
  /** Carpeta en data/, que también es el nombre del módulo generado. */
  directorio: string;
  /** `data_file` del manifest. */
  archivo: string;
  sha256: string;
  registros: unknown[];
  meta: MetaDatos;
  /** Solo en los calendarios curados: su `calendario.json`. */
  calendario?: Readonly<Record<string, unknown>>;
}

export interface Generado {
  directorio: string;
  registros: number;
  /** Del módulo .js generado. */
  bytes: number;
}

type Objeto = Record<string, unknown>;

const esObjeto = (v: unknown): v is Objeto =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sha256 = (datos: Uint8Array | string): string =>
  createHash("sha256").update(datos).digest("hex");

async function leerOpcional(ruta: string): Promise<Buffer | null> {
  try {
    return await readFile(ruta);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Revisa lo que este script usa del manifest; el formato completo lo verifica el pipeline. */
function metaDeManifiesto(
  valor: unknown,
  directorio: string,
): { meta: MetaDatos; manifiesto: Objeto } {
  const invalido = (campo: string): Error =>
    new Error(`${directorio}: manifest.json tiene ${campo} inválido`);
  const m: Objeto = esObjeto(valor) ? valor : {};
  if (typeof m.dataset !== "string" || m.dataset === "") throw invalido("dataset");
  if (typeof m.as_of !== "string" || !FECHA.test(m.as_of)) throw invalido("as_of");
  if (typeof m.data_file !== "string" || !ARCHIVO.test(m.data_file)) throw invalido("data_file");
  if (typeof m.data_sha256 !== "string" || !SHA256.test(m.data_sha256)) {
    throw invalido("data_sha256");
  }
  if (!Number.isInteger(m.records) || (m.records as number) < 0) throw invalido("records");
  const fuentes = m.sources;
  if (
    !Array.isArray(fuentes) ||
    !fuentes.every((f) => esObjeto(f) && CAMPOS_FUENTE.every((c) => typeof f[c] === "string"))
  ) {
    throw invalido("sources");
  }
  const sources = (fuentes as FuenteMeta[]).map((f) => ({
    name: f.name,
    url: f.url,
    license: f.license,
    license_url: f.license_url,
    citation: f.citation,
  }));
  return {
    meta: {
      dataset: m.dataset,
      as_of: m.as_of,
      sources,
      docs: `${URL_DOCS_DATOS}/${directorio}.md`,
    },
    manifiesto: m,
  };
}

/**
 * Lee `datos/<directorio>`: su manifest y el archivo que nombra `data_file`, que debe tener el
 * sha256 del manifest y estar en la forma canónica del pipeline (JSON con 2 espacios y salto de
 * línea final). Así, el JSON canónico de los registros del paquete da el mismo sha256.
 */
export async function leerDataset(datos: string, directorio: string): Promise<DatasetLeido> {
  const carpeta = join(datos, directorio);
  const bytesManifiesto = await leerOpcional(join(carpeta, "manifest.json"));
  if (bytesManifiesto === null) throw new Error(`${directorio}: falta manifest.json`);
  let valor: unknown;
  try {
    valor = JSON.parse(bytesManifiesto.toString("utf8"));
  } catch {
    throw new Error(`${directorio}: manifest.json no es JSON válido`);
  }
  const { meta, manifiesto } = metaDeManifiesto(valor, directorio);
  const archivo = manifiesto.data_file as string;
  const bytes = await leerOpcional(join(carpeta, archivo));
  if (bytes === null) throw new Error(`${directorio}: falta ${archivo}`);
  const real = sha256(bytes);
  if (real !== manifiesto.data_sha256) {
    throw new Error(
      `${directorio}/${archivo}: el sha256 ${real} no coincide con el del manifest (${manifiesto.data_sha256})`,
    );
  }
  const texto = bytes.toString("utf8");
  const registros: unknown = JSON.parse(texto);
  if (`${JSON.stringify(registros, null, 2)}\n` !== texto) {
    throw new Error(`${directorio}/${archivo} no está en la forma canónica del pipeline`);
  }
  if (!Array.isArray(registros)) throw new Error(`${directorio}/${archivo} no es un arreglo`);
  if (registros.length !== manifiesto.records) {
    throw new Error(
      `${directorio}: el manifest dice ${manifiesto.records} registros y hay ${registros.length}`,
    );
  }
  const calendario = await leerCalendario(carpeta, directorio, registros);
  if (calendario === undefined) return { directorio, archivo, sha256: real, registros, meta };
  return { directorio, archivo, sha256: real, registros, meta, calendario };
}

const ARCHIVO_CALENDARIO = "calendario.json";
const LLAVES_CALENDARIO = ["autoridad", "fuentes_fin_de_semana", "plazos"];

/**
 * `datos/<directorio>/calendario.json`, si existe, en la forma canónica del pipeline: `verificar`
 * lo compara con su YAML y el núcleo revisa sus reglas al armar el calendario, así que aquí solo
 * se revisa que sea del calendario de estos días.
 */
async function leerCalendario(
  carpeta: string,
  directorio: string,
  registros: unknown[],
): Promise<Objeto | undefined> {
  const bytes = await leerOpcional(join(carpeta, ARCHIVO_CALENDARIO));
  if (bytes === null) return undefined;
  const ruta = `${directorio}/${ARCHIVO_CALENDARIO}`;
  const texto = bytes.toString("utf8");
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new Error(`${ruta} no es JSON válido`);
  }
  if (`${JSON.stringify(valor, null, 2)}\n` !== texto) {
    throw new Error(`${ruta} no está en la forma canónica del pipeline`);
  }
  if (!esObjeto(valor) || Object.keys(valor).sort().join() !== LLAVES_CALENDARIO.join()) {
    throw new Error(`${ruta} debe tener solo autoridad, plazos y fuentes_fin_de_semana`);
  }
  const autoridades = [...new Set(registros.map((r) => (esObjeto(r) ? r.autoridad : undefined)))];
  if (autoridades.length !== 1 || autoridades[0] !== valor.autoridad) {
    throw new Error(
      `${ruta} es de ${String(valor.autoridad)} y sus días de ${autoridades.map(String).join(", ")}`,
    );
  }
  return valor;
}

const cadenaJs = (texto: string): string =>
  `'${texto.replace(/[\\'\n\r\u2028\u2029]/g, (c) => ESCAPES[c] as string)}'`;

/**
 * Módulo ESM sin imports que exporta `meta` y `datos`, congelados a fondo. Los registros van en
 * una sola cadena para `JSON.parse`: pesa lo mismo que el literal y se carga más rápido.
 */
export function moduloDeDatos(d: DatasetLeido): string {
  return [
    `// Generado desde data/${d.directorio}/${d.archivo} (sha256 ${d.sha256}); no se edita a mano.`,
    CONGELAR,
    `export const meta = /* @__PURE__ */ congelar(${JSON.stringify(d.meta)});`,
    `export const datos = /* @__PURE__ */ congelar(JSON.parse(${cadenaJs(JSON.stringify(d.registros))}));`,
    ...(d.calendario === undefined
      ? []
      : [`export const calendario = /* @__PURE__ */ congelar(${JSON.stringify(d.calendario)});`]),
    "",
  ].join("\n");
}

/** Nombres de las declaraciones `<directorio>.d.ts` de `carpeta`, en orden. */
export async function declarados(carpeta: string): Promise<string[]> {
  const nombres = (await readdir(carpeta))
    .filter((archivo) => archivo.endsWith(".d.ts"))
    .map((archivo) => archivo.slice(0, -".d.ts".length))
    .sort();
  const malo = nombres.find((nombre) => !NOMBRE.test(nombre));
  if (malo !== undefined) {
    throw new Error(
      `${malo}.d.ts no tiene nombre de carpeta de data/ (minúsculas, cifras y guiones)`,
    );
  }
  return nombres;
}

/**
 * Por cada declaración de `declaraciones`, escribe en `destino` el módulo de su dataset y una copia
 * de la declaración. Lee y verifica todos antes de escribir: si uno falla, `destino` queda igual.
 */
export async function generarDatos(opciones: {
  datos: string;
  declaraciones: string;
  destino: string;
}): Promise<Generado[]> {
  const nombres = await declarados(opciones.declaraciones);
  if (nombres.length === 0) throw new Error(`No hay declaraciones en ${opciones.declaraciones}`);
  const leidos: DatasetLeido[] = [];
  for (const nombre of nombres) {
    const leido = await leerDataset(opciones.datos, nombre);
    // La declaración y los datos dicen lo mismo: un calendario declara `calendario` y solo él.
    const declaracion = await readFile(join(opciones.declaraciones, `${nombre}.d.ts`), "utf8");
    const declara = /\bconst calendario\b/.test(declaracion);
    if (declara !== (leido.calendario !== undefined)) {
      const ruta = `data/${nombre}/${ARCHIVO_CALENDARIO}`;
      throw new Error(
        declara
          ? `${nombre}.d.ts declara calendario, pero falta ${ruta}`
          : `${ruta} existe, pero ${nombre}.d.ts no declara calendario`,
      );
    }
    leidos.push(leido);
  }
  await rm(opciones.destino, { recursive: true, force: true });
  await mkdir(opciones.destino, { recursive: true });
  const generados: Generado[] = [];
  for (const d of leidos) {
    const codigo = moduloDeDatos(d);
    await writeFile(join(opciones.destino, `${d.directorio}.js`), codigo);
    await copyFile(
      join(opciones.declaraciones, `${d.directorio}.d.ts`),
      join(opciones.destino, `${d.directorio}.d.ts`),
    );
    generados.push({
      directorio: d.directorio,
      registros: d.registros.length,
      bytes: Buffer.byteLength(codigo),
    });
  }
  return generados;
}

const IMPORT_GENERADO = /^\.\/generados\/([a-z0-9-]+)\.js$/;

/**
 * Plugin de Vite para las pruebas sobre src: sirve `./generados/<dataset>.js` (importado desde
 * src/datos) con el mismo código que escribe el build, leído de `datos`. Sin él, src no tiene
 * los módulos generados.
 */
export function pluginDatos(datos: string): {
  name: string;
  resolveId(fuente: string, importador: string | undefined): string | null;
  load(id: string): Promise<string | null>;
} {
  return {
    name: "mexicoapi-datos",
    resolveId(fuente, importador) {
      const nombre = IMPORT_GENERADO.exec(fuente)?.[1];
      if (nombre === undefined || importador === undefined) return null;
      if (basename(dirname(resolve(importador))) !== "datos") return null;
      return `${PREFIJO_VIRTUAL}${nombre}`;
    },
    async load(id) {
      if (!id.startsWith(PREFIJO_VIRTUAL)) return null;
      return moduloDeDatos(await leerDataset(datos, id.slice(PREFIJO_VIRTUAL.length)));
    },
  };
}

export interface OpcionesPrincipal {
  /** Carpeta del paquete (la que tiene src y dist). */
  raiz: string;
  /** Carpeta data/ del repositorio. */
  datos: string;
  salida: (texto: string) => void;
  errores: (texto: string) => void;
}

const plural = (n: number, palabra: string): string => `${n} ${palabra}${n === 1 ? "" : "s"}`;

export async function principal(
  argv: readonly string[],
  opciones: OpcionesPrincipal,
): Promise<number> {
  if (argv.length > 0) {
    opciones.errores(USO);
    return 2;
  }
  try {
    const generados = await generarDatos({
      datos: opciones.datos,
      declaraciones: join(opciones.raiz, CARPETA_DECLARACIONES),
      destino: join(opciones.raiz, CARPETA_DESTINO),
    });
    const lineas = generados.map(
      (g) => `  ${g.directorio}: ${plural(g.registros, "registro")}, ${g.bytes} bytes\n`,
    );
    opciones.salida(
      `datos: ${plural(generados.length, "módulo")} en dist/datos/generados\n${lineas.join("")}`,
    );
    return 0;
  } catch (error) {
    // Lo que lanzan este script y node:fs siempre es un Error.
    opciones.errores(`datos: ${(error as Error).message}\n`);
    return 1;
  }
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    raiz: fileURLToPath(new URL("..", import.meta.url)),
    datos: fileURLToPath(new URL("../../../data", import.meta.url)),
    salida: (texto) => process.stdout.write(texto),
    errores: (texto) => process.stderr.write(texto),
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`datos.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
