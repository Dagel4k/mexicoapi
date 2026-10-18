import {
  CONSULTAS,
  cumpleRegla,
  type ProblemaConsulta,
  REGLAS_RUTA,
  type ReglaConsulta,
  type ReglaParametro,
  revisarConsulta,
} from "@mexicoapi/core/rutas";
import { clabe } from "./computados/clabe.js";
import { consultarUma, shardConstante } from "./computados/constantes.js";
import { diasHabiles, diasInhabiles } from "./computados/dias.js";
import { consultarFix, consultarUdi, ultimoFix } from "./computados/indicadores.js";
import { status } from "./computados/status.js";
import type { Entorno, Opciones } from "./entorno.js";
import { servirShard } from "./estaticos.js";
import { type TipoProblema, URL_DOCS } from "./problemas.js";
import { CACHE_DATOS, respuestaJson } from "./respuestas.js";

/** Las reglas y sus textos son las del núcleo, las mismas que usan el paquete y el OpenAPI. */
export type Regla = ReglaParametro;
export type { ReglaConsulta };

export type Parametros = Readonly<Record<string, string>>;

export interface Contexto {
  peticion: Request;
  url: URL;
  entorno: Entorno;
  opciones: Opciones;
  /** La plantilla de la ruta (`/v1/estados/{cve_ent}`): lo único de la petición que se registra. */
  plantilla: string;
  /** Solo los parámetros de ruta que pasaron su regla. */
  parametros: Parametros;
  /** Un valor por parámetro de query declarado y presente. */
  consulta: Parametros;
}

export interface Ruta {
  /** La ruta como la escribe el OpenAPI (`/v1/estados/{cve_ent}`); es lo único que se registra. */
  plantilla: string;
  /**
   * Expresión anclada sobre `url.pathname` sin decodificar. Cada grupo con nombre es un
   * parámetro y necesita su regla en `parametros`; un grupo sin regla no llega al manejador.
   */
  patron: RegExp;
  parametros?: Readonly<Record<string, Regla>>;
  /** Parámetros de query permitidos, en el orden en que se revisan; cualquier otro es desconocido. */
  consulta?: Readonly<Record<string, ReglaConsulta>>;
  manejar: (contexto: Contexto) => Response | Promise<Response>;
}

export type Problema = { problema: TipoProblema; detalle: string; parametro?: string };

export type Resolucion = { ruta: Ruta; parametros: Parametros; consulta: Parametros } | Problema;

/** El problema del núcleo con la forma que responde `atender`: solo lleva `parametro`. */
function deNucleo({ tipo, detalle, extras }: ProblemaConsulta): Problema {
  const parametro = extras?.parametro;
  return typeof parametro === "string"
    ? { problema: tipo, detalle, parametro }
    : { problema: tipo, detalle };
}

function validar(ruta: Ruta, grupos: Readonly<Record<string, string>>, url: URL): Resolucion {
  const parametros: Record<string, string> = {};
  for (const [nombre, regla] of Object.entries(ruta.parametros ?? {})) {
    const valor = grupos[nombre];
    if (valor === undefined || !cumpleRegla(regla, valor)) {
      return { problema: "parametro-invalido", detalle: regla.detalle, parametro: nombre };
    }
    parametros[nombre] = valor;
  }
  // La query en el orden del núcleo: sin nombre, desconocidos y cada regla.
  const resultado = revisarConsulta(ruta.consulta ?? {}, url.search);
  return "consulta" in resultado
    ? { ruta, parametros, consulta: resultado.consulta }
    : deNucleo(resultado);
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
  sitio: "/",
  llms: "/llms.txt",
};

const indice = (): Response => respuestaJson(INDICE, { cache: CACHE_DATOS });

const {
  cve_ent: CVE_ENT,
  cvegeo: CVEGEO,
  codigo: CODIGO_BANCO,
  clabe: CLABE,
  anio: ANIO_RUTA,
} = REGLAS_RUTA;
const PERIODO_ISR = REGLAS_RUTA.periodo;

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

// `/` no está: es la página de inicio del sitio y la sirven los assets.
export const RUTAS: readonly Ruta[] = [
  { plantilla: "/v1", patron: /^\/v1$/, manejar: indice },
  {
    plantilla: "/v1/estados",
    patron: /^\/v1\/estados$/,
    manejar: fijo("/v1/estados.json", "la lista de estados"),
  },
  {
    plantilla: "/v1/estados/{cve_ent}",
    patron: /^\/v1\/estados\/(?<cve_ent>[^/]+)$/,
    parametros: { cve_ent: CVE_ENT },
    manejar: shard((p) => [`/v1/estados/${p.cve_ent}.json`, `el estado ${p.cve_ent}`]),
  },
  {
    plantilla: "/v1/estados/{cve_ent}/municipios",
    patron: /^\/v1\/estados\/(?<cve_ent>[^/]+)\/municipios$/,
    parametros: { cve_ent: CVE_ENT },
    manejar: shard((p) => [`/v1/estados/${p.cve_ent}/municipios.json`, `el estado ${p.cve_ent}`]),
  },
  {
    plantilla: "/v1/municipios",
    patron: /^\/v1\/municipios$/,
    manejar: fijo("/v1/municipios.json", "la lista de municipios"),
  },
  {
    plantilla: "/v1/municipios/{cvegeo}",
    patron: /^\/v1\/municipios\/(?<cvegeo>[^/]+)$/,
    parametros: { cvegeo: CVEGEO },
    manejar: shard((p) => [`/v1/municipios/${p.cvegeo}.json`, `el municipio ${p.cvegeo}`]),
  },
  {
    plantilla: "/v1/bancos",
    patron: /^\/v1\/bancos$/,
    manejar: fijo("/v1/bancos.json", "la lista de bancos"),
  },
  {
    plantilla: "/v1/bancos/{codigo}",
    patron: /^\/v1\/bancos\/(?<codigo>[^/]+)$/,
    parametros: { codigo: CODIGO_BANCO },
    manejar: shard((p) => [`/v1/bancos/${p.codigo}.json`, `el banco ${p.codigo}`]),
  },
  {
    plantilla: "/v1/clabe/{clabe}",
    patron: /^\/v1\/clabe\/(?<clabe>[^/]+)$/,
    parametros: { clabe: CLABE },
    manejar: clabe,
  },
  {
    plantilla: "/v1/dias-habiles",
    patron: /^\/v1\/dias-habiles$/,
    consulta: CONSULTAS["/v1/dias-habiles"],
    manejar: diasHabiles,
  },
  {
    plantilla: "/v1/dias-inhabiles",
    patron: /^\/v1\/dias-inhabiles$/,
    consulta: CONSULTAS["/v1/dias-inhabiles"],
    manejar: diasInhabiles,
  },
  {
    plantilla: "/v1/tipo-cambio/fix",
    patron: /^\/v1\/tipo-cambio\/fix$/,
    consulta: CONSULTAS["/v1/tipo-cambio/fix"],
    manejar: consultarFix,
  },
  {
    plantilla: "/v1/tipo-cambio/fix/ultimo",
    patron: /^\/v1\/tipo-cambio\/fix\/ultimo$/,
    manejar: ultimoFix,
  },
  {
    plantilla: "/v1/udis",
    patron: /^\/v1\/udis$/,
    consulta: CONSULTAS["/v1/udis"],
    manejar: consultarUdi,
  },
  {
    plantilla: "/v1/constantes/uma",
    patron: /^\/v1\/constantes\/uma$/,
    consulta: CONSULTAS["/v1/constantes/uma"],
    manejar: consultarUma,
  },
  {
    plantilla: "/v1/constantes/uma/{anio}",
    patron: /^\/v1\/constantes\/uma\/(?<anio>[^/]+)$/,
    parametros: { anio: ANIO_RUTA },
    manejar: shardConstante(() => ({ carpeta: "constantes/uma", nombre: "la UMA" })),
  },
  {
    plantilla: "/v1/constantes/salario-minimo/{anio}",
    patron: /^\/v1\/constantes\/salario-minimo\/(?<anio>[^/]+)$/,
    parametros: { anio: ANIO_RUTA },
    manejar: shardConstante(() => ({
      carpeta: "constantes/salario-minimo",
      nombre: "el salario mínimo",
    })),
  },
  {
    plantilla: "/v1/isr/tarifa/{periodo}/{anio}",
    patron: /^\/v1\/isr\/tarifa\/(?<periodo>[^/]+)\/(?<anio>[^/]+)$/,
    parametros: { periodo: PERIODO_ISR, anio: ANIO_RUTA },
    manejar: shardConstante((p) => ({
      carpeta: `isr/tarifa/${p.periodo}`,
      nombre: `la tarifa ${p.periodo} de ISR`,
    })),
  },
  { plantilla: "/v1/status", patron: /^\/v1\/status$/, manejar: status },
  {
    plantilla: "/v1/openapi.json",
    patron: /^\/v1\/openapi\.json$/,
    manejar: fijo("/v1/openapi.json", "el documento OpenAPI"),
  },
];
