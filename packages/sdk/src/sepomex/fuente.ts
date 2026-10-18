// De dónde sale el catálogo de códigos postales y qué se le dice a quien lo descarga.

/** Página pública de Correos de México con el formulario de descarga. */
export const URL_DESCARGA =
  "https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx";

/**
 * Aviso de uso que Correos de México pone en la primera línea del TXT. Se muestra antes de
 * descargar; el del archivo descargado queda en `estado().aviso`.
 */
export const AVISO_SEPOMEX =
  "El Catálogo Nacional de Códigos Postales, es elaborado por Correos de México y se proporciona en forma gratuita para uso particular, no estando permitida su comercialización, total o parcial, ni su distribución a terceros bajo ningún concepto.";

/** Nota de MéxicoAPI: los datos no vienen de MéxicoAPI ni salen del equipo. */
export const NOTA_MEXICOAPI =
  "Los códigos postales se descargan de Correos de México (SEPOMEX) desde este equipo y se guardan solo en él. No vienen de MéxicoAPI, que no los distribuye ni los modifica: solo los convierte a UTF-8 y les agrega la clave de municipio de INEGI.";

/** Qué hacer si la descarga automática no funciona. */
export const DESCARGA_MANUAL = `Descarga el archivo a mano desde ${URL_DESCARGA} (estado "Todos", formato TXT) y usa sepomex.importar(ruta).`;

/** User-Agent de las peticiones a Correos de México: dice quién descarga. */
export const USER_AGENT = "mexicoapi (+https://github.com/Dagel4k/mexicoapi)";
