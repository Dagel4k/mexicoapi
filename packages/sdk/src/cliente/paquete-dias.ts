// Días hábiles e inhábiles desde el paquete, con las reglas y los textos del Worker
// (apps/api/src/computados/dias.ts): la LFT por regla del núcleo y la CNBV y el SAT con los
// calendarios de `mexicoapi/datos/calendarios`, con sus tipos de plazo, coberturas y respaldo. La
// integración contra el Worker compara las dos respuestas.
import type {
  Autoridad,
  AutoridadCurada,
  Calendario,
  CoberturaSerie,
  FechaISO,
  ResultadoDiasHabiles,
  TipoDiaCurado,
  TipoPlazo,
} from "@mexicoapi/core";
import type { CalendarioCurado, PlazoCurado } from "../datos/calendarios.js";
import type { MetaDatos } from "../datos/tipos.js";
import type { MexicoApiError } from "./error.js";
import {
  type Contexto,
  conDocs,
  type Dato,
  DOCS,
  falla,
  type Nucleo,
  type RutaPaquete,
  valor,
} from "./paquete-comun.js";

const calendarios = () => import("../datos/calendarios.js");

/** Los días de la LFT salen del núcleo; su `meta` es el que da la API. */
const metaLft = (n: Nucleo, seccion: string): MetaDatos => ({
  dataset: "dias-inhabiles.lft",
  as_of: n.VIGENCIA_LFT,
  sources: [
    {
      name: "Ley Federal del Trabajo, artículos 74 y 715",
      url: n.FUENTE_LFT_74.url,
      license:
        "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
      license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      citation:
        "Ley Federal del Trabajo, artículos 74 y 715, texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
    },
  ],
  docs: `${DOCS}/api/README.md#${seccion}`,
});

/** Cómo se nombra cada autoridad en los textos: "Calendario incompleto: SAT", "del SAT". */
const NOMBRE: Readonly<Record<Autoridad, string>> = { lft: "LFT", cnbv: "CNBV", sat: "SAT" };
const DE: Readonly<Record<Autoridad, string>> = {
  lft: "de la LFT",
  cnbv: "de la CNBV",
  sat: "del SAT",
};

const TIPOS_DIA: readonly TipoDiaCurado[] = ["descanso", "vacaciones"];

const cubre = ({ desde, hasta }: CoberturaSerie): string => `cubre del ${desde} al ${hasta}`;
const dentro = (fecha: FechaISO, { desde, hasta }: CoberturaSerie): boolean =>
  fecha >= desde && fecha <= hasta;
const cubreAnio = (anio: string, { desde, hasta }: CoberturaSerie): boolean =>
  `${anio}-01-01` >= desde && `${anio}-12-31` <= hasta;
const plazosDe = (calendario: CalendarioCurado) =>
  Object.entries(calendario.plazos) as [TipoPlazo, PlazoCurado][];

/**
 * Los tipos de día que cuenta `plazo` y que excluyen todos los plazos que cumplen `cubren`: los
 * que pueden faltar donde solo esos plazos están completos.
 */
function faltan(
  calendario: CalendarioCurado,
  plazo: PlazoCurado,
  cubren: (p: PlazoCurado) => boolean,
): TipoDiaCurado[] {
  const otros = plazosDe(calendario)
    .map(([, p]) => p)
    .filter(cubren);
  return TIPOS_DIA.filter(
    (t) => !plazo.excluirTipos.includes(t) && otros.every((p) => p.excluirTipos.includes(t)),
  );
}

interface Incompleto {
  autoridad: Autoridad;
  fecha: FechaISO;
  cobertura: CoberturaSerie;
}

/** 422 con la autoridad, la fecha que falta y la cobertura. */
const calendarioIncompleto = (
  c: Contexto,
  { autoridad, fecha, cobertura }: Incompleto,
  detalle: string,
): MexicoApiError =>
  falla(c, "calendario-incompleto", detalle, {
    autoridad,
    fecha,
    cobertura: { desde: cobertura.desde, hasta: cobertura.hasta },
  });

type Detalle = (error: Incompleto) => string;

const detalleSimple: Detalle = ({ autoridad, fecha, cobertura }) =>
  `El calendario ${DE[autoridad]} no cubre ${fecha}; ${cubre(cobertura)}.`;

/** El 422 de un plazo curado: si otro plazo cubre la fecha, dice por qué este no. */
function detalleCurado(calendario: CalendarioCurado, tipo: TipoPlazo, plazo: PlazoCurado): Detalle {
  return ({ fecha, cobertura }) => {
    const plazos = plazosDe(calendario);
    const cual = plazos.length > 1 ? ` para tipo_plazo=${tipo}` : "";
    const base = `El calendario ${DE[calendario.autoridad]}${cual} no cubre ${fecha}; ${cubre(cobertura)}`;
    const otros = plazos.filter(([, p]) => dentro(fecha, p.cobertura));
    const tipos = faltan(calendario, plazo, (p) => dentro(fecha, p.cobertura));
    if (otros.length === 0 || tipos.length === 0) return `${base}.`;
    const lado = fecha > cobertura.hasta ? "posteriores" : "anteriores";
    return [
      `${base} porque los días de tipo ${tipos.join(" y ")} ${lado} no están publicados o no se han cargado.`,
      ...otros.map(([t, p]) => `Con tipo_plazo=${t}, que no los cuenta, ${cubre(p.cobertura)}.`),
    ].join(" ");
  };
}

/** Suma con la consulta, que ya pasó sus reglas; un problema de la consulta se lanza. */
function sumar(c: Contexto, n: Nucleo, calendario: Calendario, detalle: Detalle) {
  try {
    return n.sumarDiasHabiles({
      calendario,
      desde: valor(c, "desde"),
      dias: Number(valor(c, "dias")),
      permitirIncompleto: c.valores.permitir_incompleto === "true",
    });
  } catch (error) {
    // Los errores del núcleo traen `codigo` para reconocerlos sin instanceof.
    const codigo = (error as { codigo?: unknown }).codigo;
    if (codigo === "calendario-incompleto") {
      throw calendarioIncompleto(c, error as Incompleto, detalle(error as Incompleto));
    }
    if (codigo === "fecha-fuera-de-rango") {
      const texto = "Con estos días, el resultado pasaría del año 9999.";
      throw falla(c, "parametro-invalido", texto, { parametro: "desde" });
    }
    throw error;
  }
}

const mayor = (a: FechaISO, b: FechaISO): FechaISO => (a > b ? a : b);
const menor = (a: FechaISO, b: FechaISO): FechaISO => (a < b ? a : b);

/** El primer día contado que cae en la cobertura amplia pero fuera de la del plazo. */
function primerDiaFueraDelPlazo(
  n: Nucleo,
  { desde, resultado }: ResultadoDiasHabiles,
  plazo: CoberturaSerie,
  amplia: CoberturaSerie,
): FechaISO | undefined {
  const inicio = mayor(n.sumarDias(desde, 1), amplia.desde);
  const fin = menor(resultado, amplia.hasta);
  if (inicio > fin) return undefined;
  if (!dentro(inicio, plazo)) return inicio;
  return fin > plazo.hasta ? n.sumarDias(plazo.hasta, 1) : undefined;
}

/**
 * Con `permitir_incompleto`, un plazo más corto que la cobertura amplia calcula con su respaldo:
 * fuera de su cobertura descuenta los días publicados y lo advierte si el cálculo pasa por ahí.
 */
function sumarConRespaldo(
  c: Contexto,
  n: Nucleo,
  calendario: CalendarioCurado,
  tipo: TipoPlazo,
  plazo: PlazoCurado,
  respaldo: Calendario,
): ResultadoDiasHabiles {
  const resultado = sumar(c, n, respaldo, detalleCurado(calendario, tipo, plazo));
  const fuera = primerDiaFueraDelPlazo(n, resultado, plazo.cobertura, calendario.amplia);
  if (fuera === undefined) return resultado;
  const tipos = faltan(calendario, plazo, (p) => dentro(fuera, p.cobertura));
  if (tipos.length === 0) return resultado;
  const aviso = `Calendario incompleto: ${NOMBRE[calendario.autoridad]} con tipo_plazo=${tipo} ${cubre(plazo.cobertura)}; fuera de ese rango pueden faltar días de tipo ${tipos.join(" y ")}, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.`;
  return { ...resultado, advertencias: [aviso, ...resultado.advertencias] };
}

export const DIAS_HABILES: RutaPaquete = {
  consulta: [
    ["autoridad", true],
    ["tipo_plazo", false],
    ["desde", true],
    ["dias", true],
    ["permitir_incompleto", false],
  ],
  responder: async (c, n): Promise<Dato> => {
    // La regla de la consulta solo deja pasar lft, cnbv y sat.
    const autoridad = valor(c, "autoridad") as Autoridad;
    const tipo = c.valores.tipo_plazo as TipoPlazo | undefined;
    if (autoridad === "sat" && tipo === undefined) {
      const detalle =
        "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.";
      throw falla(c, "parametro-faltante", detalle, { parametro: "tipo_plazo" });
    }
    if (autoridad !== "sat" && tipo !== undefined) {
      const detalle = "El parámetro tipo_plazo solo se acepta con autoridad=sat.";
      throw falla(c, "parametro-invalido", detalle, { parametro: "tipo_plazo" });
    }
    if (autoridad === "lft") {
      return {
        data: sumar(c, n, n.calendarioLft(), detalleSimple),
        meta: metaLft(n, "dias-habiles"),
      };
    }
    const calendario = (await calendarios()).calendarioCurado(autoridad);
    const tipoPlazo = tipo ?? "general";
    // Las tablas de plazos del paquete y de la API son las mismas.
    const plazo = calendario.plazos[tipoPlazo] as PlazoCurado;
    const data =
      c.valores.permitir_incompleto === "true" && plazo.respaldo !== undefined
        ? sumarConRespaldo(c, n, calendario, tipoPlazo, plazo, plazo.respaldo)
        : sumar(c, n, plazo.calendario, detalleCurado(calendario, tipoPlazo, plazo));
    return { data, meta: conDocs(calendario.meta, "dias-habiles") };
  },
};

/** 422 de un año que la cobertura no alcanza, con el primer día del año que no cubre. */
function anioIncompleto(
  c: Contexto,
  n: Nucleo,
  autoridad: Autoridad,
  anio: string,
  cobertura: CoberturaSerie,
): MexicoApiError {
  const inicio = `${anio}-01-01`;
  // Si el año empieza dentro de la cobertura, lo que falta es lo que sigue a su fin.
  const fecha =
    inicio < cobertura.desde || inicio > cobertura.hasta ? inicio : n.sumarDias(cobertura.hasta, 1);
  return calendarioIncompleto(
    c,
    { autoridad, fecha, cobertura },
    `El calendario ${DE[autoridad]} no cubre el año ${anio}; ${cubre(cobertura)}.`,
  );
}

/** Qué puede faltar en la lista de `anio` cuando el plazo general no cubre todo el año. */
function advertencias(calendario: CalendarioCurado, anio: string): string[] {
  const { autoridad, general } = calendario;
  if (cubreAnio(anio, general.cobertura)) return [];
  const tipos = faltan(calendario, general, (p) => cubreAnio(anio, p.cobertura));
  if (tipos.length === 0) return [];
  const { desde, hasta } = general.cobertura;
  const completas = plazosDe(calendario)
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

export const DIAS_INHABILES: RutaPaquete = {
  consulta: [
    ["autoridad", true],
    ["anio", true],
  ],
  responder: async (c, n): Promise<Dato> => {
    const anio = valor(c, "anio");
    const autoridad = valor(c, "autoridad") as Autoridad;
    if (autoridad === "lft") {
      const cobertura = n.COBERTURA_LFT;
      if (!cubreAnio(anio, cobertura)) throw anioIncompleto(c, n, autoridad, anio, cobertura);
      // La LFT se calcula por regla: la lista del año siempre está completa.
      return {
        data: n.diasDescansoLft(Number(anio)),
        meta: metaLft(n, "dias-inhabiles"),
        advertencias: [],
      };
    }
    const calendario = (await calendarios()).calendarioCurado(autoridad as AutoridadCurada);
    if (!cubreAnio(anio, calendario.amplia)) {
      throw anioIncompleto(c, n, autoridad, anio, calendario.amplia);
    }
    return {
      data: calendario.dias.filter((d) => d.fecha.startsWith(`${anio}-`)),
      meta: conDocs(calendario.meta, "dias-inhabiles"),
      advertencias: advertencias(calendario, anio),
    };
  },
};
