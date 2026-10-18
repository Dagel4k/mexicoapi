/**
 * El `_headers` de los assets: las descargas y las rutas del sitio. Cloudflare aplica todas las
 * reglas que coinciden con la URL pedida y junta con coma un encabezado repetido, así que cada
 * ruta tiene una sola regla con todo lo suyo.
 *
 * No hay regla `/*`: chocaría con la CSP, el nosniff y la caché de `/descargas/*` y de cada ruta
 * del sitio. Por eso el 404 (cualquier URL que no es un asset) sale sin CSP; es una página
 * estática, sin scripts, que no repite nada de la petición.
 */

type Encabezados = readonly (readonly [string, string])[];

interface Regla {
  ruta: string;
  encabezados: Encabezados;
}

export const CSP_PAGINAS =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Lo que no es una página no carga nada. */
const CSP_ARCHIVOS = "default-src 'none'";

/** HTML, CSS y JS no llevan hash en el nombre: se revalidan pronto. */
const CACHE_SITIO = "public, max-age=300";

const SEGURIDAD_DESCARGAS: Encabezados = [
  ["Access-Control-Allow-Origin", "*"],
  ["X-Content-Type-Options", "nosniff"],
  ["Content-Security-Policy", CSP_ARCHIVOS],
  ["Cache-Control", "public, max-age=3600, stale-while-revalidate=86400"],
];

const sitio = (ruta: string, csp: string, cache: string, extra: Encabezados = []): Regla => ({
  ruta,
  encabezados: [
    ["Content-Security-Policy", csp],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Cache-Control", cache],
    ...extra,
  ],
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

/** El archivo completo: una regla por descarga con su tipo, la general de descargas y el sitio. */
export function archivoEncabezados(descargas: readonly string[]): string {
  const reglas: Regla[] = descargas.map((nombre) => ({
    ruta: `/descargas/${nombre}`,
    encabezados: [["Content-Type", tipoContenido(nombre)]],
  }));
  reglas.push({ ruta: "/descargas/*", encabezados: SEGURIDAD_DESCARGAS }, ...REGLAS_SITIO);
  return reglas.map(texto).join("\n");
}
