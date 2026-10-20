import { describe, expect, it } from "vitest";
import { URL_ARCHIVOS, URL_REPO } from "../../../src/sitio/meta.js";
import { CSP_404 } from "../../../src/sitio/paginas/encabezados.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { paginaNoEncontrada } from "../../../src/sitio/paginas/no-encontrado.js";
import { atributos, esperarDocumentoValido } from "./estructura.js";

const html = paginaNoEncontrada();

describe("404.html", () => {
  it("es un documento válido, con la hoja de estilo y sin scripts", () => {
    esperarDocumentoValido(html);
    expect(html).toContain('<link rel="stylesheet" href="/estilo.css">');
    expect(html).not.toContain("<script");
    expect(html).toContain("<h1>No existe esta página</h1>");
  });

  // Se sirve en URL sin regla propia en _headers (solo la de /*, sin CSP): su CSP y su referrer
  // van en meta, antes de cargar nada.
  // frame-ancestors no vale en una meta (el navegador lo ignora y avisa en la consola).
  it("lleva su CSP y su política de referrer en meta, justo después del charset", () => {
    expect(html).toContain(
      '<head>\n<meta charset="utf-8">\n' +
        `<meta http-equiv="Content-Security-Policy" content="${CSP_404}">\n` +
        '<meta name="referrer" content="no-referrer">\n',
    );
    expect(CSP_404).toBe(
      "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'",
    );
    expect(html).not.toContain("frame-ancestors");
  });

  // Se sirve con 404 en cualquier URL; el noindex cubre a quien la tome por una página más.
  it("pide no indexarla", () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("enlaza al inicio y al índice de la API", () => {
    expect(html).toContain('<a href="/">');
    expect(html).toContain('<a href="/v1">');
  });

  // Se sirve en cualquier URL que no existe: un enlace relativo apuntaría a otra ruta inexistente.
  it("todos sus enlaces son absolutos: al sitio, a la misma página o, en el pie, al repositorio", () => {
    for (const href of atributos(html, "href")) {
      const valido =
        /^(\/(?!\/)|#)/.test(href) || href === URL_REPO || href.startsWith(`${URL_REPO}/`);
      expect(valido, href).toBe(true);
    }
    const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });

  // No tiene URL propia: ni canónica ni tarjeta, y ningún enlace del menú es la página actual.
  it("lleva el pie, sin canónica ni Open Graph y sin aria-current", () => {
    expect(html).toContain('<footer class="pie">');
    expect(html).toContain(`<a href="${URL_ARCHIVOS}/SECURITY.md">Reportar una vulnerabilidad</a>`);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:");
    expect(html).not.toContain("aria-current");
  });
});
