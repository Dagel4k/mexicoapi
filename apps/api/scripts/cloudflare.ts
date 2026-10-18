// Habla con la API REST de Cloudflare para el despliegue y el bot de datos: resuelve el namespace
// de KV, genera la configuración de wrangler de cada entorno y escribe `estado:<dataset>`.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface ClienteCloudflare {
  cuenta: string;
  token: string;
  fetch?: typeof fetch;
  /** Por omisión `https://api.cloudflare.com/client/v4`. */
  base?: string;
}

export interface ErrorApi {
  code: number;
  message: string;
}

export class ErrorCloudflare extends Error {
  /** Estado HTTP; 0 si no hubo respuesta. */
  readonly estado: number;
  readonly errores: ErrorApi[];

  constructor(mensaje: string, estado: number, errores: ErrorApi[]) {
    super(mensaje);
    this.name = "ErrorCloudflare";
    this.estado = estado;
    this.errores = errores;
  }
}

export const TITULO_KV = "mexicoapi-estado";

const BASE = "https://api.cloudflare.com/client/v4";
const TIEMPO_MAXIMO_MS = 30_000;
const POR_PAGINA = 100;
// 5000 namespaces: muy por encima de lo que permite una cuenta; más allá algo anda mal.
const MAX_PAGINAS = 50;

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cambia el token y la cuenta, tal cual y codificados como van en una URL, por `***`. */
function tapar(texto: string, c: ClienteCloudflare): string {
  let salida = texto;
  for (const secreto of [c.token, c.cuenta]) {
    if (secreto.length === 0) continue;
    salida = salida.replaceAll(encodeURIComponent(secreto), "***").replaceAll(secreto, "***");
  }
  return salida;
}

/** Mensaje de un error con su causa, si la trae (fetch pone ahí el motivo de red). */
function detalleDe(error: unknown): string {
  const causa =
    error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return `${mensajeDe(error)}${causa}`;
}

async function pedir(
  c: ClienteCloudflare,
  operacion: string,
  metodo: string,
  ruta: string,
  cuerpo?: { tipo: string; texto: string },
): Promise<Response> {
  const encabezados: Record<string, string> = { Authorization: `Bearer ${c.token}` };
  if (cuerpo !== undefined) encabezados["Content-Type"] = cuerpo.tipo;
  const url = `${c.base ?? BASE}/accounts/${encodeURIComponent(c.cuenta)}${ruta}`;
  try {
    return await (c.fetch ?? fetch)(url, {
      method: metodo,
      headers: encabezados,
      body: cuerpo?.texto ?? null,
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch (error) {
    throw new ErrorCloudflare(tapar(`no se pudo ${operacion}: ${detalleDe(error)}`, c), 0, []);
  }
}

/** Cuerpo de la respuesta. Una lectura que se corta es error, nunca un cuerpo vacío. */
async function leerTexto(
  c: ClienteCloudflare,
  respuesta: Response,
  operacion: string,
): Promise<string> {
  try {
    return await respuesta.text();
  } catch (error) {
    throw new ErrorCloudflare(
      tapar(`no se pudo leer la respuesta al ${operacion}: ${detalleDe(error)}`, c),
      respuesta.status,
      [],
    );
  }
}

function jsonDe(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

function errorDe(
  c: ClienteCloudflare,
  operacion: string,
  estado: number,
  sobre: unknown,
): ErrorCloudflare {
  const errores: ErrorApi[] = [];
  if (esObjeto(sobre) && Array.isArray(sobre.errors)) {
    for (const e of sobre.errors) {
      if (!esObjeto(e)) continue;
      errores.push({
        code: typeof e.code === "number" ? e.code : 0,
        message: typeof e.message === "string" ? tapar(e.message, c) : "",
      });
    }
  }
  let detalle = "";
  if (!esObjeto(sobre)) detalle = " (sin JSON)";
  else if (errores.length > 0)
    detalle = `: ${errores.map((e) => `[${e.code}] ${e.message}`).join("; ")}`;
  return new ErrorCloudflare(
    tapar(`Cloudflare respondió ${estado} al ${operacion}${detalle}`, c),
    estado,
    errores,
  );
}

function inesperada(operacion: string, estado: number, detalle = ""): ErrorCloudflare {
  return new ErrorCloudflare(
    `respuesta inesperada de Cloudflare al ${operacion}${detalle}`,
    estado,
    [],
  );
}

/** Pide y desenvuelve el sobre `{ success, errors, result, result_info }`. */
async function llamar(
  c: ClienteCloudflare,
  operacion: string,
  metodo: string,
  ruta: string,
  cuerpo?: { tipo: string; texto: string },
): Promise<{ result: unknown; result_info: unknown; estado: number }> {
  const respuesta = await pedir(c, operacion, metodo, ruta, cuerpo);
  const sobre = jsonDe(await leerTexto(c, respuesta, operacion));
  if (!respuesta.ok || !esObjeto(sobre) || sobre.success !== true) {
    throw errorDe(c, operacion, respuesta.status, sobre);
  }
  return { result: sobre.result, result_info: sobre.result_info, estado: respuesta.status };
}

async function buscarNamespace(c: ClienteCloudflare, titulo: string): Promise<string | null> {
  const operacion = "listar los namespaces de KV";
  for (let pagina = 1; ; pagina++) {
    const { result, result_info, estado } = await llamar(
      c,
      operacion,
      "GET",
      `/storage/kv/namespaces?per_page=${POR_PAGINA}&page=${pagina}`,
    );
    if (!Array.isArray(result)) throw inesperada(operacion, estado);
    for (const ns of result) {
      if (esObjeto(ns) && ns.title === titulo && typeof ns.id === "string") return ns.id;
    }
    const total = esObjeto(result_info) ? result_info.total_pages : undefined;
    if (typeof total !== "number") {
      if (result.length < POR_PAGINA) return null;
      throw inesperada(operacion, estado, ": página llena sin result_info.total_pages");
    }
    if (total > MAX_PAGINAS) {
      throw inesperada(
        operacion,
        estado,
        `: ${total} páginas, más de las ${MAX_PAGINAS} que recorre`,
      );
    }
    if (pagina >= total) return null;
  }
}

/** Id del namespace con ese título; lo crea si no existe. */
export async function resolverNamespace(
  c: ClienteCloudflare,
  titulo: string = TITULO_KV,
): Promise<string> {
  const existente = await buscarNamespace(c, titulo);
  if (existente !== null) return existente;
  const operacion = "crear el namespace de KV";
  try {
    const { result, estado } = await llamar(c, operacion, "POST", "/storage/kv/namespaces", {
      tipo: "application/json",
      texto: JSON.stringify({ title: titulo }),
    });
    if (esObjeto(result) && typeof result.id === "string") return result.id;
    throw inesperada(operacion, estado);
  } catch (error) {
    // Otra corrida pudo crearlo entre la búsqueda y el POST (Cloudflare rechaza el título
    // repetido); si tampoco aparece ahora, el error del POST es el que explica la falla.
    let creado: string | null;
    try {
      creado = await buscarNamespace(c, titulo);
    } catch (otro) {
      const { estado, errores } =
        error instanceof ErrorCloudflare ? error : { estado: 0, errores: [] };
      throw new ErrorCloudflare(
        tapar(`${mensajeDe(error)}; y al volver a listar: ${mensajeDe(otro)}`, c),
        estado,
        errores,
      );
    }
    if (creado !== null) return creado;
    throw error;
  }
}

/** Subdominio de workers.dev de la cuenta (`<subdominio>.workers.dev`). */
export async function subdominio(c: ClienteCloudflare): Promise<string> {
  const operacion = "leer el subdominio de workers.dev";
  const { result, estado } = await llamar(c, operacion, "GET", "/workers/subdomain");
  const valor = esObjeto(result) ? result.subdomain : undefined;
  if (typeof valor !== "string" || !/^[a-z0-9-]+$/i.test(valor)) {
    throw inesperada(operacion, estado);
  }
  return valor;
}

function finDeCadena(texto: string, inicio: number): number {
  let i = inicio + 1;
  while (i < texto.length) {
    if (texto[i] === "\\") i += 2;
    else if (texto[i] === '"') return i + 1;
    else i++;
  }
  return texto.length;
}

/** JSON con comentarios de línea y de bloque y comas finales, como lo acepta wrangler. */
export function leerJsonc(texto: string): unknown {
  let salida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === '"') {
      const fin = finDeCadena(texto, i);
      salida += texto.slice(i, fin);
      i = fin;
    } else if (c === "/" && texto[i + 1] === "/") {
      const fin = texto.indexOf("\n", i);
      i = fin === -1 ? texto.length : fin;
    } else if (c === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      if (fin === -1) throw new SyntaxError("comentario /* sin cerrar");
      i = fin + 2;
    } else {
      // Fuera de las cadenas, el último carácter no blanco solo es una coma si es separador.
      if (c === "}" || c === "]") salida = salida.replace(/,(\s*)$/, "$1");
      salida += c;
      i++;
    }
  }
  return JSON.parse(salida);
}

export type Entorno = "staging" | "produccion";

const ENTORNOS: Record<Entorno, { name: string; limite: string }> = {
  staging: { name: "mexicoapi-staging", limite: "1002" },
  produccion: { name: "mexicoapi", limite: "1001" },
};

function esEntorno(valor: string): valor is Entorno {
  return Object.hasOwn(ENTORNOS, valor);
}

/**
 * Configuración de wrangler de un entorno a partir de `wrangler.jsonc`. `main` y
 * `assets.directory` se quedan relativos: el archivo generado vive junto a `wrangler.jsonc`.
 */
export function configuracionDespliegue(
  base: Record<string, unknown>,
  entorno: Entorno,
  kvId: string,
): Record<string, unknown> {
  const { name, limite } = ENTORNOS[entorno];
  return {
    ...base,
    name,
    kv_namespaces: [{ binding: "ESTADO", id: kvId }],
    // namespace_id es un entero elegido por la cuenta: separa los contadores de cada Worker.
    ratelimits: [{ name: "LIMITE", namespace_id: limite, simple: { limit: 600, period: 60 } }],
  };
}

export interface EstadoKv {
  last_attempt: string;
  last_success: string | null;
  last_result: "sin_cambios" | "actualizado" | "requiere_revision" | "error";
}

// La misma forma que acepta /v1/status: instante UTC con segundos y `Z`.
const INSTANTE = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

function esInstante(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const partes = INSTANTE.exec(valor);
  if (partes === null) return false;
  const [anio, mes, dia] = partes.slice(1, 4).map(Number) as [number, number, number];
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return (
    anio >= 1 &&
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Estado que sigue a una corrida. `previo` es lo que había en KV, con cualquier forma.
 * `last_success` avanza con `sin_cambios` siempre y con `actualizado` solo si la corrida
 * publicó el cambio: si no, lo que sirve la API sigue siendo lo anterior.
 */
export function siguienteEstado(
  previo: unknown,
  resultado: EstadoKv["last_result"],
  publicado: boolean,
  ahora: Date,
): EstadoKv {
  const instante = ahora.toISOString();
  const exito = resultado === "sin_cambios" || (resultado === "actualizado" && publicado);
  const anterior = esObjeto(previo) && esInstante(previo.last_success) ? previo.last_success : null;
  return {
    last_attempt: instante,
    last_success: exito ? instante : anterior,
    last_result: resultado,
  };
}

type ResultadoCorrida = Exclude<EstadoKv["last_result"], "error">;

function esResultadoCorrida(valor: unknown): valor is ResultadoCorrida {
  return valor === "sin_cambios" || valor === "actualizado" || valor === "requiere_revision";
}

function esDataset(valor: unknown): valor is string {
  return typeof valor === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(valor);
}

/** Pares dataset → resultado del `resumen.json` del CLI de datos y su código de salida. */
function leerResumen(
  resumen: unknown,
  codigo: number,
  publicado: boolean,
): Array<[string, EstadoKv["last_result"]]> {
  if (codigo !== 0 && codigo !== 1 && codigo !== 3) {
    throw new Error(`código de salida inesperado: ${codigo} (se espera 0, 1 o 3)`);
  }
  if (codigo === 1 && publicado) {
    throw new Error("con código 1 la corrida no publica nada: --publicado debe ser no");
  }
  if (!esObjeto(resumen) || !Array.isArray(resumen.resultados) || !Array.isArray(resumen.errores)) {
    throw new Error("el resumen no trae resultados[] y errores[]");
  }
  if (codigo !== 1 && resumen.errores.length > 0) {
    throw new Error(`el resumen trae errores pero el código de salida es ${codigo}`);
  }
  const pares: Array<[string, EstadoKv["last_result"]]> = [];
  for (const [i, r] of (resumen.resultados as unknown[]).entries()) {
    if (!esObjeto(r) || !esDataset(r.dataset) || !esResultadoCorrida(r.estado)) {
      throw new Error(`el resumen trae un resultado inválido en la posición ${i}`);
    }
    pares.push([r.dataset, r.estado]);
  }
  for (const [i, e] of (resumen.errores as unknown[]).entries()) {
    if (!esObjeto(e) || !esDataset(e.dataset)) {
      throw new Error(`el resumen trae un error inválido en la posición ${i}`);
    }
    pares.push([e.dataset, "error"]);
  }
  return pares;
}

const rutaValor = (kvId: string, clave: string) =>
  `/storage/kv/namespaces/${encodeURIComponent(kvId)}/values/${encodeURIComponent(clave)}`;

/**
 * Valor JSON guardado en la clave; `undefined` si no existe o no es JSON. Un cuerpo que no se
 * pudo leer es error: tomarlo como vacío borraría un `last_success` válido.
 */
async function leerValor(c: ClienteCloudflare, kvId: string, clave: string): Promise<unknown> {
  const operacion = `leer ${clave}`;
  const respuesta = await pedir(c, operacion, "GET", rutaValor(kvId, clave));
  if (respuesta.status === 404) {
    // El cuerpo no sirve, pero se descarta para no dejar la conexión ocupada.
    await respuesta.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const texto = await leerTexto(c, respuesta, operacion);
  if (!respuesta.ok) throw errorDe(c, operacion, respuesta.status, jsonDe(texto));
  return jsonDe(texto);
}

/** Algunos datasets no se pudieron escribir; los demás sí. */
export class ErrorEstados extends Error {
  readonly escritos: string[];
  readonly fallas: { dataset: string; mensaje: string }[];

  constructor(escritos: string[], fallas: { dataset: string; mensaje: string }[]) {
    const lista = fallas.map((f) => `${f.dataset} (${f.mensaje})`).join("; ");
    super(`escritos: ${escritos.length > 0 ? escritos.join(", ") : "ninguno"}; fallaron: ${lista}`);
    this.name = "ErrorEstados";
    this.escritos = escritos;
    this.fallas = fallas;
  }
}

/**
 * Escribe `estado:<dataset>` de cada dataset del resumen y devuelve los escritos, en orden.
 * `publicado` dice si la corrida publicó sus cambios (ver `siguienteEstado`). Intenta todos
 * aunque alguno falle; si hubo fallas, al final lanza `ErrorEstados`.
 */
export async function escribirEstados(
  c: ClienteCloudflare,
  kvId: string,
  resumen: unknown,
  codigo: number,
  publicado: boolean,
  ahora: Date,
): Promise<string[]> {
  const pares = leerResumen(resumen, codigo, publicado);
  const escritos: string[] = [];
  const fallas: { dataset: string; mensaje: string }[] = [];
  for (const [dataset, resultado] of pares) {
    const clave = `estado:${dataset}`;
    try {
      const previo = await leerValor(c, kvId, clave);
      const siguiente = siguienteEstado(previo, resultado, publicado, ahora);
      await llamar(c, `escribir ${clave}`, "PUT", rutaValor(kvId, clave), {
        tipo: "application/octet-stream",
        texto: JSON.stringify(siguiente),
      });
      escritos.push(dataset);
    } catch (error) {
      fallas.push({ dataset, mensaje: tapar(mensajeDe(error), c) });
    }
  }
  if (fallas.length > 0) throw new ErrorEstados(escritos, fallas);
  return escritos;
}

export interface EntornoCli {
  variables: Readonly<Record<string, string | undefined>>;
  /** Carpeta de `wrangler.jsonc`. */
  raizApi: string;
  ahora: () => Date;
  escribir: (texto: string) => void;
  escribirError: (texto: string) => void;
  fetch?: typeof fetch;
}

const USO = `Uso:
  configurar --entorno <staging|produccion> --salida <ruta del JSON de wrangler>
  estado --resumen <ruta de resumen.json> --codigo <código de salida del CLI de datos>
         --publicado <si|no>   (si la corrida publicó sus cambios)
Lee CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID (ver docs/operacion/cloudflare.md).
`;

const OPCIONES_POR_COMANDO: Record<string, readonly string[]> = {
  configurar: ["entorno", "salida"],
  estado: ["resumen", "codigo", "publicado"],
};

function leer(argumentos: readonly string[]) {
  return parseArgs({
    args: [...argumentos],
    allowPositionals: true,
    options: {
      entorno: { type: "string" },
      salida: { type: "string" },
      resumen: { type: "string" },
      codigo: { type: "string" },
      publicado: { type: "string" },
    },
  });
}

/** El cliente con las variables de entorno, o el motivo para salir con 2. */
function clienteDesde(entorno: EntornoCli): ClienteCloudflare | string {
  const valores = {
    CLOUDFLARE_API_TOKEN: entorno.variables.CLOUDFLARE_API_TOKEN?.trim() ?? "",
    CLOUDFLARE_ACCOUNT_ID: entorno.variables.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "",
  };
  const faltan = Object.entries(valores).filter(([, v]) => v === "");
  if (faltan.length > 0) {
    return `Faltan ${faltan.map(([k]) => k).join(" y ")}; ver docs/operacion/cloudflare.md.`;
  }
  // Un encabezado inválido haría que fetch repitiera el token en su mensaje de error.
  if (/[^!-~]/.test(valores.CLOUDFLARE_API_TOKEN)) {
    return "CLOUDFLARE_API_TOKEN tiene espacios o caracteres fuera de ASCII.";
  }
  // Va en la URL: con otra forma aparecería codificada en los errores, donde nada la tapa.
  if (!/^[0-9a-f]{32}$/.test(valores.CLOUDFLARE_ACCOUNT_ID)) {
    return "CLOUDFLARE_ACCOUNT_ID no es un Account ID (32 caracteres hexadecimales en minúsculas).";
  }
  return {
    cuenta: valores.CLOUDFLARE_ACCOUNT_ID,
    token: valores.CLOUDFLARE_API_TOKEN,
    ...(entorno.fetch === undefined ? {} : { fetch: entorno.fetch }),
  };
}

async function configurar(
  c: ClienteCloudflare,
  destino: Entorno,
  salida: string,
  entorno: EntornoCli,
): Promise<void> {
  const ruta = join(entorno.raizApi, "wrangler.jsonc");
  const base = leerJsonc(await readFile(ruta, "utf8"));
  if (!esObjeto(base)) throw new Error(`${ruta} no es un objeto JSON`);
  const kvId = await resolverNamespace(c);
  const sub = await subdominio(c);
  const config = configuracionDespliegue(base, destino, kvId);
  await writeFile(salida, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  entorno.escribirError(`configurar: ${salida} (KV ${kvId})\n`);
  entorno.escribir(`https://${ENTORNOS[destino].name}.${sub}.workers.dev\n`);
}

async function estado(
  c: ClienteCloudflare,
  rutaResumen: string,
  codigo: number,
  publicado: boolean,
  entorno: EntornoCli,
): Promise<void> {
  const texto = await readFile(rutaResumen, "utf8");
  let resumen: unknown;
  try {
    resumen = JSON.parse(texto);
  } catch {
    throw new Error(`${rutaResumen} no es JSON válido`);
  }
  // Un resumen inválido se rechaza antes de crear o tocar nada en Cloudflare.
  leerResumen(resumen, codigo, publicado);
  const kvId = await resolverNamespace(c);
  const escritos = await escribirEstados(c, kvId, resumen, codigo, publicado, entorno.ahora());
  entorno.escribir(
    escritos.length === 0
      ? "estado: el resumen no trae datasets\n"
      : `estado: ${escritos.join(", ")}\n`,
  );
}

export async function principal(
  argumentos: readonly string[],
  entorno: EntornoCli,
): Promise<number> {
  const usar = (motivo: string): number => {
    entorno.escribirError(`${motivo}\n${USO}`);
    return 1;
  };
  let parseado: ReturnType<typeof leer>;
  try {
    parseado = leer(argumentos);
  } catch (error) {
    return usar(mensajeDe(error));
  }
  const { values, positionals } = parseado;
  const [comando, ...resto] = positionals;
  // Object.hasOwn: un comando como `constructor` no debe encontrar lo heredado de Object.
  const permitidas =
    comando !== undefined && Object.hasOwn(OPCIONES_POR_COMANDO, comando)
      ? OPCIONES_POR_COMANDO[comando]
      : undefined;
  if (permitidas === undefined) return usar("Comando desconocido o ausente.");
  const sobran = Object.keys(values).filter((k) => !permitidas.includes(k));
  if (sobran.length > 0) {
    return usar(`Opciones que no aplican a ${comando}: ${sobran.map((k) => `--${k}`).join(", ")}`);
  }
  if (resto.length > 0) return usar(`Argumentos de más para ${comando}: ${resto.join(" ")}`);
  const faltan = permitidas.filter((k) => values[k as keyof typeof values] === undefined);
  if (faltan.length > 0) return usar(`Falta ${faltan.map((k) => `--${k}`).join(", ")}.`);

  let accion: (c: ClienteCloudflare) => Promise<void>;
  if (comando === "configurar") {
    const destino = values.entorno as string;
    const salida = values.salida as string;
    if (!esEntorno(destino)) return usar(`--entorno inválido: ${destino}`);
    if (relative(resolve(entorno.raizApi, "wrangler.jsonc"), resolve(salida)) === "") {
      return usar("--salida no puede ser wrangler.jsonc: es la base de la configuración.");
    }
    if (relative(resolve(entorno.raizApi), resolve(dirname(salida))) !== "") {
      return usar(
        `--salida debe quedar en la misma carpeta que wrangler.jsonc (${entorno.raizApi}): sus rutas son relativas a ella.`,
      );
    }
    accion = (c) => configurar(c, destino, salida, entorno);
  } else {
    const codigo = values.codigo as string;
    const publicado = values.publicado as string;
    if (!/^\d+$/.test(codigo)) return usar(`--codigo inválido: ${codigo}`);
    if (publicado !== "si" && publicado !== "no") {
      return usar(`--publicado inválido: ${publicado} (si o no)`);
    }
    accion = (c) =>
      estado(c, values.resumen as string, Number(codigo), publicado === "si", entorno);
  }

  const cliente = clienteDesde(entorno);
  if (typeof cliente === "string") {
    entorno.escribirError(`${cliente}\n`);
    return 2;
  }
  try {
    await accion(cliente);
    return 0;
  } catch (error) {
    entorno.escribirError(`${comando}: ${tapar(mensajeDe(error), cliente)}\n`);
    return 1;
  }
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  process.exitCode = await principal(process.argv.slice(2), {
    variables: process.env,
    raizApi: fileURLToPath(new URL("..", import.meta.url)),
    ahora: () => new Date(),
    escribir: (texto) => void process.stdout.write(texto),
    escribirError: (texto) => void process.stderr.write(texto),
  });
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`cloudflare.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
