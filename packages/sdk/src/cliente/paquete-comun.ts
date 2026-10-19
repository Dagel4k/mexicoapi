// Lo que comparten las respuestas desde el paquete: el contexto de una consulta, la forma de una
// ruta y cómo se arman sus problemas y su `meta`.
import type { Aviso } from "@mexicoapi/core";
import type { TipoProblema } from "@mexicoapi/core/problemas";
import { URL_DOCS } from "@mexicoapi/core/problemas";
import type { ProblemaConsulta } from "@mexicoapi/core/rutas";
import type { MetaDatos } from "../datos/tipos.js";
import { type ContextoLocal, type MexicoApiError, problemaLocal } from "./error.js";

export type Nucleo = typeof import("@mexicoapi/core");

export interface Contexto extends ContextoLocal {
  /** Los parámetros como texto, igual que irían en la URL. */
  valores: Readonly<Record<string, string | undefined>>;
  /** La query como iría en la URL, sin el `?`: se revisa con las reglas del núcleo, como la API. */
  query: string;
  /** Cambia cada valor sensible de la ruta por `{nombre}`. */
  ocultar(texto: string): string;
  /**
   * Los avisos del cliente, con su código: que la API falló, la antigüedad de una serie del
   * paquete y que pueden faltar publicaciones. Van antes que los de la respuesta.
   */
  avisos: Aviso[];
}

export interface Dato {
  data: unknown;
  meta: MetaDatos;
  /** Las de primer nivel que daría la API (`/v1/dias-inhabiles`), con sus avisos. */
  advertencias?: readonly string[];
  avisos?: readonly Aviso[];
}

/** Cómo responde el paquete una ruta cuya query ya pasó las reglas del núcleo. */
export interface RutaPaquete {
  responder(c: Contexto, n: Nucleo): Promise<Dato> | Dato;
}

export const falla = (
  c: Contexto,
  tipo: TipoProblema,
  detalle: string,
  extras?: Readonly<Record<string, unknown>>,
): MexicoApiError => problemaLocal(c, tipo, detalle, extras);

/** El MexicoApiError de un problema del núcleo (sus reglas, sus errores, una consulta sin registro). */
export const fallaDe = (c: Contexto, { tipo, detalle, extras }: ProblemaConsulta): MexicoApiError =>
  problemaLocal(c, tipo, detalle, extras);

/** El `meta` de un dataset con el enlace a la sección de la API, como en las rutas calculadas. */
export const conDocs = (meta: MetaDatos, seccion: string): MetaDatos => ({
  ...meta,
  docs: `${URL_DOCS}/api/README.md#${seccion}`,
});

/** El valor de un parámetro que ya pasó su regla. */
export const valor = (c: Contexto, nombre: string): string => c.valores[nombre] as string;
