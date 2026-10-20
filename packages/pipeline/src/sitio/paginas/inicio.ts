import type { DetalleClabe, ResultadoValidacion } from "@mexicoapi/core";
import { URL_API } from "@mexicoapi/core/problemas";
import { PUBLICADO_EN_NPM, porNombre } from "../comun.js";
import { type Meta, URL_ARCHIVOS, URL_DOCS, URL_REPO } from "../meta.js";
import { describir } from "./catalogo.js";
import { documento, enlaceSeguro, escaparHtml, navegacion } from "./html.js";

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
  /** Lo actualiza un bot desde su fuente o una persona desde publicaciones oficiales. */
  tipo: "automatico" | "curado";
  as_of: string;
  /** En las series (FIX y UDIS), la fecha de su registro más reciente: `cobertura.hasta`. */
  ultimo_dato?: string;
  registros: number;
  fuentes: readonly FuenteInicio[];
  docs: string;
}

export interface EntradaInicio {
  datasets: readonly DatasetInicio[];
  /** Cada archivo de `/descargas/` con su contenido. */
  descargas: ReadonlyMap<string, Uint8Array | string>;
  /** Lo que se muestra de la respuesta de `/v1/clabe/{CLABE_EJEMPLO}` (`respuestaRecortada`). */
  ejemplo: unknown;
}

/** La CLABE de los ejemplos: Banamex, con su dígito de control. */
export const CLABE_EJEMPLO = "002010077777777771";

/**
 * Lo que la página muestra de la respuesta de `/v1/clabe/{clabe}`: el veredicto, el banco y la
 * primera fuente, con los mismos valores y en la misma forma que la respuesta completa.
 */
export function respuestaRecortada(respuesta: {
  data: ResultadoValidacion<DetalleClabe>;
  meta: Pick<Meta, "dataset" | "as_of" | "sources">;
}): unknown {
  const { data, meta } = respuesta;
  return {
    data: {
      valor: data.valor,
      valido: data.valido,
      errores: data.errores,
      detalle: { banco: data.detalle?.banco ?? null },
    },
    meta: {
      dataset: meta.dataset,
      as_of: meta.as_of,
      sources: meta.sources.slice(0, 1).map((s) => ({ name: s.name, license: s.license })),
    },
  };
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

/**
 * La base de los ejemplos: la API pública, que es la que funciona sin JavaScript. `sitio.js` la
 * cambia por el origen de la página, que sirve la misma API (otro despliegue o `wrangler dev`).
 */
const ORIGEN = `<span data-origen>${escaparHtml(URL_API)}</span>`;

const codigo = (texto: string): string =>
  `<pre tabindex="0"><code>${escaparHtml(texto)}</code></pre>`;

/**
 * Un comando copiable de un paquete que todavía no está en npm falla, o instala el de alguien que
 * tomó el nombre: mientras no se publiquen, un solo aviso en lugar de sus bloques.
 */
const PENDIENTE = `<p class="aviso"><strong>Pendiente:</strong> el paquete <code>mexicoapi</code> y el servidor MCP <code>mexicoapi-mcp</code> se publicarán en npm; mientras tanto, usa la API. Lo que traen está en sus README: <a href="${URL_ARCHIVOS}/packages/sdk/README.md">paquete</a> y <a href="${URL_ARCHIVOS}/packages/mcp/README.md">servidor MCP</a>.</p>`;

const EJEMPLO_CLABE = `import { validarClabe } from "mexicoapi";

const r = validarClabe("${CLABE_EJEMPLO}");
r.valido; // true`;

const CONFIGURACION_MCP = `{
  "mcpServers": {
    "mexicoapi": {
      "command": "npx",
      "args": ["-y", "mexicoapi-mcp"]
    }
  }
}`;

function bloqueApi(ejemplo: unknown): string {
  return `<div class="bloque">
<h3>API</h3>
<p>Sin llave ni cuenta. Cada respuesta trae el dato en <code>data</code> y su fuente, licencia y fecha en <code>meta</code>.</p>
<pre tabindex="0"><code>curl ${ORIGEN}/v1/estados/25
curl ${ORIGEN}/v1/clabe/${CLABE_EJEMPLO}</code></pre>
<p>La respuesta de la CLABE, recortada:</p>
${codigo(JSON.stringify(ejemplo, null, 2))}
<p>Para sumar días hábiles: <code>/v1/dias-habiles?autoridad=lft&amp;desde=2026-12-18&amp;dias=3</code>, también con <code>cnbv</code>; con <code>sat</code>, agrega <code>tipo_plazo=general</code> o <code>tipo_plazo=declaraciones_pagos</code>. Las fechas van en <code>AAAA-MM-DD</code> y son días de la Ciudad de México.</p>
</div>`;
}

/** Ya publicados, la API, el paquete y el servidor van en tres bloques; antes, la API y un aviso. */
function empieza(publicado: boolean, ejemplo: unknown): string {
  const contenido = publicado
    ? `<div class="bloques">
${bloqueApi(ejemplo)}
<div class="bloque">
<h3>Paquete de npm</h3>
<p>Validadores, reglas y los mismos datos para JavaScript y TypeScript, sin dependencias y sin red.</p>
${codigo("npm install mexicoapi")}
${codigo(EJEMPLO_CLABE)}
</div>
<div class="bloque">
<h3>Servidor MCP</h3>
<p>Los mismos datos y validadores como herramientas de un servidor MCP por stdio.</p>
<p>Agrégalo a la configuración de tu cliente:</p>
${codigo(CONFIGURACION_MCP)}
</div>
</div>`
    : `${bloqueApi(ejemplo)}\n${PENDIENTE}`;
  return `<section id="empieza" aria-labelledby="titulo-empieza">
<h2 id="titulo-empieza">Empieza</h2>
${contenido}
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

const tiempo = (fecha: string): string => {
  const texto = escaparHtml(fecha);
  return `<time datetime="${texto}">${texto}</time>`;
};

const conMayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/** Las rutas del dataset, la principal primero, cada una con lo que responde si el catálogo lo dice. */
function rutasApi(id: string): string {
  const { ruta, nota, otras = [] } = describir(id);
  if (ruta === null) return "Solo en descargas";
  return [{ ruta, nota }, ...otras]
    .map(
      (r) =>
        `<code>${escaparHtml(r.ruta)}</code>${r.nota === undefined ? "" : `<span class="detalle">${escaparHtml(conMayuscula(r.nota))}</span>`}`,
    )
    .join("");
}

function datos(entrada: EntradaInicio): string {
  const existe = (archivo: string): boolean => entrada.descargas.has(archivo);
  // data-etiqueta: debajo de 640 px cada renglón es una tarjeta y la hoja la usa como etiqueta.
  const celda = (etiqueta: string, clase: string, contenido: string): string =>
    `<td class="${clase}" data-etiqueta="${etiqueta}">${contenido}</td>`;
  const filas = entrada.datasets.map((d) => {
    const { nombre } = describir(d.id);
    const nombreHtml = escaparHtml(nombre);
    const ultimo =
      d.ultimo_dato === undefined
        ? ""
        : `<span class="detalle">último dato ${tiempo(d.ultimo_dato)}</span>`;
    return `<tr>
<th scope="row">${enlaceSeguro(d.docs, nombre)}<span class="id">${escaparHtml(d.id)}</span><span class="detalle">${d.tipo === "curado" ? "Curado" : "Automático"}</span></th>
${celda("Datos al", "junto", `${tiempo(d.as_of)}${ultimo}`)}
${celda("Registros", "num", formatearEntero(d.registros))}
${celda("Fuente y licencia", "fuentes", fuentes(d.fuentes))}
${celda("API", "rutas", rutasApi(d.id))}
${celda("Descargas", "junto", descargasDe(d, nombreHtml, existe))}
</tr>`;
  });
  return `<section id="datos" aria-labelledby="titulo-datos">
<h2 id="titulo-datos">Datos</h2>
<p>Los datasets automáticos los actualiza un bot desde su fuente; los curados se transcriben de publicaciones oficiales y se verifican contra ellas. <em>Datos al</em> es, en los automáticos, la fecha de la última actualización que los cambió y, en los curados, la de su publicación oficial más reciente; en <a href="/estado/">Estado</a> se ve si cada dataset automático está al día. En las series (FIX y UDIS), el <em>último dato</em> es la fecha de su registro más reciente: el FIX no se publica en fines de semana ni en feriados bancarios, y las UDIS se publican por adelantado.</p>
<div class="tabla tarjetas" role="region" aria-labelledby="tabla-datos" tabindex="0">
<table>
<caption id="tabla-datos">${entrada.datasets.length} datasets, con su fecha, fuente y licencia</caption>
<thead>
<tr><th scope="col">Dataset</th><th scope="col">Datos al</th><th scope="col" class="num">Registros</th><th scope="col">Fuente y licencia</th><th scope="col">API</th><th scope="col">Descargas</th></tr>
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
  const lft = ["json", "csv"].every((e) => entrada.descargas.has(`dias-inhabiles-lft.${e}`))
    ? ' Los días de descanso obligatorio de la LFT (art. 74), que se calculan por regla y no son un dataset, están en <a href="/descargas/dias-inhabiles-lft.json">JSON</a> y <a href="/descargas/dias-inhabiles-lft.csv">CSV</a>, de 2007 a 2100.'
    : "";
  const nombres = [...entrada.descargas.keys()].sort(porNombre);
  const filas = nombres.map((nombre) => {
    const archivo = escaparHtml(nombre);
    return `<tr><th scope="row"><a href="/descargas/${archivo}">${archivo}</a></th><td class="num">${tamano(nombre)}</td></tr>`;
  });
  return `<section id="descargas" aria-labelledby="titulo-descargas">
<h2 id="titulo-descargas">Descargas</h2>
<p>Todo junto en <a href="/descargas/mexicoapi.sqlite">mexicoapi.sqlite</a> (${sqlite}): una base SQLite con todos los datasets y el manifiesto de cada uno. Cada dataset también se descarga en JSON y CSV, con su manifiesto.${lft}</p>
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
<dd>Si cada dataset automático está al día y cuándo se revisó por última vez.</dd>
</dl>
</section>`;

/** `index.html`: qué es, cómo empezar, qué datos hay, las descargas y la referencia. */
export function paginaInicio(entrada: EntradaInicio, publicado = PUBLICADO_EN_NPM): string {
  const ruta = "/";
  const cuerpo = `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
<div class="marco">
<h1>MéxicoAPI</h1>
<p class="lema">Datos de referencia de México con fuente oficial, licencia y sha256.</p>
${navegacion(ruta, URL_REPO)}
</div>
</header>
<main id="contenido" class="marco">
<p class="intro">Una API JSON de solo lectura, sin llave ni cuenta, con ${entrada.datasets.length} datasets oficiales y descargas completas en JSON, CSV y SQLite. Cada dato dice de qué fuente salió, con qué licencia y de qué fecha, y cada archivo publica su sha256.</p>
${empieza(publicado, entrada.ejemplo)}
${datos(entrada)}
${descargas(entrada)}
${REFERENCIA}
</main>`;
  return documento({
    titulo: "MéxicoAPI: datos de referencia de México con fuente oficial",
    descripcion:
      "API JSON sin llave y descargas en JSON, CSV y SQLite: catálogos, indicadores, calendarios y constantes oficiales de México, con fuente, licencia y sha256.",
    cuerpo,
    ruta,
    scripts: ["/sitio.js"],
  });
}
