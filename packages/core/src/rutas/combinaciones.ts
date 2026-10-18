// Las reglas de la API que relacionan dos parámetros de una consulta: tipo_plazo con la autoridad
// y publicado con operacion. Van en el índice del núcleo (y en `mexicoapi`) porque el MCP y la CLI
// las revisan sin pedirle nada a la API; solo importan los catálogos.
import { type Autoridad, TIPOS_PLAZO, type TipoPlazo } from "../dias-habiles/tipos.js";
import type { ProblemaConsulta } from "./parametros.js";

/**
 * Cómo se nombran la autoridad y el tipo de plazo en cada superficie: `tipo_plazo` en la API y el
 * MCP, `--tipo-plazo` en la CLI y `tipoPlazo` en el SDK.
 */
export interface NombresTipoPlazo {
  /** "autoridad=sat", "--autoridad sat". */
  readonly autoridad: (autoridad: Autoridad) => string;
  /** "el parámetro tipo_plazo", "--tipo-plazo", "tipoPlazo". */
  readonly tipoPlazo: string;
}

const NOMBRES_API: NombresTipoPlazo = {
  autoridad: (autoridad) => `autoridad=${autoridad}`,
  tipoPlazo: "el parámetro tipo_plazo",
};

const conMayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Con el SAT, el tipo de plazo es obligatorio: sus vacaciones no son inhábiles en los plazos de
 * declaraciones y pagos (CFF art. 12, segundo párrafo). Las demás autoridades tienen un solo plazo
 * y no lo aceptan. Devuelve el problema de la API, o null si la combinación vale. `nombres` cambia
 * cómo se nombran los parámetros en el texto; `parametro` sigue siendo el de la API.
 */
export function revisarTipoPlazo(
  autoridad: Autoridad,
  tipoPlazo: TipoPlazo | undefined,
  nombres: NombresTipoPlazo = NOMBRES_API,
): ProblemaConsulta | null {
  const conSat = nombres.autoridad("sat");
  const extras = { parametro: "tipo_plazo" };
  if (autoridad === "sat" && tipoPlazo === undefined) {
    const tipos = TIPOS_PLAZO.join(" o ");
    const detalle = `Con ${conSat} falta ${nombres.tipoPlazo}: ${tipos}.`;
    return { tipo: "parametro-faltante", detalle, extras };
  }
  if (autoridad !== "sat" && tipoPlazo !== undefined) {
    const detalle = `${conMayuscula(nombres.tipoPlazo)} solo se acepta con ${conSat}.`;
    return { tipo: "parametro-invalido", detalle, extras };
  }
  return null;
}

/**
 * El FIX se pide por exactamente una fecha: la de publicación o la de la operación. Devuelve el
 * problema de la API, o null si viene una sola.
 */
export function revisarFix(
  publicado: string | undefined,
  operacion: string | undefined,
): ProblemaConsulta | null {
  if (publicado !== undefined && operacion !== undefined) {
    return { tipo: "parametro-invalido", detalle: "Indica solo uno de publicado u operacion." };
  }
  if (publicado === undefined && operacion === undefined) {
    return { tipo: "parametro-faltante", detalle: "Indica publicado u operacion." };
  }
  return null;
}
