// Días inhábiles y suma de días hábiles de la LFT, la CNBV y el SAT: datos que caducan (los
// calendarios crecen con cada publicación en el DOF). Se piden a la API si hay MEXICOAPI_BASE.
import type { DiaInhabil, ResultadoDiasHabiles } from "mexicoapi";
import { compilarEsquema } from "../esquema.js";
import { type Herramienta, resultadoError } from "../herramientas.js";
import {
  anotaciones,
  consultar,
  ESQUEMA_FUENTE_DATO,
  enLinea,
  esquemaSalida,
  FECHA,
  fuenteDe,
  type OpcionesHerramientas,
  procedencia,
  RESPALDO_API,
  resultado,
} from "../respuesta.js";

type Autoridad = "lft" | "cnbv" | "sat";

const AUTORIDAD = {
  type: "string",
  enum: ["lft", "cnbv", "sat"],
  description:
    "lft: sábados, domingos y días de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, sin los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (artículo 715); cnbv: calendario bancario, los días en que cierran las entidades financieras (no el de la CNBV como autoridad); sat: Código Fiscal de la Federación, artículo 12, por regla, y vacaciones del SAT.",
} as const;

const NOMBRE: Readonly<Record<Autoridad, string>> = {
  lft: "la LFT",
  cnbv: "la CNBV",
  sat: "el SAT",
};

const DIA_INHABIL = {
  type: "object",
  properties: {
    fecha: FECHA,
    motivo: { type: "string" },
    tipo: { type: "string", description: "descanso o vacaciones." },
    fuente: ESQUEMA_FUENTE_DATO,
  },
  required: ["fecha", "motivo", "tipo", "fuente"],
} as const;

const DIAS_INHABILES = { type: "array", items: DIA_INHABIL } as const;
const revisarDias = compilarEsquema(DIAS_INHABILES);

const SUMA = {
  type: "object",
  properties: {
    autoridad: { type: "string" },
    desde: FECHA,
    dias: { type: "integer" },
    resultado: { ...FECHA, description: "Fecha en que vence el plazo." },
    inhabiles_saltados: { type: "array", items: DIA_INHABIL },
    advertencias: { type: "array", items: { type: "string" } },
  },
  required: ["autoridad", "desde", "dias", "resultado", "inhabiles_saltados", "advertencias"],
} as const;
const revisarSuma = compilarEsquema(SUMA);

const lineaDia = (d: DiaInhabil): string =>
  `- ${d.fecha} ${enLinea(d.motivo)} (${enLinea(d.tipo)})`;

export function diasInhabilesHerramienta({ cliente, conApi }: OpcionesHerramientas): Herramienta {
  return {
    name: "dias_inhabiles",
    title: "Días inhábiles",
    description: `Días inhábiles de un año según una autoridad: lft, cnbv o sat. No lista los sábados y domingos por serlo, pero sí un día publicado que cae en fin de semana. Cada día trae su motivo, su tipo (descanso, o vacaciones del SAT, que en los plazos de declaraciones y pagos cuentan como hábiles) y su fuente. Si la lista de un año puede estar incompleta, lo advierte; con lft advierte siempre que no incluye los festivos ni las suspensiones de labores del artículo 715. ${RESPALDO_API}`,
    inputSchema: {
      type: "object",
      properties: {
        autoridad: AUTORIDAD,
        anio: { type: "integer", minimum: 1000, maximum: 9999, description: "Año de 4 cifras." },
      },
      required: ["autoridad", "anio"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(DIAS_INHABILES, { origenes: ["api", "paquete"] }),
    annotations: anotaciones(conApi),
    async ejecutar(args, { signal }) {
      const { autoridad, anio } = args as { autoridad: Autoridad; anio: number };
      const r = await consultar(
        signal,
        () => cliente.diasInhabiles({ autoridad, anio }, { signal }),
        revisarDias,
      );
      const dias = r.data;
      const de = `de ${anio} según ${NOMBRE[autoridad]}`;
      const lineas =
        dias.length === 0
          ? [`Ningún día inhábil ${de}, sin contar sábados y domingos.`]
          : [
              `${dias.length} ${dias.length === 1 ? "día inhábil" : "días inhábiles"} ${de}, sin contar sábados y domingos:`,
              ...dias.map(lineaDia),
            ];
      const fuentes = dias.map((d) => fuenteDe(d.fuente));
      return resultado(lineas, dias, procedencia(r, { fuentes }));
    },
  };
}

export function sumarDiasHabilesHerramienta({
  cliente,
  conApi,
}: OpcionesHerramientas): Herramienta {
  return {
    name: "sumar_dias_habiles",
    title: "Sumar días hábiles",
    description: `Calcula la fecha que resulta de sumar días hábiles a la fecha desde según el calendario de una autoridad (lft, cnbv o sat), contando desde el día hábil siguiente. En un plazo que corre desde una notificación, desde es el día en que surte efectos, no el día en que se hizo. Con sat, tipo_plazo es obligatorio: en declaraciones_pagos las vacaciones del SAT cuentan como hábiles (CFF, artículo 12) y en general no; con lft o cnbv no se acepta. Devuelve la fecha resultante y los días inhábiles saltados con su fuente. Las advertencias dicen lo que el cálculo no descuenta: con lft, los festivos y las suspensiones de labores del artículo 715; con declaraciones_pagos, la prórroga del quinto párrafo del artículo 12 si el resultado cae en viernes, en vacaciones del SAT o en un cierre bancario. Si el calendario no cubre el periodo responde con error; con permitir_incompleto: true calcula de todos modos y lo advierte. Es una calculadora, no asesoría legal. ${RESPALDO_API}`,
    inputSchema: {
      type: "object",
      properties: {
        autoridad: AUTORIDAD,
        desde: {
          ...FECHA,
          description:
            "Fecha de partida (AAAA-MM-DD), que no se cuenta: en un plazo que corre desde una notificación, el día en que surte efectos.",
        },
        dias: {
          type: "integer",
          minimum: 1,
          maximum: 3650,
          description: "Días hábiles a sumar, de 1 a 3650.",
        },
        tipo_plazo: {
          type: "string",
          enum: ["general", "declaraciones_pagos"],
          description: "Solo con autoridad sat, y ahí obligatorio.",
        },
        permitir_incompleto: {
          type: "boolean",
          description:
            "true para calcular fuera de la cobertura del calendario, con advertencia: el resultado puede cambiar cuando se publique lo que falta.",
        },
      },
      required: ["autoridad", "desde", "dias"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(SUMA, { origenes: ["api", "paquete"] }),
    annotations: anotaciones(conApi),
    async ejecutar(args, { signal }) {
      const { autoridad, desde, dias, tipo_plazo, permitir_incompleto } = args as {
        autoridad: Autoridad;
        desde: string;
        dias: number;
        tipo_plazo?: "general" | "declaraciones_pagos";
        permitir_incompleto?: boolean;
      };
      // Las mismas reglas y textos que la API, sin ir a pedirlo.
      if (autoridad === "sat" && tipo_plazo === undefined) {
        return resultadoError(
          "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
        );
      }
      if (autoridad !== "sat" && tipo_plazo !== undefined) {
        return resultadoError("El parámetro tipo_plazo solo se acepta con autoridad=sat.");
      }
      const consulta =
        autoridad === "sat"
          ? { autoridad, tipoPlazo: tipo_plazo as "general" | "declaraciones_pagos", desde, dias }
          : { autoridad, desde, dias };
      const r = await consultar(
        signal,
        () =>
          cliente.diasHabiles({ ...consulta, permitirIncompleto: permitir_incompleto }, { signal }),
        revisarSuma,
      );
      const calculo: ResultadoDiasHabiles = r.data;
      const plazo = tipo_plazo === undefined ? "" : ` (tipo_plazo ${tipo_plazo})`;
      const unidad = calculo.dias === 1 ? "día hábil" : "días hábiles";
      const lineas = [
        `${calculo.desde} + ${calculo.dias} ${unidad} según ${NOMBRE[autoridad]}${plazo}: ${calculo.resultado}.`,
      ];
      if (calculo.inhabiles_saltados.length === 0) {
        lineas.push("No hubo días inhábiles de por medio, salvo sábados y domingos.");
      } else {
        lineas.push(
          "Inhábiles saltados (sin contar sábados y domingos):",
          ...calculo.inhabiles_saltados.map(lineaDia),
        );
      }
      const p = procedencia(r, { advertencias: calculo.advertencias });
      return resultado(lineas, calculo, p);
    },
  };
}
