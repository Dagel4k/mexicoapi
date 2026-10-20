import { URL_API } from "@mexicoapi/core/problemas";
import { describe, expect, it } from "vitest";
import { ROBOTS } from "../../../src/sitio/paginas/robots.js";

describe("robots.txt", () => {
  // `/v1` sin barra es un prefijo: cubre el índice `/v1` y todo `/v1/...`. El sitemap va con su
  // URL absoluta, la de la API pública, como pide el protocolo.
  it("deja rastrear el sitio, pero no la API ni las descargas, y declara el sitemap", () => {
    expect(ROBOTS).toBe(
      "User-agent: *\nAllow: /\nDisallow: /v1\nDisallow: /descargas/\n\n" +
        `Sitemap: ${URL_API}/sitemap.xml\n`,
    );
  });
});
