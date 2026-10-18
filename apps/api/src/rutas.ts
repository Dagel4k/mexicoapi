import { clabe } from "./computados/clabe.js";
import type { Entorno, Opciones } from "./entorno.js";
import { servirShard } from "./estaticos.js";
import { type TipoProblema, URL_DOCS } from "./problemas.js";
import { CACHE_DATOS, respuestaJson } from "./respuestas.js";

export interface Regla {
  /** Expresión anclada (`^…$`) que debe cumplir el valor completo. */
  patron: RegExp;
  /** `detail` del 400 cuando el valor no la cumple. */
  detalle: string;
}

export interface ReglaConsulta extends Regla {
  obligatorio?: boolean;
}

export type Parametros = Readonly<Record<string, string>>;

export interface Contexto {
  peticion: Request;
  url: URL;
  entorno: Entorno;
  opciones: Opciones;
  /** Solo los parámetros de ruta que pasaron su regla. */
  parametros: Parametros;
  /** Un valor por parámetro de query declarado y presente. */
  consulta: Parametros;
}

export interface Ruta {
  /**
   * Expresión anclada sobre `url.pathname` sin decodificar. Cada grupo con nombre es un
   * parámetro y necesita su regla en `parametros`; un grupo sin regla no llega al manejador.
   */
  patron: RegExp;
  parametros?: Readonly<Record<string, Regla>>;
  /** Parámetros de query permitidos; cualquier otro es desconocido. */
  consulta?: Readonly<Record<string, ReglaConsulta>>;
  manejar: (contexto: Contexto) => Response | Promise<Response>;
}

export type Problema = { problema: TipoProblema; detalle: string; parametro?: string };

export type Resolucion = { ruta: Ruta; parametros: Parametros; consulta: Parametros } | Problema;

function problema(tipo: TipoProblema, detalle: string, parametro: string): Problema {
  return { problema: tipo, detalle, parametro };
}

function validarConsulta(
  reglas: Readonly<Record<string, ReglaConsulta>>,
  query: URLSearchParams,
): { consulta: Parametros } | Problema {
  for (const nombre of query.keys()) {
    if (!Object.hasOwn(reglas, nombre)) {
      return problema(
        "parametro-desconocido",
        `Esta ruta no acepta el parámetro ${nombre}.`,
        nombre,
      );
    }
  }
  const consulta: Record<string, string> = {};
  for (const [nombre, regla] of Object.entries(reglas)) {
    const [valor, ...repetidos] = query.getAll(nombre);
    if (valor === undefined) {
      if (regla.obligatorio === true) {
        return problema("parametro-faltante", `Falta el parámetro ${nombre}.`, nombre);
      }
      continue;
    }
    if (repetidos.length > 0) {
      return problema(
        "parametro-invalido",
        `El parámetro ${nombre} aparece más de una vez.`,
        nombre,
      );
    }
    if (valor === "") {
      return problema("parametro-invalido", `El parámetro ${nombre} está vacío.`, nombre);
    }
    if (!regla.patron.test(valor)) return problema("parametro-invalido", regla.detalle, nombre);
    consulta[nombre] = valor;
  }
  return { consulta };
}

/** URLSearchParams ignora `?&` y `a=1&&b=2`, y a `?=1` le da nombre vacío; aquí se rechazan. */
const tieneSegmentoSinNombre = (search: string): boolean =>
  search
    .slice(1)
    .split("&")
    .some((segmento) => segmento === "" || segmento.startsWith("="));

function validar(ruta: Ruta, grupos: Readonly<Record<string, string>>, url: URL): Resolucion {
  const parametros: Record<string, string> = {};
  for (const [nombre, regla] of Object.entries(ruta.parametros ?? {})) {
    const valor = grupos[nombre];
    if (valor === undefined || !regla.patron.test(valor)) {
      return problema("parametro-invalido", regla.detalle, nombre);
    }
    parametros[nombre] = valor;
  }
  // `url.search` es "" con un `?` solo.
  if (url.search !== "" && tieneSegmentoSinNombre(url.search)) {
    return { problema: "parametro-invalido", detalle: "La query tiene un parámetro sin nombre." };
  }
  const resultado = validarConsulta(ruta.consulta ?? {}, url.searchParams);
  return "consulta" in resultado ? { ruta, parametros, consulta: resultado.consulta } : resultado;
}

/**
 * Busca la ruta de `url` y valida sus parámetros. Trabaja sobre la ruta sin decodificar:
 * cualquier `%` (incluidos los dígitos de ancho completo, que llegan codificados) no se encuentra.
 */
export function resolver(tabla: readonly Ruta[], url: URL): Resolucion {
  const camino = url.pathname;
  if (!camino.includes("%")) {
    for (const ruta of tabla) {
      const coincidencia = ruta.patron.exec(camino);
      if (coincidencia !== null) return validar(ruta, coincidencia.groups ?? {}, url);
    }
  }
  return { problema: "no-encontrado", detalle: "No existe la ruta." };
}

const INDICE = {
  nombre: "MéxicoAPI",
  version: "v1",
  documentacion: `${URL_DOCS}/api/README.md`,
  openapi: "/v1/openapi.json",
  status: "/v1/status",
  descargas: "/descargas/SHA256SUMS",
};

const indice = (): Response => respuestaJson(INDICE, { cache: CACHE_DATOS });

const CVE_ENT: Regla = {
  patron: /^\d{2}$/,
  detalle: "La clave de estado (cve_ent) debe tener 2 dígitos.",
};
const CVEGEO: Regla = {
  patron: /^\d{5}$/,
  detalle: "La clave de municipio (cvegeo) debe tener 5 dígitos.",
};
const CODIGO_BANCO: Regla = {
  patron: /^\d{3}$/,
  detalle: "El código de banco debe tener 3 dígitos.",
};
const CLABE: Regla = { patron: /^\d{18}$/, detalle: "La CLABE debe tener 18 dígitos." };

/**
 * Manejador de un shard. `destino` arma la ruta del asset y el nombre del recurso (para el
 * 404) solo con parámetros que ya pasaron su regla.
 */
function shard(destino: (p: Parametros) => readonly [asset: string, recurso: string]) {
  return (c: Contexto): Promise<Response> => {
    const [asset, recurso] = destino(c.parametros);
    return servirShard(c, asset, recurso);
  };
}

const fijo = (asset: string, recurso: string) => shard(() => [asset, recurso]);

export const RUTAS: readonly Ruta[] = [
  { patron: /^\/$/, manejar: indice },
  { patron: /^\/v1$/, manejar: indice },
  { patron: /^\/v1\/estados$/, manejar: fijo("/v1/estados.json", "la lista de estados") },
  {
    patron: /^\/v1\/estados\/(?<cve_ent>[^/]+)$/,
    parametros: { cve_ent: CVE_ENT },
    manejar: shard((p) => [`/v1/estados/${p.cve_ent}.json`, `el estado ${p.cve_ent}`]),
  },
  {
    patron: /^\/v1\/estados\/(?<cve_ent>[^/]+)\/municipios$/,
    parametros: { cve_ent: CVE_ENT },
    manejar: shard((p) => [`/v1/estados/${p.cve_ent}/municipios.json`, `el estado ${p.cve_ent}`]),
  },
  { patron: /^\/v1\/municipios$/, manejar: fijo("/v1/municipios.json", "la lista de municipios") },
  {
    patron: /^\/v1\/municipios\/(?<cvegeo>[^/]+)$/,
    parametros: { cvegeo: CVEGEO },
    manejar: shard((p) => [`/v1/municipios/${p.cvegeo}.json`, `el municipio ${p.cvegeo}`]),
  },
  { patron: /^\/v1\/bancos$/, manejar: fijo("/v1/bancos.json", "la lista de bancos") },
  {
    patron: /^\/v1\/bancos\/(?<codigo>[^/]+)$/,
    parametros: { codigo: CODIGO_BANCO },
    manejar: shard((p) => [`/v1/bancos/${p.codigo}.json`, `el banco ${p.codigo}`]),
  },
  {
    patron: /^\/v1\/clabe\/(?<clabe>[^/]+)$/,
    parametros: { clabe: CLABE },
    manejar: clabe,
  },
  { patron: /^\/v1\/openapi\.json$/, manejar: fijo("/v1/openapi.json", "el documento OpenAPI") },
];
