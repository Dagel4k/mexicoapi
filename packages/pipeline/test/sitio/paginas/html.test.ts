import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { documento, enlaceSeguro, escaparHtml } from "../../../src/sitio/paginas/html.js";
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
  };

  it("arma un documento válido con la hoja de estilo y sin scripts", () => {
    const html = documento(base);
    esperarDocumentoValido(html);
    expect(html).toContain("<title>Título &amp; &lt;prueba&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="Descripción con &quot;comillas&quot;">',
    );
    expect(html).toContain('<link rel="stylesheet" href="/estilo.css">');
    expect(html).not.toContain("<script");
    expect(html.endsWith("</html>\n")).toBe(true);
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
