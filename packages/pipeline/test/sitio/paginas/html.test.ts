import { URL_API } from "@mexicoapi/core/problemas";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { URL_ARCHIVOS, URL_REPO } from "../../../src/sitio/meta.js";
import { CSP_404 } from "../../../src/sitio/paginas/encabezados.js";
import { ESTILO, FONDO } from "../../../src/sitio/paginas/estilo.js";
import {
  documento,
  enlaceSeguro,
  escaparHtml,
  navegacion,
} from "../../../src/sitio/paginas/html.js";
import { desescapar, esperarDocumentoValido, problemasDeEtiquetas } from "./estructura.js";

/** Cadenas cargadas de los caracteres que importan, incluidas entidades ya escritas. */
const conEspeciales = fc.string({
  unit: fc.constantFrom("&", "<", ">", '"', "'", "a", "ñ", " ", ";", "#", "&amp;", "&lt;", "&#39;"),
});

describe("escaparHtml", () => {
  it("no deja < > \" ' sin escapar y desescapar devuelve el texto original", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: "binary" }), conEspeciales), (texto) => {
        const escapado = escaparHtml(texto);
        expect(escapado).not.toMatch(/[<>"']/);
        // Cada & que queda empieza una de las cinco entidades.
        expect(escapado.replace(/&(?:amp|lt|gt|quot|#39);/g, "")).not.toContain("&");
        expect(desescapar(escapado)).toBe(texto);
      }),
    );
  });

  it("escapa los cinco caracteres", () => {
    expect(escaparHtml(`A & <B> "c" 'd'`)).toBe("A &amp; &lt;B&gt; &quot;c&quot; &#39;d&#39;");
  });
});

describe("enlaceSeguro", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "http://ejemplo.mx/",
    "data:text/html,<b>hola</b>",
    "https://ejemplo.mx/con espacio",
    "https://ejemplo.mx/\tb",
    "https://ejemplo.mx/\n",
    " https://ejemplo.mx/",
    "https://",
    "//ejemplo.mx/",
    "/local",
    "",
  ])("%j da el texto sin enlace", (url) => {
    expect(enlaceSeguro(url, "A & <B>")).toBe("A &amp; &lt;B&gt;");
  });

  it("una URL https da un enlace con href y texto escapados", () => {
    expect(enlaceSeguro("https://dof.gob.mx/nota.php?a=1&b=2", "A & <B>")).toBe(
      '<a href="https://dof.gob.mx/nota.php?a=1&amp;b=2">A &amp; &lt;B&gt;</a>',
    );
  });

  // El validador de HTML rechaza `{` o `"` sin codificar en un href; la URL de Banxico trae llaves.
  it("el href va normalizado, con los caracteres que HTML no acepta codificados", () => {
    expect(enlaceSeguro("https://banxico.org.mx/d/{C24C}.pdf", "PDF")).toBe(
      '<a href="https://banxico.org.mx/d/%7BC24C%7D.pdf">PDF</a>',
    );
    expect(enlaceSeguro('https://DOF.gob.mx/n.php?b="2"&c={3}|%zz#x^y', "x")).toBe(
      '<a href="https://dof.gob.mx/n.php?b=%222%22&amp;c=%7B3%7D%7C%25zz#x%5Ey">x</a>',
    );
  });

  it("solo enlaza lo que empieza con https://, y el texto siempre sale escapado", () => {
    const url = fc.oneof(
      fc.string(),
      fc.webUrl(),
      conEspeciales.map((s) => `https://a.mx/${s}`),
    );
    fc.assert(
      fc.property(url, conEspeciales, (u, texto) => {
        const resultado = enlaceSeguro(u, texto);
        if (resultado.startsWith("<a ")) {
          expect(u.startsWith("https://")).toBe(true);
          const [, atributo, contenido] = resultado.match(/^<a href="([^"]*)">(.*)<\/a>$/s) ?? [];
          expect(contenido).toBe(escaparHtml(texto));
          // Solo caracteres válidos en un href, cada % con sus dos dígitos, y el mismo origen.
          const href = desescapar(atributo ?? "");
          expect(href).toMatch(/^https:\/\/[\w!$&'()*+,\-./:;=?@~%#\u0080-\u{10ffff}]*$/u);
          expect(href).not.toMatch(/%(?![0-9A-Fa-f]{2})/);
          expect(new URL(href).origin).toBe(new URL(u).origin);
        } else {
          expect(resultado).toBe(escaparHtml(texto));
        }
      }),
    );
  });
});

describe("documento", () => {
  const base = {
    titulo: "Título & <prueba>",
    descripcion: 'Descripción con "comillas"',
    cuerpo: "<main><h1>Hola</h1></main>",
    ruta: "/prueba/",
  };

  it("arma un documento válido con la hoja de estilo y sin scripts", () => {
    const html = documento(base);
    esperarDocumentoValido(html);
    expect(html).toContain("<title>Título &amp; &lt;prueba&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="Descripción con &quot;comillas&quot;">',
    );
    expect(html).toContain('<link rel="stylesheet" href="/estilo.css">');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).not.toContain("<script");
    expect(html.endsWith("</html>\n")).toBe(true);
    // Las páginas con regla en _headers no repiten la política en meta: una CSP en meta sin
    // script-src bloquearía sitio.js.
    expect(html).not.toContain("http-equiv");
    expect(html).not.toContain('name="referrer"');
  });

  it("con seguridadEnMeta pone la CSP del 404 y el referrer después del charset", () => {
    const html = documento({ ...base, seguridadEnMeta: true });
    esperarDocumentoValido(html);
    expect(html).toContain(
      `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP_404}">\n` +
        '<meta name="referrer" content="no-referrer">\n<meta name="viewport"',
    );
  });

  // Sin ruta (el 404, que se sirve en cualquier URL) no hay canónica ni tarjeta, y no se indexa.
  it("con ruta null pide a los buscadores no indexar la página y no declara canónica", () => {
    expect(documento(base)).not.toContain('name="robots"');
    const html = documento({ ...base, ruta: null });
    esperarDocumentoValido(html);
    expect(html).toContain('<meta name="robots" content="noindex">\n');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:");
    expect(html).not.toContain("twitter:");
  });

  // Staging también apunta a producción: la canónica sale de URL_API, no del origen servido.
  it("con ruta declara la canónica en la API pública y la tarjeta de Open Graph", () => {
    const html = documento(base);
    esperarDocumentoValido(html);
    const canonica = `${URL_API}/prueba/`;
    expect(html).toContain(
      `<link rel="canonical" href="${canonica}">\n` +
        '<meta property="og:type" content="website">\n' +
        '<meta property="og:site_name" content="MéxicoAPI">\n' +
        '<meta property="og:locale" content="es_MX">\n' +
        '<meta property="og:title" content="Título &amp; &lt;prueba&gt;">\n' +
        '<meta property="og:description" content="Descripción con &quot;comillas&quot;">\n' +
        `<meta property="og:url" content="${canonica}">\n` +
        '<meta name="twitter:card" content="summary">\n',
    );
    expect(html).not.toContain("og:image");
    expect(documento({ ...base, ruta: "/" })).toContain(
      `<link rel="canonical" href="${URL_API}/">`,
    );
  });

  it.each(["", "estado/", "//otro.mx/", "https://otro.mx/", "/a b/", '/a"b/', "/a?b"])(
    "rechaza la ruta %j",
    (ruta) => {
      expect(() => documento({ ...base, ruta })).toThrow(/ruta/);
    },
  );

  // Los buscadores cortan la descripción cerca de los 155 caracteres.
  it("rechaza una descripción de más de 155 caracteres", () => {
    expect(() => documento({ ...base, descripcion: "é".repeat(155) })).not.toThrow();
    expect(() => documento({ ...base, descripcion: "é".repeat(156) })).toThrow(/155/);
  });

  // El color de la barra del navegador es el fondo de la página, en cada tema.
  it("declara theme-color con el fondo de cada tema", () => {
    expect(documento(base)).toContain(
      `<meta name="theme-color" content="${FONDO.claro}" media="(prefers-color-scheme: light)">\n` +
        `<meta name="theme-color" content="${FONDO.oscuro}" media="(prefers-color-scheme: dark)">\n`,
    );
    const oscuro = ESTILO.indexOf("prefers-color-scheme: dark");
    expect(ESTILO.indexOf(`--fondo: ${FONDO.claro};`)).toBeLessThan(oscuro);
    expect(ESTILO.indexOf(`--fondo: ${FONDO.oscuro};`)).toBeGreaterThan(oscuro);
  });

  // El pie con las licencias y el reporte de vulnerabilidades va en toda página, también el 404.
  it.each([
    ["/prueba/", "/prueba/"],
    ["null", null],
  ])("con ruta %s cierra el cuerpo con el pie", (_, ruta) => {
    const html = documento({ ...base, ruta });
    esperarDocumentoValido(html);
    const inicio = html.indexOf('<footer class="pie">');
    expect(html.indexOf("</main>")).toBeLessThan(inicio);
    const pie = html.slice(inicio, html.indexOf("</body>"));
    expect(pie.trimEnd().endsWith("</footer>")).toBe(true);
    for (const href of [
      `${URL_ARCHIVOS}/LICENSE`,
      `${URL_ARCHIVOS}/DATA_LICENSE.md`,
      URL_REPO,
      `${URL_ARCHIVOS}/SECURITY.md`,
    ]) {
      expect(pie).toContain(`<a href="${href}">`);
    }
    expect(pie).toContain("Reportar una vulnerabilidad");
    expect(html.match(/<footer/g)).toHaveLength(1);
  });

  it("carga cada script como módulo del mismo origen", () => {
    const html = documento({ ...base, scripts: ["/sitio.js"] });
    esperarDocumentoValido(html);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
  });

  it.each(["sitio.js", "//cdn.ejemplo.mx/x.js", "https://ejemplo.mx/x.js", '/a".js'])(
    "rechaza el script %j",
    (src) => {
      expect(() => documento({ ...base, scripts: [src] })).toThrow(/script/);
    },
  );
});

describe("navegacion", () => {
  const enlaces = (nav: string): string[] =>
    [...nav.matchAll(/<a [^>]*>[^<]*<\/a>/g)].map((m) => m[0]);

  it("en / las secciones son anclas de la página y nada lleva aria-current", () => {
    expect(enlaces(navegacion("/", URL_REPO))).toEqual([
      '<a href="#empieza">Empieza</a>',
      '<a href="#datos">Datos</a>',
      '<a href="#descargas">Descargas</a>',
      '<a href="#referencia">Referencia</a>',
      '<a href="/estado/">Estado</a>',
      `<a href="${URL_REPO}">GitHub</a>`,
    ]);
  });

  // aria-current marca el enlace de la página en la que se está.
  it("en /estado/ las secciones van a las de / y Estado lleva aria-current", () => {
    expect(enlaces(navegacion("/estado/"))).toEqual([
      '<a href="/#empieza">Empieza</a>',
      '<a href="/#datos">Datos</a>',
      '<a href="/#descargas">Descargas</a>',
      '<a href="/#referencia">Referencia</a>',
      '<a href="/estado/" aria-current="page">Estado</a>',
    ]);
  });

  it("sin ruta (el 404) todo apunta a / y nada lleva aria-current", () => {
    const nav = navegacion(null);
    expect(nav).not.toContain("aria-current");
    expect(enlaces(nav)).toContain('<a href="/estado/">Estado</a>');
    expect(enlaces(nav)).toContain('<a href="/#datos">Datos</a>');
  });
});

describe("verificador de etiquetas de las pruebas", () => {
  it("detecta cierres cruzados, sobrantes y etiquetas sin cerrar", () => {
    expect(problemasDeEtiquetas("<p><b>x</p></b>")).toEqual(["</p> cierra <b>", "</b> cierra <p>"]);
    expect(problemasDeEtiquetas("<div><p>x</p>")).toEqual(["<div> sin cerrar"]);
    expect(problemasDeEtiquetas("</p>")).toEqual(["</p> cierra <nada>"]);
    expect(problemasDeEtiquetas('<meta charset="utf-8"></meta>')).toEqual([
      "</meta> cierra una etiqueta vacía",
    ]);
    expect(problemasDeEtiquetas('<p>a<br>b<a href="/">c</a></p>')).toEqual([]);
  });
});
