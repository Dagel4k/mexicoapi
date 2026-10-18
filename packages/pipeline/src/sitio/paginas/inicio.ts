import { URL_ARCHIVOS, URL_DOCS, URL_REPO } from "../meta.js";
import { describir } from "./catalogo.js";
import { documento, enlaceSeguro, escaparHtml, navegacion } from "./html.js";

/** Cambia a `true` con la primera publicación de `mexicoapi` y `mexicoapi-mcp` en npm. */
export const PUBLICADO_EN_NPM = false;

export interface FuenteInicio {
  name: string;
  url: string;
  license: string;
  license_url: string;
  published_at: string | null;
}

/** Lo que la página muestra de cada dataset; sale de su manifiesto. */
export interface DatasetInicio {
  id: string;
  /** Carpeta en `data/` y prefijo de sus descargas. */
  directorio: string;
  as_of: string;
  registros: number;
  fuentes: readonly FuenteInicio[];
  docs: string;
}

export interface EntradaInicio {
  datasets: readonly DatasetInicio[];
  /** Cada archivo de `/descargas/` con su contenido. */
  descargas: ReadonlyMap<string, Uint8Array | string>;
}

const UNIDADES = ["KB", "MB", "GB"] as const;

/** Tamaño en unidades de 1024, con un decimal por debajo de 10: `512 B`, `1.5 KB`, `300 MB`. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let valor = bytes / 1024;
  let unidad = 0;
  // Lo que redondearía a 1024 pasa a la unidad siguiente.
  while (valor >= 1023.5 && unidad < UNIDADES.length - 1) {
    valor /= 1024;
    unidad += 1;
  }
  const numero = valor < 9.95 ? valor.toFixed(1) : String(Math.round(valor));
  return `${numero} ${UNIDADES[unidad]}`;
}

/** Miles con coma, como se escriben en México. */
export const formatearEntero = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Orden por unidades de código UTF-16, igual que SHA256SUMS. */
const porNombre = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** El ejemplo de `https://<base>`: `sitio.js` lo cambia por el origen de la página. */
const ORIGEN = "<span data-origen>https://&lt;base&gt;</span>";

const codigo = (texto: string): string =>
  `<pre tabindex="0"><code>${escaparHtml(texto)}</code></pre>`;

function aviso(que: string, publicado: boolean): string {
  return publicado
    ? ""
    : `<p class="aviso"><strong>Pendiente:</strong> ${que} se publicará en npm; mientras tanto, usa la API.</p>\n`;
}

const EJEMPLO_CLABE = `import { validarClabe } from "mexicoapi";

const r = validarClabe("002010077777777771");
r.valido; // true`;

const CONFIGURACION_MCP = `{
  "mcpServers": {
    "mexicoapi": {
      "command": "npx",
      "args": ["-y", "mexicoapi-mcp"]
    }
  }
}`;

function empieza(publicado: boolean): string {
  return `<section id="empieza" aria-labelledby="titulo-empieza">
<h2 id="titulo-empieza">Empieza</h2>
<div class="bloques">
<div class="bloque">
<h3>API</h3>
<p>Sin llave ni cuenta. Cada respuesta trae el dato en <code>data</code> y su fuente, licencia y fecha en <code>meta</code>.</p>
<pre tabindex="0"><code>curl ${ORIGEN}/v1/estados/25</code></pre>
<noscript><p>Cambia <code>https://&lt;base&gt;</code> por la dirección de este sitio.</p></noscript>
</div>
<div class="bloque">
<h3>Paquete de npm</h3>
<p>Validadores, reglas y los mismos datos para JavaScript y TypeScript, sin dependencias y sin red.</p>
${aviso("el paquete", publicado)}${codigo("npm install mexicoapi")}
${codigo(EJEMPLO_CLABE)}
</div>
<div class="bloque">
<h3>Servidor MCP</h3>
<p>Los mismos datos y validadores como herramientas de un servidor MCP por stdio. Agrégalo a la configuración de tu cliente:</p>
${aviso("el servidor", publicado)}${codigo(CONFIGURACION_MCP)}
</div>
</div>
</section>`;
}

function fuentes(lista: readonly FuenteInicio[]): string {
  const elementos = lista.map((f) => {
    const fecha =
      lista.length > 2 && f.published_at !== null ? ` (${escaparHtml(f.published_at)})` : "";
    return `<li>${enlaceSeguro(f.url, f.name)}${fecha}</li>`;
  });
  const ul = `<ul>\n${elementos.join("\n")}\n</ul>`;
  const nombres =
    lista.length > 2
      ? `<details>\n<summary>${lista.length} fuentes</summary>\n${ul}\n</details>`
      : ul;
  const licencias = new Map<string, FuenteInicio>();
  for (const f of lista) licencias.set(`${f.license_url}\n${f.license}`, f);
  const terminos = [...licencias.values()].map(
    (f) => `<p class="licencia">Licencia: ${enlaceSeguro(f.license_url, f.license)}</p>`,
  );
  return `${nombres}\n${terminos.join("\n")}`;
}

function descargasDe(
  d: DatasetInicio,
  nombre: string,
  existe: (archivo: string) => boolean,
): string {
  const enlaces = [
    ["json", "JSON"],
    ["csv", "CSV"],
  ]
    .map(([extension, formato]) => [`${d.directorio}.${extension}`, formato] as const)
    .filter(([archivo]) => existe(archivo))
    .map(
      ([archivo, formato]) =>
        `<a href="/descargas/${escaparHtml(archivo)}">${formato}<span class="oculto"> de ${nombre}</span></a>`,
    );
  return enlaces.join(" · ");
}

function datos(entrada: EntradaInicio): string {
  const existe = (archivo: string): boolean => entrada.descargas.has(archivo);
  const filas = entrada.datasets.map((d) => {
    const { nombre, ruta } = describir(d.id);
    const nombreHtml = escaparHtml(nombre);
    const api = ruta === null ? "Solo en descargas" : `<code>${escaparHtml(ruta)}</code>`;
    const fecha = escaparHtml(d.as_of);
    return `<tr>
<th scope="row">${enlaceSeguro(d.docs, nombre)}<span class="id">${escaparHtml(d.id)}</span></th>
<td class="junto"><time datetime="${fecha}">${fecha}</time></td>
<td class="num">${formatearEntero(d.registros)}</td>
<td class="fuentes">${fuentes(d.fuentes)}</td>
<td class="junto">${api}</td>
<td class="junto">${descargasDe(d, nombreHtml, existe)}</td>
</tr>`;
  });
  return `<section id="datos" aria-labelledby="titulo-datos">
<h2 id="titulo-datos">Datos</h2>
<p>Los datasets automáticos los actualiza un bot desde su fuente; los curados se transcriben de publicaciones oficiales y se verifican contra ellas. La fecha es la de su última actualización; en <a href="/estado/">Estado</a> se ve si cada uno está al día.</p>
<div class="tabla" role="region" aria-labelledby="tabla-datos" tabindex="0">
<table>
<caption id="tabla-datos">${entrada.datasets.length} datasets, con su fecha, fuente y licencia</caption>
<thead>
<tr><th scope="col">Dataset</th><th scope="col">Actualizado</th><th scope="col" class="num">Registros</th><th scope="col">Fuente y licencia</th><th scope="col">API</th><th scope="col">Descargas</th></tr>
</thead>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</div>
</section>`;
}

function descargas(entrada: EntradaInicio): string {
  const tamano = (nombre: string): string => {
    const contenido = entrada.descargas.get(nombre);
    if (contenido === undefined) throw new Error(`falta la descarga ${nombre}`);
    return tamanoLegible(Buffer.byteLength(contenido));
  };
  const sqlite = tamano("mexicoapi.sqlite");
  tamano("SHA256SUMS");
  const nombres = [...entrada.descargas.keys()].sort(porNombre);
  const filas = nombres.map((nombre) => {
    const archivo = escaparHtml(nombre);
    return `<tr><th scope="row"><a href="/descargas/${archivo}">${archivo}</a></th><td class="num">${tamano(nombre)}</td></tr>`;
  });
  return `<section id="descargas" aria-labelledby="titulo-descargas">
<h2 id="titulo-descargas">Descargas</h2>
<p>Todo junto en <a href="/descargas/mexicoapi.sqlite">mexicoapi.sqlite</a> (${sqlite}): una base SQLite con todos los datasets y el manifiesto de cada uno. Cada dataset también se descarga en JSON y CSV, con su manifiesto.</p>
<p><a href="/descargas/SHA256SUMS">SHA256SUMS</a> trae el sha256 de cada archivo. Para verificar lo que bajaste:</p>
<pre tabindex="0"><code>curl -O ${ORIGEN}/descargas/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing</code></pre>
<details>
<summary>Los ${nombres.length} archivos, con su tamaño</summary>
<div class="tabla" role="region" aria-labelledby="tabla-descargas" tabindex="0">
<table>
<caption id="tabla-descargas">Archivos de /descargas/</caption>
<thead>
<tr><th scope="col">Archivo</th><th scope="col" class="num">Tamaño</th></tr>
</thead>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</div>
</details>
</section>`;
}

const REFERENCIA = `<section id="referencia" aria-labelledby="titulo-referencia">
<h2 id="titulo-referencia">Referencia</h2>
<dl>
<dt><a href="/v1/openapi.json">/v1/openapi.json</a></dt>
<dd>Especificación OpenAPI 3.1 de todas las rutas, para generar clientes o validar respuestas.</dd>
<dt><a href="${URL_DOCS}/api/README.md">Guía de la API</a></dt>
<dd>Rutas, parámetros, ejemplos de respuesta, caché, CORS y límite de peticiones.</dd>
<dt><a href="${URL_DOCS}/api/problemas.md">Errores</a></dt>
<dd>Los errores responden <code>application/problem+json</code>; cada tipo está documentado.</dd>
<dt><a href="/llms.txt">/llms.txt</a></dt>
<dd>Resumen del sitio en texto plano, con la documentación completa en <code>/llms-full.txt</code>.</dd>
<dt><a href="/estado/">Estado</a></dt>
<dd>Si cada dataset está al día y cuándo se actualizó por última vez.</dd>
</dl>
</section>`;

const PIE = `<footer class="pie">
<div class="marco">
<p>El código es <a href="${URL_ARCHIVOS}/LICENSE">MIT</a>. Los datos conservan los términos de la institución que los publica: ver <a href="${URL_ARCHIVOS}/DATA_LICENSE.md">DATA_LICENSE.md</a>.</p>
<p><a href="${URL_REPO}">Repositorio en GitHub</a> · <a href="${URL_ARCHIVOS}/SECURITY.md">Reportar una vulnerabilidad</a></p>
</div>
</footer>`;

/** `index.html`: qué es, cómo empezar, qué datos hay, las descargas y la referencia. */
export function paginaInicio(entrada: EntradaInicio, publicado = PUBLICADO_EN_NPM): string {
  const cuerpo = `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
<div class="marco">
<h1>MéxicoAPI</h1>
<p class="lema">Datos de referencia de México con fuente oficial, licencia y sha256.</p>
${navegacion(true)}
</div>
</header>
<main id="contenido" class="marco">
<p class="intro">Una API JSON de solo lectura, sin llave ni cuenta, con ${entrada.datasets.length} datasets oficiales, y descargas completas en JSON, CSV y SQLite. Cada dato dice de qué fuente salió, con qué licencia y de qué fecha, y cada archivo publica su sha256.</p>
${empieza(publicado)}
${datos(entrada)}
${descargas(entrada)}
${REFERENCIA}
</main>
${PIE}`;
  return documento({
    titulo: "MéxicoAPI: datos de referencia de México con fuente oficial",
    descripcion:
      "API JSON sin llave y descargas en JSON, CSV y SQLite con datos oficiales de México: catálogos, indicadores, calendarios y constantes, cada uno con su fuente, licencia y sha256.",
    cuerpo,
    scripts: ["/sitio.js"],
  });
}
