import {
  type Autoridad,
  type AutoridadCurada,
  calendarioLft,
  sumarDiasHabiles,
  type TipoPlazo,
} from "@mexicoapi/core";
import { avisosDe } from "@mexicoapi/core/avisos";
import {
  type CalendarioCurado,
  type ConsultaDiasHabilesCurado,
  diasInhabilesCurados,
  sumarDiasHabilesCurado,
} from "@mexicoapi/core/curados";
import {
  diasInhabilesLft,
  metaLft,
  problemaDeError,
  revisarTipoPlazo,
} from "@mexicoapi/core/rutas";
import { calendarioCurado, feriadosDeLaCnbv, type Meta, metaInterna } from "../cargas.js";
import type { Entorno } from "../entorno.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, respuestaDe, respuestaJson } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

const DOCS_HABILES = `${URL_DOCS}/api/README.md#dias-habiles`;
const DOCS_INHABILES = `${URL_DOCS}/api/README.md#dias-inhabiles`;

const CALENDARIO = calendarioLft();

/**
 * La meta del calendario curado de `autoridad` (sus publicaciones en el DOF) con el enlace a la
 * sección de la API.
 */
async function metaCurada(entorno: Entorno, autoridad: AutoridadCurada, docs: string) {
  const curado = (await metaInterna(entorno)).curados?.[`dias-inhabiles.${autoridad}`];
  if (curado === undefined) {
    throw new Error(`El meta interno no tiene el calendario dias-inhabiles.${autoridad}.`);
  }
  return { ...curado.meta, docs };
}

/** El calendario curado y su meta; los dos se leen una vez por isolate. */
async function cargarCurado(
  c: Contexto,
  autoridad: AutoridadCurada,
  docs: string,
): Promise<[Meta, CalendarioCurado]> {
  return Promise.all([
    metaCurada(c.entorno, autoridad, docs),
    calendarioCurado(c.entorno, autoridad),
  ]);
}

/**
 * La respuesta de `responder`, o el problema del núcleo para el error de la consulta: 422 si el
 * calendario no la cubre y 400 si el resultado pasaría del año 9999. Cualquier otro error es 500.
 */
function conCalendario(c: Contexto, responder: () => Response): Response {
  try {
    return responder();
  } catch (error) {
    const problema = problemaDeError(error);
    if (problema === null) throw error;
    return respuestaDe(problema, c.url.pathname);
  }
}

const respuestaDatos = (data: unknown, meta: Meta): Response =>
  respuestaJson({ data, meta }, { cache: CACHE_DATOS });

const AVISO_SIN_CNBV =
  "mexicoapi: aviso: el calendario de la CNBV no cargó; la advertencia de la prórroga del art. 12 no revisa los cierres bancarios";

/**
 * Los feriados bancarios para la advertencia de la prórroga del art. 12 del CFF, que solo se da
 * con el SAT y `declaraciones_pagos`. Si el calendario de la CNBV no carga, esa parte no se
 * revisa y queda un aviso en el registro; la respuesta sigue, sin un 500.
 */
async function feriadosParaLaProrroga(
  c: Contexto,
  autoridad: AutoridadCurada,
  consulta: ConsultaDiasHabilesCurado,
): Promise<((fecha: string) => boolean) | undefined> {
  if (autoridad !== "sat" || consulta.tipoPlazo !== "declaraciones_pagos") return undefined;
  const feriados = await feriadosDeLaCnbv(c.entorno);
  if (feriados === undefined) console.warn(AVISO_SIN_CNBV);
  return feriados;
}

/**
 * Un calendario curado con el núcleo: cada tipo de plazo con su cobertura y, con
 * `permitir_incompleto=true`, su respaldo y sus advertencias. En el SAT con
 * `declaraciones_pagos`, también la de la prórroga del art. 12 (con los cierres bancarios).
 */
async function diasHabilesCurados(
  c: Contexto,
  autoridad: AutoridadCurada,
  consulta: ConsultaDiasHabilesCurado,
): Promise<Response> {
  const [[meta, calendario], feriadoBancario] = await Promise.all([
    cargarCurado(c, autoridad, DOCS_HABILES),
    feriadosParaLaProrroga(c, autoridad, consulta),
  ]);
  return conCalendario(c, () =>
    respuestaDatos(sumarDiasHabilesCurado(calendario, { ...consulta, feriadoBancario }), meta),
  );
}

/**
 * `GET /v1/dias-habiles`: la consulta ya pasó sus reglas (fecha real, 1-3650). Con `sat`,
 * `tipo_plazo` es obligatorio y las demás autoridades no lo aceptan (`revisarTipoPlazo`).
 */
export function diasHabiles(c: Contexto): Response | Promise<Response> {
  // La regla de la ruta solo deja pasar lft, cnbv y sat.
  const autoridad = requerido(c.consulta, "autoridad") as Autoridad;
  const tipo = c.consulta.tipo_plazo as TipoPlazo | undefined;
  const combinacion = revisarTipoPlazo(autoridad, tipo);
  if (combinacion !== null) return respuestaDe(combinacion, c.url.pathname);
  const desde = requerido(c.consulta, "desde");
  const dias = Number(requerido(c.consulta, "dias"));
  const permitirIncompleto = c.consulta.permitir_incompleto === "true";
  if (autoridad === "lft") {
    return conCalendario(c, () =>
      respuestaDatos(
        sumarDiasHabiles({ calendario: CALENDARIO, desde, dias, permitirIncompleto }),
        metaLft("dias-habiles"),
      ),
    );
  }
  const tipoPlazo = tipo ?? "general";
  return diasHabilesCurados(c, autoridad, { tipoPlazo, desde, dias, permitirIncompleto });
}

/**
 * `{ data, advertencias, avisos, meta }`: la lista puede estar completa solo para algunos plazos.
 * `avisos` son las mismas advertencias, en el mismo orden, con su código.
 */
const respuestaInhabiles = (data: unknown, advertencias: readonly string[], meta: Meta) =>
  respuestaJson(
    { data, advertencias, avisos: avisosDe(advertencias), meta },
    { cache: CACHE_DATOS },
  );

/**
 * Un año de un calendario curado con el núcleo: la lista si un plazo lo cubre completo y, si el
 * plazo general no lo cubre, las advertencias de lo que puede faltar.
 */
async function inhabilesCurados(
  c: Contexto,
  autoridad: AutoridadCurada,
  anio: number,
): Promise<Response> {
  const [meta, calendario] = await cargarCurado(c, autoridad, DOCS_INHABILES);
  return conCalendario(c, () => {
    const { dias, advertencias } = diasInhabilesCurados(calendario, anio);
    return respuestaInhabiles(dias, advertencias, meta);
  });
}

/**
 * `GET /v1/dias-inhabiles`: los días inhábiles de un año (0001-9999), sin fines de semana. Los de
 * la LFT salen del art. 74, con el aviso del art. 715; los de la CNBV y el SAT, de sus
 * publicaciones en el DOF.
 */
export function diasInhabiles(c: Contexto): Response | Promise<Response> {
  const anio = Number(requerido(c.consulta, "anio"));
  const autoridad = requerido(c.consulta, "autoridad") as Autoridad;
  if (autoridad !== "lft") return inhabilesCurados(c, autoridad, anio);
  return conCalendario(c, () => {
    const { dias, advertencias } = diasInhabilesLft(anio);
    return respuestaInhabiles(dias, advertencias, metaLft("dias-inhabiles"));
  });
}
