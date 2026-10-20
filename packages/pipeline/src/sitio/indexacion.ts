/**
 * La llave de IndexNow. Es pública por diseño: el buscador la compara con el archivo
 * `/<llave>.txt` del sitio para saber que el aviso viene de su dueño. El workflow de despliegue
 * (`despliegue.yml`) usa la misma llave; una prueba comprueba que coincidan.
 */
export const LLAVE_INDEXNOW = "51b257ee324a98da1d1e5d6bd8094a98";

/** La ruta del archivo de la llave, en la raíz del sitio. */
export const RUTA_LLAVE_INDEXNOW = `/${LLAVE_INDEXNOW}.txt`;

/**
 * Los códigos de verificación de Google Search Console y de Bing Webmaster Tools (propiedad
 * `https://mexicoapi.dagel4k.workers.dev/`). La portada emite su `<meta>`; con uno vacío, no.
 */
export const VERIFICACION_GOOGLE: string = "uHufR-xOP9NNU75Kwg0lXLOfzcrkV5LcSepAOUX2mLQ";
export const VERIFICACION_BING: string = "BE549682F9C6EED45464B22CA34809CA";
