import { describe, expect, it } from "vitest";
import {
  archivoEncabezados,
  CSP_PAGINAS,
  RUTAS_SITIO,
} from "../../../src/sitio/paginas/encabezados.js";
import { encabezadosDe, leerReglas } from "./reglas-cloudflare.js";

const DESCARGAS = [
  "SHA256SUMS",
  "bancos-historial.csv",
  "bancos.csv",
  "bancos.json",
  "bancos.manifest.json",
  "mexicoapi.sqlite",
];

const texto = archivoEncabezados(DESCARGAS);
const reglas = leerReglas(texto);
const efectivos = (ruta: string): Record<string, string> => {
  const encabezados = encabezadosDe(reglas, ruta);
  for (const [nombre, valores] of encabezados) {
    // Dos reglas con el mismo encabezado lo juntan con coma: eso es un choque.
    expect(valores, `${ruta} ${nombre}`).toHaveLength(1);
  }
  return Object.fromEntries([...encabezados].map(([nombre, valores]) => [nombre, valores.join()]));
};

const SEGURIDAD = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const NINGUNO = "default-src 'none'";

describe("_headers", () => {
  it("respeta los límites de Cloudflare: 100 reglas y 2,000 caracteres por línea", () => {
    expect(reglas.length).toBeLessThanOrEqual(100);
    for (const linea of texto.split("\n")) expect(linea.length).toBeLessThanOrEqual(2000);
    expect(texto.endsWith("\n")).toBe(true);
  });

  it("la CSP de las páginas es la del sitio", () => {
    expect(CSP_PAGINAS).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
        "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("cubre todas las rutas del sitio, cada una con una sola regla", () => {
    expect(RUTAS_SITIO).toEqual([
      "/",
      "/estado/",
      "/estilo.css",
      "/sitio.js",
      "/favicon.svg",
      "/robots.txt",
      "/llms.txt",
      "/llms-full.txt",
    ]);
    for (const ruta of RUTAS_SITIO) {
      expect(
        reglas.filter((r) => r.ruta === ruta),
        ruta,
      ).toHaveLength(1);
    }
  });

  it.each(["/", "/estado/"])(
    "la página %s lleva su CSP, nosniff, referrer y caché corta",
    (ruta) => {
      expect(efectivos(ruta)).toEqual({
        "content-security-policy": CSP_PAGINAS,
        ...SEGURIDAD,
        "cache-control": "public, max-age=300",
      });
    },
  );

  it.each(["/estilo.css", "/sitio.js"])("%s lleva caché corta y CSP vacía", (ruta) => {
    expect(efectivos(ruta)).toEqual({
      "content-security-policy": NINGUNO,
      ...SEGURIDAD,
      "cache-control": "public, max-age=300",
    });
  });

  it.each(["/robots.txt", "/favicon.svg"])("%s se guarda un día", (ruta) => {
    expect(efectivos(ruta)).toEqual({
      "content-security-policy": NINGUNO,
      ...SEGURIDAD,
      "cache-control": "public, max-age=86400",
    });
  });

  it.each(["/llms.txt", "/llms-full.txt"])(
    "%s es texto UTF-8 con CORS y una hora de caché",
    (ruta) => {
      expect(efectivos(ruta)).toEqual({
        "content-security-policy": NINGUNO,
        ...SEGURIDAD,
        "cache-control": "public, max-age=3600",
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*",
      });
    },
  );

  it("las descargas conservan sus encabezados y no reciben los del sitio", () => {
    const comunes = {
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "content-security-policy": NINGUNO,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    };
    expect(efectivos("/descargas/bancos.csv")).toEqual({
      "content-type": "text/csv; charset=utf-8",
      ...comunes,
    });
    expect(efectivos("/descargas/bancos.manifest.json")).toEqual({
      "content-type": "application/json; charset=utf-8",
      ...comunes,
    });
    expect(efectivos("/descargas/mexicoapi.sqlite")).toEqual({
      "content-type": "application/vnd.sqlite3",
      ...comunes,
    });
    expect(efectivos("/descargas/SHA256SUMS")).toEqual({
      "content-type": "text/plain; charset=utf-8",
      ...comunes,
    });
    expect(
      texto.startsWith("/descargas/SHA256SUMS\n  Content-Type: text/plain; charset=utf-8\n"),
    ).toBe(true);
  });

  // Una regla `/*` chocaría con la CSP, el nosniff y la caché de `/descargas/*` y de cada ruta
  // del sitio. El 404 lleva su CSP y su referrer en meta (prueba de no-encontrado).
  it("las rutas que no existen no reciben reglas", () => {
    expect(reglas.some((r) => r.ruta === "/*")).toBe(false);
    for (const ruta of ["/wp-admin", "/v2", "/404.html", "/index.html", "/estado"]) {
      expect(efectivos(ruta), ruta).toEqual({});
    }
  });
});
