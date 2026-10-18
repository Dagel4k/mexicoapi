import { esFechaIsoValida } from "@mexicoapi/core";
import { clabe } from "./computados/clabe.js";
import { consultarUma } from "./computados/constantes.js";
import { diasHabiles, diasInhabiles } from "./computados/dias.js";
import { consultarFix, consultarUdi, ultimoFix } from "./computados/indicadores.js";
import { status } from "./computados/status.js";
import type { Entorno, Opciones } from "./entorno.js";
import { servirShard } from "./estaticos.js";
import { type TipoProblema, URL_DOCS } from "./problemas.js";
import { CACHE_DATOS, respuestaJson } from "./respuestas.js";

export interface Regla {
  /** Expresión anclada (`^…$`) que debe cumplir el valor completo. */
  patron: RegExp;
  /** Lo que el patrón no puede decir (un máximo, una fecha que existe); se prueba después. */
  cumple?: (valor: string) => boolean;
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
  /** La ruta como la escribe el OpenAPI (`/v1/estados/{cve_ent}`); es lo único que se registra. */
  plantilla: string;
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

const cumpleRegla = (regla: Regla, valor: string): boolean =>
  regla.patron.test(valor) && (regla.cumple?.(valor) ?? true);

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
    if (!cumpleRegla(regla, valor)) return problema("parametro-invalido", regla.detalle, nombre);
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
    if (valor === undefined || !cumpleRegla(regla, valor)) {
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

const AUTORIDAD: ReglaConsulta = {
  patron: /^(?:lft|cnbv|sat)$/,
  detalle: "Autoridades disponibles: lft, cnbv y sat.",
  obligatorio: true,
};
// El manejador lo exige con sat y lo rechaza con las demás autoridades.
const TIPO_PLAZO: ReglaConsulta = {
  patron: /^(?:general|declaraciones_pagos)$/,
  detalle: "El tipo de plazo (tipo_plazo) debe ser general o declaraciones_pagos.",
};
/** Una fecha real con formato AAAA-MM-DD. */
const fecha = (detalle: string, obligatorio: boolean): ReglaConsulta => ({
  patron: /^\d{4}-\d{2}-\d{2}$/,
  cumple: esFechaIsoValida,
  detalle,
  obligatorio,
});

const DESDE = fecha(
  "La fecha de partida (desde) debe ser una fecha válida con formato AAAA-MM-DD.",
  true,
);
// El manejador exige exactamente uno de los dos.
const PUBLICADO = fecha(
  "La fecha de publicación (publicado) debe ser una fecha válida con formato AAAA-MM-DD.",
  false,
);
const OPERACION = fecha(
  "La fecha de la operación (operacion) debe ser una fecha válida con formato AAAA-MM-DD.",
  false,
);
const FECHA_UDI = fecha(
  "La fecha del valor (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
  true,
);
const DIAS: ReglaConsulta = {
  patron: /^[1-9]\d{0,3}$/,
  cumple: (valor) => Number(valor) <= 3650,
  detalle: "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
  obligatorio: true,
};
const PERMITIR_INCOMPLETO: ReglaConsulta = {
  patron: /^(?:true|false)$/,
  detalle: "El parámetro permitir_incompleto debe ser true o false.",
};
const ANIO_RUTA: Regla = {
  patron: /^\d{4}$/,
  // No hay año 0000: las fechas van de 0001 a 9999.
  cumple: (valor) => valor !== "0000",
  detalle: "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
};
const ANIO: ReglaConsulta = { ...ANIO_RUTA, obligatorio: true };
const PERIODO_ISR: Regla = {
  patron: /^(?:mensual|anual)$/,
  detalle: "El periodo de la tarifa debe ser mensual o anual.",
};
const FECHA_UMA = fecha(
  "La fecha que se consulta (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
  true,
);

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
  { plantilla: "/", patron: /^\/$/, manejar: indice },
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
    consulta: {
      autoridad: AUTORIDAD,
      tipo_plazo: TIPO_PLAZO,
      desde: DESDE,
      dias: DIAS,
      permitir_incompleto: PERMITIR_INCOMPLETO,
    },
    manejar: diasHabiles,
  },
  {
    plantilla: "/v1/dias-inhabiles",
    patron: /^\/v1\/dias-inhabiles$/,
    consulta: { autoridad: AUTORIDAD, anio: ANIO },
    manejar: diasInhabiles,
  },
  {
    plantilla: "/v1/tipo-cambio/fix",
    patron: /^\/v1\/tipo-cambio\/fix$/,
    consulta: { publicado: PUBLICADO, operacion: OPERACION },
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
    consulta: { fecha: FECHA_UDI },
    manejar: consultarUdi,
  },
  {
    plantilla: "/v1/constantes/uma",
    patron: /^\/v1\/constantes\/uma$/,
    consulta: { fecha: FECHA_UMA },
    manejar: consultarUma,
  },
  {
    plantilla: "/v1/constantes/uma/{anio}",
    patron: /^\/v1\/constantes\/uma\/(?<anio>[^/]+)$/,
    parametros: { anio: ANIO_RUTA },
    manejar: shard((p) => [
      `/v1/constantes/uma/${p.anio}.json`,
      `la UMA de ${p.anio} en los datos cargados`,
    ]),
  },
  {
    plantilla: "/v1/constantes/salario-minimo/{anio}",
    patron: /^\/v1\/constantes\/salario-minimo\/(?<anio>[^/]+)$/,
    parametros: { anio: ANIO_RUTA },
    manejar: shard((p) => [
      `/v1/constantes/salario-minimo/${p.anio}.json`,
      `el salario mínimo de ${p.anio} en los datos cargados`,
    ]),
  },
  {
    plantilla: "/v1/isr/tarifa/{periodo}/{anio}",
    patron: /^\/v1\/isr\/tarifa\/(?<periodo>[^/]+)\/(?<anio>[^/]+)$/,
    parametros: { periodo: PERIODO_ISR, anio: ANIO_RUTA },
    manejar: shard((p) => [
      `/v1/isr/tarifa/${p.periodo}/${p.anio}.json`,
      `la tarifa ${p.periodo} de ISR de ${p.anio} en los datos cargados`,
    ]),
  },
  { plantilla: "/v1/status", patron: /^\/v1\/status$/, manejar: status },
  {
    plantilla: "/v1/openapi.json",
    patron: /^\/v1\/openapi\.json$/,
    manejar: fijo("/v1/openapi.json", "el documento OpenAPI"),
  },
];
