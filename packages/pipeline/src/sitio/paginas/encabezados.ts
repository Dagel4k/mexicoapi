/**
 * El `_headers` de los assets: lo de todas las URL, las descargas y las rutas del sitio.
 * Cloudflare aplica todas las reglas que coinciden con la URL pedida y junta con coma un
 * encabezado repetido, así que ningún encabezado sale en dos reglas que alcancen la misma URL.
 *
 * `/*` lleva lo que vale en cualquier URL: alcanza también al 404 (que se sirve en la URL pedida)
 * y a las redirecciones. Ahí no va la CSP ni la caché, que cambian por ruta: el 404 lleva
 * `CSP_404` en `<meta>`. Los otros comodines son los de las familias de páginas de datos
 * (`/municipios/*`): una regla con la CSP de las páginas para la de arriba y todas sus hijas, a
 * cuyas rutas no llega ninguna otra regla de la lista. Las respuestas del Worker en `/v1` no
 * reciben estas reglas; ponen sus propios encabezados (`respuestas.ts` de la API).
 */

type Encabezados = readonly (readonly [string, string])[];

interface Regla {
  ruta: string;
  encabezados: Encabezados;
}

export const CSP_PAGINAS =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * La CSP del 404, en `<meta http-equiv>`: solo la hoja de estilo y el favicon. Sin
 * `frame-ancestors`, que en una meta no vale y el navegador avisa en la consola.
 */
export const CSP_404 =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";

/** Lo que no es una página no carga nada. */
const CSP_ARCHIVOS = "default-src 'none'";

/** HTML, CSS y JS no llevan hash en el nombre: se revalidan pronto. */
const CACHE_SITIO = "public, max-age=300";

/**
 * La regla `/*`: sin CSP ni caché, que se juntarían con las de cada ruta. HSTS sin
 * includeSubDomains ni preload; `Vary` porque la plataforma comprime según `Accept-Encoding`. El
 * sitio no usa cámara, micrófono ni ubicación, y ninguna página comparte su ventana con otro origen.
 */
const TODAS: Regla = {
  ruta: "/*",
  encabezados: [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["X-Frame-Options", "DENY"],
    ["Strict-Transport-Security", "max-age=31536000"],
    ["Vary", "Accept-Encoding"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ],
};

const SEGURIDAD_DESCARGAS: Encabezados = [
  ["Access-Control-Allow-Origin", "*"],
  ["Content-Security-Policy", CSP_ARCHIVOS],
  ["Cache-Control", "public, max-age=3600, stale-while-revalidate=86400"],
];

const sitio = (ruta: string, csp: string, cache: string, extra: Encabezados = []): Regla => ({
  ruta,
  encabezados: [["Content-Security-Policy", csp], ["Cache-Control", cache], ...extra],
});

const TEXTO_PARA_TODOS: Encabezados = [
  ["Content-Type", "text/plain; charset=utf-8"],
  ["Access-Control-Allow-Origin", "*"],
];

const REGLAS_SITIO: readonly Regla[] = [
  sitio("/", CSP_PAGINAS, CACHE_SITIO),
  sitio("/estado/", CSP_PAGINAS, CACHE_SITIO),
  sitio("/estilo.css", CSP_ARCHIVOS, CACHE_SITIO),
  sitio("/sitio.js", CSP_ARCHIVOS, CACHE_SITIO),
  sitio("/favicon.svg", CSP_ARCHIVOS, "public, max-age=86400"),
  sitio("/robots.txt", CSP_ARCHIVOS, "public, max-age=86400"),
  // Su lastmod cambia con los datos.
  sitio("/sitemap.xml", CSP_ARCHIVOS, "public, max-age=3600", [
    ["Content-Type", "application/xml; charset=utf-8"],
  ]),
  sitio("/llms.txt", CSP_ARCHIVOS, "public, max-age=3600", TEXTO_PARA_TODOS),
  sitio("/llms-full.txt", CSP_ARCHIVOS, "public, max-age=3600", TEXTO_PARA_TODOS),
];

/** Las rutas del sitio con regla propia, en el orden del archivo. */
export const RUTAS_SITIO: readonly string[] = REGLAS_SITIO.map((r) => r.ruta);

function tipoContenido(nombre: string): string {
  if (nombre.endsWith(".json")) return "application/json; charset=utf-8";
  if (nombre.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (nombre.endsWith(".sqlite")) return "application/vnd.sqlite3";
  return "text/plain; charset=utf-8";
}

const texto = ({ ruta, encabezados }: Regla): string =>
  `${ruta}\n${encabezados.map(([nombre, valor]) => `  ${nombre}: ${valor}\n`).join("")}`;

/**
 * La ruta de una página de datos: con barra final, como se sirve su `index.html`, y no la raíz;
 * o, para una familia de páginas, esa ruta con `*` al final (`/municipios/*`), que la cubre a ella
 * y a todas las que cuelgan de ella.
 */
const RUTA_PAGINA = /^\/(?:[a-z0-9][a-z0-9._-]*\/)+\*?$/;

/** Si la regla (con comodín al final o sin él) alcanza la ruta. */
const alcanza = (regla: string, ruta: string): boolean =>
  regla.endsWith("*") ? ruta.startsWith(regla.slice(0, -1)) : regla === ruta;

/**
 * El archivo completo: `/*`, una regla por descarga con su tipo y lo de todas, las del sitio y una
 * por cada página de datos o familia de páginas (`paginas`), con la CSP y la caché de las páginas.
 * Lanza Error si una página está mal escrita, se repite, ya es una ruta del sitio o la alcanza otra
 * regla de la lista (Cloudflare juntaría con coma sus encabezados).
 */
export function archivoEncabezados(
  descargas: readonly string[],
  paginas: readonly string[] = [],
): string {
  const vistas = new Set(RUTAS_SITIO);
  for (const ruta of paginas) {
    if (!RUTA_PAGINA.test(ruta)) throw new Error(`ruta de página inválida en _headers: ${ruta}`);
    if (vistas.has(ruta)) throw new Error(`página repetida en _headers: ${ruta}`);
    vistas.add(ruta);
  }
  for (const regla of paginas) {
    for (const otra of paginas) {
      if (otra !== regla && alcanza(regla, otra.replace(/\*$/, ""))) {
        throw new Error(`la página ${otra} ya la cubre ${regla} en _headers`);
      }
    }
  }
  const reglas: Regla[] = [TODAS];
  for (const nombre of descargas) {
    reglas.push({
      ruta: `/descargas/${nombre}`,
      encabezados: [["Content-Type", tipoContenido(nombre)], ...SEGURIDAD_DESCARGAS],
    });
  }
  reglas.push(...REGLAS_SITIO, ...paginas.map((ruta) => sitio(ruta, CSP_PAGINAS, CACHE_SITIO)));
  return reglas.map(texto).join("\n");
}
