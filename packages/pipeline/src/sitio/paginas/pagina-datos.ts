// Las páginas de datos: una por tema, con el dato completo, su fuente oficial, la fecha de los
// datos y cómo pedirlo por API, por el paquete o en descarga. Cada tema arma su `PaginaDatos` con
// lo que lee de `data/` en el build; aquí se valida el registro y se arma el HTML y el JSON-LD.
import type { FechaISO } from "@mexicoapi/core";
import { fechaEnTexto } from "@mexicoapi/core/rutas";
import type { FuenteMeta } from "../meta.js";
import { codigo, enPowerShell, rutaPartible, tamanoLegible, VARIABLE_API } from "./bloques.js";
import { NOMBRE_SITIO, nodoDataset, nodoMigas } from "./datos-estructurados.js";
import { RUTA_ESTADO } from "./estado.js";
import { documento, enlaceSeguro, escaparHtml, esRutaDePagina, navegacion } from "./html.js";

/** Un texto oficial que respalda los datos de la página, citado tal cual. */
export interface CitaPagina {
  /** El nombre de la publicación, como en la `fuente` de cada registro. */
  nombre: string;
  url: string;
  /** Los fragmentos citados de esa publicación, en orden. */
  fragmentos: readonly string[];
}

export interface DescargaPagina {
  /** El nombre del archivo en `/descargas/`. */
  archivo: string;
  /** Qué trae, para elegir cuál bajar. */
  contenido: string;
}

/** El `Dataset` de schema.org que describe la página. */
export interface ConjuntoPagina {
  nombre: string;
  /** De 50 a 5000 caracteres, más completa que la meta descripción. */
  descripcion: string;
  palabrasClave: readonly string[];
  /** ISO 8601: `2026-01-01/2026-12-31`, o abierta con `..` si la serie sigue (`2020-01-02/..`). */
  coberturaTemporal: string;
  /** Las descargas del dataset en JSON y CSV: su `distribution`. */
  distribucion: readonly string[];
}

/**
 * Una entrada del registro de páginas. Los textos (`titulo`, `h1`, `miga`, las citas) van sin
 * escapar; `intro` y `contenido` son HTML ya armado, con los datos escapados por quien los arma.
 */
export interface PaginaDatos {
  /** La ruta pública y estable, con barra final: `/dias-inhabiles-sat/`. */
  ruta: string;
  titulo: string;
  /** La meta descripción: 155 caracteres o menos (`documento()` lo exige). */
  descripcion: string;
  /** Con las palabras con las que se busca el dato, en español. */
  h1: string;
  /** El nombre corto de la página en las migas. */
  miga: string;
  /** La ruta de la página de la que cuelga en las migas; sin ella, de la portada. */
  superior?: string;
  /** El id del dataset cuyo renglón de la tabla de la portada enlaza aquí, si tiene. */
  dataset: string | null;
  /** El `as_of` de los datos que muestra: "Datos al" y el `lastmod` del sitemap. */
  datosAl: FechaISO;
  /** Qué es esa fecha, para terminar la frase "Datos al {fecha}, ...". */
  queEsDatosAl: string;
  intro: string;
  /** Las secciones con los datos, cada una con su `h2`. */
  contenido: string;
  fuentes: readonly FuenteMeta[];
  citas: readonly CitaPagina[];
  /** Las consultas de la API que dan lo mismo que la página, con su query. */
  consultas: readonly string[];
  /** La sección de la guía de la API que las explica. */
  guiaApi: string;
  /** El ejemplo del paquete de npm, o null si no tiene. */
  paquete: string | null;
  descargas: readonly DescargaPagina[];
  /** La documentación del dataset, si tiene. */
  docs: string | null;
  conjunto: ConjuntoPagina;
  /** Las rutas de las páginas relacionadas, que deben estar en el registro. */
  relacionadas: readonly string[];
}

/** Las páginas de datos por su ruta, en el orden en que se registraron. */
export type RegistroPaginas = ReadonlyMap<string, PaginaDatos>;

/** La portada y `/estado/` no son páginas de datos. */
const RESERVADAS: ReadonlySet<string> = new Set(["/", RUTA_ESTADO]);

interface Miga {
  nombre: string;
  ruta: string;
}

/** De la portada a la página, pasando por sus superiores. */
function migasDe(pagina: PaginaDatos, registro: RegistroPaginas): Miga[] {
  const cadena: Miga[] = [];
  const vistas = new Set<string>();
  let actual: PaginaDatos | undefined = pagina;
  while (actual !== undefined) {
    if (vistas.has(actual.ruta)) {
      throw new Error(`las páginas superiores de ${pagina.ruta} hacen un ciclo`);
    }
    vistas.add(actual.ruta);
    cadena.unshift({ nombre: actual.miga, ruta: actual.ruta });
    const { superior, ruta }: PaginaDatos = actual;
    if (superior === undefined) break;
    actual = registro.get(superior);
    if (actual === undefined) {
      throw new Error(`${ruta} cuelga de ${superior}, que no está en el registro`);
    }
  }
  return [{ nombre: NOMBRE_SITIO, ruta: "/" }, ...cadena];
}

/**
 * El registro de las páginas de datos. Lanza Error si una ruta no es de página, es la de la
 * portada o la de `/estado/`, se repite, o si una relacionada o una superior no está registrada.
 */
export function registrarPaginas(paginas: readonly PaginaDatos[]): RegistroPaginas {
  const registro = new Map<string, PaginaDatos>();
  for (const pagina of paginas) {
    if (!esRutaDePagina(pagina.ruta)) throw new Error(`ruta de página inválida: ${pagina.ruta}`);
    if (RESERVADAS.has(pagina.ruta)) throw new Error(`la ruta ${pagina.ruta} está reservada`);
    if (registro.has(pagina.ruta)) throw new Error(`página repetida: ${pagina.ruta}`);
    registro.set(pagina.ruta, pagina);
  }
  for (const pagina of registro.values()) {
    for (const ruta of pagina.relacionadas) {
      if (ruta === pagina.ruta) {
        throw new Error(`${pagina.ruta} se lista a sí misma como relacionada`);
      }
      if (!registro.has(ruta)) {
        throw new Error(`${pagina.ruta} enlaza ${ruta}, que no está en el registro`);
      }
    }
    migasDe(pagina, registro);
  }
  return registro;
}

const sinRepetir = (valores: readonly string[]): string[] => [...new Set(valores)];

/** La cita del manifiesto con el nombre de la fuente enlazado y sin la URL al final. */
function citaEnlazada(f: FuenteMeta): string {
  const cita = f.citation.endsWith(` ${f.url}`)
    ? f.citation.slice(0, -(f.url.length + 1))
    : f.citation;
  const enlace = enlaceSeguro(f.url, f.name);
  return cita.startsWith(f.name)
    ? `${enlace}${escaparHtml(cita.slice(f.name.length))}`
    : `${enlace}<span class="detalle">${escaparHtml(cita)}</span>`;
}

function seccionFuente(pagina: PaginaDatos): string {
  const licencias = new Map<string, FuenteMeta>();
  for (const f of pagina.fuentes) licencias.set(`${f.license_url}\n${f.license}`, f);
  const citas = pagina.citas.map(
    (c) => `<details>
<summary>Texto citado: ${escaparHtml(c.nombre)}</summary>
<blockquote>
${c.fragmentos.map((f) => `<p>${escaparHtml(f)}</p>`).join("\n")}
</blockquote>
</details>`,
  );
  return `<section id="fuente" aria-labelledby="titulo-fuente">
<h2 id="titulo-fuente">Fuente oficial</h2>
<ul>
${pagina.fuentes.map((f) => `<li>${citaEnlazada(f)}</li>`).join("\n")}
</ul>
${[...licencias.values()].map((f) => `<p class="licencia">Licencia: ${enlaceSeguro(f.license_url, f.license)}</p>`).join("\n")}
${citas.join("\n")}
</section>`;
}

function seccionConsultar(pagina: PaginaDatos, tamano: (archivo: string) => string): string {
  const [primera] = pagina.consultas;
  if (primera === undefined) throw new Error(`${pagina.ruta} no tiene consultas de la API`);
  const curl = pagina.consultas.map((c) => `curl "$API${rutaPartible(c)}"`);
  const api = `<div class="bloque">
<h3>API</h3>
<p>Sin llave ni cuenta. Cada respuesta trae el dato en <code>data</code> y su fuente, licencia y fecha en <code>meta</code>.</p>
<pre><code>${VARIABLE_API}
${curl.join("\n")}</code></pre>
${enPowerShell(`curl.exe "$API${primera}"`)}
<p>Parámetros y ejemplos de respuesta en la <a href="${escaparHtml(pagina.guiaApi)}">guía de la API</a>.</p>
</div>`;
  const paquete =
    pagina.paquete === null
      ? ""
      : `<div class="bloque">
<h3>Paquete de npm</h3>
<p>Con <code>npm install mexicoapi</code>. Si la API no responde, usa los datos del paquete y lo avisa.</p>
${codigo(pagina.paquete)}
</div>
`;
  const descargas = pagina.descargas.map((d) => {
    const archivo = escaparHtml(d.archivo);
    return `<li><a href="/descargas/${archivo}">${archivo}</a> (${tamano(d.archivo)}): ${escaparHtml(d.contenido)}</li>`;
  });
  return `<section id="consultar" aria-labelledby="titulo-consultar">
<h2 id="titulo-consultar">Cómo consultarlo</h2>
<div class="bloques">
${api}
${paquete}<div class="bloque">
<h3>Descargas</h3>
<ul>
${descargas.join("\n")}
</ul>
<p>Todos los archivos, con su sha256 y en SQLite, en <a href="/#descargas">Descargas</a>.</p>
</div>
</div>
</section>`;
}

function seccionRelacionadas(pagina: PaginaDatos, registro: RegistroPaginas): string {
  const enlaces = pagina.relacionadas.map((ruta) => {
    const otra = registro.get(ruta) as PaginaDatos;
    return `<li><a href="${ruta}">${escaparHtml(otra.h1)}</a></li>`;
  });
  const docs =
    pagina.docs === null
      ? []
      : [
          `<li><a href="${escaparHtml(pagina.docs)}">Documentación del dataset</a>: campos, cobertura y cómo se captura</li>`,
        ];
  return `<section id="relacionadas" aria-labelledby="titulo-relacionadas">
<h2 id="titulo-relacionadas">Relacionadas</h2>
<ul>
${[...enlaces, ...docs, `<li><a href="/">${NOMBRE_SITIO}</a>: todos los datos, la API y las descargas</li>`].join("\n")}
</ul>
</section>`;
}

function migasVisibles(migas: readonly Miga[]): string {
  const ultima = migas.length - 1;
  const elementos = migas.map(({ nombre, ruta }, i) =>
    i === ultima
      ? `<li aria-current="page">${escaparHtml(nombre)}</li>`
      : `<li><a href="${ruta}">${escaparHtml(nombre)}</a></li>`,
  );
  return `<nav class="migas" aria-label="Ruta de navegación">
<ol>
${elementos.join("\n")}
</ol>
</nav>`;
}

/**
 * El `index.html` de una página del registro. Lanza Error si la página no está en el registro, si
 * falta en `descargas` un archivo que enlaza o que declara su Dataset, o si el Dataset no cumple
 * lo que pide Google (`nodoDataset`).
 */
export function paginaDeDatos(
  pagina: PaginaDatos,
  registro: RegistroPaginas,
  descargas: ReadonlyMap<string, Uint8Array | string>,
): string {
  if (!registro.has(pagina.ruta)) {
    throw new Error(`${pagina.ruta} no está en el registro de páginas`);
  }
  const tamano = (archivo: string): string => {
    const contenido = descargas.get(archivo);
    if (contenido === undefined) throw new Error(`${pagina.ruta}: falta la descarga ${archivo}`);
    return tamanoLegible(Buffer.byteLength(contenido));
  };
  for (const archivo of pagina.conjunto.distribucion) tamano(archivo);
  const migas = migasDe(pagina, registro);
  const dataset = nodoDataset({
    nombre: pagina.conjunto.nombre,
    descripcion: pagina.conjunto.descripcion,
    ruta: pagina.ruta,
    licencias: sinRepetir(pagina.fuentes.map((f) => f.license_url)),
    fuentes: sinRepetir(pagina.fuentes.map((f) => f.url)),
    palabrasClave: pagina.conjunto.palabrasClave,
    coberturaTemporal: pagina.conjunto.coberturaTemporal,
    modificado: pagina.datosAl,
    distribucion: pagina.conjunto.distribucion,
  });
  const fecha = escaparHtml(pagina.datosAl);
  const cuerpo = `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
<div class="marco">
<p class="marca"><a href="/">${NOMBRE_SITIO}</a></p>
${navegacion(pagina.ruta)}
</div>
</header>
<main id="contenido" class="marco">
${migasVisibles(migas)}
<h1>${escaparHtml(pagina.h1)}</h1>
<p class="datos-al">Datos al <time datetime="${fecha}">${fechaEnTexto(pagina.datosAl)}</time>, ${escaparHtml(pagina.queEsDatosAl)}.</p>
${pagina.intro}
${pagina.contenido}
${seccionFuente(pagina)}
${seccionConsultar(pagina, tamano)}
${seccionRelacionadas(pagina, registro)}
</main>`;
  return documento({
    titulo: pagina.titulo,
    descripcion: pagina.descripcion,
    cuerpo,
    ruta: pagina.ruta,
    scripts: ["/sitio.js"],
    datosEstructurados: [dataset, nodoMigas(migas)],
  });
}
