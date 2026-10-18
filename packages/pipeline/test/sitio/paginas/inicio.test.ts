import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validarClabe } from "@mexicoapi/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PUBLICADO_EN_NPM } from "../../../src/sitio/comun.js";
import { URL_ARCHIVOS, URL_REPO } from "../../../src/sitio/meta.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { enlaceSeguro } from "../../../src/sitio/paginas/html.js";
import {
  type DatasetInicio,
  formatearEntero,
  paginaInicio,
  tamanoLegible,
} from "../../../src/sitio/paginas/inicio.js";
import { atributos, desescapar, esperarDocumentoValido } from "./estructura.js";

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
    as_of: "2026-10-17",
    registros: 32,
    docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/inegi-estados.md",
    fuentes: [
      {
        name: "A & <B>",
        url: "https://gaia.inegi.org.mx/wscatgeo/v2/",
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
];

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

const html = paginaInicio({ datasets: DATASETS, descargas: DESCARGAS });

/** El cuerpo de la tabla de datasets, una cadena por renglón. */
function renglones(pagina: string, idTabla: string): string[] {
  const inicio = pagina.indexOf(`<caption id="${idTabla}">`);
  const fin = pagina.indexOf("</table>", inicio);
  const cuerpo = pagina.slice(pagina.indexOf("<tbody>", inicio), fin);
  return [...cuerpo.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1] as string);
}

/** El texto de cada bloque `pre > code`, ya sin etiquetas ni entidades. */
const bloquesDeCodigo = (pagina: string): string[] =>
  [...pagina.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) =>
    desescapar((m[1] as string).replace(/<[^>]+>/g, "")),
  );

describe("página de inicio", () => {
  it("es un documento válido que carga sitio.js como módulo", () => {
    esperarDocumentoValido(html);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    expect(html).toContain("<h1>MéxicoAPI</h1>");
    expect(html).toContain("Datos de referencia de México con fuente oficial, licencia y sha256.");
    expect(html).toContain("con 3 datasets oficiales y descargas completas en JSON, CSV y SQLite.");
  });

  it("navega a las cinco secciones", () => {
    for (const [href, texto] of [
      ["#empieza", "Empieza"],
      ["#datos", "Datos"],
      ["#descargas", "Descargas"],
      ["#referencia", "Referencia"],
      ["/estado/", "Estado"],
    ]) {
      expect(html).toContain(`<a href="${href}">${texto}</a>`);
    }
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

  it("muestra el nombre y la ruta de la API del catálogo, y un dataset nuevo con su id", () => {
    const [estados, uma, nuevo] = renglones(html, "tabla-datos") as [string, string, string];
    expect(estados).toContain(">Estados</a>");
    expect(estados).toContain("<code>/v1/estados</code>");
    expect(uma).toContain("<code>/v1/constantes/uma?fecha={fecha}</code>");
    expect(nuevo).toContain(">nuevo.dataset</a>");
    expect(nuevo).toContain("Solo en descargas");
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

  it("cada href es del sitio, del repositorio o una URL https de los manifiestos", () => {
    // Las URL de los manifiestos tal como las deja enlaceSeguro, normalizadas.
    const deManifiestos = new Set(
      DATASETS.flatMap((d) => d.fuentes.flatMap((f) => [f.url, f.license_url])).flatMap((u) =>
        atributos(enlaceSeguro(u, "x"), "href"),
      ),
    );
    expect(html).toContain('<a href="https://www.banxico.org.mx/servicios/d/%7BC24C7DBC%7D.pdf">');
    const hrefs = atributos(html, "href");
    expect(hrefs.length).toBeGreaterThan(20);
    for (const href of hrefs) {
      const valido =
        /^\/(?!\/)/.test(href) ||
        href.startsWith("#") ||
        href === URL_REPO ||
        href.startsWith(`${URL_REPO}/`) ||
        (deManifiestos.has(href) && href.startsWith("https://"));
      expect(valido, href).toBe(true);
    }
  });

  it("toda celda de encabezado declara su scope y toda tabla tiene caption", () => {
    for (const [th] of html.matchAll(/<th\b[^>]*>/g)) expect(th).toMatch(/ scope="(col|row)"/);
    expect(html.match(/<table>/g)?.length).toBe(2);
    expect(html.match(/<table>\n<caption id="[^"]+">/g)?.length).toBe(2);
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
  });

  it("los ejemplos con URL usan https://<base> dentro de [data-origen]", () => {
    const origenes = [...html.matchAll(/<span data-origen>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(origenes.length).toBeGreaterThanOrEqual(2);
    for (const texto of origenes) expect(texto).toBe("https://&lt;base&gt;");
    const codigo = bloquesDeCodigo(html);
    expect(codigo).toContain("curl https://<base>/v1/estados/25");
    expect(codigo).toContain(
      "curl -O https://<base>/descargas/SHA256SUMS\nsha256sum -c SHA256SUMS --ignore-missing",
    );
  });

  it("trae el ejemplo del paquete y la configuración del servidor MCP", () => {
    const codigo = bloquesDeCodigo(html);
    expect(codigo).toContain("npm install mexicoapi");
    const ejemplo = [
      'import { validarClabe } from "mexicoapi";',
      "",
      'const r = validarClabe("002010077777777771");',
      "r.valido; // true",
    ].join("\n");
    expect(codigo).toContain(ejemplo);
    expect(validarClabe("002010077777777771").valido).toBe(true);
    const mcp = codigo.find((c) => c.includes("mcpServers"));
    expect(JSON.parse(mcp ?? "")).toEqual({
      mcpServers: { mexicoapi: { command: "npx", args: ["-y", "mexicoapi-mcp"] } },
    });
  });

  it("avisa que el paquete y el servidor MCP se publicarán en npm mientras no lo estén", () => {
    expect(PUBLICADO_EN_NPM).toBe(false);
    expect(html.match(/se publicará en npm/g)).toHaveLength(2);
    const publicado = paginaInicio({ datasets: DATASETS, descargas: DESCARGAS }, true);
    expect(publicado).not.toContain("se publicará en npm");
    expect(publicado).not.toContain('class="aviso"');
    expect(publicado).toContain("npm install mexicoapi");
  });

  it("enlaza la referencia y el pie a archivos que existen en el repositorio", async () => {
    for (const href of [
      "/v1/openapi.json",
      `${URL_ARCHIVOS}/docs/api/README.md`,
      `${URL_ARCHIVOS}/docs/api/problemas.md`,
      "/llms.txt",
      "/estado/",
      `${URL_ARCHIVOS}/LICENSE`,
      `${URL_ARCHIVOS}/DATA_LICENSE.md`,
      `${URL_ARCHIVOS}/SECURITY.md`,
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
      expect(() => paginaInicio({ datasets: DATASETS, descargas })).toThrow(falta);
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
