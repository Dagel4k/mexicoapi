// Reglas de los valores de la ruta de la API y la forma de sus reglas y problemas. Las usan la API,
// el cliente del paquete y el OpenAPI; las que relacionan dos parámetros de la query están en
// combinaciones.ts. Tiene su propia subruta del núcleo (parametros) y no importa nada: el cliente
// lo carga al importarse.
import type { TipoProblema } from "./problemas.js";

/** La regla de un parámetro y el texto de la API cuando no la cumple. */
export interface ReglaParametro {
  /**
   * Expresión anclada (`^…$`) y sin banderas que debe cumplir el valor completo. Es el `pattern`
   * del parámetro en el OpenAPI, así que dice todo lo que pueda (un máximo, un valor excluido).
   */
  readonly patron: RegExp;
  /** Lo que el patrón no puede decir (una fecha que existe); se prueba después. */
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

/**
 * Las reglas de los valores de la ruta, por nombre del parámetro (`/v1/estados/{cve_ent}`). Los
 * dígitos van como `[0-9]` y no `\d`: en Python o .NET, un validador generado del OpenAPI lee `\d`
 * como cualquier dígito Unicode.
 */
export const REGLAS_RUTA = Object.freeze({
  cve_ent: Object.freeze({
    patron: /^[0-9]{2}$/,
    detalle: "La clave de estado (cve_ent) debe tener 2 dígitos.",
  }),
  cvegeo: Object.freeze({
    patron: /^[0-9]{5}$/,
    detalle: "La clave de municipio (cvegeo) debe tener 5 dígitos.",
  }),
  codigo: Object.freeze({
    patron: /^[0-9]{3}$/,
    detalle: "El código de banco debe tener 3 dígitos.",
  }),
  clabe: Object.freeze({ patron: /^[0-9]{18}$/, detalle: "La CLABE debe tener 18 dígitos." }),
  anio: Object.freeze({
    // No hay año 0000: las fechas van de 0001 a 9999. Sin lookahead, que no todos los motores de
    // expresiones de los clientes generados tienen.
    patron: /^(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})$/,
    detalle: "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
  }),
  periodo: enumeracion(["mensual", "anual"], "El periodo de la tarifa debe ser mensual o anual."),
} satisfies Record<string, ReglaParametro>);
