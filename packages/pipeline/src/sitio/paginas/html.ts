import { URL_API } from "@mexicoapi/core/problemas";
import { URL_ARCHIVOS, URL_REPO } from "../meta.js";
import { CSP_404 } from "./encabezados.js";
import { FONDO } from "./estilo.js";

const ENTIDADES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapa texto para el cuerpo o para un atributo entre comillas. Todo texto de datos pasa por aquí. */
export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ENTIDADES[c] as string);
}

/** Espacios o caracteres de control: una URL de datos que los trae no se enlaza. */
const noEnlazable = (url: string): boolean =>
  /\s/.test(url) || [...url].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** Lo que un href válido admite sin codificar (los "URL code points" de WHATWG, `%` y `#`). */
const NO_ADMITIDO = /%(?![0-9A-Fa-f]{2})|[^\w!$&'()*+,\-./:;=?@~%#\u0080-\u{10ffff}]/gu;

const codificar = (c: string): string =>
  [...new TextEncoder().encode(c)]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");

/**
 * La URL normalizada: el parser de URL codifica `{` o `"` en la ruta, pero deja algunos en la
 * query y el fragmento, y esos tampoco son válidos en un href.
 */
const normalizada = (url: string): string => new URL(url).href.replace(NO_ADMITIDO, codificar);

/**
 * Enlace a una URL que viene de los datos. Si no empieza con `https://` o no es una URL válida,
 * devuelve solo el texto: nunca entra a un `href` un `javascript:`, un `data:` o un `http:`.
 */
export function enlaceSeguro(url: string, texto: string): string {
  const enlazable = url.startsWith("https://") && !noEnlazable(url) && URL.canParse(url);
  return enlazable
    ? `<a href="${escaparHtml(normalizada(url))}">${escaparHtml(texto)}</a>`
    : escaparHtml(texto);
}

/** Ruta de un script propio: absoluta, del mismo origen y sin caracteres raros. */
const RUTA_SCRIPT = /^\/[\w.-][\w./-]*$/;

/**
 * Ruta de una página del sitio: absoluta y con la barra final con la que se sirve su
 * `index.html` (`/`, `/estado/`), sin caracteres que haya que codificar.
 */
const RUTA_PAGINA = /^\/(?:[a-z0-9][a-z0-9._-]*\/)*$/;

/** Si `ruta` puede ser la de una página: la que recibe `documento()` y la que lista el sitemap. */
export const esRutaDePagina = (ruta: string): boolean => RUTA_PAGINA.test(ruta);

/** Lo que los buscadores muestran de la descripción antes de cortarla. */
export const MAXIMO_DESCRIPCION = 155;

/**
 * La navegación del sitio. En `/` las secciones son anclas de la página; en las demás apuntan a
 * las de `/`. El enlace de la página en la que se está (`ruta`) lleva `aria-current`; el 404
 * (`null`) no tiene ruta propia. Con `repositorio` (una URL del proyecto, no de los datos), lo
 * enlaza al final.
 */
export function navegacion(ruta: string | null, repositorio?: string): string {
  const prefijo = ruta === "/" ? "" : "/";
  const enlace = (href: string, texto: string): string =>
    `<li><a href="${escaparHtml(href)}"${href === ruta ? ' aria-current="page"' : ""}>${texto}</a></li>`;
  const enlaces = [
    enlace(`${prefijo}#empieza`, "Empieza"),
    enlace(`${prefijo}#datos`, "Datos"),
    enlace(`${prefijo}#descargas`, "Descargas"),
    enlace(`${prefijo}#referencia`, "Referencia"),
    enlace("/estado/", "Estado"),
    ...(repositorio === undefined ? [] : [enlace(repositorio, "GitHub")]),
  ];
  return `<nav class="secciones" aria-label="Secciones">
<ul>
${enlaces.join("\n")}
</ul>
</nav>`;
}

/** El pie de toda página: licencias, repositorio y cómo reportar una vulnerabilidad. */
const PIE = `<footer class="pie">
<div class="marco">
<p>El código es <a href="${URL_ARCHIVOS}/LICENSE">MIT</a>. Los datos conservan los términos de la institución que los publica: ver <a href="${URL_ARCHIVOS}/DATA_LICENSE.md">DATA_LICENSE.md</a>.</p>
<p><a href="${URL_REPO}">Repositorio en GitHub</a> · <a href="${URL_ARCHIVOS}/SECURITY.md">Reportar una vulnerabilidad</a></p>
</div>
</footer>`;

export interface Documento {
  titulo: string;
  descripcion: string;
  /** HTML ya armado del `body`, sin el pie, que se agrega aquí; quien lo arma escapa los datos. */
  cuerpo: string;
  /**
   * La ruta con la que se sirve la página (`/`, `/estado/`): da la URL canónica, que siempre es
   * la de la API pública (también en staging), y la tarjeta de Open Graph. `null` en el 404, que
   * se sirve en cualquier URL: sin canónica ni tarjeta, y con `noindex`.
   */
  ruta: string | null;
  /** Módulos del mismo origen (`/sitio.js`), sin scripts en línea: la CSP no los permite. */
  scripts?: readonly string[];
  /**
   * Para la página que no tiene regla propia en `_headers` (el 404, que solo recibe la de `/*`):
   * su CSP y su política de referrer van en `<meta>`, antes de cualquier recurso.
   */
  seguridadEnMeta?: boolean;
  /**
   * Los nodos de schema.org de la página (`WebSite`, `Dataset`, `BreadcrumbList`), que van en un
   * solo bloque JSON-LD con `@graph`. Es un bloque de datos: no se ejecuta y la CSP no lo bloquea.
   */
  datosEstructurados?: readonly Readonly<Record<string, unknown>>[];
}

const SEGURIDAD_EN_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_404}">
<meta name="referrer" content="no-referrer">
`;

const TEMA = `<meta name="theme-color" content="${FONDO.claro}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${FONDO.oscuro}" media="(prefers-color-scheme: dark)">
`;

/** La canónica y la tarjeta para compartir el enlace (Open Graph, sin imagen). */
function tarjeta(ruta: string, titulo: string, descripcion: string): string {
  if (!esRutaDePagina(ruta)) throw new Error(`ruta de página inválida: ${ruta}`);
  const canonica = escaparHtml(`${URL_API}${ruta}`);
  return `<link rel="canonical" href="${canonica}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MéxicoAPI">
<meta property="og:locale" content="es_MX">
<meta property="og:title" content="${escaparHtml(titulo)}">
<meta property="og:description" content="${escaparHtml(descripcion)}">
<meta property="og:url" content="${canonica}">
<meta name="twitter:card" content="summary">
`;
}

/**
 * JSON para un bloque `<script type="application/ld+json">`: `<`, `>` y `&` van como `\u003c`,
 * `\u003e` y `\u0026`, así que un texto de los datos no cierra el bloque ni abre un comentario;
 * U+2028 y U+2029 también van escapados. El JSON que se lee es el mismo.
 */
export function jsonEnScript(valor: unknown): string {
  return JSON.stringify(valor).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const bloqueJsonLd = (nodos: Documento["datosEstructurados"]): string => {
  if (nodos === undefined) return "";
  const json = jsonEnScript({ "@context": "https://schema.org", "@graph": nodos });
  return `<script type="application/ld+json">${json}</script>\n`;
};

export function documento({
  titulo,
  descripcion,
  cuerpo,
  ruta,
  scripts = [],
  seguridadEnMeta = false,
  datosEstructurados,
}: Documento): string {
  if ([...descripcion].length > MAXIMO_DESCRIPCION) {
    throw new Error(`la descripción pasa de ${MAXIMO_DESCRIPCION} caracteres: ${descripcion}`);
  }
  const modulos = scripts.map((src) => {
    if (!RUTA_SCRIPT.test(src)) throw new Error(`script fuera del sitio: ${src}`);
    return `<script type="module" src="${src}"></script>\n`;
  });
  const indexacion =
    ruta === null ? '<meta name="robots" content="noindex">\n' : tarjeta(ruta, titulo, descripcion);
  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
${seguridadEnMeta ? SEGURIDAD_EN_META : ""}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparHtml(titulo)}</title>
<meta name="description" content="${escaparHtml(descripcion)}">
${indexacion}${TEMA}<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/estilo.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${modulos.join("")}${bloqueJsonLd(datosEstructurados)}</head>
<body>
${cuerpo}
${PIE}
</body>
</html>
`;
}
