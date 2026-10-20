import { URL_API } from "@mexicoapi/core/problemas";
import { describe, expect, it } from "vitest";
import { archivoSitemap, fechaMasReciente } from "../../../src/sitio/paginas/sitemap.js";

describe("sitemap.xml", () => {
  // La URL de cada página es la canónica: la de la API pública, también si se sirve en staging.
  it("lista cada página con su URL canónica y su lastmod, en el orden dado", () => {
    expect(
      archivoSitemap([
        { ruta: "/", lastmod: "2026-10-19" },
        { ruta: "/estado/", lastmod: "2026-10-18" },
      ]),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        `<url><loc>${URL_API}/</loc><lastmod>2026-10-19</lastmod></url>\n` +
        `<url><loc>${URL_API}/estado/</loc><lastmod>2026-10-18</lastmod></url>\n` +
        "</urlset>\n",
    );
  });

  it.each(["", "estado/", "/estado", "//otro.mx/", "https://otro.mx/", "/a&b/", "/a<b/"])(
    "rechaza la ruta %j",
    (ruta) => {
      expect(() => archivoSitemap([{ ruta, lastmod: "2026-10-19" }])).toThrow(/ruta/);
    },
  );

  it.each(["2026-02-30", "2026-10-19T00:00:00Z", "19/10/2026", ""])(
    "rechaza el lastmod %j",
    (lastmod) => {
      expect(() => archivoSitemap([{ ruta: "/", lastmod }])).toThrow(/lastmod/);
    },
  );

  it("rechaza una página repetida o una lista vacía", () => {
    const pagina = { ruta: "/", lastmod: "2026-10-19" };
    expect(() => archivoSitemap([pagina, pagina])).toThrow(/repetida/);
    expect(() => archivoSitemap([])).toThrow(/ninguna página/);
  });
});

describe("fechaMasReciente", () => {
  it("da la fecha mayor, sin importar el orden", () => {
    expect(fechaMasReciente(["2025-12-20", "2026-10-18", "2026-01-09"])).toBe("2026-10-18");
    expect(fechaMasReciente(["2026-10-17"])).toBe("2026-10-17");
  });

  it("falla sin fechas o con una que no es AAAA-MM-DD", () => {
    expect(() => fechaMasReciente([])).toThrow(/ninguna fecha/);
    expect(() => fechaMasReciente(["2026-10-18", "ayer"])).toThrow(/ayer/);
  });
});
