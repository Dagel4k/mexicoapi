// Días hábiles e inhábiles desde el paquete, con las reglas y los textos de los calendarios
// curados del núcleo, los mismos que usa la API: la LFT por regla y la CNBV y el SAT con los
// calendarios de `mexicoapi/datos/calendarios`, con sus tipos de plazo, coberturas y respaldo.
// Aquí solo quedan las reglas de la ruta; la integración contra el Worker compara las respuestas.
import type {
  Autoridad,
  AutoridadCurada,
  CalendarioIncompletoError,
  TipoPlazo,
} from "@mexicoapi/core";
import { diasInhabilesCurados, exigirAnio, sumarDiasHabilesCurado } from "@mexicoapi/core/curados";
import type { MetaDatos } from "../datos/tipos.js";
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

/**
 * Lo que da `calcular`, o el problema de la consulta que lanza: el 422 con la autoridad, la fecha
 * que falta, la cobertura y el texto del núcleo si el calendario no la cubre, y el 400 si el
 * resultado pasaría del año 9999. Cualquier otro error sigue tal cual.
 */
function conCalendario<T>(c: Contexto, calcular: () => T): T {
  try {
    return calcular();
  } catch (error) {
    // Los errores del núcleo traen `codigo` para reconocerlos sin instanceof.
    const codigo = (error as { codigo?: unknown }).codigo;
    if (codigo === "calendario-incompleto") {
      const { autoridad, fecha, cobertura, detalle } = error as CalendarioIncompletoError;
      throw falla(c, "calendario-incompleto", detalle, {
        autoridad,
        fecha,
        cobertura: { desde: cobertura.desde, hasta: cobertura.hasta },
      });
    }
    if (codigo === "fecha-fuera-de-rango") {
      const texto = "Con estos días, el resultado pasaría del año 9999.";
      throw falla(c, "parametro-invalido", texto, { parametro: "desde" });
    }
    throw error;
  }
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
    const desde = valor(c, "desde");
    const dias = Number(valor(c, "dias"));
    const permitirIncompleto = c.valores.permitir_incompleto === "true";
    if (autoridad === "lft") {
      const calendario = n.calendarioLft();
      return {
        data: conCalendario(c, () =>
          n.sumarDiasHabiles({ calendario, desde, dias, permitirIncompleto }),
        ),
        meta: metaLft(n, "dias-habiles"),
      };
    }
    const curado = (await calendarios()).calendarioCurado(autoridad);
    const tipoPlazo = tipo ?? "general";
    return {
      data: conCalendario(c, () =>
        sumarDiasHabilesCurado(curado, { tipoPlazo, desde, dias, permitirIncompleto }),
      ),
      meta: conDocs(curado.meta, "dias-habiles"),
    };
  },
};

export const DIAS_INHABILES: RutaPaquete = {
  consulta: [
    ["autoridad", true],
    ["anio", true],
  ],
  responder: async (c, n): Promise<Dato> => {
    const anio = Number(valor(c, "anio"));
    const autoridad = valor(c, "autoridad") as Autoridad;
    if (autoridad === "lft") {
      conCalendario(c, () => exigirAnio(autoridad, anio, n.COBERTURA_LFT));
      // La LFT se calcula por regla: la lista del año siempre está completa.
      return {
        data: n.diasDescansoLft(anio),
        meta: metaLft(n, "dias-inhabiles"),
        advertencias: [],
      };
    }
    const curado = (await calendarios()).calendarioCurado(autoridad as AutoridadCurada);
    const { dias, advertencias } = conCalendario(c, () => diasInhabilesCurados(curado, anio));
    return { data: dias, meta: conDocs(curado.meta, "dias-inhabiles"), advertencias };
  },
};
