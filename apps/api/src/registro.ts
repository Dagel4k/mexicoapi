// Lo que el Worker deja en el registro: una línea con prefijo fijo ("mexicoapi: error interno:" o
// "mexicoapi: aviso:"), sin la URL, la query, la IP ni el mensaje del error, que pueden traer
// datos del usuario.

/** Un `name` como los de las clases de error; cualquier otro texto podría traer datos. */
const NOMBRE_DE_ERROR = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** El nombre de la clase de un error, o "desconocido": nunca su mensaje. */
export const nombreDeError = (error: unknown): string =>
  error instanceof Error && NOMBRE_DE_ERROR.test(error.name) ? error.name : "desconocido";
