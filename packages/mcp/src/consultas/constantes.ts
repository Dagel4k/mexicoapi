// UMA, salario mínimo y tarifas de ISR publicados en el DOF: datos que caducan (cada año trae
// valores nuevos). Se piden a la API si hay MEXICOAPI_BASE.
import type { SalarioMinimo, TarifaIsr, Uma } from "mexicoapi";
import type { Respuesta } from "mexicoapi/cliente";
import { type Herramienta, type ResultadoHerramienta, resultadoError } from "../herramientas.js";
import {
  anotaciones,
  consultar,
  enLinea,
  esquemaSalida,
  FECHA,
  fuenteDe,
  type OpcionesHerramientas,
  procedencia,
  RESPALDO_API,
  resultado,
} from "../respuesta.js";

type Tipo = "uma" | "salario_minimo" | "isr";

interface Argumentos {
  tipo: Tipo;
  anio?: number;
  fecha?: string;
  periodo?: "mensual" | "anual";
}

const ZONAS: Readonly<Record<string, string>> = {
  general: "general",
  zlfn: "Zona Libre de la Frontera Norte",
};

/** El problema de una combinación de argumentos, con los textos de las reglas de la API. */
function problema({ tipo, anio, fecha, periodo }: Argumentos): string | null {
  if (tipo !== "isr" && periodo !== undefined) {
    return "El parámetro periodo solo se acepta con tipo=isr.";
  }
  if (tipo !== "uma" && fecha !== undefined) {
    return "El parámetro fecha solo se acepta con tipo=uma.";
  }
  if (tipo === "uma") {
    if (anio !== undefined && fecha !== undefined) {
      return "Con tipo=uma indica solo uno de anio o fecha.";
    }
    if (anio === undefined && fecha === undefined) {
      return "Con tipo=uma falta anio (la UMA de ese año) o fecha (la vigente ese día).";
    }
    return null;
  }
  if (tipo === "isr" && periodo === undefined) {
    return "Con tipo=isr falta el parámetro periodo: mensual o anual.";
  }
  return anio === undefined ? `Con tipo=${tipo} falta el parámetro anio.` : null;
}

export function constantesHerramienta({ cliente }: OpcionesHerramientas): Herramienta {
  return {
    name: "constantes",
    title: "UMA, salario mínimo e ISR",
    description: `UMA, salario mínimo y tarifas de ISR publicados en el DOF, cada uno con la publicación que lo respalda. tipo uma con anio (la UMA de ese año) o con fecha (la vigente ese día: cada UMA rige del 1 de febrero al 31 de enero siguiente); tipo salario_minimo con anio (zona general y Zona Libre de la Frontera Norte); tipo isr con periodo (mensual o anual) y anio. Los montos son texto con dos decimales. ${RESPALDO_API}`,
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["uma", "salario_minimo", "isr"] },
        anio: { type: "integer", minimum: 1000, maximum: 9999, description: "Año de 4 cifras." },
        fecha: { ...FECHA, description: "Solo con tipo uma: día en que se busca la vigente." },
        periodo: {
          type: "string",
          enum: ["mensual", "anual"],
          description: "Solo con tipo isr.",
        },
      },
      required: ["tipo"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(
      {
        type: ["object", "array"],
        description:
          "La UMA (objeto), el salario mínimo (lista, uno por zona) o la tarifa de ISR (objeto con sus tramos), según tipo. Cada uno trae su fuente.",
      },
      {
        origenes: ["api", "paquete"],
        extra: { tipo: { type: "string", enum: ["uma", "salario_minimo", "isr"] } },
      },
    ),
    annotations: anotaciones(true),
    async ejecutar(args, { signal }) {
      const a = args as unknown as Argumentos;
      const mal = problema(a);
      if (mal !== null) return resultadoError(mal);
      const op = { signal };
      const extra = { tipo: a.tipo };
      if (a.tipo === "uma") {
        const r: Respuesta<Uma> = await consultar(signal, () =>
          a.fecha === undefined
            ? cliente.uma(a.anio as number, op)
            : cliente.umaVigente(a.fecha, op),
        );
        const u = r.data;
        const montos = enLinea(
          `diaria ${u.diaria}, mensual ${u.mensual} y anual ${u.anual} pesos; rige desde el ${u.vigencia_desde}.`,
        );
        const linea =
          a.fecha === undefined
            ? `UMA de ${u.anio}: ${montos}`
            : `UMA vigente el ${a.fecha}: la de ${u.anio}, ${montos}`;
        return conFuentes([linea], r, [u.fuente], extra);
      }
      if (a.tipo === "salario_minimo") {
        const r: Respuesta<readonly SalarioMinimo[]> = await consultar(signal, () =>
          cliente.salarioMinimo(a.anio as number, op),
        );
        const zonas = r.data;
        const primera = zonas[0];
        if (primera === undefined) {
          return resultadoError(`La respuesta no trae el salario mínimo de ${a.anio}.`);
        }
        const lineas = [
          `Salario mínimo diario de ${a.anio}, desde el ${primera.vigencia_desde}:`,
          ...zonas.map((z) => enLinea(`- ${ZONAS[z.zona] ?? z.zona}: ${z.diario} pesos`)),
        ];
        return conFuentes(
          lineas,
          r,
          zonas.map((z) => z.fuente),
          extra,
        );
      }
      const periodo = a.periodo as "mensual" | "anual";
      const r: Respuesta<TarifaIsr> = await consultar(signal, () =>
        cliente.tarifaIsr(periodo, a.anio as number, op),
      );
      const t = r.data;
      const lineas = [
        `Tarifa ${periodo} de ISR de ${t.anio}, en pesos:`,
        ...t.tramos.map((tramo) =>
          enLinea(
            `- de ${tramo.limite_inferior} ${tramo.limite_superior === null ? "en adelante" : `a ${tramo.limite_superior}`}: cuota fija ${tramo.cuota_fija} más ${tramo.tasa_excedente} % del excedente`,
          ),
        ),
      ];
      return conFuentes(lineas, r, [t.fuente], extra);
    },
  };
}

/** El resultado con las fuentes de los registros (la publicación del DOF de cada uno). */
function conFuentes(
  lineas: string[],
  r: Respuesta<unknown>,
  fuentes: readonly { nombre: string; url: string }[],
  extra: Record<string, unknown>,
): ResultadoHerramienta {
  const p = procedencia(r, { fuentes: fuentes.map(fuenteDe) });
  return resultado(lineas, r.data, p, { extra });
}
