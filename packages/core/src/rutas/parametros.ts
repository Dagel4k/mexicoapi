// Reglas de los parámetros de la API: las de los valores de la ruta y las que relacionan dos
// parámetros de la query (tipo_plazo con la autoridad, publicado con operacion). Las usan la API,
// el cliente del paquete, el OpenAPI, la CLI y el MCP. Tiene su propia subruta del núcleo
// (parametros) y solo importa los catálogos: el cliente lo carga al importarse.
import { type Autoridad, TIPOS_PLAZO, type TipoPlazo } from "../dias-habiles/tipos.js";
import type { TipoProblema } from "./problemas.js";

/** La regla de un parámetro y el texto de la API cuando no la cumple. */
export interface ReglaParametro {
  /**
   * Expresión anclada (`^…$`) y sin banderas que debe cumplir el valor completo. Es el `pattern`
   * del parámetro en el OpenAPI.
   */
  readonly patron: RegExp;
  /** Lo que el patrón no puede decir (un máximo, una fecha que existe); se prueba después. */
  readonly cumple?: (valor: string) => boolean;
  /** El `detail` del 400 cuando el valor no la cumple. */
  readonly detalle: string;
  /** Si solo acepta una lista de valores: los que acepta el patrón, el `enum` del OpenAPI. */
  readonly valores?: readonly string[];
}

/** La regla de un parámetro de la query. */
export interface ReglaConsulta extends ReglaParametro {
  readonly obligatorio?: boolean;
}

export const cumpleRegla = (regla: ReglaParametro, valor: string): boolean =>
  regla.patron.test(valor) && (regla.cumple?.(valor) ?? true);

/**
 * Un problema de una consulta como lo responde la API: su tipo, el `detail` y las extensiones del
 * problem+json (`parametro`, o `autoridad`, `fecha` y `cobertura`).
 */
export interface ProblemaConsulta {
  readonly tipo: TipoProblema;
  readonly detalle: string;
  readonly extras?: Readonly<Record<string, unknown>>;
}

/** Una regla que acepta solo `valores`, con el patrón que los acepta exactamente. */
export const enumeracion = (valores: readonly string[], detalle: string): ReglaParametro =>
  Object.freeze({
    patron: new RegExp(`^(?:${valores.join("|")})$`),
    detalle,
    valores: Object.freeze([...valores]),
  });

/** "a", "a y b", "a, b y c". */
export const enLista = (partes: readonly string[]): string =>
  partes.length < 2 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;

/** Las reglas de los valores de la ruta, por nombre del parámetro (`/v1/estados/{cve_ent}`). */
export const REGLAS_RUTA = Object.freeze({
  cve_ent: Object.freeze({
    patron: /^\d{2}$/,
    detalle: "La clave de estado (cve_ent) debe tener 2 dígitos.",
  }),
  cvegeo: Object.freeze({
    patron: /^\d{5}$/,
    detalle: "La clave de municipio (cvegeo) debe tener 5 dígitos.",
  }),
  codigo: Object.freeze({ patron: /^\d{3}$/, detalle: "El código de banco debe tener 3 dígitos." }),
  clabe: Object.freeze({ patron: /^\d{18}$/, detalle: "La CLABE debe tener 18 dígitos." }),
  anio: Object.freeze({
    patron: /^\d{4}$/,
    // No hay año 0000: las fechas van de 0001 a 9999.
    cumple: (valor: string) => valor !== "0000",
    detalle: "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
  }),
  periodo: enumeracion(["mensual", "anual"], "El periodo de la tarifa debe ser mensual o anual."),
} satisfies Record<string, ReglaParametro>);

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
