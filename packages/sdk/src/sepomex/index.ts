// Entrada `mexicoapi/sepomex` (solo Node): descarga el catálogo de códigos postales de Correos de
// México en el equipo del usuario, lo une con INEGI y lo consulta desde la caché local.
import { colonias, cp, directorio, importar, resumen, sync } from "./sepomex.js";

export type { Asentamiento, CodigoPostal } from "./catalogo.js";
export { SepomexError, type TipoErrorSepomex } from "./error.js";
export { AVISO_SEPOMEX, NOTA_MEXICOAPI, URL_DESCARGA } from "./fuente.js";
export { colonias, cp, directorio, importar, LIMITES, resumen, sync } from "./sepomex.js";
export type {
  FetchSepomex,
  InitFetchSepomex,
  OpcionesDirectorio,
  OpcionesGuardado,
  OpcionesSync,
  RespuestaFetchSepomex,
  ResumenSepomex,
} from "./tipos.js";

/** Las funciones de la entrada en un objeto: `sepomex.sync()`, `sepomex.cp("80000")`... */
export const sepomex: Readonly<{
  sync: typeof sync;
  importar: typeof importar;
  cp: typeof cp;
  colonias: typeof colonias;
  resumen: typeof resumen;
  directorio: typeof directorio;
}> = Object.freeze({ sync, importar, cp, colonias, resumen, directorio });
