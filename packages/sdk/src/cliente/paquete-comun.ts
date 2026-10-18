// Lo que comparten las respuestas desde el paquete: el contexto de una consulta, la forma de una
// ruta y cómo se arman sus problemas y su `meta`.
import { URL_DOCS } from "@mexicoapi/core/problemas";
import type { MetaDatos } from "../datos/tipos.js";
import { type ContextoLocal, type MexicoApiError, problemaLocal, type TipoLocal } from "./error.js";

export type Nucleo = typeof import("@mexicoapi/core");

export interface Contexto extends ContextoLocal {
  /** Los parámetros como texto, igual que irían en la URL. */
  valores: Readonly<Record<string, string | undefined>>;
  /** Solo los de la query. */
  consulta: Readonly<Record<string, string>>;
  /** Cambia cada valor sensible de la ruta por `{nombre}`. */
  ocultar(texto: string): string;
  /** Se le agregan las advertencias de antigüedad. */
  advertencias: string[];
}

export interface Dato {
  data: unknown;
  meta: MetaDatos;
  /** Las de primer nivel que daría la API (`/v1/dias-inhabiles`). */
  advertencias?: readonly string[];
}

export interface RutaPaquete {
  /**
   * Parámetros de la query en el orden en que la API los revisa, si son obligatorios y, si no es
   * la de su nombre, la clave de su regla.
   */
  consulta?: readonly (readonly [nombre: string, obligatorio: boolean, regla?: string])[];
  responder(c: Contexto, n: Nucleo): Promise<Dato> | Dato;
}

export const falla = (
  c: Contexto,
  tipo: TipoLocal,
  detalle: string,
  extras?: Readonly<Record<string, unknown>>,
): MexicoApiError => problemaLocal(c, tipo, detalle, extras);

/** El `meta` de un dataset con el enlace a la sección de la API, como en las rutas calculadas. */
export const conDocs = (meta: MetaDatos, seccion: string): MetaDatos => ({
  ...meta,
  docs: `${URL_DOCS}/api/README.md#${seccion}`,
});

/** El valor de un parámetro que ya pasó su regla. */
export const valor = (c: Contexto, nombre: string): string => c.valores[nombre] as string;
