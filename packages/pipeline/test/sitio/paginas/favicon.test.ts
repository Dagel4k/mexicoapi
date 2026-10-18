import { describe, expect, it } from "vitest";
import { FAVICON } from "../../../src/sitio/paginas/favicon.js";

describe("favicon.svg", () => {
  it("es un SVG pequeño y autocontenido", () => {
    expect(FAVICON.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(
      true,
    );
    expect(FAVICON.endsWith("</svg>\n")).toBe(true);
    expect(FAVICON).toMatch(/^[\x20-\x7e\n]*$/);
    expect(Buffer.byteLength(FAVICON)).toBeLessThan(512);
    // El único http es el espacio de nombres: no carga nada.
    expect(FAVICON.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:/);
    expect(FAVICON).not.toMatch(/href|<script|<style|style=|\son[a-z]+=/i);
  });

  // Con fondo propio se ve igual sobre una pestaña clara u oscura, y el trazo no depende de fuentes.
  it("lleva su propio fondo y la letra trazada, sin texto", () => {
    expect(FAVICON).toMatch(/<rect [^>]*fill="#0a6640"/);
    expect(FAVICON).toMatch(/<path [^>]*stroke="#ffffff"/);
    expect(FAVICON).not.toContain("<text");
  });
});
