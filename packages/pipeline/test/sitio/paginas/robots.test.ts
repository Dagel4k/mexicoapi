import { describe, expect, it } from "vitest";
import { ROBOTS } from "../../../src/sitio/paginas/robots.js";

describe("robots.txt", () => {
  it("deja rastrear el sitio, pero no la API ni las descargas", () => {
    expect(ROBOTS).toBe("User-agent: *\nAllow: /\nDisallow: /v1/\nDisallow: /descargas/\n");
  });
});
