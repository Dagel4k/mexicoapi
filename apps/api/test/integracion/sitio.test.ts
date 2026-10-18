import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { filasDeEstado } from "../../../../packages/pipeline/src/sitio/cliente/sitio.js";
import { CSP_PAGINAS } from "../../../../packages/pipeline/src/sitio/paginas/encabezados.ts";
import { leerPublico, pedir, pedirJson, SEGURIDAD, tipoDeMedio } from "./ayudas.js";

/** Encabezados que pone `_headers` en todas las rutas del sitio. */
function esperarSitio(respuesta: Response, csp: string, cache: string): void {
  expect(respuesta.headers.get("content-security-policy")).toBe(csp);
  expect(respuesta.headers.get("x-content-type-options")).toBe("nosniff");
  expect(respuesta.headers.get("referrer-policy")).toBe("no-referrer");
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

  it("/estado redirige a /estado/", async () => {
    const respuesta = await pedir("/estado");
    expect(respuesta.status).toBeGreaterThanOrEqual(300);
    expect(respuesta.status).toBeLessThan(400);
    expect(new URL(respuesta.headers.get("location") ?? "", "http://x").pathname).toBe("/estado/");
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
