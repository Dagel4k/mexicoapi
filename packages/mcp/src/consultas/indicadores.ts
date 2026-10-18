// Tipo de cambio FIX y UDIS: datos que caducan. Se piden a la API (la pública o la de
// MEXICOAPI_BASE); si no responde, salen del paquete con la advertencia del cliente. Sin red
// (MEXICOAPI_SIN_RED=1) salen del paquete, y se advierte solo cuando la respuesta puede no estar
// al día (ver cercaDelFinal).
import { type CoberturaSerie, revisarFix } from "mexicoapi";
import { DIAS_DATOS_RECIENTES, type Respuesta } from "mexicoapi/cliente";
import { compilarEsquema } from "../esquema.js";
import type { Herramienta } from "../herramientas.js";
import {
  anotaciones,
  aUnaLinea,
  consultar,
  ESQUEMA_FUENTE_DATO,
  esquemaSalida,
  FECHA,
  fuenteDe,
  type OpcionesHerramientas,
  procedencia,
  RESPALDO_API,
  resultado,
  resultadoProblema,
  TEXTO_NUMERICO,
} from "../respuesta.js";

const FIX = {
  type: "object",
  properties: {
    fecha_publicacion: { ...FECHA, description: "Día de la publicación en el DOF." },
    valor: { ...TEXTO_NUMERICO, description: "Pesos por dólar, con 4 decimales." },
    fecha_operacion: FECHA,
    fundamento: ESQUEMA_FUENTE_DATO,
  },
  required: ["fecha_publicacion", "valor"],
} as const;
const revisarDatosFix = compilarEsquema(FIX);

const UDI = {
  type: "object",
  properties: {
    fecha: FECHA,
    valor: { ...TEXTO_NUMERICO, description: "Pesos por UDI, con 6 decimales." },
  },
  required: ["fecha", "valor"],
} as const;
const revisarUdi = compilarEsquema(UDI);

/**
 * Días antes del último dato de la serie del paquete en los que, sin API, se advierte que puede
 * haber datos más nuevos: la última publicación que trae el paquete puede no ser la última que
 * hay, y una consulta por esos días suele buscar el valor vigente. Una fecha anterior es historia
 * publicada: no cambia y no se advierte. Es el umbral de datos viejos del cliente
 * (DIAS_DATOS_RECIENTES), que él cuenta desde el último dato hasta hoy.
 */
const DIAS_CERCA_DEL_FINAL = DIAS_DATOS_RECIENTES;

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
    description: `Tipo de cambio FIX (pesos por dólar) publicado en el DOF. Con publicado, el valor que se publicó ese día; con operacion, el que aplica a una operación de ese día según el CFF, artículo 20 (el publicado el día anterior o, si ese día no hubo publicación, el último antes); sin ninguno de los dos, la publicación más reciente. Indica solo uno. ${RESPALDO_API} Sin red advierte en la publicación más reciente y en fechas a ${DIAS_CERCA_DEL_FINAL} días o menos del último dato del paquete.`,
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
      // La regla de la API pide una de las dos fechas; sin ninguna, aquí es la más reciente.
      const combinacion = revisarFix(publicado, operacion);
      if (combinacion?.tipo === "parametro-invalido") return resultadoProblema(combinacion);
      const op = { signal };
      const r = await consultar(
        signal,
        (): Promise<Respuesta<Fix>> =>
          publicado !== undefined
            ? cliente.fixPublicado(publicado, op)
            : operacion !== undefined
              ? cliente.fixParaOperacion(operacion, op)
              : cliente.fixUltimo(op),
        revisarDatosFix,
      );
      const fix = r.data;
      // Del paquete es la más reciente que trae, que puede no ser la última publicada.
      const masReciente =
        r.origen === "paquete"
          ? "Publicación más reciente del FIX en los datos del paquete"
          : "Última publicación del FIX";
      const linea =
        publicado !== undefined
          ? `FIX publicado en el DOF el ${fix.fecha_publicacion}: ${aUnaLinea(fix.valor)} pesos por dólar.`
          : operacion !== undefined
            ? `FIX para una operación del ${operacion}: ${aUnaLinea(fix.valor)} pesos por dólar, el publicado en el DOF el ${fix.fecha_publicacion} (CFF, artículo 20).`
            : `${masReciente}: ${aUnaLinea(fix.valor)} pesos por dólar, en el DOF del ${fix.fecha_publicacion}.`;
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
    description: `Valor de la UDI (pesos por unidad de inversión) de un día, como se publica en el DOF. Hay un valor para cada día del calendario, fines de semana incluidos. ${RESPALDO_API} Sin red advierte en fechas a ${DIAS_CERCA_DEL_FINAL} días o menos del último valor del paquete.`,
    inputSchema: {
      type: "object",
      properties: {
        fecha: { ...FECHA, description: "Día del valor (AAAA-MM-DD)." },
      },
      required: ["fecha"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(UDI, { origenes: ["api", "paquete"] }),
    annotations: anotaciones(conApi),
    async ejecutar(args, { signal }) {
      const r = await consultar(
        signal,
        () => cliente.udi(args.fecha as string, { signal }),
        revisarUdi,
      );
      const udi = r.data;
      const sinApi = !conApi && (await cercaDelFinal(serieUdis, udi.fecha));
      return resultado(
        [`UDI del ${udi.fecha}: ${aUnaLinea(udi.valor)} pesos.`],
        udi,
        procedencia(r, { sinApi }),
      );
    },
  };
}
