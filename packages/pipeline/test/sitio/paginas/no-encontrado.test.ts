import { describe, expect, it } from "vitest";
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

  it("enlaza al inicio y al índice de la API", () => {
    expect(html).toContain('<a href="/">');
    expect(html).toContain('<a href="/v1">');
  });

  // Se sirve en cualquier URL que no existe: un enlace relativo apuntaría a otra ruta inexistente.
  it("todos sus enlaces son absolutos al sitio o a la misma página", () => {
    for (const href of atributos(html, "href")) expect(href).toMatch(/^(\/(?!\/)|#)/);
    const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });
});
