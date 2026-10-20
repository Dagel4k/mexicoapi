import { URL_API } from "@mexicoapi/core/problemas";
import { describe, expect, it } from "vitest";
import { type FuenteMeta, URL_DOCS } from "../../../src/sitio/meta.js";
import { tamanoLegible, VARIABLE_API } from "../../../src/sitio/paginas/bloques.js";
import { NOMBRES_ALTERNOS, nodosDelSitio } from "../../../src/sitio/paginas/datos-estructurados.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { escaparHtml } from "../../../src/sitio/paginas/html.js";
import {
  type ConjuntoPagina,
  fechaDelSitemap,
  type PaginaDatos,
  paginaDeDatos,
  registrarPaginas,
  rutasParaEncabezados,
} from "../../../src/sitio/paginas/pagina-datos.js";
import { atributos, datosEstructurados, desescapar, esperarDocumentoValido } from "./estructura.js";

const LFDA = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf";
const URL_FUENTE = "https://dof.gob.mx/nota_detalle.php?codigo=1&fecha=01/02/2026";

const FUENTE: FuenteMeta = {
  name: "Ley de Prueba, artículo 1",
  url: URL_FUENTE,
  license: "Texto oficial publicado en el DOF",
  license_url: LFDA,
  citation: `Ley de Prueba, artículo 1. Diario Oficial de la Federación, 01/02/2026. ${URL_FUENTE}`,
};

const DESCRIPCION_LARGA =
  "Días de prueba con su motivo y la cita de su fuente, transcritos del Diario Oficial de la Federación.";

const PAGINA: PaginaDatos = {
  ruta: "/prueba-datos/",
  titulo: "Datos de prueba 2026 & 2027 · MéxicoAPI",
  descripcion: "Datos de prueba de 2026 y 2027 con su fuente oficial.",
  h1: "Datos de prueba 2026 & 2027",
  miga: "Datos de <prueba>",
  dataset: "prueba.datos",
  datosAl: "2026-02-01",
  queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
  intro: '<p class="intro">Unos datos y otros.</p>',
  contenido:
    '<section id="anio-2026" aria-labelledby="titulo-2026">\n<h2 id="titulo-2026">2026</h2>\n<p>Nada.</p>\n</section>',
  fuentes: [FUENTE],
  citas: [{ nombre: FUENTE.name, url: URL_FUENTE, fragmentos: ["Artículo 1. <Texto> & más."] }],
  consultas: ["/v1/prueba?anio=2026&tipo=a", "/v1/prueba?anio=2027"],
  guiaApi: `${URL_DOCS}/api/README.md#prueba`,
  paquete: {
    codigo: 'import { crearCliente } from "mexicoapi/cliente";',
    nota: "Con <code>npm install mexicoapi</code>, también sin red.",
  },
  descargas: [
    { archivo: "prueba.json", contenido: "Los días, con su fuente" },
    { archivo: "prueba.csv", contenido: "Lo mismo en CSV" },
  ],
  docs: `${URL_DOCS}/datos/prueba.md`,
  conjunto: {
    nombre: "Días de prueba",
    descripcion: DESCRIPCION_LARGA,
    palabrasClave: ["días de prueba", "DOF"],
    coberturaTemporal: "2026-01-01/2026-12-31",
    distribucion: ["prueba.json", "prueba.csv"],
  },
  relacionadas: ["/otra/"],
};

const OTRA: PaginaDatos = {
  ...PAGINA,
  ruta: "/otra/",
  h1: "Otra página 2026",
  miga: "Otra",
  dataset: null,
  relacionadas: ["/prueba-datos/"],
};

const DESCARGAS = new Map<string, string>([
  ["prueba.json", "[]"],
  ["prueba.csv", "x".repeat(2048)],
]);

const REGISTRO = registrarPaginas([PAGINA, OTRA]);
const html = paginaDeDatos(PAGINA, REGISTRO, DESCARGAS);

/** El texto de una sección por su id, sin la etiqueta de apertura. */
function seccion(pagina: string, id: string): string {
  const inicio = pagina.indexOf(`<section id="${id}"`);
  expect(inicio, id).toBeGreaterThan(0);
  return pagina.slice(inicio, pagina.indexOf("</section>", inicio));
}

/** Quita etiquetas y entidades: lo que se copia de un bloque de código. */
const textoDe = (fragmento: string): string => desescapar(fragmento.replace(/<[^>]*>/g, ""));

const nodo = (tipo: string, pagina = html): Record<string, unknown> => {
  const nodos = datosEstructurados(pagina).filter((n) => n["@type"] === tipo);
  expect(nodos, tipo).toHaveLength(1);
  return nodos[0] as Record<string, unknown>;
};

describe("página de datos", () => {
  it("es un documento válido con su canónica, sitio.js y un solo h1 con las palabras de la búsqueda", () => {
    esperarDocumentoValido(html);
    expect(html).toContain("<title>Datos de prueba 2026 &amp; 2027 · MéxicoAPI</title>");
    expect(html).toContain("<h1>Datos de prueba 2026 &amp; 2027</h1>");
    expect(html).toContain(`<link rel="canonical" href="${URL_API}/prueba-datos/">`);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    expect(html).toContain('<main id="contenido" class="marco">');
    expect(html).toContain(PAGINA.intro);
    expect(html).toContain(PAGINA.contenido);
  });

  // Dos regiones de navegación: la del sitio y la de las migas, cada una con su nombre.
  it("lleva migas visibles y en JSON-LD, de la portada a la página", () => {
    expect(html).toContain(
      '<nav class="migas" aria-label="Ruta de navegación">\n<ol>\n<li><a href="/">MéxicoAPI</a></li>\n<li aria-current="page">Datos de &lt;prueba&gt;</li>\n</ol>\n</nav>',
    );
    expect(html.indexOf('class="migas"')).toBeLessThan(html.indexOf("<h1>"));
    expect(atributos(html, "aria-label").sort()).toEqual(["Ruta de navegación", "Secciones"]);
    expect(nodo("BreadcrumbList")).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "MéxicoAPI", item: `${URL_API}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: "Datos de <prueba>",
          item: `${URL_API}/prueba-datos/`,
        },
      ],
    });
  });

  it("con una página superior, las migas pasan por ella", () => {
    const hija: PaginaDatos = {
      ...OTRA,
      ruta: "/otra/hija/",
      miga: "Hija",
      superior: "/otra/",
      conjunto: null,
    };
    const registro = registrarPaginas([PAGINA, OTRA, hija]);
    const pagina = paginaDeDatos(hija, registro, DESCARGAS);
    esperarDocumentoValido(pagina);
    expect(pagina).toContain(
      '<li><a href="/">MéxicoAPI</a></li>\n<li><a href="/otra/">Otra</a></li>\n<li aria-current="page">Hija</li>',
    );
    // La hija no declara su propio Dataset: lo describe la superior.
    expect(datosEstructurados(pagina).map((n) => n["@type"])).toEqual(["BreadcrumbList"]);
    const migas = nodo("BreadcrumbList", pagina).itemListElement as { item: string }[];
    expect(migas.map((m) => m.item)).toEqual([
      `${URL_API}/`,
      `${URL_API}/otra/`,
      `${URL_API}/otra/hija/`,
    ]);
  });

  it("dice la fecha de los datos y qué es esa fecha", () => {
    expect(html).toContain(
      '<p class="datos-al">Datos al <time datetime="2026-02-01">1 de febrero de 2026</time>, la fecha de la publicación más reciente de sus fuentes.</p>',
    );
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf('class="datos-al"'));
  });

  it("cita la fuente oficial con su enlace y su licencia, y el texto citado tal cual", () => {
    const fuente = seccion(html, "fuente");
    expect(fuente).toContain('<h2 id="titulo-fuente">Fuente oficial</h2>');
    expect(fuente).toContain(
      `<li><a href="${escaparHtml(URL_FUENTE)}">Ley de Prueba, artículo 1</a>. Diario Oficial de la Federación, 01/02/2026.</li>`,
    );
    expect(fuente).toContain(
      `<p class="licencia">Licencia: <a href="${LFDA}">Texto oficial publicado en el DOF</a></p>`,
    );
    expect(fuente).toContain(
      "<details>\n<summary>Texto citado: Ley de Prueba, artículo 1</summary>\n<blockquote>\n<p>Artículo 1. &lt;Texto&gt; &amp; más.</p>\n</blockquote>\n</details>",
    );
  });

  // La cita de la LFT no empieza con el nombre de su fuente: va completa, después del enlace.
  it("una cita que no empieza con el nombre de la fuente va completa después del enlace", () => {
    const otra: FuenteMeta = {
      ...FUENTE,
      name: "Ley Federal del Trabajo, artículos 74 y 715",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
      citation: "Ley Federal del Trabajo: del artículo 74, los días de descanso obligatorio.",
    };
    const pagina = paginaDeDatos({ ...PAGINA, fuentes: [otra] }, REGISTRO, DESCARGAS);
    expect(seccion(pagina, "fuente")).toContain(
      '<li><a href="https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf">Ley Federal del Trabajo, artículos 74 y 715</a><span class="detalle">Ley Federal del Trabajo: del artículo 74, los días de descanso obligatorio.</span></li>',
    );
  });

  // Sin JavaScript se ve la API pública; sitio.js pone el origen. Las URL con & y ? van entre
  // comillas: sin ellas bash manda el comando al fondo y zsh busca archivos.
  it("dice cómo pedirlo por API, con curl entre comillas y la línea de PowerShell", () => {
    const consultar = seccion(html, "consultar");
    expect(consultar).toContain('<h2 id="titulo-consultar">Cómo consultarlo</h2>');
    const [bloque] = [...consultar.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(
      (m) => m[1] as string,
    );
    expect(bloque?.startsWith(VARIABLE_API)).toBe(true);
    expect(textoDe(bloque ?? "")).toBe(
      `API=${URL_API}\ncurl "$API/v1/prueba?anio=2026&tipo=a"\ncurl "$API/v1/prueba?anio=2027"`,
    );
    expect(consultar).toContain(
      `<p>En PowerShell: <code>$API = &quot;<span data-origen>${URL_API}</span>&quot;</code> y <code>curl.exe &quot;$API/v1/prueba?anio=2026&amp;tipo=a&quot;</code>.</p>`,
    );
    expect(consultar).toContain(`<a href="${URL_DOCS}/api/README.md#prueba">`);
  });

  // Cada página dice lo que hace su ejemplo: el cliente usa la API y la LFT va sin red.
  it("muestra el ejemplo del paquete con su nota y, sin él, no muestra el bloque de npm", () => {
    const consultar = seccion(html, "consultar");
    expect(consultar).toContain(
      "<h3>Paquete de npm</h3>\n<p>Con <code>npm install mexicoapi</code>, también sin red.</p>\n<pre>",
    );
    expect(consultar).toContain(
      "<pre><code>import { crearCliente } from &quot;mexicoapi/cliente&quot;;</code></pre>",
    );
    const sinPaquete = paginaDeDatos({ ...PAGINA, paquete: null }, REGISTRO, DESCARGAS);
    esperarDocumentoValido(sinPaquete);
    expect(sinPaquete).not.toContain("Paquete de npm");
  });

  it("enlaza cada descarga con su tamaño y lo que trae, y todas las descargas de la portada", () => {
    const consultar = seccion(html, "consultar");
    expect(consultar).toContain(
      `<li><a href="/descargas/prueba.json">prueba.json</a> (${tamanoLegible(2)}): Los días, con su fuente</li>`,
    );
    expect(consultar).toContain(
      `<li><a href="/descargas/prueba.csv">prueba.csv</a> (${tamanoLegible(2048)}): Lo mismo en CSV</li>`,
    );
    expect(consultar).toContain('<a href="/#descargas">');
  });

  it("enlaza sus páginas relacionadas por su h1, la documentación y la portada", () => {
    const relacionadas = seccion(html, "relacionadas");
    expect(relacionadas).toContain('<li><a href="/otra/">Otra página 2026</a></li>');
    expect(relacionadas).toContain(`<a href="${URL_DOCS}/datos/prueba.md">`);
    expect(relacionadas).toContain('<li><a href="/">');
    const sinDocs = paginaDeDatos({ ...PAGINA, docs: null }, REGISTRO, DESCARGAS);
    expect(seccion(sinDocs, "relacionadas")).not.toContain("/docs/datos/");
  });

  // Los obligatorios de la guía de Google (name, description de 50 a 5000, distribution con
  // contentUrl absoluto y encodingFormat) y los recomendados que describen lo que muestra la página.
  it("declara un solo Dataset con los obligatorios y recomendados de Google", () => {
    const dataset = nodo("Dataset");
    expect(dataset).toEqual({
      "@type": "Dataset",
      name: "Días de prueba",
      description: DESCRIPCION_LARGA,
      url: `${URL_API}/prueba-datos/`,
      license: LFDA,
      isAccessibleForFree: true,
      creator: { "@type": "Organization", name: "MéxicoAPI", url: `${URL_API}/` },
      keywords: ["días de prueba", "DOF"],
      temporalCoverage: "2026-01-01/2026-12-31",
      spatialCoverage: { "@type": "Place", name: "México" },
      dateModified: "2026-02-01",
      version: "2026-02-01",
      isBasedOn: [URL_FUENTE],
      includedInDataCatalog: { "@type": "DataCatalog", name: "MéxicoAPI", url: `${URL_API}/` },
      distribution: [
        {
          "@type": "DataDownload",
          contentUrl: `${URL_API}/descargas/prueba.json`,
          encodingFormat: "application/json",
        },
        {
          "@type": "DataDownload",
          contentUrl: `${URL_API}/descargas/prueba.csv`,
          encodingFormat: "text/csv",
        },
      ],
    });
    expect(datosEstructurados(html).map((n) => n["@type"])).toEqual(["Dataset", "BreadcrumbList"]);
  });

  it("con fuentes de licencias distintas, el Dataset las lista sin repetir", () => {
    const otra: FuenteMeta = { ...FUENTE, url: "https://dof.gob.mx/otra", license_url: URL_FUENTE };
    const pagina = paginaDeDatos(
      { ...PAGINA, fuentes: [FUENTE, otra, FUENTE] },
      REGISTRO,
      DESCARGAS,
    );
    expect(nodo("Dataset", pagina)).toMatchObject({
      license: [LFDA, URL_FUENTE],
      isBasedOn: [URL_FUENTE, "https://dof.gob.mx/otra"],
    });
  });

  it("falla si falta una descarga, si la descripción del Dataset no mide de 50 a 5000 o la distribución no es JSON ni CSV", () => {
    const sinCsv = new Map(DESCARGAS);
    sinCsv.delete("prueba.csv");
    expect(() => paginaDeDatos(PAGINA, REGISTRO, sinCsv)).toThrow(/prueba\.csv/);
    const con = (cambio: Partial<ConjuntoPagina>) =>
      paginaDeDatos(
        { ...PAGINA, conjunto: { ...(PAGINA.conjunto as ConjuntoPagina), ...cambio } },
        REGISTRO,
        DESCARGAS,
      );
    expect(() => con({ descripcion: "x".repeat(50) })).not.toThrow();
    expect(() => con({ descripcion: "x".repeat(5000) })).not.toThrow();
    expect(() => con({ descripcion: "x".repeat(49) })).toThrow(/50 a 5000/);
    expect(() => con({ descripcion: "x".repeat(5001) })).toThrow(/50 a 5000/);
    expect(() => con({ distribucion: ["prueba.json", "SHA256SUMS"] })).toThrow(/SHA256SUMS/);
    expect(() => con({ distribucion: [] })).toThrow(/distribución/);
    expect(() => con({ distribucion: ["prueba.json", "otra.csv"] })).toThrow(/otra\.csv/);
  });

  // Una página que no describe un dataset (una calculadora, un validador) no declara Dataset.
  it("sin conjunto no declara Dataset, solo sus migas", () => {
    const sinConjunto = paginaDeDatos({ ...PAGINA, conjunto: null }, REGISTRO, DESCARGAS);
    esperarDocumentoValido(sinConjunto);
    expect(datosEstructurados(sinConjunto).map((n) => n["@type"])).toEqual(["BreadcrumbList"]);
  });

  // Sin consultas de la API no hay bloque de la API; sin nada que consultar, no hay sección.
  it("sin consultas no muestra el bloque de la API, y sin nada que consultar no hay sección", () => {
    const sinApi = paginaDeDatos({ ...PAGINA, consultas: [] }, REGISTRO, DESCARGAS);
    esperarDocumentoValido(sinApi);
    expect(seccion(sinApi, "consultar")).not.toContain("<h3>API</h3>");
    expect(seccion(sinApi, "consultar")).toContain("<h3>Paquete de npm</h3>");
    const nada = paginaDeDatos(
      { ...PAGINA, consultas: [], paquete: null, descargas: [], conjunto: null },
      REGISTRO,
      new Map(),
    );
    esperarDocumentoValido(nada);
    expect(nada).not.toContain('id="consultar"');
  });

  // El título de algunas páginas cambia con el año: el sitemap usa la fecha de la página si la trae.
  it("la fecha del sitemap es la de la página o, si no la trae, la de sus datos", () => {
    expect(fechaDelSitemap(PAGINA)).toBe("2026-02-01");
    expect(fechaDelSitemap({ ...PAGINA, modificada: "2027-01-01" })).toBe("2027-01-01");
  });

  it("escapa los textos y cada clase que usa tiene regla en la hoja de estilo", () => {
    expect(html).not.toContain("<prueba>");
    const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });

  it("cada href es del sitio, de la documentación, de una fuente o de su licencia", () => {
    const cuerpo = html.slice(html.indexOf("<body>"), html.indexOf('<footer class="pie">'));
    for (const href of atributos(cuerpo, "href")) {
      const valido =
        /^\/(?!\/)/.test(href) ||
        href.startsWith("#") ||
        href.startsWith(`${URL_DOCS}/`) ||
        [URL_FUENTE, LFDA].includes(href);
      expect(valido, href).toBe(true);
    }
  });
});

describe("registro de páginas", () => {
  it("guarda cada página por su ruta, en orden", () => {
    expect([...REGISTRO.keys()]).toEqual(["/prueba-datos/", "/otra/"]);
  });

  // Sin relacionadas, para que cada caso falle solo por lo que prueba.
  const SOLA: PaginaDatos = { ...PAGINA, relacionadas: [] };

  it.each([
    ["una ruta repetida", [SOLA, SOLA], /repetida/],
    ["la portada", [{ ...SOLA, ruta: "/" }], /reservada/],
    ["la de estado", [{ ...SOLA, ruta: "/estado/" }], /reservada/],
    ["una ruta inválida", [{ ...SOLA, ruta: "/sin-barra" }], /ruta/],
    ["una relacionada que no existe", [{ ...SOLA, relacionadas: ["/nada/"] }], /\/nada\//],
    ["una relacionada que es ella misma", [{ ...SOLA, relacionadas: ["/prueba-datos/"] }], /misma/],
    ["una superior que no existe", [{ ...SOLA, superior: "/nada/" }], /\/nada\//],
    [
      "una hija con su propio Dataset",
      [
        { ...SOLA, conjunto: null },
        { ...SOLA, ruta: "/prueba-datos/hija/", superior: "/prueba-datos/" },
      ],
      /Dataset/,
    ],
    [
      "superiores en ciclo",
      [
        { ...PAGINA, superior: "/otra/" },
        { ...OTRA, superior: "/prueba-datos/" },
      ],
      /ciclo/,
    ],
  ] as const)("rechaza %s", (_, paginas, error) => {
    expect(() => registrarPaginas(paginas as readonly PaginaDatos[])).toThrow(error);
  });
});

describe("rutas de las páginas en _headers", () => {
  // Una regla por página sin hijas y una con comodín por familia: Cloudflare acepta 100 reglas.
  it("da la ruta de cada página de arriba, con comodín si tiene hijas, y nada por las hijas", () => {
    const hija = (n: number): PaginaDatos => ({
      ...OTRA,
      ruta: `/otra/hija-${n}/`,
      superior: "/otra/",
      conjunto: null,
      relacionadas: [],
    });
    const nieta: PaginaDatos = {
      ...hija(9),
      ruta: "/otra/hija-1/nieta/",
      superior: "/otra/hija-1/",
    };
    const registro = registrarPaginas([PAGINA, OTRA, hija(1), hija(2), nieta]);
    expect(rutasParaEncabezados(registro)).toEqual(["/prueba-datos/", "/otra/*"]);
  });
});

describe("datos estructurados del sitio", () => {
  it("WebSite y Organization con el nombre, los nombres alternos y la URL", () => {
    expect(NOMBRES_ALTERNOS).toEqual(["mexicoapi", "México API"]);
    expect(nodosDelSitio()).toEqual([
      {
        "@type": "WebSite",
        name: "MéxicoAPI",
        alternateName: ["mexicoapi", "México API"],
        url: `${URL_API}/`,
      },
      {
        "@type": "Organization",
        name: "MéxicoAPI",
        alternateName: ["mexicoapi", "México API"],
        url: `${URL_API}/`,
      },
    ]);
  });
});
