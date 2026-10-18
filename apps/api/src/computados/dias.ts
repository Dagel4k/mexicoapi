import {
  CalendarioIncompletoError,
  calendarioLft,
  diasDescansoLft,
  FechaFueraDeRangoError,
  FUENTE_LFT_74,
  type ResultadoDiasHabiles,
  sumarDiasHabiles,
  VIGENCIA_LFT,
} from "@mexicoapi/core";
import { congelar, type Meta } from "../cargas.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

/** Los días de la LFT salen del núcleo, no de un dataset del build; su meta es fija. */
function metaLft(seccion: string): Meta {
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
    docs: `${URL_DOCS}/api/README.md#${seccion}`,
  });
}

const META_DIAS_HABILES = metaLft("dias-habiles");
const META_DIAS_INHABILES = metaLft("dias-inhabiles");

const CALENDARIO = calendarioLft();

const cubre = ({ cobertura }: CalendarioIncompletoError): string =>
  `cubre del ${cobertura.desde} al ${cobertura.hasta}`;

/** 422 con lo que trae el error: la autoridad, la fecha que falta y la cobertura. */
function calendarioIncompleto(
  c: Contexto,
  error: CalendarioIncompletoError,
  detalle: string,
): Response {
  const { autoridad, fecha, cobertura } = error;
  return respuestaProblema(
    "calendario-incompleto",
    detalle,
    { autoridad, fecha, cobertura: { desde: cobertura.desde, hasta: cobertura.hasta } },
    c.url.pathname,
  );
}

/** `GET /v1/dias-habiles`: la consulta ya pasó sus reglas (autoridad lft, fecha real, 1-3650). */
export function diasHabiles(c: Contexto): Response {
  let data: ResultadoDiasHabiles;
  try {
    data = sumarDiasHabiles({
      calendario: CALENDARIO,
      desde: requerido(c.consulta, "desde"),
      dias: Number(requerido(c.consulta, "dias")),
      permitirIncompleto: c.consulta.permitir_incompleto === "true",
    });
  } catch (error) {
    if (error instanceof CalendarioIncompletoError) {
      return calendarioIncompleto(
        c,
        error,
        `El calendario de ${error.autoridad} no cubre ${error.fecha}; ${cubre(error)}.`,
      );
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
  return respuestaJson({ data, meta: META_DIAS_HABILES }, { cache: CACHE_DATOS });
}

/** `GET /v1/dias-inhabiles`: días de descanso obligatorio del art. 74 en un año (0001-9999). */
export function diasInhabiles(c: Contexto): Response {
  const anio = requerido(c.consulta, "anio");
  const { autoridad, cobertura } = CALENDARIO;
  if (`${anio}-01-01` < cobertura.desde || `${anio}-12-31` > cobertura.hasta) {
    const error = new CalendarioIncompletoError(autoridad, `${anio}-01-01`, cobertura);
    return calendarioIncompleto(
      c,
      error,
      `El calendario de ${autoridad} no cubre el año ${anio}; ${cubre(error)}.`,
    );
  }
  return respuestaJson(
    { data: diasDescansoLft(Number(anio)), meta: META_DIAS_INHABILES },
    { cache: CACHE_DATOS },
  );
}
