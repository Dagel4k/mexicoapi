// Días hábiles e inhábiles desde el paquete, con las reglas y los textos del núcleo, los mismos que
// usa la API: la LFT por regla y la CNBV y el SAT con los calendarios de
// `mexicoapi/datos/calendarios`, con sus tipos de plazo, coberturas y respaldo. La integración
// contra el Worker compara las respuestas.
import type { Autoridad, AutoridadCurada, TipoPlazo } from "@mexicoapi/core";
import { diasInhabilesCurados, sumarDiasHabilesCurado } from "@mexicoapi/core/curados";
import {
  diasInhabilesLft,
  metaLft,
  problemaDeError,
  revisarTipoPlazo,
} from "@mexicoapi/core/rutas";
import {
  type Contexto,
  conDocs,
  type Dato,
  fallaDe,
  type RutaPaquete,
  valor,
} from "./paquete-comun.js";

const calendarios = () => import("../datos/calendarios.js");

/**
 * Lo que da `calcular`, o el problema del núcleo para el error que lanza: el 422 si el calendario
 * no cubre la consulta y el 400 si el resultado pasaría del año 9999. Cualquier otro error sigue
 * tal cual.
 */
function conCalendario<T>(c: Contexto, calcular: () => T): T {
  try {
    return calcular();
  } catch (error) {
    const problema = problemaDeError(error);
    if (problema === null) throw error;
    throw fallaDe(c, problema);
  }
}

export const DIAS_HABILES: RutaPaquete = {
  responder: async (c, n): Promise<Dato> => {
    // La regla de la consulta solo deja pasar lft, cnbv y sat.
    const autoridad = valor(c, "autoridad") as Autoridad;
    const tipo = c.valores.tipo_plazo as TipoPlazo | undefined;
    const combinacion = revisarTipoPlazo(autoridad, tipo);
    if (combinacion !== null) throw fallaDe(c, combinacion);
    const desde = valor(c, "desde");
    const dias = Number(valor(c, "dias"));
    const permitirIncompleto = c.valores.permitir_incompleto === "true";
    if (autoridad === "lft") {
      const calendario = n.calendarioLft();
      return {
        data: conCalendario(c, () =>
          n.sumarDiasHabiles({ calendario, desde, dias, permitirIncompleto }),
        ),
        meta: metaLft("dias-habiles"),
      };
    }
    const cal = await calendarios();
    const curado = cal.calendarioCurado(autoridad);
    const tipoPlazo = tipo ?? "general";
    // Los cierres bancarios de la CNBV, para la prórroga del art. 12 en declaraciones_pagos.
    const feriadoBancario = cal.feriadoBancario;
    return {
      data: conCalendario(c, () =>
        sumarDiasHabilesCurado(curado, {
          tipoPlazo,
          desde,
          dias,
          permitirIncompleto,
          feriadoBancario,
        }),
      ),
      meta: conDocs(curado.meta, "dias-habiles"),
    };
  },
};

export const DIAS_INHABILES: RutaPaquete = {
  responder: async (c): Promise<Dato> => {
    const anio = Number(valor(c, "anio"));
    const autoridad = valor(c, "autoridad") as Autoridad;
    if (autoridad === "lft") {
      const { dias, advertencias } = conCalendario(c, () => diasInhabilesLft(anio));
      return { data: dias, meta: metaLft("dias-inhabiles"), advertencias };
    }
    const curado = (await calendarios()).calendarioCurado(autoridad as AutoridadCurada);
    const { dias, advertencias } = conCalendario(c, () => diasInhabilesCurados(curado, anio));
    return { data: dias, meta: conDocs(curado.meta, "dias-inhabiles"), advertencias };
  },
};
