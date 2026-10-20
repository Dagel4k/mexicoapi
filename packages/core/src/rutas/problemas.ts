// Los problemas (RFC 9457) que responde la API y las direcciones de la API y de su documentación.
// Los usan la API, el OpenAPI, el cliente del paquete y el MCP. Tiene su propia subruta del
// núcleo (problemas) y no importa nada: el cliente lo carga al importarse sin traer el resto del
// núcleo.

/**
 * El origen de la API pública en producción, sin `/v1`: la base que usan el cliente del paquete y
 * el MCP si no se les da otra.
 */
export const URL_API = "https://mexicoapi.dagel4k.workers.dev";

/** El repositorio: la documentación y el catálogo de problemas viven en su rama main. */
export const URL_REPOSITORIO = "https://github.com/Dagel4k/mexicoapi";
export const URL_DOCS = `${URL_REPOSITORIO}/blob/main/docs`;
/** Base del `type` de cada problema: `${URL_PROBLEMAS}#<tipo>`. */
export const URL_PROBLEMAS = `${URL_DOCS}/api/problemas.md`;

export type TipoProblema =
  | "parametro-invalido"
  | "parametro-desconocido"
  | "parametro-faltante"
  | "https-requerido"
  | "no-encontrado"
  | "dato-no-disponible"
  | "metodo-no-permitido"
  | "calendario-incompleto"
  | "demasiadas-peticiones"
  | "error-interno";

const problema = (title: string, status: number) => Object.freeze({ title, status });

/** El título y el status de cada tipo de problema, en orden de status. */
export const PROBLEMAS: Readonly<
  Record<TipoProblema, Readonly<{ title: string; status: number }>>
> = Object.freeze({
  "parametro-invalido": problema("Parámetro inválido", 400),
  "parametro-desconocido": problema("Parámetro desconocido", 400),
  "parametro-faltante": problema("Falta un parámetro obligatorio", 400),
  "https-requerido": problema("Se requiere HTTPS", 403),
  "no-encontrado": problema("Recurso no encontrado", 404),
  "dato-no-disponible": problema("Dato todavía no disponible", 404),
  "metodo-no-permitido": problema("Método no permitido", 405),
  "calendario-incompleto": problema("Calendario incompleto", 422),
  "demasiadas-peticiones": problema("Demasiadas peticiones", 429),
  "error-interno": problema("Error interno", 500),
});

const PREFIJO = `${URL_PROBLEMAS}#`;

/**
 * El tipo de un `type` de la API sin su dirección (`no-encontrado`), o undefined si el `type` no
 * es de la API (`about:blank`). No lo busca en `PROBLEMAS`: la API puede agregar tipos.
 */
export function tipoDeProblema(type: string): string | undefined {
  return type.startsWith(PREFIJO) && type.length > PREFIJO.length
    ? type.slice(PREFIJO.length)
    : undefined;
}
