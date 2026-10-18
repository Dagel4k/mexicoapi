export const URL_DOCS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs";
export const URL_PROBLEMAS = `${URL_DOCS}/api/problemas.md`;

export type TipoProblema =
  | "parametro-invalido"
  | "parametro-desconocido"
  | "parametro-faltante"
  | "no-encontrado"
  | "dato-no-disponible"
  | "metodo-no-permitido"
  | "calendario-incompleto"
  | "demasiadas-peticiones"
  | "error-interno";

const problema = (title: string, status: number) => Object.freeze({ title, status });

/** El `type` de cada problema es `${URL_PROBLEMAS}#${tipo}`. */
export const PROBLEMAS: Readonly<Record<TipoProblema, { title: string; status: number }>> =
  Object.freeze({
    "parametro-invalido": problema("Parámetro inválido", 400),
    "parametro-desconocido": problema("Parámetro desconocido", 400),
    "parametro-faltante": problema("Falta un parámetro obligatorio", 400),
    "no-encontrado": problema("Recurso no encontrado", 404),
    "dato-no-disponible": problema("Dato todavía no disponible", 404),
    "metodo-no-permitido": problema("Método no permitido", 405),
    "calendario-incompleto": problema("Calendario incompleto", 422),
    "demasiadas-peticiones": problema("Demasiadas peticiones", 429),
    "error-interno": problema("Error interno", 500),
  });
