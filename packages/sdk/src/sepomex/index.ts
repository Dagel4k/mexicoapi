// Entrada `mexicoapi/sepomex` (solo Node): descarga el catálogo de códigos postales de Correos de
// México en el equipo del usuario, lo une con INEGI y lo consulta desde la caché local.
import { colonias, cp, directorio, estado, importar, sync } from "./sepomex.js";

export type { Asentamiento, CodigoPostal } from "./catalogo.js";
export { SepomexError, type TipoErrorSepomex } from "./error.js";
export { AVISO_SEPOMEX, NOTA_MEXICOAPI, URL_DESCARGA } from "./fuente.js";
export { colonias, cp, directorio, estado, importar, LIMITES, sync } from "./sepomex.js";
export type {
  EstadoSepomex,
  FetchSepomex,
  InitFetchSepomex,
  OpcionesDirectorio,
  OpcionesGuardado,
  OpcionesSync,
  RespuestaFetchSepomex,
} from "./tipos.js";

/** Las funciones de la entrada en un objeto: `sepomex.sync()`, `sepomex.cp("80000")`... */
export const sepomex: Readonly<{
  sync: typeof sync;
  importar: typeof importar;
  cp: typeof cp;
  colonias: typeof colonias;
  estado: typeof estado;
  directorio: typeof directorio;
}> = Object.freeze({ sync, importar, cp, colonias, estado, directorio });
