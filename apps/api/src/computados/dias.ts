import {
  type Autoridad,
  type AutoridadCurada,
  type Calendario,
  CalendarioIncompletoError,
  calendarioLft,
  type DiaInhabil,
  diasDescansoLft,
  FechaFueraDeRangoError,
  type FechaISO,
  FUENTE_LFT_74,
  type ResultadoDiasHabiles,
  sumarDias,
  sumarDiasHabiles,
  type TipoDiaCurado,
  type TipoPlazo,
  VIGENCIA_LFT,
} from "@mexicoapi/core";
import {
  type CalendarioCurado,
  calendarioCurado,
  congelar,
  type Meta,
  metaInterna,
  type PlazoCurado,
} from "../cargas.js";
import type { Entorno } from "../entorno.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

const DOCS_HABILES = `${URL_DOCS}/api/README.md#dias-habiles`;
const DOCS_INHABILES = `${URL_DOCS}/api/README.md#dias-inhabiles`;

/** Los días de la LFT salen del núcleo, no de un dataset del build; su meta es fija. */
function metaLft(docs: string): Meta {
  return congelar({
    dataset: "dias-inhabiles.lft",
    as_of: VIGENCIA_LFT,
    sources: [
      {
        name: "Ley Federal del Trabajo, artículos 74 y 715",
        url: FUENTE_LFT_74.url,
        license:
          "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
        license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
        citation:
          "Ley Federal del Trabajo, artículos 74 y 715, texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
      },
    ],
    docs,
  });
}

const META_DIAS_HABILES = metaLft(DOCS_HABILES);
const META_DIAS_INHABILES = metaLft(DOCS_INHABILES);

const CALENDARIO = calendarioLft();

type Cobertura = { readonly desde: FechaISO; readonly hasta: FechaISO };

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

const cubre = ({ desde, hasta }: Cobertura): string => `cubre del ${desde} al ${hasta}`;
const dentro = (fecha: FechaISO, { desde, hasta }: Cobertura): boolean =>
  fecha >= desde && fecha <= hasta;

/** Cómo se nombra cada autoridad en los textos: "Calendario incompleto: SAT", "del SAT". */
const NOMBRE: Readonly<Record<Autoridad, string>> = { lft: "LFT", cnbv: "CNBV", sat: "SAT" };
const DE: Readonly<Record<Autoridad, string>> = {
  lft: "de la LFT",
  cnbv: "de la CNBV",
  sat: "del SAT",
};

const TIPOS_DIA: readonly TipoDiaCurado[] = ["descanso", "vacaciones"];

/**
 * Los tipos de día que cuenta `plazo` y que excluyen todos los plazos que cumplen `cubre`: los
 * que pueden faltar donde solo esos plazos están completos.
 */
function faltan(
  calendario: CalendarioCurado,
  plazo: PlazoCurado,
  cubre: (p: PlazoCurado) => boolean,
): TipoDiaCurado[] {
  const cubren = [...calendario.plazos.values()].filter(cubre);
  return TIPOS_DIA.filter(
    (t) => !plazo.excluirTipos.includes(t) && cubren.every((p) => p.excluirTipos.includes(t)),
  );
}

/** 422 con la autoridad, la fecha que falta y la cobertura. */
function calendarioIncompleto(
  c: Contexto,
  { autoridad, fecha, cobertura }: CalendarioIncompletoError,
  detalle: string,
): Response {
  return respuestaProblema(
    "calendario-incompleto",
    detalle,
    { autoridad, fecha, cobertura: { desde: cobertura.desde, hasta: cobertura.hasta } },
    c.url.pathname,
  );
}

type Detalle = (error: CalendarioIncompletoError) => string;

const detalleSimple: Detalle = ({ autoridad, fecha, cobertura }) =>
  `El calendario ${DE[autoridad]} no cubre ${fecha}; ${cubre(cobertura)}.`;

/**
 * El 422 de un plazo curado. Si otro plazo sí cubre la fecha, dice por qué este no (qué tipos de
 * día faltan) y hasta dónde llega el otro: con el SAT 2026, general termina el 30 de noviembre
 * porque falta el segundo periodo de vacaciones, y declaraciones_pagos llega al 31 de diciembre.
 */
function detalleCurado(calendario: CalendarioCurado, tipo: TipoPlazo, plazo: PlazoCurado): Detalle {
  return ({ fecha, cobertura }) => {
    const cual = calendario.plazos.size > 1 ? ` para tipo_plazo=${tipo}` : "";
    const base = `El calendario ${DE[calendario.autoridad]}${cual} no cubre ${fecha}; ${cubre(cobertura)}`;
    const otros = [...calendario.plazos].filter(([, p]) => dentro(fecha, p.cobertura));
    const tipos = faltan(calendario, plazo, (p) => dentro(fecha, p.cobertura));
    if (otros.length === 0 || tipos.length === 0) return `${base}.`;
    const lado = fecha > cobertura.hasta ? "posteriores" : "anteriores";
    return [
      `${base} porque los días de tipo ${tipos.join(" y ")} ${lado} no están publicados o no se han cargado.`,
      ...otros.map(([t, p]) => `Con tipo_plazo=${t}, que no los cuenta, ${cubre(p.cobertura)}.`),
    ].join(" ");
  };
}

/**
 * Suma con la consulta, que ya pasó sus reglas (fecha real, 1-3650). Devuelve el resultado o la
 * respuesta de error que le toca a la consulta.
 */
function sumar(
  c: Contexto,
  calendario: Calendario,
  detalle: Detalle,
): ResultadoDiasHabiles | Response {
  try {
    return sumarDiasHabiles({
      calendario,
      desde: requerido(c.consulta, "desde"),
      dias: Number(requerido(c.consulta, "dias")),
      permitirIncompleto: c.consulta.permitir_incompleto === "true",
    });
  } catch (error) {
    if (error instanceof CalendarioIncompletoError) {
      return calendarioIncompleto(c, error, detalle(error));
    }
    // Solo el resultado fuera de 0001-9999 es culpa de la consulta; cualquier otro error es 500.
    if (error instanceof FechaFueraDeRangoError) {
      return respuestaProblema(
        "parametro-invalido",
        "Con estos días, el resultado pasaría del año 9999.",
        { parametro: "desde" },
        c.url.pathname,
      );
    }
    throw error;
  }
}

const responderSuma = (resultado: ResultadoDiasHabiles | Response, meta: Meta): Response =>
  resultado instanceof Response
    ? resultado
    : respuestaJson({ data: resultado, meta }, { cache: CACHE_DATOS });

const mayor = (a: FechaISO, b: FechaISO): FechaISO => (a > b ? a : b);
const menor = (a: FechaISO, b: FechaISO): FechaISO => (a < b ? a : b);

/**
 * El primer día contado (de `desde` + 1 a `resultado`) que cae en la cobertura amplia pero fuera
 * de la del plazo, o undefined si el cálculo no pasó por ahí.
 */
function primerDiaFueraDelPlazo(
  { desde, resultado }: ResultadoDiasHabiles,
  plazo: Cobertura,
  amplia: Cobertura,
): FechaISO | undefined {
  const inicio = mayor(sumarDias(desde, 1), amplia.desde);
  const fin = menor(resultado, amplia.hasta);
  if (inicio > fin) return undefined;
  if (!dentro(inicio, plazo)) return inicio;
  return fin > plazo.hasta ? sumarDias(plazo.hasta, 1) : undefined;
}

/**
 * Con `permitir_incompleto=true`, un plazo más corto que la cobertura amplia calcula con su
 * respaldo: fuera de su cobertura descuenta los días publicados (el 25 de diciembre del SAT) y
 * no solo los fines de semana, para que el resultado sea un día hábil según lo que se conoce. Si
 * el cálculo pasa por ahí, lo advierte; después de la cobertura amplia sigue la advertencia del
 * núcleo.
 */
function sumarConRespaldo(
  c: Contexto,
  calendario: CalendarioCurado,
  tipo: TipoPlazo,
  plazo: PlazoCurado,
  respaldo: Calendario,
): ResultadoDiasHabiles | Response {
  const resultado = sumar(c, respaldo, detalleCurado(calendario, tipo, plazo));
  if (resultado instanceof Response) return resultado;
  const fuera = primerDiaFueraDelPlazo(resultado, plazo.cobertura, calendario.amplia);
  if (fuera === undefined) return resultado;
  const tipos = faltan(calendario, plazo, (p) => dentro(fuera, p.cobertura));
  if (tipos.length === 0) return resultado;
  const aviso = `Calendario incompleto: ${NOMBRE[calendario.autoridad]} con tipo_plazo=${tipo} ${cubre(plazo.cobertura)}; fuera de ese rango pueden faltar días de tipo ${tipos.join(" y ")}, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.`;
  return { ...resultado, advertencias: [aviso, ...resultado.advertencias] };
}

async function diasHabilesCurados(
  c: Contexto,
  autoridad: AutoridadCurada,
  tipo: TipoPlazo,
): Promise<Response> {
  const [meta, calendario] = await cargarCurado(c, autoridad, DOCS_HABILES);
  const plazo = calendario.plazos.get(tipo);
  if (plazo === undefined) {
    throw new Error(`El calendario de ${autoridad} no tiene el tipo de plazo ${tipo}.`);
  }
  const { respaldo } = plazo;
  const resultado =
    c.consulta.permitir_incompleto === "true" && respaldo !== undefined
      ? sumarConRespaldo(c, calendario, tipo, plazo, respaldo)
      : sumar(c, plazo.calendario, detalleCurado(calendario, tipo, plazo));
  return responderSuma(resultado, meta);
}

/**
 * `GET /v1/dias-habiles`: la consulta ya pasó sus reglas. Con `sat`, `tipo_plazo` es
 * obligatorio porque las vacaciones del SAT no son inhábiles en los plazos de declaraciones y
 * pagos (CFF art. 12, segundo párrafo); las demás autoridades no lo aceptan.
 */
export function diasHabiles(c: Contexto): Response | Promise<Response> {
  // La regla de la ruta solo deja pasar lft, cnbv y sat.
  const autoridad = requerido(c.consulta, "autoridad") as Autoridad;
  const tipo = c.consulta.tipo_plazo as TipoPlazo | undefined;
  if (autoridad === "sat" && tipo === undefined) {
    return respuestaProblema(
      "parametro-faltante",
      "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
      { parametro: "tipo_plazo" },
      c.url.pathname,
    );
  }
  if (autoridad !== "sat" && tipo !== undefined) {
    return respuestaProblema(
      "parametro-invalido",
      "El parámetro tipo_plazo solo se acepta con autoridad=sat.",
      { parametro: "tipo_plazo" },
      c.url.pathname,
    );
  }
  if (autoridad === "lft") {
    return responderSuma(sumar(c, CALENDARIO, detalleSimple), META_DIAS_HABILES);
  }
  return diasHabilesCurados(c, autoridad, tipo ?? "general");
}

const cubreAnio = (anio: string, { desde, hasta }: Cobertura): boolean =>
  `${anio}-01-01` >= desde && `${anio}-12-31` <= hasta;

/** 422 de un año que la cobertura no alcanza, con el primer día del año que no cubre. */
function anioIncompleto(c: Contexto, autoridad: Autoridad, anio: string, cobertura: Cobertura) {
  const inicio = `${anio}-01-01`;
  // Si el año empieza dentro de la cobertura, lo que falta es lo que sigue a su fin.
  const fecha =
    inicio < cobertura.desde || inicio > cobertura.hasta ? inicio : sumarDias(cobertura.hasta, 1);
  const error = new CalendarioIncompletoError(autoridad, fecha, cobertura);
  return calendarioIncompleto(
    c,
    error,
    `El calendario ${DE[autoridad]} no cubre el año ${anio}; ${cubre(cobertura)}.`,
  );
}

/** `{ data, advertencias, meta }`: la lista puede estar completa solo para algunos plazos. */
const respuestaInhabiles = (data: readonly DiaInhabil[], advertencias: string[], meta: Meta) =>
  respuestaJson({ data, advertencias, meta }, { cache: CACHE_DATOS });

/**
 * Qué puede faltar en la lista de `anio` cuando el plazo general no cubre todo el año. Un tipo de
 * día está completo en el año si lo cuenta algún plazo que lo cubre; los que todos esos plazos
 * excluyen solo están completos en la cobertura de general.
 */
function advertencias(calendario: CalendarioCurado, anio: string): string[] {
  const { autoridad, general, plazos } = calendario;
  if (cubreAnio(anio, general.cobertura)) return [];
  const tipos = faltan(calendario, general, (p) => cubreAnio(anio, p.cobertura));
  if (tipos.length === 0) return [];
  const { desde, hasta } = general.cobertura;
  const completas = [...plazos]
    .filter(([, p]) => cubreAnio(anio, p.cobertura))
    .map(
      ([tipo]) => `Para tipo_plazo=${tipo}, que no los cuenta, la lista de ${anio} está completa.`,
    );
  return [
    [
      `Los días de tipo ${tipos.join(" y ")} ${DE[autoridad]} solo están completos del ${desde} al ${hasta}; fuera de ese rango pueden faltar.`,
      ...completas,
    ].join(" "),
  ];
}

/**
 * Un año de un calendario curado. Se responde si un plazo lo cubre completo (la cobertura más
 * amplia); si el plazo general no lo cubre, la lista lleva advertencias con lo que puede faltar.
 * Así el SAT 2026 lista lo publicado aunque falte su segundo periodo de vacaciones.
 */
async function diasInhabilesCurados(
  c: Contexto,
  autoridad: AutoridadCurada,
  anio: string,
): Promise<Response> {
  const [meta, calendario] = await cargarCurado(c, autoridad, DOCS_INHABILES);
  if (!cubreAnio(anio, calendario.amplia)) {
    return anioIncompleto(c, autoridad, anio, calendario.amplia);
  }
  const data = calendario.dias.filter((d) => d.fecha.startsWith(`${anio}-`));
  return respuestaInhabiles(data, advertencias(calendario, anio), meta);
}

/**
 * `GET /v1/dias-inhabiles`: los días inhábiles de un año (0001-9999), sin fines de semana. Los de
 * la LFT salen del art. 74; los de la CNBV y el SAT, de sus publicaciones en el DOF.
 */
export function diasInhabiles(c: Contexto): Response | Promise<Response> {
  const anio = requerido(c.consulta, "anio");
  const autoridad = requerido(c.consulta, "autoridad") as Autoridad;
  if (autoridad !== "lft") return diasInhabilesCurados(c, autoridad, anio);
  const { cobertura } = CALENDARIO;
  if (!cubreAnio(anio, cobertura)) return anioIncompleto(c, autoridad, anio, cobertura);
  // La LFT se calcula por regla: la lista del año siempre está completa.
  return respuestaInhabiles(diasDescansoLft(Number(anio)), [], META_DIAS_INHABILES);
}
