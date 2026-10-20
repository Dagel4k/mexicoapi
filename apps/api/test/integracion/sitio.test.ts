import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { filasDeEstado } from "../../../../packages/pipeline/src/sitio/cliente/sitio.js";
import { CSP_PAGINAS } from "../../../../packages/pipeline/src/sitio/paginas/encabezados.ts";
import { leerPublico, pedir, pedirJson, SEGURIDAD, tipoDeMedio } from "./ayudas.js";

/**
 * Lo que pone la regla `/*` de `_headers` en toda respuesta de los assets, también en el 404 y en
 * las redirecciones. `get` junta con coma un encabezado repetido: un valor exacto prueba que llegó
 * una sola vez.
 */
function esperarTodas(respuesta: Response): void {
  expect(respuesta.headers.get("x-content-type-options")).toBe("nosniff");
  expect(respuesta.headers.get("referrer-policy")).toBe("no-referrer");
  expect(respuesta.headers.get("x-frame-options")).toBe("DENY");
  expect(respuesta.headers.get("strict-transport-security")).toBe("max-age=31536000");
  expect(respuesta.headers.get("vary")).toBe("Accept-Encoding");
}

/** Encabezados que pone `_headers` en todas las rutas del sitio. */
function esperarSitio(respuesta: Response, csp: string, cache: string): void {
  esperarTodas(respuesta);
  expect(respuesta.headers.get("content-security-policy")).toBe(csp);
  expect(respuesta.headers.get("cache-control")).toBe(cache);
}

/**
 * Una respuesta que el Worker no tocó: el Worker pone `Cross-Origin-Resource-Policy` y
 * `Access-Control-Expose-Headers` en todas las suyas, y los assets no.
 */
function esperarSinWorker(respuesta: Response): void {
  expect(respuesta.headers.get("cross-origin-resource-policy")).toBeNull();
  expect(respuesta.headers.get("access-control-expose-headers")).toBeNull();
}

describe("páginas del sitio en el Worker local", () => {
  it("/ es la página de inicio del build, con la CSP de las páginas y nosniff", async () => {
    const respuesta = await pedir("/");
    expect(respuesta.status).toBe(200);
    expect(tipoDeMedio(respuesta)).toBe("text/html");
    esperarSitio(respuesta, CSP_PAGINAS, "public, max-age=300");
    esperarSinWorker(respuesta);
    const html = await respuesta.text();
    expect(html).toBe((await leerPublico("index.html")).toString("utf8"));
    expect(html).toContain("<h1>MéxicoAPI</h1>");
  });

  it("HEAD / responde 200 con los encabezados de GET y sin cuerpo", async () => {
    const get = await pedir("/");
    await get.arrayBuffer();
    const head = await pedir("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const nombre of ["content-type", "content-security-policy", "cache-control", "etag"]) {
      expect(head.headers.get(nombre), nombre).toBe(get.headers.get(nombre));
    }
  });

  it("/estado/ es la página del build, con la CSP de las páginas", async () => {
    const respuesta = await pedir("/estado/");
    expect(respuesta.status).toBe(200);
    expect(tipoDeMedio(respuesta)).toBe("text/html");
    esperarSitio(respuesta, CSP_PAGINAS, "public, max-age=300");
    const html = await respuesta.text();
    expect(html).toContain("<h1>Estado de los datos</h1>");
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
  });

  it("/estado redirige a /estado/, con los encabezados de /*", async () => {
    const respuesta = await pedir("/estado");
    expect(respuesta.status).toBeGreaterThanOrEqual(300);
    expect(respuesta.status).toBeLessThan(400);
    expect(new URL(respuesta.headers.get("location") ?? "", "http://x").pathname).toBe("/estado/");
    esperarTodas(respuesta);
    await respuesta.arrayBuffer();
  });

  // Un módulo necesita un tipo de JavaScript: con nosniff, otro tipo lo bloquea el navegador.
  it("/sitio.js se sirve como JavaScript y es el archivo fuente tal cual", async () => {
    const respuesta = await pedir("/sitio.js");
    expect(respuesta.status).toBe(200);
    expect(tipoDeMedio(respuesta)).toMatch(/^(text|application)\/javascript$/);
    expect(respuesta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(respuesta.headers.get("content-security-policy")).toBe("default-src 'none'");
    const fuente = await readFile(
      new URL("../../../../packages/pipeline/src/sitio/cliente/sitio.js", import.meta.url),
      "utf8",
    );
    expect(await respuesta.text()).toBe(fuente);
  });

  it.each(["/llms.txt", "/llms-full.txt"])(
    "%s es texto en UTF-8 con CORS y una hora de caché",
    async (ruta) => {
      const respuesta = await pedir(ruta);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(respuesta.headers.get("access-control-allow-origin")).toBe("*");
      esperarSitio(respuesta, "default-src 'none'", "public, max-age=3600");
      esperarSinWorker(respuesta);
      const texto = await respuesta.text();
      expect(texto).toBe((await leerPublico(ruta.slice(1))).toString("utf8"));
      expect(texto.startsWith("# ")).toBe(true);
    },
  );

  it("/sitemap.xml es XML en UTF-8 con una hora de caché, y robots.txt lo declara", async () => {
    const respuesta = await pedir("/sitemap.xml");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    esperarSitio(respuesta, "default-src 'none'", "public, max-age=3600");
    esperarSinWorker(respuesta);
    expect(await respuesta.text()).toBe((await leerPublico("sitemap.xml")).toString("utf8"));
    const robots = await pedir("/robots.txt");
    expect(robots.status).toBe(200);
    expect(await robots.text()).toMatch(/\nSitemap: https:\/\/\S+\/sitemap\.xml\n$/);
  });
});

describe("lo que no existe", () => {
  // `not_found_handling: "404-page"` con `run_worker_first` en lista: lo que no es un asset
  // ni está en /v1 lo responden los assets con 404.html, sin invocar al Worker.
  it.each(["/wp-admin", "/v2", "/v2/estados", "/nada/mas/", "/descargas/nada", "/index.php"])(
    "%s: 404 con 404.html, sin pasar por el Worker",
    async (ruta) => {
      const respuesta = await pedir(ruta);
      expect(respuesta.status).toBe(404);
      expect(tipoDeMedio(respuesta)).toBe("text/html");
      esperarSinWorker(respuesta);
      expect(await respuesta.text()).toBe((await leerPublico("404.html")).toString("utf8"));
    },
  );

  // Al 404 solo lo alcanza la regla /* de _headers: su CSP va en meta y la hoja de estilo carga,
  // también bajo /descargas/, y no hereda la caché ni el CORS de las descargas.
  it.each(["/descargas/nada.csv", "/descargas/", "/wp-admin"])(
    "%s: el 404 solo recibe los encabezados de /*",
    async (ruta) => {
      const respuesta = await pedir(ruta);
      expect(respuesta.status).toBe(404);
      esperarTodas(respuesta);
      expect(respuesta.headers.get("content-security-policy")).toBeNull();
      expect(respuesta.headers.get("access-control-allow-origin")).toBeNull();
      expect(respuesta.headers.get("cache-control") ?? "").not.toContain("stale-while-revalidate");
      const html = await respuesta.text();
      expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    },
  );

  it("cada descarga de SHA256SUMS conserva sus encabezados de seguridad, CORS y caché", async () => {
    const sumas = (await leerPublico("descargas/SHA256SUMS")).toString("utf8");
    const archivos = [
      "SHA256SUMS",
      ...sumas
        .trimEnd()
        .split("\n")
        .map((l) => l.slice(66)),
    ];
    expect(archivos.length).toBeGreaterThan(30);
    for (const archivo of archivos) {
      const respuesta = await pedir(`/descargas/${archivo}`, { method: "HEAD" });
      expect(respuesta.status, archivo).toBe(200);
      expect(Object.fromEntries(respuesta.headers), archivo).toMatchObject({
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "strict-transport-security": "max-age=31536000",
        vary: "Accept-Encoding",
        "content-security-policy": "default-src 'none'",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      });
    }
  });

  // Lo que dice la referencia en CORS: los archivos estáticos solo aceptan GET y HEAD.
  it.each(["/descargas/bancos.csv", "/llms.txt", "/"])(
    "OPTIONS y POST en %s: 405 de los assets",
    async (ruta) => {
      for (const method of ["OPTIONS", "POST"]) {
        const respuesta = await pedir(ruta, { method });
        expect(respuesta.status, method).toBe(405);
        esperarSinWorker(respuesta);
        await respuesta.arrayBuffer();
      }
    },
  );

  // El Worker arma sus propios encabezados y del asset solo copia el ETag: /* no le llega ni se
  // repite. X-Frame-Options no hace falta ahí: la CSP del Worker lleva frame-ancestors 'none'.
  it.each(["/v1", "/v1/estados", "/v1/estados/25", "/v1/openapi.json", "/v1/nada", "/v1/estados/"])(
    "%s: los encabezados del Worker, cada uno una vez y sin los de _headers",
    async (ruta) => {
      const respuesta = await pedir(ruta);
      await respuesta.arrayBuffer();
      for (const [nombre, valor] of Object.entries(SEGURIDAD)) {
        expect(respuesta.headers.get(nombre), `${ruta} ${nombre}`).toBe(valor);
      }
      expect(respuesta.headers.get("x-frame-options"), ruta).toBeNull();
    },
  );

  it("/v1/nada sigue siendo el 404 problem+json del Worker", async () => {
    const { respuesta, cuerpo } = await pedirJson("/v1/nada");
    expect(respuesta.status).toBe(404);
    expect(tipoDeMedio(respuesta)).toBe("application/problem+json");
    for (const [nombre, valor] of Object.entries(SEGURIDAD)) {
      expect(respuesta.headers.get(nombre), nombre).toBe(valor);
    }
    expect(cuerpo).toMatchObject({
      status: 404,
      detail: "No existe la ruta.",
      instance: "/v1/nada",
    });
  });

  it("/v1 es el índice JSON y enlaza el sitio y llms.txt", async () => {
    const { respuesta, cuerpo } = await pedirJson("/v1");
    expect(respuesta.status).toBe(200);
    expect(cuerpo).toMatchObject({ sitio: "/", llms: "/llms.txt", openapi: "/v1/openapi.json" });
  });
});

describe("página de estado contra el /v1/status real", () => {
  // Sin KV no hay corridas: cada dataset sale Sin registro, pero la forma es la real.
  it("sitio.js lee el /v1/status real: un renglón por dataset, todos Sin registro", async () => {
    const { respuesta, cuerpo } = await pedirJson("/v1/status");
    expect(respuesta.status).toBe(200);
    const { data } = cuerpo as { data: { dataset: string }[] };
    const filas = filasDeEstado(cuerpo, new Date());
    expect(filas.map((f) => f.dataset)).toEqual(data.map((d) => d.dataset));
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      expect(fila, fila.dataset).toMatchObject({
        estado: "Sin registro",
        ultimoExito: "Ninguna registrada",
      });
    }
  });
});
