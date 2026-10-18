// Lógica de la CLI `mexicoapi`: recibe los argumentos y el entorno y devuelve el código de salida.
// No toca process; el binario (index.ts) le pasa stdout, stderr y el entorno reales.
//
// Códigos de salida: 0 todo bien; 1 entrada o resultado inválido (un RFC mal formado, un banco
// que no existe) o error al ejecutar; 2 uso incorrecto (comando desconocido, falta un argumento).
import { parseArgs } from "node:util";
import { type Autoridad, esFechaIsoValida } from "../index.js";
import { AYUDA, ayudaDe } from "./ayuda.js";
import {
  bancoTexto,
  diasHabilesTexto,
  estadoSepomexTexto,
  municipiosTexto,
  municipioTexto,
  pieTexto,
  validacionTexto,
} from "./texto.js";
import type { ModuloSepomexCli } from "./tipos.js";

export interface Entorno {
  /** Escribe en la salida estándar; recibe el texto con su salto de línea. */
  salida(texto: string): void;
  /** Escribe en la salida de errores. */
  errores(texto: string): void;
  env: Readonly<Record<string, string | undefined>>;
  version: string;
  /** Para las pruebas: reemplaza a `mexicoapi/sepomex`. */
  sepomex?: ModuloSepomexCli | undefined;
}

/** Uso incorrecto: sale con código 2 y un recordatorio de `--help`. */
class ErrorUso extends Error {}

const OPCIONES = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  depurar: { type: "boolean" },
  base: { type: "string" },
  desde: { type: "string" },
  dias: { type: "string" },
  autoridad: { type: "string" },
} as const;

type Opciones = {
  json?: boolean | undefined;
  help?: boolean | undefined;
  version?: boolean | undefined;
  depurar?: boolean | undefined;
  base?: string | undefined;
  desde?: string | undefined;
  dias?: string | undefined;
  autoridad?: string | undefined;
};

/** Opciones propias de cada comando, además de --json, --help, --version y --depurar. */
const PROPIAS: Readonly<Record<string, readonly (keyof Opciones)[]>> = {
  "dias-habiles": ["base", "desde", "dias", "autoridad"],
  municipio: ["base"],
  banco: ["base"],
};

const VALIDADORES = ["clabe", "rfc", "curp", "nss"] as const;
const SUBCOMANDOS_SEPOMEX = ["sync", "importar", "cp", "estado"] as const;
const CVEGEO = /^\d{5}$/;
const ENTERO = /^\d+$/;
const MAXIMO_MUNICIPIOS = 20;
const SIN_CATALOGO =
  "Todavía no hay catálogo de códigos postales. Corre `mexicoapi sepomex sync` (o `mexicoapi sepomex importar <archivo>`).";

const imprimir = (e: Entorno, texto: string): void => e.salida(`${texto}\n`);
const json = (e: Entorno, valor: unknown): void => imprimir(e, JSON.stringify(valor, null, 2));

function analizar(argv: readonly string[]): { posiciones: string[]; opciones: Opciones } {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: OPCIONES,
      allowPositionals: true,
      strict: true,
    });
    return { posiciones: positionals, opciones: values };
  } catch (error) {
    throw new ErrorUso((error as Error).message.replace(/\. If the argument.*$/s, "."));
  }
}

function revisarOpciones(comando: string, opciones: Opciones): void {
  const permitidas = PROPIAS[comando] ?? [];
  for (const nombre of ["base", "desde", "dias", "autoridad"] as const) {
    if (opciones[nombre] !== undefined && !permitidas.includes(nombre)) {
      throw new ErrorUso(`La opción --${nombre} no aplica a "${comando}".`);
    }
  }
}

function unValor(posiciones: readonly string[], nombre: string, comando: string): string {
  const [valor, ...resto] = posiciones;
  if (valor === undefined) throw new ErrorUso(`Falta ${nombre} en "${comando}".`);
  if (resto.length > 0) throw new ErrorUso(`Sobran argumentos en "${comando}": ${resto.join(" ")}`);
  return valor;
}

function sinArgumentos(posiciones: readonly string[], comando: string): void {
  if (posiciones.length > 0) {
    throw new ErrorUso(`"${comando}" no recibe argumentos: ${posiciones.join(" ")}`);
  }
}

async function crearClienteCli(e: Entorno, opciones: Opciones) {
  const { crearCliente } = await import("../cliente/index.js");
  const base = opciones.base ?? e.env.MEXICOAPI_BASE;
  return base === undefined || base === ""
    ? { cliente: crearCliente({ offline: true }), conRed: false }
    : { cliente: crearCliente({ base }), conRed: true };
}

async function validador(
  comando: (typeof VALIDADORES)[number],
  valor: string,
  e: Entorno,
  opciones: Opciones,
): Promise<number> {
  const core = await import("../index.js");
  const resultado =
    comando === "clabe"
      ? core.validarClabe(valor, { bancos: (await import("../datos/bancos.js")).catalogoClabe() })
      : comando === "rfc"
        ? core.validarRfc(valor)
        : comando === "curp"
          ? core.validarCurp(valor)
          : core.validarNss(valor);
  if (opciones.json) json(e, resultado);
  else {
    const femenino = comando === "clabe" || comando === "curp";
    const pie = comando === "clabe" ? pieTexto({ origen: "paquete", advertencias: [] }, false) : "";
    imprimir(e, validacionTexto(comando.toUpperCase(), femenino, resultado) + pie);
  }
  return resultado.valido ? 0 : 1;
}

async function diasHabiles(e: Entorno, opciones: Opciones): Promise<number> {
  const { desde, dias, autoridad } = opciones;
  if (desde === undefined) throw new ErrorUso('Falta --desde AAAA-MM-DD en "dias-habiles".');
  if (dias === undefined) throw new ErrorUso('Falta --dias N en "dias-habiles".');
  // Un valor mal formado es un error de uso; uno bien formado pero inválido (una autoridad que no
  // existe, 0 días) lo rechaza el cliente y sale con 1.
  if (!ENTERO.test(dias)) throw new ErrorUso(`--dias debe ser un entero, no "${dias}".`);
  if (!esFechaIsoValida(desde)) {
    throw new ErrorUso(`--desde debe ser una fecha válida AAAA-MM-DD, no "${desde}".`);
  }
  const { cliente, conRed } = await crearClienteCli(e, opciones);
  const respuesta = await cliente.diasHabiles({
    desde,
    dias: Number(dias),
    autoridad: autoridad as Autoridad | undefined,
  });
  if (opciones.json) json(e, respuesta);
  else imprimir(e, diasHabilesTexto(respuesta) + pieTexto(respuesta, conRed));
  return 0;
}

async function municipio(valor: string, e: Entorno, opciones: Opciones): Promise<number> {
  const datos = await import("../datos/index.js");
  if (CVEGEO.test(valor)) {
    const { cliente, conRed } = await crearClienteCli(e, opciones);
    const respuesta = await cliente.municipio(valor);
    if (opciones.json) json(e, respuesta);
    else {
      const estado = datos.estado(respuesta.data.cve_ent);
      imprimir(e, municipioTexto(respuesta.data, estado?.nombre) + pieTexto(respuesta, conRed));
    }
    return 0;
  }
  // La API no busca por texto: la búsqueda siempre sale de los datos del paquete.
  const encontrados = datos.buscarMunicipio(valor);
  if (opciones.json) json(e, encontrados);
  else {
    imprimir(
      e,
      municipiosTexto(valor, encontrados, MAXIMO_MUNICIPIOS, (cve) => datos.estado(cve)?.nombre) +
        pieTexto({ origen: "paquete", advertencias: [] }, false),
    );
  }
  return encontrados.length > 0 ? 0 : 1;
}

async function banco(codigo: string, e: Entorno, opciones: Opciones): Promise<number> {
  const { cliente, conRed } = await crearClienteCli(e, opciones);
  const respuesta = await cliente.banco(codigo);
  if (opciones.json) json(e, respuesta);
  else imprimir(e, bancoTexto(respuesta.data) + pieTexto(respuesta, conRed));
  return 0;
}

async function sepomex(
  posiciones: readonly string[],
  e: Entorno,
  opciones: Opciones,
): Promise<number> {
  const [sub, ...resto] = posiciones;
  if (sub === undefined || !(SUBCOMANDOS_SEPOMEX as readonly string[]).includes(sub)) {
    throw new ErrorUso(
      sub === undefined
        ? 'Falta el subcomando de "sepomex": sync, importar, cp o estado.'
        : `Subcomando de "sepomex" desconocido: ${sub}`,
    );
  }
  const lib = e.sepomex ?? (await import("../sepomex/index.js"));
  // El aviso de Correos de México va a stderr: con --json, stdout queda solo con el resultado.
  const aviso = (texto: string): void => e.errores(`${texto}\n`);
  if (sub === "sync" || sub === "estado") sinArgumentos(resto, `sepomex ${sub}`);
  if (sub === "sync") {
    const estado = await lib.sync({ aviso });
    if (opciones.json) json(e, estado);
    else imprimir(e, `Catálogo descargado.\n${estadoSepomexTexto(estado)}`);
    return 0;
  }
  if (sub === "importar") {
    const ruta = unValor(resto, "la ruta del archivo", "sepomex importar");
    const estado = await lib.importar(ruta, { aviso });
    if (opciones.json) json(e, estado);
    else imprimir(e, `Catálogo importado.\n${estadoSepomexTexto(estado)}`);
    return 0;
  }
  if (sub === "estado") {
    const estado = await lib.estado();
    if (opciones.json) json(e, estado);
    else if (estado === null) imprimir(e, SIN_CATALOGO);
    else imprimir(e, estadoSepomexTexto(estado));
    return estado === null ? 1 : 0;
  }
  const codigo = unValor(resto, "el código postal", "sepomex cp");
  const encontrado = await lib.cp(codigo);
  if (opciones.json) json(e, encontrado);
  else if (encontrado === null) imprimir(e, `El código postal ${codigo} no está en el catálogo.`);
  else {
    const { estado, municipio: mun, asentamientos } = encontrado;
    const lineas = [
      `${encontrado.cp}  ${mun.nombre}, ${estado.nombre}`,
      `Municipio: ${mun.cvegeo ?? "sin clave de INEGI"}`,
      ...asentamientos.map((a) => `  ${a.nombre} (${a.tipo}, ${a.zona})`),
    ];
    imprimir(e, lineas.join("\n"));
  }
  return encontrado === null ? 1 : 0;
}

/** Un error al ejecutar: texto por stderr o, con --json, `{"error": {...}}`. */
function imprimirError(e: Entorno, mensaje: string, enJson: boolean, problema?: unknown): void {
  if (!enJson) {
    e.errores(`mexicoapi: ${mensaje}\n`);
    return;
  }
  const p = problema as { status?: unknown; tipo?: unknown; title?: unknown; detail?: unknown };
  const cuerpo =
    problema === undefined
      ? { mensaje }
      : { status: p.status, tipo: p.tipo ?? null, title: p.title, detail: p.detail };
  e.errores(`${JSON.stringify({ error: cuerpo })}\n`);
}

/** Mensaje para el usuario; el detalle técnico solo con --depurar. */
function falla(e: Entorno, error: unknown, depurar: boolean, enJson: boolean): void {
  const nombre = (error as { name?: unknown } | null)?.name;
  const mensaje = error instanceof Error ? error.message : String(error);
  const conocido =
    nombre === "MexicoApiError" ||
    nombre === "SepomexError" ||
    error instanceof TypeError ||
    error instanceof RangeError;
  const sinCatalogo =
    nombre === "SepomexError" && (error as { tipo?: unknown }).tipo === "sin-datos";
  const texto = sinCatalogo ? SIN_CATALOGO : conocido ? mensaje : `error inesperado: ${mensaje}`;
  imprimirError(e, texto, enJson, nombre === "MexicoApiError" ? error : undefined);
  if (depurar) {
    e.errores(`${error instanceof Error ? (error.stack ?? mensaje) : String(error)}\n`);
  } else if (!conocido && !enJson) {
    e.errores("Usa --depurar para ver el detalle.\n");
  }
}

export async function ejecutar(argv: readonly string[], e: Entorno): Promise<number> {
  let depurar = argv.includes("--depurar");
  const enJson = argv.includes("--json");
  try {
    const { posiciones, opciones } = analizar(argv);
    depurar = opciones.depurar === true;
    if (opciones.version) {
      imprimir(e, e.version);
      return 0;
    }
    const [comando, ...resto] = posiciones;
    if (opciones.help) {
      imprimir(e, ayudaDe(comando, resto[0]) ?? AYUDA);
      return 0;
    }
    if (comando === undefined) throw new ErrorUso("Falta el comando.");
    if (
      !Object.hasOwn(PROPIAS, comando) &&
      !(VALIDADORES as readonly string[]).includes(comando) &&
      comando !== "sepomex"
    ) {
      throw new ErrorUso(`Comando desconocido: ${comando}`);
    }
    revisarOpciones(comando, opciones);
    if ((VALIDADORES as readonly string[]).includes(comando)) {
      const nombre = comando as (typeof VALIDADORES)[number];
      return await validador(nombre, unValor(resto, "el valor a validar", comando), e, opciones);
    }
    switch (comando) {
      case "dias-habiles":
        sinArgumentos(resto, comando);
        return await diasHabiles(e, opciones);
      case "municipio":
        return await municipio(
          unValor(resto, "la clave (cvegeo) o el texto", comando),
          e,
          opciones,
        );
      case "banco":
        return await banco(unValor(resto, "el código de 3 dígitos", comando), e, opciones);
      default:
        return await sepomex(resto, e, opciones);
    }
  } catch (error) {
    if (error instanceof ErrorUso) {
      imprimirError(e, error.message, enJson);
      if (!enJson) e.errores("Usa mexicoapi --help para ver los comandos.\n");
      return 2;
    }
    falla(e, error, depurar, enJson);
    return 1;
  }
}
