/**
 * El `_headers` de los assets: lo de todas las URL, las descargas y las rutas del sitio.
 * Cloudflare aplica todas las reglas que coinciden con la URL pedida y junta con coma un
 * encabezado repetido, así que ningún encabezado sale en dos reglas que alcancen la misma URL.
 *
 * El único comodín es `/*`, con lo que vale en cualquier URL: alcanza también al 404 (que se
 * sirve en la URL pedida) y a las redirecciones. Ahí no va la CSP ni la caché, que cambian por
 * ruta: el 404 lleva `CSP_404` en `<meta>`. Las respuestas del Worker en `/v1` no reciben estas
 * reglas; ponen sus propios encabezados (`respuestas.ts` de la API).
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

/** La regla `/*`: sin CSP ni caché, que se juntarían con las de cada ruta. */
const TODAS: Regla = {
  ruta: "/*",
  encabezados: [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["X-Frame-Options", "DENY"],
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

/** El archivo completo: `/*`, una regla por descarga con su tipo y lo de todas, y las del sitio. */
export function archivoEncabezados(descargas: readonly string[]): string {
  const reglas: Regla[] = [TODAS];
  for (const nombre of descargas) {
    reglas.push({
      ruta: `/descargas/${nombre}`,
      encabezados: [["Content-Type", tipoContenido(nombre)], ...SEGURIDAD_DESCARGAS],
    });
  }
  reglas.push(...REGLAS_SITIO);
  return reglas.map(texto).join("\n");
}
