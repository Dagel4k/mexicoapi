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

/** Lo que pone la regla `/*` en toda URL de los assets, también en el 404. */
const SEGURIDAD = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
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
      ...SEGURIDAD,
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
    expect(texto.startsWith("/*\n  X-Content-Type-Options: nosniff\n")).toBe(true);
    expect(texto).toContain("\n/descargas/SHA256SUMS\n  Content-Type: text/plain; charset=utf-8\n");
  });

  it("cada descarga tiene una sola regla, con todo lo suyo, y el único comodín es /*", () => {
    expect(reglas.map((r) => r.ruta)).toEqual([
      "/*",
      ...DESCARGAS.map((n) => `/descargas/${n}`),
      ...RUTAS_SITIO,
    ]);
    expect(reglas.filter((r) => r.ruta.includes("*")).map((r) => r.ruta)).toEqual(["/*"]);
  });

  // `/*` alcanza también al 404 y a las redirecciones: solo lleva lo que vale en cualquier URL.
  // Una CSP o una caché ahí se juntarían con las de cada ruta y, bajo /descargas/, le bloquearían
  // la hoja de estilo al 404, que lleva su CSP en meta (prueba de no-encontrado).
  it("/* solo pone nosniff, referrer y X-Frame-Options, y ninguna otra regla los repite", () => {
    const comodin = reglas.find((r) => r.ruta === "/*");
    expect(comodin).toEqual({
      ruta: "/*",
      poner: [
        ["X-Content-Type-Options", "nosniff"],
        ["Referrer-Policy", "no-referrer"],
        ["X-Frame-Options", "DENY"],
      ],
      quitar: [],
    });
    const nombres = new Set(Object.keys(SEGURIDAD));
    for (const regla of reglas.filter((r) => r.ruta !== "/*")) {
      for (const [nombre] of regla.poner) {
        expect(nombres.has(nombre.toLowerCase()), `${regla.ruta} ${nombre}`).toBe(false);
      }
    }
  });

  it("las rutas que no existen solo reciben lo de /*, tampoco bajo /descargas/", () => {
    for (const ruta of [
      "/wp-admin",
      "/v2",
      "/404.html",
      "/index.html",
      "/estado",
      "/descargas",
      "/descargas/",
      "/descargas/nada.csv",
      "/descargas/bancos.csv/x",
    ]) {
      expect(efectivos(ruta), ruta).toEqual(SEGURIDAD);
    }
  });
});
