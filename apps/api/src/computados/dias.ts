import {
  CalendarioIncompletoError,
  COBERTURA_LFT,
  calendarioLft,
  diasDescansoLft,
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
const META_LFT: Meta = congelar({
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
  docs: `${URL_DOCS}/api/README.md#dias-habiles`,
});

const CALENDARIO = calendarioLft();

const COBERTURA = `cubre del ${COBERTURA_LFT.desde} al ${COBERTURA_LFT.hasta}`;

function calendarioIncompleto(c: Contexto, detalle: string, fecha: string): Response {
  const { desde, hasta } = COBERTURA_LFT;
  return respuestaProblema(
    "calendario-incompleto",
    detalle,
    { autoridad: "lft", fecha, cobertura: { desde, hasta } },
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
        `El calendario de ${error.autoridad} no cubre ${error.fecha}; ${COBERTURA}.`,
        error.fecha,
      );
    }
    // Con desde y dias ya validados, el núcleo solo lanza RangeError si el resultado pasa de
    // 9999-12-31.
    if (error instanceof RangeError) {
      return respuestaProblema(
        "parametro-invalido",
        "Con estos días, el resultado pasaría del año 9999.",
        { parametro: "desde" },
        c.url.pathname,
      );
    }
    throw error;
  }
  return respuestaJson({ data, meta: META_LFT }, { cache: CACHE_DATOS });
}

/** `GET /v1/dias-inhabiles`: días de descanso obligatorio del art. 74 en un año. */
export function diasInhabiles(c: Contexto): Response {
  const anio = requerido(c.consulta, "anio");
  if (`${anio}-01-01` < COBERTURA_LFT.desde || `${anio}-12-31` > COBERTURA_LFT.hasta) {
    return calendarioIncompleto(
      c,
      `El calendario de lft no cubre el año ${anio}; ${COBERTURA}.`,
      `${anio}-01-01`,
    );
  }
  return respuestaJson(
    { data: diasDescansoLft(Number(anio)), meta: META_LFT },
    { cache: CACHE_DATOS },
  );
}
