// Tipo de cambio FIX y UDIS: datos que caducan. Se piden a la API si hay MEXICOAPI_BASE; si no
// responde, salen del paquete con la advertencia del cliente. Sin base salen del paquete, y se
// advierte solo cuando la respuesta puede no estar al día (ver cercaDelFinal).
import type { CoberturaSerie } from "mexicoapi";
import type { Respuesta } from "mexicoapi/cliente";
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

const FIX = {
  type: "object",
  properties: {
    fecha_publicacion: { ...FECHA, description: "Día de la publicación en el DOF." },
    valor: { type: "string", description: "Pesos por dólar, con 4 decimales." },
    fecha_operacion: FECHA,
    fundamento: ESQUEMA_FUENTE_DATO,
  },
  required: ["fecha_publicacion", "valor"],
} as const;

/**
 * Días antes del último dato de la serie del paquete en los que, sin API, se advierte que puede
 * haber datos más nuevos: la última publicación que trae el paquete puede no ser la última que
 * hay, y una consulta por esos días suele buscar el valor vigente. Una fecha anterior es historia
 * publicada: no cambia y no se advierte.
 */
export const DIAS_CERCA_DEL_FINAL = 7;

const MS_POR_DIA = 86_400_000;

/** Si `fecha` (o la publicación más reciente, sin fecha) está cerca del final de la serie. */
async function cercaDelFinal(
  serie: () => Promise<{ cobertura: CoberturaSerie }>,
  fecha: string | undefined,
): Promise<boolean> {
  if (fecha === undefined) return true;
  const { hasta } = (await serie()).cobertura;
  return Date.parse(hasta) - Date.parse(fecha) <= DIAS_CERCA_DEL_FINAL * MS_POR_DIA;
}

const serieFix = () => import("mexicoapi/datos/fix");
const serieUdis = () => import("mexicoapi/datos/udis");

interface Fix {
  fecha_publicacion: string;
  valor: string;
  fecha_operacion?: string;
  fundamento?: { nombre: string; url: string };
}

export function tipoDeCambioFixHerramienta({ cliente, conApi }: OpcionesHerramientas): Herramienta {
  return {
    name: "tipo_de_cambio_fix",
    title: "Tipo de cambio FIX",
    description: `Tipo de cambio FIX (pesos por dólar) publicado en el DOF. Con publicado, el valor que se publicó ese día; con operacion, el que aplica a una operación de ese día según el CFF, artículo 20 (el publicado el día anterior o, si ese día no hubo publicación, el último antes); sin ninguno de los dos, la publicación más reciente. Indica solo uno. ${RESPALDO_API} Sin API advierte en la publicación más reciente y en fechas a ${DIAS_CERCA_DEL_FINAL} días o menos del último dato del paquete.`,
    inputSchema: {
      type: "object",
      properties: {
        publicado: { ...FECHA, description: "Fecha de publicación en el DOF (AAAA-MM-DD)." },
        operacion: { ...FECHA, description: "Fecha de la operación (AAAA-MM-DD)." },
      },
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(FIX, { origenes: ["api", "paquete"] }),
    annotations: anotaciones(conApi),
    async ejecutar(args, { signal }) {
      const { publicado, operacion } = args as { publicado?: string; operacion?: string };
      if (publicado !== undefined && operacion !== undefined) {
        return resultadoError("Indica solo uno de publicado u operacion.");
      }
      const op = { signal };
      const r = await consultar(
        signal,
        (): Promise<Respuesta<Fix>> =>
          publicado !== undefined
            ? cliente.fixPublicado(publicado, op)
            : operacion !== undefined
              ? cliente.fixParaOperacion(operacion, op)
              : cliente.fixUltimo(op),
      );
      const fix = r.data;
      const linea =
        publicado !== undefined
          ? `FIX publicado en el DOF el ${fix.fecha_publicacion}: ${enLinea(fix.valor)} pesos por dólar.`
          : operacion !== undefined
            ? `FIX para una operación del ${operacion}: ${enLinea(fix.valor)} pesos por dólar, el publicado en el DOF el ${fix.fecha_publicacion} (CFF, artículo 20).`
            : `Última publicación del FIX: ${enLinea(fix.valor)} pesos por dólar, en el DOF del ${fix.fecha_publicacion}.`;
      const sinApi = !conApi && (await cercaDelFinal(serieFix, publicado ?? operacion));
      const base = procedencia(r, { sinApi });
      const fuentes =
        fix.fundamento === undefined ? base.fuentes : [...base.fuentes, fuenteDe(fix.fundamento)];
      return resultado([linea], fix, { ...base, fuentes });
    },
  };
}

export function udisHerramienta({ cliente, conApi }: OpcionesHerramientas): Herramienta {
  return {
    name: "udis",
    title: "Valor de la UDI",
    description: `Valor de la UDI (pesos por unidad de inversión) de un día, como se publica en el DOF. Hay un valor para cada día del calendario, fines de semana incluidos. ${RESPALDO_API} Sin API advierte en fechas a ${DIAS_CERCA_DEL_FINAL} días o menos del último valor del paquete.`,
    inputSchema: {
      type: "object",
      properties: {
        fecha: { ...FECHA, description: "Día del valor (AAAA-MM-DD)." },
      },
      required: ["fecha"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(
      {
        type: "object",
        properties: {
          fecha: FECHA,
          valor: { type: "string", description: "Pesos por UDI, con 6 decimales." },
        },
        required: ["fecha", "valor"],
      },
      { origenes: ["api", "paquete"] },
    ),
    annotations: anotaciones(conApi),
    async ejecutar(args, { signal }) {
      const r = await consultar(signal, () => cliente.udi(args.fecha as string, { signal }));
      const udi = r.data;
      const sinApi = !conApi && (await cercaDelFinal(serieUdis, udi.fecha));
      return resultado(
        [`UDI del ${udi.fecha}: ${enLinea(udi.valor)} pesos.`],
        udi,
        procedencia(r, { sinApi }),
      );
    },
  };
}
