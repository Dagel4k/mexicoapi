// Las páginas de datos del build servidas por el Worker local: cada una con la CSP de las páginas,
// cada descarga de su JSON-LD responde 200 y cada tabla de días dice lo mismo que la API.
import { describe, expect, it } from "vitest";
import { CSP_PAGINAS } from "../../../../packages/pipeline/src/sitio/paginas/encabezados.ts";
import { leerPublico, pedir, pedirJson, tipoDeMedio } from "./ayudas.js";

/** Las rutas del sitemap que no son la portada ni /estado/: las páginas de datos. */
async function paginasDeDatos(): Promise<string[]> {
  const sitemap = (await leerPublico("sitemap.xml")).toString("utf8");
  return [...sitemap.matchAll(/<loc>https:\/\/[^/]+(\/[^<]*)<\/loc>/g)]
    .map((m) => m[1] as string)
    .filter((ruta) => ruta !== "/" && ruta !== "/estado/");
}

const APERTURA_JSON_LD = '<script type="application/ld+json">';

/** Los nodos del JSON-LD de la página. */
function nodos(html: string): Record<string, unknown>[] {
  const inicio = html.indexOf(APERTURA_JSON_LD) + APERTURA_JSON_LD.length;
  const json = JSON.parse(html.slice(inicio, html.indexOf("</script>", inicio))) as {
    "@graph": Record<string, unknown>[];
  };
  return json["@graph"];
}

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};
const desescapar = (texto: string): string =>
  texto.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTIDADES[e] as string);

const AUTORIDADES: Readonly<Record<string, string>> = {
  "/dias-inhabiles-sat/": "sat",
  "/dias-de-descanso-obligatorio/": "lft",
  "/dias-inhabiles-bancarios/": "cnbv",
};

describe("páginas de datos en el Worker local", () => {
  it("cada página del sitemap es la del build, con la CSP de las páginas", async () => {
    const rutas = await paginasDeDatos();
    expect(rutas).toEqual(Object.keys(AUTORIDADES));
    for (const ruta of rutas) {
      const respuesta = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(200);
      expect(tipoDeMedio(respuesta), ruta).toBe("text/html");
      expect(respuesta.headers.get("content-security-policy"), ruta).toBe(CSP_PAGINAS);
      expect(respuesta.headers.get("cache-control"), ruta).toBe("public, max-age=300");
      expect(await respuesta.text(), ruta).toBe(
        (await leerPublico(`${ruta.slice(1)}index.html`)).toString("utf8"),
      );
      // Sin la barra final redirige a la página.
      const sinBarra = await pedir(ruta.slice(0, -1));
      expect(sinBarra.status, ruta).toBeGreaterThanOrEqual(300);
      expect(sinBarra.status, ruta).toBeLessThan(400);
      await sinBarra.arrayBuffer();
    }
  });

  it("cada descarga del Dataset de una página responde 200 con su tipo", async () => {
    for (const ruta of await paginasDeDatos()) {
      const html = (await leerPublico(`${ruta.slice(1)}index.html`)).toString("utf8");
      const [dataset] = nodos(html).filter((n) => n["@type"] === "Dataset");
      const distribucion = (
        dataset as { distribution: { contentUrl: string; encodingFormat: string }[] }
      ).distribution;
      expect(distribucion.length, ruta).toBe(2);
      for (const { contentUrl, encodingFormat } of distribucion) {
        const respuesta = await pedir(new URL(contentUrl).pathname, { method: "HEAD" });
        expect(respuesta.status, contentUrl).toBe(200);
        expect(tipoDeMedio(respuesta), contentUrl).toBe(encodingFormat);
      }
    }
  });

  // Lo que muestra cada tabla es lo que responde /v1/dias-inhabiles para el mismo año, y "Datos
  // al" es el meta.as_of de esa respuesta.
  it("cada tabla de días es la respuesta de /v1/dias-inhabiles de su año", async () => {
    for (const [ruta, autoridad] of Object.entries(AUTORIDADES)) {
      const html = (await leerPublico(`${ruta.slice(1)}index.html`)).toString("utf8");
      const anios = [...html.matchAll(/<caption id="dias-(\d{4})">/g)].map((m) => m[1] as string);
      expect(anios.length, ruta).toBeGreaterThan(0);
      for (const anio of anios) {
        const { respuesta, cuerpo } = await pedirJson(
          `/v1/dias-inhabiles?autoridad=${autoridad}&anio=${anio}`,
        );
        expect(respuesta.status, `${ruta} ${anio}`).toBe(200);
        const { data, meta } = cuerpo as {
          data: { fecha: string; motivo: string }[];
          meta: { as_of: string };
        };
        const inicio = html.indexOf(`<caption id="dias-${anio}">`);
        const tabla = html.slice(inicio, html.indexOf("</table>", inicio));
        const filas = [
          ...tabla.matchAll(/<time datetime="([^"]+)">[\s\S]*?<\/th><td>([^<]*)<\/td>/g),
        ].map((m) => ({ fecha: m[1], motivo: desescapar(m[2] as string) }));
        expect(filas, `${ruta} ${anio}`).toEqual(
          data.map(({ fecha, motivo }) => ({ fecha, motivo })),
        );
        expect(html, `${ruta} ${anio}`).toContain(
          `<p class="datos-al">Datos al <time datetime="${meta.as_of}">`,
        );
      }
    }
  });
});
