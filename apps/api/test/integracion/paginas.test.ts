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

/** Las páginas de indicadores y constantes, después de las de calendarios, en el orden del registro. */
const INDICADORES = [
  "/tipo-de-cambio-fix/",
  "/udis/",
  "/uma/",
  "/salario-minimo/",
  "/tarifas-isr/",
];

/** Las páginas de los catálogos de arriba; /municipios/ trae además una página por estado. */
const CATALOGOS = ["/bancos-clabe/", "/validar-clabe/", "/municipios/"];

/** Las páginas hijas de /municipios/: `/municipios/{cve_ent}-{estado}/`. */
const esHija = (ruta: string): boolean => /^\/municipios\/\d\d-[a-z-]+\/$/.test(ruta);

describe("páginas de datos en el Worker local", () => {
  it("cada página del sitemap es la del build, con la CSP de las páginas", async () => {
    const rutas = await paginasDeDatos();
    const hijas = rutas.filter(esHija);
    expect(hijas).toHaveLength(32);
    expect(rutas).toEqual([...Object.keys(AUTORIDADES), ...INDICADORES, ...CATALOGOS, ...hijas]);
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
      // El validador y las páginas de cada estado no declaran Dataset: el de /municipios/ las cubre.
      if (ruta === "/validar-clabe/" || esHija(ruta)) {
        expect(dataset, ruta).toBeUndefined();
        continue;
      }
      const distribucion = (
        dataset as { distribution: { contentUrl: string; encodingFormat: string }[] }
      ).distribution;
      expect(distribucion.length, ruta).toBe(ruta === "/municipios/" ? 4 : 2);
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

  // Una cifra por página, la que responde la API para lo mismo, y "Datos al" es su meta.as_of.
  it("las cifras de cada página de indicadores y constantes son las que responde la API", async () => {
    const pagina = async (ruta: string) =>
      (await leerPublico(`${ruta.slice(1)}index.html`)).toString("utf8");
    const consultar = async <T>(ruta: string) => {
      const { respuesta, cuerpo } = await pedirJson(ruta);
      expect(respuesta.status, ruta).toBe(200);
      return cuerpo as { data: T; meta: { as_of: string } };
    };
    const datosAl = (html: string, asOf: string) =>
      expect(html).toContain(`<p class="datos-al">Datos al <time datetime="${asOf}">`);

    const fix = await consultar<{ fecha_publicacion: string; valor: string }>(
      "/v1/tipo-cambio/fix/ultimo",
    );
    const htmlFix = await pagina("/tipo-de-cambio-fix/");
    expect(htmlFix).toContain(`<data value="${fix.data.valor}">${fix.data.valor}</data>`);
    expect(htmlFix).toContain(`<time datetime="${fix.data.fecha_publicacion}">`);
    datosAl(htmlFix, fix.meta.as_of);

    const htmlUdis = await pagina("/udis/");
    const filasUdis = [...htmlUdis.matchAll(/<tr data-fecha="([^"]+)">.*?<data value="([^"]+)">/g)];
    expect(filasUdis.length).toBeGreaterThan(30);
    for (const [, fecha, valor] of [filasUdis[0], filasUdis.at(-1)] as RegExpMatchArray[]) {
      const udi = await consultar<{ valor: string }>(`/v1/udis?fecha=${fecha}`);
      expect(udi.data.valor, fecha).toBe(valor);
      datosAl(htmlUdis, udi.meta.as_of);
    }

    const anio = fix.data.fecha_publicacion.slice(0, 4);
    const uma = await consultar<Record<"diaria" | "mensual" | "anual", string>>(
      `/v1/constantes/uma/${anio}`,
    );
    const htmlUma = await pagina("/uma/");
    for (const campo of ["diaria", "mensual", "anual"] as const) {
      expect(htmlUma, campo).toContain(`<data value="${uma.data[campo]}">`);
    }
    datosAl(htmlUma, uma.meta.as_of);

    const salario = await consultar<{ zona: string; diario: string }[]>(
      `/v1/constantes/salario-minimo/${anio}`,
    );
    const htmlSalario = await pagina("/salario-minimo/");
    for (const { diario } of salario.data)
      expect(htmlSalario).toContain(`<data value="${diario}">`);
    datosAl(htmlSalario, salario.meta.as_of);

    const isr = await consultar<{ tramos: { limite_inferior: string; cuota_fija: string }[] }>(
      `/v1/isr/tarifa/mensual/${anio}`,
    );
    const htmlIsr = await pagina("/tarifas-isr/");
    const mensual = htmlIsr.slice(htmlIsr.indexOf(`<caption id="isr-mensual-${anio}">`));
    for (const t of isr.data.tramos) {
      expect(mensual).toContain(`<data value="${t.limite_inferior}">`);
      expect(mensual).toContain(`<data value="${t.cuota_fija}">`);
    }
    datosAl(htmlIsr, isr.meta.as_of);
  });
});
