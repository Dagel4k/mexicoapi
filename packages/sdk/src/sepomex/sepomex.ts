// Descarga, importación y consulta del catálogo de códigos postales de SEPOMEX en el equipo del
// usuario. MéxicoAPI no lo redistribuye: sus términos lo prohíben.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cargarCodigos, directorioCache, guardar, leerMeta, type MetaGuardada } from "./cache.js";
import { type Asentamiento, armarCatalogo, type CodigoPostal } from "./catalogo.js";
import { archivoInvalido, SepomexError, tamanoLegible } from "./error.js";
import { cuerpoDeDescarga, errorCaptcha, leerFormulario, pideCaptcha } from "./formulario.js";
import {
  AVISO_SEPOMEX,
  DESCARGA_MANUAL,
  NOTA_MEXICOAPI,
  URL_DESCARGA,
  USER_AGENT,
} from "./fuente.js";
import { crearTransporte } from "./http.js";
import type {
  EstadoSepomex,
  FetchSepomex,
  InitFetchSepomex,
  OpcionesDirectorio,
  OpcionesGuardado,
  OpcionesSync,
} from "./tipos.js";
import { leerTxt } from "./txt.js";
import { esZip, LIMITE_TXT, LIMITE_ZIP, leerZip } from "./zip.js";

/** Bytes máximos de la página del formulario, del ZIP y del TXT descomprimido. */
export const LIMITES: Readonly<{ pagina: number; zip: number; txt: number }> = Object.freeze({
  pagina: 1_048_576,
  zip: LIMITE_ZIP,
  txt: LIMITE_TXT,
});

/** Tiempo sin recibir nada antes de rendirse con el transporte por omisión. */
const ESPERA_MS = 60_000;

const latin1 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");

/** Mensaje de un error con el de su causa: el `fetch failed` de Node dice el motivo en `cause`. */
function mensajeDe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/** Si los primeros bytes son de una página HTML. */
function pareceHtml(bytes: Uint8Array): boolean {
  return /<(!doctype\s+html|html|head|body)\b/i.test(latin1(bytes.subarray(0, 1024)));
}

const textoAviso = (dir: string) =>
  `Aviso de Correos de México: "${AVISO_SEPOMEX}"\n${NOTA_MEXICOAPI}\nSe guardan en ${dir}.`;

const escribirAviso = (texto: string): void => {
  process.stderr.write(`${texto}\n`);
};

const directorioDe = (opciones: OpcionesDirectorio) => resolve(opciones.dir ?? directorioCache());

/** Pide `url` y devuelve el cuerpo; traduce los fallos y los estados HTTP a SepomexError. */
async function pedirBytes(
  pedir: FetchSepomex,
  url: string,
  init: InitFetchSepomex,
  limite: number,
): Promise<Uint8Array> {
  let respuesta: Awaited<ReturnType<FetchSepomex>>;
  let cuerpo: ArrayBuffer | undefined;
  try {
    respuesta = await pedir(url, init);
    if (respuesta.status === 200) {
      const largo = Number(respuesta.headers.get("content-length"));
      if (largo > limite) {
        throw archivoInvalido(
          `La respuesta pesa ${tamanoLegible(largo)} y el límite es ${tamanoLegible(limite)}.`,
        );
      }
      cuerpo = await respuesta.arrayBuffer();
    }
  } catch (error) {
    if (error instanceof SepomexError) throw error;
    throw new SepomexError(
      "sin-respuesta",
      `No se pudo conectar con Correos de México (${mensajeDe(error)}). Intenta más tarde. ${DESCARGA_MANUAL}`,
      { cause: error },
    );
  }
  const { status } = respuesta;
  if (status === 401 || status === 403 || status === 429) {
    throw new SepomexError(
      "bloqueado",
      `Correos de México no permitió la descarga automática (HTTP ${status}). ${DESCARGA_MANUAL}`,
    );
  }
  if (status >= 500) {
    throw new SepomexError(
      "sin-respuesta",
      `Correos de México respondió con un error (HTTP ${status}). Intenta más tarde. ${DESCARGA_MANUAL}`,
    );
  }
  if (cuerpo === undefined) {
    const destino = respuesta.headers.get("location");
    throw new SepomexError(
      "pagina-inesperada",
      `Correos de México respondió HTTP ${status}${destino ? ` (redirige a ${destino})` : ""}. ${DESCARGA_MANUAL}`,
    );
  }
  if (cuerpo.byteLength > limite) {
    throw archivoInvalido(
      `La respuesta pesa ${tamanoLegible(cuerpo.byteLength)} y el límite es ${tamanoLegible(limite)}.`,
    );
  }
  return new Uint8Array(cuerpo);
}

/**
 * Lo que hace una persona en la página: la abre (GET), toma los campos ocultos del formulario y
 * lo envía (POST) con todo el país y el formato TXT.
 */
async function descargar(
  pedir: FetchSepomex,
): Promise<{ bytes: Uint8Array; as_of: string | null }> {
  const encabezados = { "User-Agent": USER_AGENT, "Accept-Encoding": "identity" };
  const pagina = await pedirBytes(
    pedir,
    URL_DESCARGA,
    { method: "GET", headers: encabezados, redirect: "manual" },
    LIMITES.pagina,
  );
  const formulario = leerFormulario(latin1(pagina), URL_DESCARGA);
  const bytes = await pedirBytes(
    pedir,
    formulario.accion,
    {
      method: "POST",
      headers: {
        ...encabezados,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: URL_DESCARGA,
      },
      body: cuerpoDeDescarga(formulario),
      redirect: "manual",
    },
    LIMITES.zip,
  );
  if (!esZip(bytes) && pareceHtml(bytes)) {
    if (pideCaptcha(latin1(bytes))) throw errorCaptcha();
    throw new SepomexError(
      "pagina-inesperada",
      `Correos de México respondió una página en vez del archivo. ${DESCARGA_MANUAL}`,
    );
  }
  return { bytes, as_of: formulario.as_of };
}

/** El TXT dentro de un ZIP, o el TXT tal cual. */
function txtDe(bytes: Uint8Array): Uint8Array {
  if (esZip(bytes)) return leerZip(bytes).datos;
  if (pareceHtml(bytes)) {
    throw archivoInvalido("El archivo es una página HTML, no el ZIP ni el TXT de SEPOMEX.");
  }
  return bytes;
}

const normal = (texto: string) => texto.replace(/\s+/g, " ").trim();

function estadoDe(dir: string, meta: MetaGuardada): EstadoSepomex {
  return Object.freeze({
    dir,
    descargado: meta.descargado,
    origen: meta.origen,
    fuente: meta.fuente,
    as_of: meta.as_of,
    aviso: meta.aviso,
    nota: meta.nota,
    filas: meta.filas,
    codigos_postales: meta.codigos_postales,
    municipios: meta.municipios,
    sin_municipio_inegi: meta.sin_municipio_inegi,
    advertencias: Object.freeze([...meta.advertencias]),
    sha256: meta.sha256,
    json: join(dir, meta.json),
    sqlite: meta.sqlite === null ? null : join(dir, meta.sqlite),
  });
}

async function guardarCatalogo(
  bytes: Uint8Array,
  dir: string,
  origen: "descarga" | "archivo",
  as_of: string | null,
  sqlite: boolean,
): Promise<EstadoSepomex> {
  const datos = txtDe(bytes);
  const { aviso, filas } = leerTxt(datos);
  const catalogo = armarCatalogo(filas);
  const advertencias = [...catalogo.resumen.advertencias];
  if (normal(aviso) !== normal(AVISO_SEPOMEX)) {
    advertencias.unshift(
      "El aviso de uso del archivo es distinto del que conoce mexicoapi: léelo en estado().aviso antes de usar los datos.",
    );
  }
  const meta = await guardar(dir, {
    catalogo,
    filas,
    sqlite,
    resumen: {
      descargado: new Date().toISOString(),
      origen,
      fuente: URL_DESCARGA,
      as_of,
      aviso,
      nota: NOTA_MEXICOAPI,
      filas: catalogo.resumen.filas,
      codigos_postales: catalogo.resumen.codigos_postales,
      municipios: catalogo.resumen.municipios,
      sin_municipio_inegi: catalogo.resumen.sin_municipio_inegi,
      advertencias,
      sha256: createHash("sha256").update(datos).digest("hex"),
    },
  });
  return estadoDe(dir, meta);
}

/**
 * Descarga el catálogo de Correos de México desde este equipo con el formulario público (todo el
 * país, TXT), lo revisa, lo une con los municipios de INEGI y lo guarda en la caché. Antes de
 * pedir nada pasa a `aviso` el aviso de uso de Correos de México y la nota de MéxicoAPI. Si algo
 * falla lanza SepomexError y la caché anterior queda igual; si el sitio bloquea la descarga
 * automática (`bloqueado`), no se intenta evadir: el mensaje dice cómo usar `importar`.
 */
export async function sync(opciones: OpcionesSync = {}): Promise<EstadoSepomex> {
  const dir = directorioDe(opciones);
  (opciones.aviso ?? escribirAviso)(textoAviso(dir));
  const pedir = opciones.fetch ?? crearTransporte({ maxBytes: LIMITE_ZIP, esperaMs: ESPERA_MS });
  const { bytes, as_of } = await descargar(pedir);
  return guardarCatalogo(bytes, dir, "descarga", as_of, opciones.sqlite ?? true);
}

/**
 * Importa el ZIP o el TXT que se descargó a mano de la página de Correos de México (estado
 * "Todos", formato TXT), con las mismas revisiones que `sync`.
 */
export async function importar(
  ruta: string,
  opciones: OpcionesGuardado = {},
): Promise<EstadoSepomex> {
  const dir = directorioDe(opciones);
  (opciones.aviso ?? escribirAviso)(textoAviso(dir));
  let bytes: Uint8Array;
  try {
    const { size } = await stat(ruta);
    if (size > LIMITE_TXT) {
      throw archivoInvalido(
        `El archivo pesa ${tamanoLegible(size)} y el límite es ${tamanoLegible(LIMITE_TXT)}.`,
      );
    }
    bytes = new Uint8Array(await readFile(ruta));
  } catch (error) {
    if (error instanceof SepomexError) throw error;
    throw archivoInvalido(`No se pudo leer ${ruta}: ${mensajeDe(error)}`, error);
  }
  return guardarCatalogo(bytes, dir, "archivo", null, opciones.sqlite ?? true);
}

/** Cómo quedó el catálogo guardado (fecha, filas, aviso...), o null si no hay. */
export async function estado(opciones: OpcionesDirectorio = {}): Promise<EstadoSepomex | null> {
  const dir = directorioDe(opciones);
  const meta = await leerMeta(dir);
  return meta === null ? null : estadoDe(dir, meta);
}

function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

const CP = /^\d{5}$/;
const SIN_ASENTAMIENTOS: readonly Asentamiento[] = Object.freeze([]);

/**
 * Un código postal del catálogo guardado (5 dígitos, como texto: `"01000"`), con su entidad, su
 * municipio y sus asentamientos; null si no existe. Lanza TypeError si no son 5 dígitos y
 * SepomexError `sin-datos` si todavía no hay catálogo.
 */
export async function cp(
  codigo: string,
  opciones: OpcionesDirectorio = {},
): Promise<CodigoPostal | null> {
  if (typeof codigo !== "string" || !CP.test(codigo)) {
    throw new TypeError('El código postal debe ser un texto de 5 dígitos, como "01000".');
  }
  const codigos = await cargarCodigos(directorioDe(opciones));
  return Object.hasOwn(codigos, codigo) ? congelar(codigos[codigo] as CodigoPostal) : null;
}

/** Los asentamientos (colonias, fraccionamientos...) de un código postal; vacío si no existe. */
export async function colonias(
  codigo: string,
  opciones: OpcionesDirectorio = {},
): Promise<readonly Asentamiento[]> {
  return (await cp(codigo, opciones))?.asentamientos ?? SIN_ASENTAMIENTOS;
}

/** Directorio de la caché por omisión en este equipo. */
export function directorio(): string {
  return directorioCache();
}
