// Descarga, importación y consulta del catálogo de códigos postales de SEPOMEX en el equipo del
// usuario. MéxicoAPI no lo redistribuye: sus términos lo prohíben.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { avisosDe } from "@mexicoapi/core/avisos";
import {
  cargarCodigos,
  conCandado,
  directorioCache,
  guardar,
  leerMeta,
  type MetaGuardada,
} from "./cache.js";
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
  FetchSepomex,
  InitFetchSepomex,
  OpcionesDirectorio,
  OpcionesGuardado,
  OpcionesSync,
  RespuestaFetchSepomex,
  ResumenSepomex,
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
/** Tiempo máximo de toda la descarga (página y archivo), con cualquier `fetch`. */
const DURACION_MAXIMA_MS = 5 * 60_000;

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

const sinRespuesta = (que: string, error: unknown) =>
  new SepomexError(
    "sin-respuesta",
    `${que} (${mensajeDe(error)}). Intenta más tarde. ${DESCARGA_MANUAL}`,
    { cause: error },
  );

const pasaDelLimite = (limite: number) =>
  archivoInvalido(`La respuesta pasa de ${tamanoLegible(limite)}.`);

/**
 * El cuerpo de la respuesta, cortado al pasar de `limite`: por partes si trae `body` (un
 * ReadableStream), entero con `arrayBuffer()` si no.
 */
async function leerCuerpo(
  respuesta: RespuestaFetchSepomex,
  limite: number,
  vencido: Promise<never>,
): Promise<Uint8Array> {
  const cuerpo = respuesta.body;
  if (!cuerpo) {
    const datos = await Promise.race([respuesta.arrayBuffer(), vencido]);
    if (datos.byteLength > limite) throw pasaDelLimite(limite);
    return new Uint8Array(datos);
  }
  const lector = cuerpo.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([lector.read(), vencido]);
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > limite) throw pasaDelLimite(limite);
      trozos.push(value);
    }
  } catch (error) {
    lector.cancel(error).catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let desde = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, desde);
    desde += trozo.byteLength;
  }
  return bytes;
}

/**
 * Pide `url` y devuelve el cuerpo, cortado al pasar de `limite` mientras llega; traduce los
 * fallos y los estados HTTP a SepomexError. `vencido` rechaza cuando se acaba el tiempo total,
 * aunque el `fetch` ignore la señal.
 */
async function pedirBytes(
  pedir: FetchSepomex,
  url: string,
  init: InitFetchSepomex,
  limite: number,
  vencido: Promise<never>,
): Promise<Uint8Array> {
  let respuesta: RespuestaFetchSepomex;
  try {
    respuesta = await Promise.race([pedir(url, init), vencido]);
  } catch (error) {
    if (error instanceof SepomexError) throw error;
    throw sinRespuesta("No se pudo conectar con Correos de México", error);
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
  if (status !== 200) {
    const destino = respuesta.headers.get("location");
    throw new SepomexError(
      "pagina-inesperada",
      `Correos de México respondió HTTP ${status}${destino ? ` (redirige a ${destino})` : ""}. ${DESCARGA_MANUAL}`,
    );
  }
  const largo = Number(respuesta.headers.get("content-length"));
  if (largo > limite) {
    throw archivoInvalido(
      `La respuesta pesa ${tamanoLegible(largo)} y el límite es ${tamanoLegible(limite)}.`,
    );
  }
  try {
    return await leerCuerpo(respuesta, limite, vencido);
  } catch (error) {
    if (error instanceof SepomexError) throw error;
    throw sinRespuesta("Se cortó la descarga de Correos de México", error);
  }
}

/**
 * Lo que hace una persona en la página: la abre (GET), toma los campos ocultos del formulario y
 * lo envía (POST) con todo el país y el formato TXT. Todo junto tiene 5 minutos.
 */
async function descargar(
  pedir: FetchSepomex,
): Promise<{ bytes: Uint8Array; as_of: string | null }> {
  const controlador = new AbortController();
  const vencido = new Promise<never>((_, rechazar) => {
    controlador.signal.addEventListener("abort", () => rechazar(controlador.signal.reason));
  });
  vencido.catch(() => undefined);
  const temporizador = setTimeout(() => {
    controlador.abort(
      new SepomexError(
        "sin-respuesta",
        `La descarga de Correos de México pasó de ${DURACION_MAXIMA_MS / 60_000} min. Intenta más tarde. ${DESCARGA_MANUAL}`,
      ),
    );
  }, DURACION_MAXIMA_MS);
  try {
    const encabezados = { "User-Agent": USER_AGENT, "Accept-Encoding": "identity" };
    const pagina = await pedirBytes(
      pedir,
      URL_DESCARGA,
      { method: "GET", headers: encabezados, redirect: "manual", signal: controlador.signal },
      LIMITES.pagina,
      vencido,
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
        signal: controlador.signal,
      },
      LIMITES.zip,
      vencido,
    );
    if (!esZip(bytes) && pareceHtml(bytes)) {
      if (pideCaptcha(latin1(bytes))) throw errorCaptcha();
      throw new SepomexError(
        "pagina-inesperada",
        `Correos de México respondió una página en vez del archivo. ${DESCARGA_MANUAL}`,
      );
    }
    return { bytes, as_of: formulario.as_of };
  } finally {
    clearTimeout(temporizador);
  }
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

function resumenDe(dir: string, meta: MetaGuardada): ResumenSepomex {
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
    avisos: Object.freeze(avisosDe(meta.advertencias).map((a) => Object.freeze(a))),
    sha256: meta.sha256,
    json: join(dir, meta.json),
    sqlite: meta.sqlite === null ? null : join(dir, meta.sqlite),
    sin_sqlite: meta.sin_sqlite,
  });
}

/**
 * Lee un archivo regular de hasta `LIMITE_TXT` bytes. Lo abre primero (sin bloquear) y revisa el
 * descriptor, no la ruta: rechaza carpetas, FIFOs y dispositivos aunque la ruta cambie entre la
 * revisión y la lectura, y deja de leer al pasar del límite aunque el archivo crezca.
 */
async function leerArchivoAcotado(ruta: string): Promise<Uint8Array> {
  const noEsArchivo = () => archivoInvalido(`${ruta} no es un archivo.`);
  const noSePudo = (error: unknown) =>
    error instanceof SepomexError
      ? error
      : archivoInvalido(`No se pudo leer ${ruta}: ${mensajeDe(error)}`, error);
  let archivo: Awaited<ReturnType<typeof open>>;
  try {
    // O_NONBLOCK no existe en Windows; en los demás evita quedarse esperando en un FIFO.
    archivo = await open(ruta, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    // Hay sistemas que no abren una carpeta para leer.
    if ((error as { code?: unknown } | null)?.code === "EISDIR") throw noEsArchivo();
    throw noSePudo(error);
  }
  try {
    const info = await archivo.stat();
    if (!info.isFile()) throw noEsArchivo();
    if (info.size > LIMITE_TXT) {
      throw archivoInvalido(
        `El archivo pesa ${tamanoLegible(info.size)} y el límite es ${tamanoLegible(LIMITE_TXT)}.`,
      );
    }
    const trozos: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const bufer = new Uint8Array(1_048_576);
      const { bytesRead } = await archivo.read(bufer, 0, bufer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > LIMITE_TXT) {
        throw archivoInvalido(`El archivo pasa de ${tamanoLegible(LIMITE_TXT)}.`);
      }
      trozos.push(bufer.subarray(0, bytesRead));
    }
    return new Uint8Array(Buffer.concat(trozos, total));
  } catch (error) {
    throw noSePudo(error);
  } finally {
    await archivo.close();
  }
}

async function guardarCatalogo(
  bytes: Uint8Array,
  dir: string,
  origen: "descarga" | "archivo",
  as_of: string | null,
  sqlite: boolean,
): Promise<ResumenSepomex> {
  const datos = txtDe(bytes);
  const { aviso, filas } = leerTxt(datos);
  const catalogo = armarCatalogo(filas);
  const advertencias = [...catalogo.resumen.advertencias];
  if (normal(aviso) !== normal(AVISO_SEPOMEX)) {
    advertencias.unshift(
      "El aviso de uso del archivo es distinto del que conoce mexicoapi: léelo en resumen().aviso antes de usar los datos.",
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
  return resumenDe(dir, meta);
}

/**
 * Descarga el catálogo de Correos de México desde este equipo con el formulario público (todo el
 * país, TXT), lo revisa, lo une con los municipios de INEGI y lo guarda en la caché. Antes de
 * pedir nada pasa a `aviso` el aviso de uso de Correos de México y la nota de MéxicoAPI. Si algo
 * falla lanza SepomexError y la caché anterior queda igual; si el sitio bloquea la descarga
 * automática (`bloqueado`), no se intenta evadir: el mensaje dice cómo usar `importar`. Mientras
 * trabaja tiene el candado `sync.lock` del directorio: otra sincronización o importación en el
 * mismo directorio falla de inmediato con `ocupado`, sin pedir nada a Correos de México. Un fallo
 * al escribir la caché (disco lleno, sin permiso) es `escritura`.
 *
 * Memoria: leer, unir y guardar el catálogo completo (unas 160 mil filas) usa por un momento unos
 * 340 MB; tarda alrededor de 1.5 s además de la descarga.
 */
export async function sync(opciones: OpcionesSync = {}): Promise<ResumenSepomex> {
  const dir = directorioDe(opciones);
  return conCandado(dir, async () => {
    (opciones.aviso ?? escribirAviso)(textoAviso(dir));
    const pedir = opciones.fetch ?? crearTransporte({ esperaMs: ESPERA_MS });
    const { bytes, as_of } = await descargar(pedir);
    return guardarCatalogo(bytes, dir, "descarga", as_of, opciones.sqlite ?? true);
  });
}

/**
 * Importa el ZIP o el TXT que se descargó a mano de la página de Correos de México (estado
 * "Todos", formato TXT), con las mismas revisiones, el mismo candado y la misma memoria que
 * `sync`. Solo acepta un archivo regular de hasta 60 MB.
 */
export async function importar(
  ruta: string,
  opciones: OpcionesGuardado = {},
): Promise<ResumenSepomex> {
  const dir = directorioDe(opciones);
  return conCandado(dir, async () => {
    (opciones.aviso ?? escribirAviso)(textoAviso(dir));
    const bytes = await leerArchivoAcotado(ruta);
    return guardarCatalogo(bytes, dir, "archivo", null, opciones.sqlite ?? true);
  });
}

/** Cómo quedó el catálogo guardado (fecha, filas, aviso...), o null si no hay. */
export async function resumen(opciones: OpcionesDirectorio = {}): Promise<ResumenSepomex | null> {
  const dir = directorioDe(opciones);
  const meta = await leerMeta(dir);
  return meta === null ? null : resumenDe(dir, meta);
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
 *
 * La primera consulta lee el JSON del catálogo (unos 17 MB en disco, ~150 ms) y lo deja en
 * memoria del proceso; las siguientes solo revisan si meta.json cambió (un `stat`).
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
