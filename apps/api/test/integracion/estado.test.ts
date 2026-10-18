import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { filasDeEstado } from "../../../../packages/pipeline/src/sitio/cliente/sitio.js";
import { CSP_PAGINAS } from "../../../../packages/pipeline/src/sitio/paginas/encabezados.ts";
import { pedir, pedirJson, tipoDeMedio } from "./ayudas.js";

describe("página de estado en el Worker local", () => {
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

  it("/estado/ es la página del build, con la CSP de las páginas", async () => {
    const respuesta = await pedir("/estado/");
    expect(respuesta.status).toBe(200);
    expect(tipoDeMedio(respuesta)).toBe("text/html");
    expect(respuesta.headers.get("content-security-policy")).toBe(CSP_PAGINAS);
    const html = await respuesta.text();
    expect(html).toContain("<h1>Estado de los datos</h1>");
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
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
});
