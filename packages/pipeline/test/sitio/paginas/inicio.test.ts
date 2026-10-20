import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validarClabe, validarRfc } from "@mexicoapi/core";
import { URL_API } from "@mexicoapi/core/problemas";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PUBLICADO_EN_NPM } from "../../../src/sitio/comun.js";
import { URL_ARCHIVOS, URL_REPO } from "../../../src/sitio/meta.js";
import { nodosDelSitio } from "../../../src/sitio/paginas/datos-estructurados.js";
import { paginaEstado } from "../../../src/sitio/paginas/estado.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { enlaceSeguro } from "../../../src/sitio/paginas/html.js";
import {
  CLABE_EJEMPLO,
  type DatasetInicio,
  type EntradaInicio,
  formatearEntero,
  paginaInicio,
  respuestaRecortada,
  tamanoLegible,
} from "../../../src/sitio/paginas/inicio.js";
import { atributos, datosEstructurados, desescapar, esperarDocumentoValido } from "./estructura.js";

const LICENCIA_INEGI = {
  license: "Términos de libre uso de la información del INEGI",
  license_url: "https://www.inegi.org.mx/inegi/terminos.html",
};
const LICENCIA_DOF = {
  license: "Texto oficial publicado en el DOF",
  license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
};

const DATASETS: DatasetInicio[] = [
  {
    id: "inegi.estados",
    directorio: "inegi-estados",
    tipo: "automatico",
    as_of: "2026-10-17",
    registros: 32,
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/inegi-estados.md",
    fuentes: [
      {
        name: "A & <B>",
        url: "https://www.inegi.org.mx/app/ageeml/",
        published_at: null,
        ...LICENCIA_INEGI,
      },
      {
        name: "Fuente sin enlace",
        url: "javascript:alert(1)",
        published_at: null,
        license: 'Licencia "rara"',
        license_url: "http://inseguro.mx/licencia",
      },
    ],
  },
  {
    id: "constantes.uma",
    directorio: "constantes-uma",
    tipo: "curado",
    as_of: "2026-01-09",
    registros: 1234567,
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/constantes-uma.md",
    fuentes: ["2024-01-10", "2025-01-10", "2026-01-09"].map((fecha) => ({
      name: "INEGI. Unidad de medida y actualización",
      url: `https://dof.gob.mx/nota_detalle.php?codigo=1&fecha=${fecha}`,
      published_at: fecha,
      ...LICENCIA_INEGI,
    })),
  },
  {
    id: "nuevo.dataset",
    directorio: "nuevo-dataset",
    tipo: "automatico",
    as_of: "2026-05-01",
    registros: 7,
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/nuevo-dataset.md",
    fuentes: [
      {
        name: "Banxico",
        url: "https://www.banxico.org.mx/servicios/d/{C24C7DBC}.pdf",
        published_at: null,
        ...LICENCIA_DOF,
      },
    ],
  },
  {
    id: "tipo-cambio.fix",
    directorio: "tipo-cambio-fix",
    tipo: "automatico",
    as_of: "2026-10-18",
    ultimo_dato: "2026-10-16",
    registros: 1710,
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/tipo-cambio-fix.md",
    fuentes: [
      {
        name: "DOF (SIDOF)",
        url: "https://sidof.segob.gob.mx/",
        published_at: null,
        ...LICENCIA_DOF,
      },
    ],
  },
];

/** Lo que responde la API a la CLABE de los ejemplos, con textos que hay que escapar. */
const RESPUESTA_CLABE = {
  data: validarClabe(CLABE_EJEMPLO, {
    bancos: new Map([["002", { codigo: "002", nombre_corto: "BANAMEX", activo: true }]]),
  }),
  meta: {
    dataset: "bancos",
    as_of: "2026-10-17",
    sources: [
      {
        name: "Banco de México <CEP>",
        url: "https://www.banxico.org.mx/cep/",
        license: "Reproducción con cita & fuente",
        license_url: "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
        citation: "Banco de México. CEP.",
      },
      {
        name: "Banco de México, SPEI",
        url: "https://www.banxico.org.mx/servicios/",
        license: "Reproducción con cita & fuente",
        license_url: "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
        citation: "Banco de México. SPEI.",
      },
    ],
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#clabe",
  },
};

const EJEMPLO = respuestaRecortada(RESPUESTA_CLABE);

const DESCARGAS = new Map<string, Uint8Array | string>([
  ["SHA256SUMS", "a".repeat(200)],
  ["constantes-uma.csv", "x".repeat(2048)],
  ["constantes-uma.json", "x".repeat(10)],
  ["inegi-estados.csv", "x".repeat(1500)],
  ["inegi-estados.json", new Uint8Array(3 * 1024 * 1024)],
  ["inegi-estados.manifest.json", "{}"],
  ["mexicoapi.sqlite", new Uint8Array(5 * 1024 * 1024 + 300 * 1024)],
  ["nuevo-dataset.json", "[]"],
]);

const ENTRADA: EntradaInicio = { datasets: DATASETS, descargas: DESCARGAS, ejemplo: EJEMPLO };

const html = paginaInicio(ENTRADA);

/** El cuerpo de la tabla de datasets, una cadena por renglón. */
function renglones(pagina: string, idTabla: string): string[] {
  const inicio = pagina.indexOf(`<caption id="${idTabla}">`);
  const fin = pagina.indexOf("</table>", inicio);
  const cuerpo = pagina.slice(pagina.indexOf("<tbody", inicio), fin);
  return [...cuerpo.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1] as string);
}

/** Quita etiquetas hasta que no quede ninguna: una sola pasada podría dejar otra armada. */
function sinEtiquetas(texto: string): string {
  let antes: string;
  let despues = texto;
  do {
    antes = despues;
    despues = antes.replace(/<[^>]*>/g, "");
  } while (despues !== antes);
  return despues;
}

/** El texto de cada bloque `pre > code`, ya sin etiquetas ni entidades. */
const bloquesDeCodigo = (pagina: string): string[] =>
  [...pagina.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) =>
    desescapar(sinEtiquetas(m[1] as string)),
  );

describe("página de inicio", () => {
  it("es un documento válido que carga sitio.js como módulo", () => {
    esperarDocumentoValido(html);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    expect(html).toContain("<h1>MéxicoAPI</h1>");
    expect(html).toContain("Datos de referencia de México con fuente oficial, licencia y sha256.");
    expect(html).toContain("con 4 datasets oficiales y descargas completas en JSON, CSV y SQLite.");
  });

  it("navega a las cinco secciones y, desde la cabecera, al repositorio", () => {
    for (const [href, texto] of [
      ["#empieza", "Empieza"],
      ["#datos", "Datos"],
      ["#descargas", "Descargas"],
      ["#referencia", "Referencia"],
      ["/estado/", "Estado"],
    ]) {
      expect(html).toContain(`<a href="${href}">${texto}</a>`);
    }
    const cabecera = html.slice(
      html.indexOf('<header class="cabecera">'),
      html.indexOf("</header>"),
    );
    expect(cabecera).toContain(`<li><a href="${URL_REPO}">GitHub</a></li>`);
    expect(cabecera).not.toContain("aria-current");
    // La navegación de las demás páginas no sale del sitio; el repositorio queda en el pie.
    const estado = paginaEstado();
    expect(estado.slice(0, estado.indexOf("</header>"))).not.toContain(URL_REPO);
  });

  // La descripción es la de los buscadores y la tarjeta al compartir el enlace.
  it("declara su canónica y una descripción que los buscadores no cortan", () => {
    expect(html).toContain(`<link rel="canonical" href="${URL_API}/">`);
    expect(html).toContain(`<meta property="og:url" content="${URL_API}/">`);
    const [descripcion] = [...html.matchAll(/<meta name="description" content="([^"]*)">/g)].map(
      (m) => desescapar(m[1] as string),
    );
    expect(descripcion?.length).toBeLessThanOrEqual(155);
    expect(html).toContain(`<meta property="og:description" content="${descripcion}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("declara el sitio y la organización en JSON-LD", () => {
    expect(datosEstructurados(html)).toEqual(nodosDelSitio());
  });

  // La portada lleva a cada página de datos: desde el renglón de su dataset y desde una lista.
  it("enlaza cada página de datos desde el renglón de su dataset y desde Consultar los datos", () => {
    const paginas = [
      {
        ruta: "/uma/",
        h1: "UMA 2026 & 2025",
        descripcion: "La UMA <diaria>, mensual y anual.",
        dataset: "constantes.uma",
      },
      {
        ruta: "/dias-de-descanso-obligatorio/",
        h1: "Días de descanso obligatorio 2026 y 2027 (LFT)",
        descripcion: "Los del artículo 74.",
        dataset: null,
        anios: [2026, 2027],
      },
      // Una página hija no va en la lista: se llega a ella desde su superior.
      {
        ruta: "/uma/2026/",
        h1: "UMA 2026",
        descripcion: "La de 2026.",
        dataset: "constantes.uma",
        superior: "/uma/",
      },
    ];
    const conPaginas = paginaInicio({ ...ENTRADA, paginas });
    esperarDocumentoValido(conPaginas);
    const [estados, uma] = renglones(conPaginas, "tabla-datos") as [string, string];
    // El nombre lleva a la página y "Documentación" a la del repositorio: dos textos distintos.
    const docs = DATASETS.find((d) => d.id === "constantes.uma")?.docs as string;
    expect(uma).toContain(
      `<th scope="row" role="rowheader"><a href="/uma/">UMA</a><span class="id">constantes.uma</span><span class="detalle"><a href="${docs}">Documentación<span class="oculto"> de UMA</span></a></span><span class="detalle">Curado</span></th>`,
    );
    expect(uma).not.toContain("/uma/2026/");
    expect(estados).not.toContain("/uma/");
    expect(estados).toContain(
      '>Estados</a><span class="id">inegi.estados</span><span class="detalle">Automático</span></th>',
    );
    const inicio = conPaginas.indexOf('<section id="consultar-datos"');
    const seccion = conPaginas.slice(inicio, conPaginas.indexOf("</section>", inicio));
    expect(seccion).toContain('<h2 id="titulo-consultar-datos">Consultar los datos</h2>');
    expect(seccion).toContain(
      "<p>Una página por tema, con su fuente oficial y cómo pedir los datos por API, npm o descarga.</p>",
    );
    expect(seccion).toContain(
      '<dt><a href="/uma/">UMA 2026 &amp; 2025</a></dt>\n<dd>La UMA &lt;diaria&gt;, mensual y anual.</dd>',
    );
    expect(seccion).toContain(
      '<dt><a href="/dias-de-descanso-obligatorio/">Días de descanso obligatorio 2026 y 2027 (LFT)</a></dt>',
    );
    expect(seccion).not.toContain("/uma/2026/");
    // La frase de la LFT en Descargas lleva a su página, si está.
    const conLft = new Map(DESCARGAS);
    conLft.set("dias-inhabiles-lft.json", "[]");
    conLft.set("dias-inhabiles-lft.csv", "");
    expect(paginaInicio({ ...ENTRADA, descargas: conLft, paginas })).toContain(
      'están en <a href="/descargas/dias-inhabiles-lft.json">JSON</a> y <a href="/descargas/dias-inhabiles-lft.csv">CSV</a>, de 2007 a 2100. Los de 2026 y 2027, con su motivo y su cita, en <a href="/dias-de-descanso-obligatorio/">Días de descanso obligatorio 2026 y 2027 (LFT)</a>.',
    );
    // Los años salen de la página, no de un texto fijo.
    const otrosAnios = paginas.map((p) =>
      p.ruta === "/dias-de-descanso-obligatorio/" ? { ...p, anios: [2100] } : p,
    );
    expect(paginaInicio({ ...ENTRADA, descargas: conLft, paginas: otrosAnios })).toContain(
      "de 2007 a 2100. Los de 2100, con su motivo y su cita, en ",
    );
    // Antes de la tabla de datos; sin páginas no hay sección.
    expect(inicio).toBeLessThan(conPaginas.indexOf('<section id="datos"'));
    expect(html).not.toContain("consultar-datos");
    const clases = new Set(atributos(conPaginas, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });

  it("cierra con el pie y un solo footer", () => {
    expect(html.match(/<footer class="pie">/g)).toHaveLength(1);
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf('<footer class="pie">'));
  });

  // "Datos al" es la última actualización; en el FIX no hay dato del domingo.
  it("en las series muestra el último dato aparte de Datos al", () => {
    const filas = renglones(html, "tabla-datos");
    const fix = filas.find((f) => f.includes('<span class="id">tipo-cambio.fix</span>')) ?? "";
    expect(fix).toContain(
      '<td class="junto" data-etiqueta="Datos al" role="cell"><time datetime="2026-10-18">2026-10-18</time><span class="detalle">último dato <time datetime="2026-10-16">2026-10-16</time></span></td>',
    );
    expect(filas.filter((f) => f.includes("último dato"))).toEqual([fix]);
    expect(html).toContain(
      "En las series (FIX y UDIS), el <em>último dato</em> es la fecha de su registro más reciente",
    );
  });

  // Para un pago la ruta es operacion; publicado en un día sin publicación da 404.
  it("en el FIX muestra primero operacion, con lo que responde, y luego /ultimo y publicado", () => {
    const fix =
      renglones(html, "tabla-datos").find((f) => f.includes("tipo-cambio.fix</span>")) ?? "";
    expect(fix).toContain(
      '<td class="rutas" data-etiqueta="API" role="cell"><code>/v1/<wbr>tipo-cambio/<wbr>fix<wbr>?operacion={fecha}</code><span class="detalle">El que aplica a un pago o una operación de esa fecha</span><code>/v1/<wbr>tipo-cambio/<wbr>fix/<wbr>ultimo</code><span class="detalle">La publicación más reciente</span><code>/v1/<wbr>tipo-cambio/<wbr>fix<wbr>?publicado={fecha}</code><span class="detalle">El que publicó el DOF ese día</span></td>',
    );
  });

  // Entre 1024 y 1280 px las rutas se parten: mejor después de una / o antes de ? y &, nunca
  // después de la / inicial. <wbr> no cambia lo que se copia.
  it("las rutas se pueden partir en sus separadores y se copian tal cual", () => {
    const conRutas = paginaInicio({
      ...ENTRADA,
      datasets: ["inegi.municipios", "dias-inhabiles.cnbv", "isr.tarifas"].map((id) => ({
        ...(DATASETS[0] as DatasetInicio),
        id,
      })),
    });
    const codigos = [...conRutas.matchAll(/<td class="rutas"[^>]*>([\s\S]*?)<\/td>/g)].flatMap(
      (m) => [...(m[1] as string).matchAll(/<code>([\s\S]*?)<\/code>/g)].map((c) => c[1] as string),
    );
    expect(codigos).toEqual([
      "/v1/<wbr>municipios",
      "/v1/<wbr>estados/<wbr>{cve_ent}/<wbr>municipios",
      "/v1/<wbr>dias-inhabiles<wbr>?autoridad=cnbv<wbr>&amp;anio={anio}",
      "/v1/<wbr>isr/<wbr>tarifa/<wbr>{periodo}/<wbr>{anio}",
    ]);
    for (const codigo of codigos) expect(codigo).not.toMatch(/^\/<wbr>/);
    expect(codigos.map((c) => desescapar(c.replaceAll("<wbr>", "")))).toEqual([
      "/v1/municipios",
      "/v1/estados/{cve_ent}/municipios",
      "/v1/dias-inhabiles?autoridad=cnbv&anio={anio}",
      "/v1/isr/tarifa/{periodo}/{anio}",
    ]);
  });

  // Debajo de 640 px cada renglón es una tarjeta y la etiqueta de cada celda sale de este atributo.
  it("cada celda de la tabla de datos dice su columna, para verse como tarjeta", () => {
    const columnas = ["Datos al", "Registros", "Fuente y licencia", "API", "Descargas"];
    for (const fila of renglones(html, "tabla-datos")) {
      expect(fila.match(/<td\b/g)).toHaveLength(columnas.length);
      expect([...fila.matchAll(/<td\b[^>]*\sdata-etiqueta="([^"]*)"/g)].map((m) => m[1])).toEqual(
        columnas,
      );
    }
    expect(html).toContain(
      '<div class="tabla tarjetas" role="region" aria-labelledby="tabla-datos" tabindex="0">',
    );
    // La de las descargas tiene dos columnas y cabe tal cual.
    expect(html).toContain(
      '<div class="tabla" role="region" aria-labelledby="tabla-descargas" tabindex="0">',
    );
  });

  it("cada dataset aparece en un solo renglón de la tabla, con su as_of y sus registros", () => {
    const filas = renglones(html, "tabla-datos");
    expect(filas).toHaveLength(DATASETS.length);
    for (const d of DATASETS) {
      const suyas = filas.filter((f) => f.includes(`<span class="id">${d.id}</span>`));
      expect(suyas, d.id).toHaveLength(1);
      expect(suyas[0]).toContain(`<time datetime="${d.as_of}">${d.as_of}</time>`);
      expect(suyas[0]).toContain(`>${formatearEntero(d.registros)}</td>`);
      expect(suyas[0]).toContain(`<a href="${d.docs}">`);
    }
    expect(filas[1]).toContain(">1,234,567</td>");
  });

  // La misma palabra que /estado/ para la fecha de los datos; el tipo dice quién los actualiza.
  it("distingue automáticos y curados, y llama Datos al a la fecha, como /estado/", () => {
    const cabecera = html.slice(
      html.indexOf('<caption id="tabla-datos">'),
      html.indexOf("</thead>"),
    );
    expect([...cabecera.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1])).toEqual([
      "Dataset",
      "Datos al",
      "Registros",
      "Fuente y licencia",
      "API",
      "Descargas",
    ]);
    const [estados, uma, nuevo] = renglones(html, "tabla-datos") as [string, string, string];
    // Una etiqueta bajo el nombre y no otra columna: así la tabla cabe a 1280 px sin desplazarse.
    expect(estados).toContain(
      '<span class="id">inegi.estados</span><span class="detalle">Automático</span></th>',
    );
    expect(uma).toContain(
      '<span class="id">constantes.uma</span><span class="detalle">Curado</span></th>',
    );
    expect(nuevo).toContain('<span class="detalle">Automático</span></th>');
    expect(html).not.toContain("Actualizado");
    expect(paginaEstado()).toContain('<th scope="col" role="columnheader">Datos al</th>');
    expect(html).toContain("<em>Datos al</em>");
    // /estado/ y /v1/status solo traen los automáticos; en los curados la fecha es la publicación.
    expect(html).toContain("en los curados, la de su publicación oficial más reciente");
    expect(html).toContain("si cada dataset automático está al día");
  });

  it("muestra el nombre y la ruta de la API del catálogo, y un dataset nuevo con su id", () => {
    const [estados, uma, nuevo] = renglones(html, "tabla-datos") as [string, string, string];
    expect(estados).toContain(">Estados</a>");
    expect(estados).toContain("<code>/v1/<wbr>estados</code>");
    expect(uma).toContain("<code>/v1/<wbr>constantes/<wbr>uma<wbr>?fecha={fecha}</code>");
    expect(nuevo).toContain(">nuevo.dataset</a>");
    expect(nuevo).toContain("Solo en descargas");
  });

  // La ruta de uso común para los municipios es la de un estado.
  it("en Municipios muestra también la ruta de los municipios de un estado", () => {
    const municipios: DatasetInicio = {
      ...(DATASETS[0] as DatasetInicio),
      id: "inegi.municipios",
      directorio: "inegi-municipios",
    };
    const [fila] = renglones(paginaInicio({ ...ENTRADA, datasets: [municipios] }), "tabla-datos");
    expect(fila).toContain(
      '<code>/v1/<wbr>municipios</code><span class="detalle">Todos los del país</span><code>/v1/<wbr>estados/<wbr>{cve_ent}/<wbr>municipios</code><span class="detalle">Los de un estado</span></td>',
    );
  });

  it("enlaza las descargas JSON y CSV que existen de cada dataset", () => {
    const [estados, uma, nuevo] = renglones(html, "tabla-datos") as [string, string, string];
    expect(estados).toContain('<a href="/descargas/inegi-estados.json">JSON');
    expect(estados).toContain('<a href="/descargas/inegi-estados.csv">CSV');
    expect(uma).toContain('<a href="/descargas/constantes-uma.csv">CSV');
    expect(nuevo).toContain('<a href="/descargas/nuevo-dataset.json">JSON');
    expect(nuevo).not.toContain("nuevo-dataset.csv");
  });

  it("escapa los textos de las fuentes y no enlaza URL que no son https", () => {
    expect(html).toContain("A &amp; &lt;B&gt;");
    expect(html).not.toContain("A & <B>");
    expect(html).toContain("Fuente sin enlace");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://inseguro.mx");
    expect(html).toContain("Licencia &quot;rara&quot;");
  });

  it("junta las licencias repetidas y pliega las listas largas de fuentes", () => {
    const [estados, uma] = renglones(html, "tabla-datos") as [string, string];
    expect(estados.match(/class="licencia"/g)).toHaveLength(2);
    expect(estados).not.toContain("<details>");
    expect(uma.match(/class="licencia"/g)).toHaveLength(1);
    expect(uma).toContain("<details>\n<summary>3 fuentes</summary>");
    expect(uma).toContain("(2026-01-09)");
    expect(uma).toContain(
      '<a href="https://dof.gob.mx/nota_detalle.php?codigo=1&amp;fecha=2026-01-09">',
    );
  });

  it("cada href es del sitio, del repositorio, de npm o una URL https de los manifiestos", () => {
    const NPM = [
      "https://www.npmjs.com/package/mexicoapi",
      "https://www.npmjs.com/package/mexicoapi-mcp",
    ];
    // Las URL de los manifiestos tal como las deja enlaceSeguro, normalizadas.
    const deManifiestos = new Set(
      DATASETS.flatMap((d) => d.fuentes.flatMap((f) => [f.url, f.license_url])).flatMap((u) =>
        atributos(enlaceSeguro(u, "x"), "href"),
      ),
    );
    expect(html).toContain('<a href="https://www.banxico.org.mx/servicios/d/%7BC24C7DBC%7D.pdf">');
    // Los del cuerpo: en el head solo están la hoja, el favicon y la canónica.
    const hrefs = atributos(html.slice(html.indexOf("<body>")), "href");
    expect(hrefs.length).toBeGreaterThan(20);
    for (const href of hrefs) {
      const valido =
        /^\/(?!\/)/.test(href) ||
        href.startsWith("#") ||
        href === URL_REPO ||
        href.startsWith(`${URL_REPO}/`) ||
        NPM.includes(href) ||
        (deManifiestos.has(href) && href.startsWith("https://"));
      expect(valido, href).toBe(true);
    }
  });

  it("toda celda de encabezado declara su scope y toda tabla tiene caption", () => {
    for (const [th] of html.matchAll(/<th\b[^>]*>/g)) expect(th).toMatch(/ scope="(col|row)"/);
    expect(html.match(/<table\b/g)?.length).toBe(2);
    expect(html.match(/<table\b[^>]*>\n<caption id="[^"]+">/g)?.length).toBe(2);
  });

  // En modo tarjeta (display: block) WebKit quita la semántica de tabla: los roles la fijan. La
  // de las descargas no cambia de forma y no los necesita.
  it("la tabla de datos declara sus roles para el modo tarjeta; la de descargas no", () => {
    const tabla = (id: string): string => {
      const caption = html.indexOf(`<caption id="${id}">`);
      return html.slice(html.lastIndexOf("<table", caption), html.indexOf("</table>", caption));
    };
    const datos = tabla("tabla-datos");
    expect(datos.startsWith('<table role="table">')).toBe(true);
    expect(datos.match(/<thead\b[^>]*>|<tbody\b[^>]*>/g)).toEqual([
      '<thead role="rowgroup">',
      '<tbody role="rowgroup">',
    ]);
    const filas = datos.match(/<tr\b[^>]*>/g) ?? [];
    expect(filas).toHaveLength(DATASETS.length + 1);
    for (const tr of filas) expect(tr).toBe('<tr role="row">');
    for (const [th] of datos.matchAll(/<th\b[^>]*>/g)) {
      const [, scope, role] = th.match(/^<th scope="(\w+)"(?: class="\w+")? role="(\w+)">$/) ?? [];
      expect(`${scope}header`.replace("col", "column"), th).toBe(role);
    }
    const celdas = datos.match(/<td\b[^>]*>/g) ?? [];
    expect(celdas).toHaveLength(DATASETS.length * 5);
    for (const td of celdas) expect(td).toMatch(/ role="cell">$/);
    expect(tabla("tabla-descargas")).not.toContain("role=");
  });

  it("cada clase que usa tiene regla en la hoja de estilo", () => {
    const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });

  it("lista cada descarga con su tamaño y destaca el SQLite y SHA256SUMS", () => {
    const filas = renglones(html, "tabla-descargas");
    expect(filas).toHaveLength(DESCARGAS.size);
    expect(filas[0]).toContain('<a href="/descargas/SHA256SUMS">SHA256SUMS</a>');
    expect(filas.find((f) => f.includes("inegi-estados.json"))).toContain(">3.0 MB</td>");
    expect(filas.find((f) => f.includes("inegi-estados.csv"))).toContain(">1.5 KB</td>");
    expect(html).toContain('<a href="/descargas/mexicoapi.sqlite">mexicoapi.sqlite</a> (5.3 MB)');
    expect(html).toContain('<a href="/descargas/SHA256SUMS">SHA256SUMS</a> trae');
    // Sin la lista de la LFT en las descargas, no la menciona.
    expect(html).not.toContain("dias-inhabiles-lft");
    const conLft = new Map(DESCARGAS);
    conLft.set("dias-inhabiles-lft.json", "[]");
    conLft.set("dias-inhabiles-lft.csv", "");
    expect(paginaInicio({ ...ENTRADA, descargas: conLft })).toContain(
      'Los días de descanso obligatorio de la LFT (art. 74), que se calculan por regla y no son un dataset, están en <a href="/descargas/dias-inhabiles-lft.json">JSON</a> y <a href="/descargas/dias-inhabiles-lft.csv">CSV</a>, de 2007 a 2100.',
    );
  });

  // Sin JavaScript se ve la API pública, que funciona tal cual; sitio.js pone el origen. El origen
  // va una vez en API= y cada curl lo usa: los renglones caben en una columna angosta y, si no,
  // se parten en un espacio o después de API=, nunca a media URL.
  it("los ejemplos con URL usan la API pública dentro de [data-origen], sin aviso en noscript", () => {
    expect(URL_API).toBe("https://mexicoapi.dagel4k.workers.dev");
    const origenes = [...html.matchAll(/<span data-origen>([^<]*)<\/span>/g)].map((m) => m[1]);
    // Dos bloques de bash y su línea de PowerShell.
    expect(origenes).toHaveLength(4);
    for (const texto of origenes) expect(texto).toBe(URL_API);
    expect(html.match(/<pre><code>API=<wbr><span data-origen>/g)).toHaveLength(2);
    const codigo = bloquesDeCodigo(html);
    expect(codigo).toContain(
      `API=${URL_API}\ncurl $API/v1/estados/25\ncurl $API/v1/clabe/002010077777777771`,
    );
    expect(codigo).toContain(
      `API=${URL_API}\ncurl -O $API/descargas/SHA256SUMS\nsha256sum -c SHA256SUMS --ignore-missing`,
    );
    // Cada renglón con curl lleva el comando y la URL juntos, sin el origen repetido.
    for (const renglon of codigo
      .join("\n")
      .split("\n")
      .filter((r) => r.startsWith("curl"))) {
      expect(renglon).toMatch(/^curl (-O )?\$API\/\S+$/);
      expect(renglon.length).toBeLessThanOrEqual(40);
    }
    expect(html).not.toContain("&lt;base&gt;");
    expect(html).not.toContain("<noscript>");
  });

  // `API=` y `$API` son de bash y zsh. En PowerShell la variable se asigna con espacios y
  // comillas, y `curl` es un alias de Invoke-WebRequest en la 5.1: hace falta `curl.exe`.
  it("debajo de cada bloque de curl dice cómo correrlo en PowerShell, con curl.exe y comillas", () => {
    const notas = [...html.matchAll(/<\/code><\/pre>\n<p>En PowerShell: ([\s\S]*?)<\/p>/g)].map(
      (m) => m[1] as string,
    );
    expect(notas).toHaveLength(2);
    const codigos = notas.map((nota) =>
      [...nota.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => m[1] as string),
    );
    for (const [asignacion, comando] of codigos) {
      expect(asignacion).toBe(`$API = &quot;<span data-origen>${URL_API}</span>&quot;`);
      expect(desescapar(comando ?? "")).toMatch(/^curl\.exe (-O )?"\$API\/[^"\s]+"$/);
    }
    expect(desescapar(codigos[0]?.[1] ?? "")).toBe('curl.exe "$API/v1/estados/25"');
    expect(desescapar(codigos[1]?.[1] ?? "")).toBe('curl.exe -O "$API/descargas/SHA256SUMS"');
    // Cada nota va justo debajo del bloque de bash que traduce.
    for (const bloque of ["curl $API/v1/clabe/", "sha256sum -c SHA256SUMS"]) {
      const fin = html.indexOf("</code></pre>", html.indexOf(bloque));
      expect(html.slice(fin).startsWith("</code></pre>\n<p>En PowerShell: "), bloque).toBe(true);
    }
    // sha256sum no existe en PowerShell: Get-FileHash da el sha256 para comparar.
    expect(notas[1]).toContain("<code>Get-FileHash</code>");
  });

  // Con pre-wrap ningún bloque de código se desplaza: con tabindex, Tab se detendría en cada uno.
  it("solo las tablas, que se pueden desplazar, se enfocan con Tab; los bloques de código no", () => {
    expect(html.match(/<pre\b[^>]*>/g)?.every((pre) => pre === "<pre>")).toBe(true);
    expect(html.match(/<pre>/g)?.length).toBeGreaterThanOrEqual(5);
    const conTabindex = html.match(/<[a-z]+\b[^>]*\stabindex="0"[^>]*>/g) ?? [];
    expect(conTabindex).toHaveLength(2);
    for (const etiqueta of conTabindex) expect(etiqueta).toMatch(/^<div class="tabla[ "]/);
  });

  it("Empieza muestra una consulta, una CLABE y cómo sumar días hábiles, con tipo_plazo en el SAT", () => {
    const api = html.slice(
      html.indexOf("<h3>API</h3>"),
      html.indexOf("</div>", html.indexOf("<h3>API</h3>")),
    );
    expect(bloquesDeCodigo(api)).toEqual([
      `API=${URL_API}\ncurl $API/v1/estados/25\ncurl $API/v1/clabe/${CLABE_EJEMPLO}`,
      JSON.stringify(EJEMPLO, null, 2),
    ]);
    expect(CLABE_EJEMPLO).toBe("002010077777777771");
    expect(validarClabe("002010077777777771").valido).toBe(true);
    expect(api).toContain("<p>La respuesta de la CLABE, recortada:</p>\n<pre><code>{");
    expect(api).toContain(
      "<code>/v1/dias-habiles?autoridad=lft&amp;desde=2026-12-18&amp;dias=3</code>",
    );
    expect(api).toContain("con <code>sat</code>, agrega <code>tipo_plazo=general</code>");
    expect(api).toContain("<code>tipo_plazo=declaraciones_pagos</code>");
    expect(api).toContain("<code>AAAA-MM-DD</code>");
  });

  // Un subconjunto de la respuesta real, con los mismos valores: la prueba de integración lo
  // compara contra la del Worker.
  it("respuestaRecortada deja el veredicto, el banco y la fuente, y escapa los textos", () => {
    expect(EJEMPLO).toEqual({
      data: {
        valor: CLABE_EJEMPLO,
        valido: true,
        errores: [],
        detalle: { banco: { codigo: "002", nombre_corto: "BANAMEX", activo: true } },
      },
      meta: {
        dataset: "bancos",
        as_of: "2026-10-17",
        sources: [{ name: "Banco de México <CEP>", license: "Reproducción con cita & fuente" }],
      },
    });
    expect(html).toContain("Banco de México &lt;CEP&gt;");
    expect(html).toContain("Reproducción con cita &amp; fuente");
    expect(html).not.toContain("<CEP>");
  });

  // Sin el catálogo, validarClabe no revisa el banco: el ejemplo que se copia lo pasa.
  it("ya publicados, trae el ejemplo del paquete con el catálogo de bancos y la configuración del MCP", () => {
    const codigo = bloquesDeCodigo(paginaInicio(ENTRADA, true));
    expect(codigo).toContain("npm install mexicoapi");
    const ejemplo = [
      'import { validarClabe } from "mexicoapi";',
      'import { catalogoClabe } from "mexicoapi/datos";',
      "",
      'const r = validarClabe("002010077777777771", { bancos: catalogoClabe() });',
      'r.valido; // true; un banco que no existe da false con errores ["banco"]',
    ].join("\n");
    expect(codigo).toContain(ejemplo);
    // Lo que dice el comentario, con un catálogo que solo trae el 002.
    const bancos = new Map([["002", { codigo: "002", nombre_corto: "BANAMEX", activo: true }]]);
    expect(validarClabe("002010077777777771", { bancos }).valido).toBe(true);
    expect(validarClabe("999010077777777774", { bancos })).toMatchObject({
      valido: false,
      errores: ["banco"],
    });
    expect(validarClabe("999010077777777774").valido).toBe(true);
    const mcp = codigo.find((c) => c.includes("mcpServers"));
    expect(JSON.parse(mcp ?? "")).toEqual({
      mcpServers: { mexicoapi: { command: "npx", args: ["-y", "mexicoapi-mcp"] } },
    });
  });

  // npm muestra el README de la versión publicada; el CHANGELOG de main dice qué viene.
  it("al pie del paquete y del MCP enlaza su página de npm y su CHANGELOG", () => {
    const bloque = (titulo: string): string => {
      const inicio = html.indexOf(`<h3>${titulo}</h3>`);
      return html.slice(inicio, html.indexOf("</div>", inicio));
    };
    const pie = (nombre: string, carpeta: string): string =>
      `<p>Documentación: <a href="https://www.npmjs.com/package/${nombre}">README<span class="oculto"> de ${nombre}</span> en npm</a> · <a href="${URL_ARCHIVOS}/packages/${carpeta}/CHANGELOG.md">cambios<span class="oculto"> de ${nombre}</span></a></p>\n`;
    expect(bloque("Paquete de npm").endsWith(pie("mexicoapi", "sdk"))).toBe(true);
    expect(bloque("Servidor MCP").endsWith(pie("mexicoapi-mcp", "mcp"))).toBe(true);
  });

  // Varios clientes en Windows no encuentran npx (es npx.cmd) si no pasa por cmd.
  it("debajo de la configuración del MCP dice cómo usarla en Windows", () => {
    const inicio = html.indexOf("<h3>Servidor MCP</h3>");
    const mcp = html.slice(inicio, html.indexOf("</div>", inicio));
    const nota = mcp.match(
      /<p>En Windows, si el cliente no encuentra <code>npx<\/code>, usa <code>(.+?)<\/code> y <code>(.+?)<\/code>\.<\/p>/,
    );
    expect(nota).not.toBeNull();
    expect(mcp.indexOf("</code></pre>")).toBeLessThan(mcp.indexOf("<p>En Windows"));
    const [, comando, argumentos] = nota as RegExpMatchArray;
    const texto = (html: string): string => desescapar(sinEtiquetas(html));
    expect(JSON.parse(`{${texto(comando ?? "")}, ${texto(argumentos ?? "")}}`)).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "mexicoapi-mcp"],
    });
    // Cada argumento queda entero en su renglón: "-y" no se parte en el guion.
    for (const argumento of ["/c", "npx", "-y", "mexicoapi-mcp"]) {
      expect(argumentos).toContain(`<span class="junto">&quot;${argumento}&quot;</span>`);
    }
  });

  // La API solo valida CLABE; el paquete también RFC, CURP y NSS, sin mandar el dato a la red. En
  // el RFC un mal dígito verificador no hace falso `valido`: solo se avisa.
  it("dice qué valida el paquete, que lo hace en el equipo y que en el RFC el dígito es informativo", () => {
    const inicio = html.indexOf("<h3>Paquete de npm</h3>");
    expect(html.slice(inicio, html.indexOf("</div>", inicio))).toContain(
      "Validadores de CLABE, RFC, CURP y NSS (formato y dígito verificador, en tu equipo; en el RFC, el dígito es informativo)",
    );
    const rfc = validarRfc("XAXX010101001");
    expect([rfc.valido, rfc.digito_verificador_valido]).toEqual([true, false]);
  });

  // Un comando copiable de un paquete que no existe en npm falla, o instala el de otra persona.
  it("mientras no estén en npm, solo avisa en una línea, sin comandos de instalación ni configuración", () => {
    const html = paginaInicio(ENTRADA, false);
    const codigo = bloquesDeCodigo(html).join("\n");
    for (const texto of ["npm install", "npx", "mexicoapi-mcp", "mcpServers", 'from "mexicoapi"']) {
      expect(codigo, texto).not.toContain(texto);
    }
    expect(html).not.toContain("npm install");
    expect(html).not.toContain("npx -y");
    // Un solo aviso para los dos, después del bloque de la API, que ocupa el ancho completo.
    expect(html.match(/class="aviso"/g)).toHaveLength(1);
    expect(html).toContain(
      `<p class="aviso"><strong>Pendiente:</strong> el paquete <code>mexicoapi</code> y el servidor MCP <code>mexicoapi-mcp</code> se publicarán en npm; mientras tanto, usa la API. Lo que traen está en sus README: <a href="${URL_ARCHIVOS}/packages/sdk/README.md">paquete</a> y <a href="${URL_ARCHIVOS}/packages/mcp/README.md">servidor MCP</a>.</p>`,
    );
    expect(html).not.toContain("<h3>Paquete de npm</h3>");
    expect(html).not.toContain('<div class="bloques">');
    // Ya están en npm (0.1.0, 2026-10-18): la página que se publica es la de los paquetes publicados.
    expect(PUBLICADO_EN_NPM).toBe(true);
    const publicado = paginaInicio(ENTRADA);
    expect(publicado).not.toContain("se publicarán en npm");
    expect(publicado).toContain('<div class="bloques">');
    expect(publicado).not.toContain('class="aviso"');
    expect(publicado).toContain("npm install mexicoapi");
    expect(publicado).toContain("mexicoapi-mcp");
  });

  it("enlaza la referencia y el pie a archivos que existen en el repositorio", async () => {
    for (const href of [
      "/v1/openapi.json",
      `${URL_ARCHIVOS}/docs/api/README.md`,
      `${URL_ARCHIVOS}/docs/api/problemas.md`,
      "/llms.txt",
      "/llms-full.txt",
      "/estado/",
      `${URL_ARCHIVOS}/LICENSE`,
      `${URL_ARCHIVOS}/DATA_LICENSE.md`,
      `${URL_ARCHIVOS}/SECURITY.md`,
      `${URL_ARCHIVOS}/packages/sdk/CHANGELOG.md`,
      `${URL_ARCHIVOS}/packages/mcp/CHANGELOG.md`,
      URL_REPO,
    ]) {
      expect(html).toContain(`<a href="${href}">`);
    }
    const raiz = fileURLToPath(new URL("../../../../../", import.meta.url));
    const delRepo = atributos(html, "href")
      .filter((h) => h.startsWith(`${URL_ARCHIVOS}/`) && !h.includes("/docs/datos/"))
      .map((h) => h.slice(URL_ARCHIVOS.length + 1));
    expect(delRepo.length).toBeGreaterThanOrEqual(5);
    for (const ruta of delRepo)
      await expect(access(`${raiz}${ruta}`), ruta).resolves.toBeUndefined();
  });

  it("falla si falta el SQLite o SHA256SUMS en las descargas", () => {
    for (const falta of ["mexicoapi.sqlite", "SHA256SUMS"]) {
      const descargas = new Map(DESCARGAS);
      descargas.delete(falta);
      expect(() => paginaInicio({ ...ENTRADA, descargas })).toThrow(falta);
    }
  });
});

describe("formatos", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024, "10 KB"],
    [1023 * 1024 + 600, "1.0 MB"],
    [300 * 1024 * 1024, "300 MB"],
    [3 * 1024 ** 3, "3.0 GB"],
  ])("tamanoLegible(%i) es %j", (bytes, texto) => {
    expect(tamanoLegible(bytes)).toBe(texto);
  });

  it("tamanoLegible da un número de hasta 1023 con su unidad", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 40 }), (bytes) => {
        const [numero, unidad] = tamanoLegible(bytes).split(" ") as [string, string];
        expect(numero).toMatch(/^\d+(\.\d)?$/);
        expect(["B", "KB", "MB", "GB"]).toContain(unidad);
        if (unidad !== "GB") expect(Number(numero)).toBeLessThan(1024);
      }),
    );
  });

  it.each([
    [0, "0"],
    [999, "999"],
    [2478, "2,478"],
    [1234567, "1,234,567"],
  ])("formatearEntero(%i) es %j", (n, texto) => {
    expect(formatearEntero(n)).toBe(texto);
  });
});
