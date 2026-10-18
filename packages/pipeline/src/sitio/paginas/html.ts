import { CSP_404 } from "./encabezados.js";

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

/** La navegación del sitio: desde otra página, las secciones apuntan a las de `/`. */
export function navegacion(desdeInicio: boolean): string {
  const prefijo = desdeInicio ? "" : "/";
  const secciones = [
    ["empieza", "Empieza"],
    ["datos", "Datos"],
    ["descargas", "Descargas"],
    ["referencia", "Referencia"],
  ]
    .map(([id, texto]) => `<li><a href="${prefijo}#${id}">${texto}</a></li>`)
    .join("\n");
  return `<nav class="secciones" aria-label="Secciones">
<ul>
${secciones}
<li><a href="/estado/">Estado</a></li>
</ul>
</nav>`;
}

export interface Documento {
  titulo: string;
  descripcion: string;
  /** HTML ya armado del `body`; quien lo arma escapa los datos. */
  cuerpo: string;
  /** Módulos del mismo origen (`/sitio.js`), sin scripts en línea: la CSP no los permite. */
  scripts?: readonly string[];
  /**
   * Para la página que se sirve sin reglas de `_headers` (el 404): su CSP y su política de
   * referrer van en `<meta>`, antes de cualquier recurso.
   */
  seguridadEnMeta?: boolean;
}

const SEGURIDAD_EN_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_404}">
<meta name="referrer" content="no-referrer">
`;

export function documento({
  titulo,
  descripcion,
  cuerpo,
  scripts = [],
  seguridadEnMeta = false,
}: Documento): string {
  const modulos = scripts.map((src) => {
    if (!RUTA_SCRIPT.test(src)) throw new Error(`script fuera del sitio: ${src}`);
    return `<script type="module" src="${src}"></script>\n`;
  });
  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
${seguridadEnMeta ? SEGURIDAD_EN_META : ""}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparHtml(titulo)}</title>
<meta name="description" content="${escaparHtml(descripcion)}">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/estilo.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${modulos.join("")}</head>
<body>
${cuerpo}
</body>
</html>
`;
}
