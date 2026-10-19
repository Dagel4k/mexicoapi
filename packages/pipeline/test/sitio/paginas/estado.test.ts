import { describe, expect, it } from "vitest";
import { DATASETS } from "../../../src/registro.js";
import { ETIQUETAS, NOMBRES_STATUS, nombresDeDatasets } from "../../../src/sitio/cliente/sitio.js";
import { CATALOGO } from "../../../src/sitio/paginas/catalogo.js";
import { paginaEstado } from "../../../src/sitio/paginas/estado.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { atributos, esperarDocumentoValido } from "./estructura.js";

const html = paginaEstado();

/** La etiqueta de apertura del elemento con `id`. */
function etiquetaDe(pagina: string, id: string): string {
  const etiqueta = pagina.match(new RegExp(`<[a-z]+\\b[^>]*\\sid="${id}"[^>]*>`))?.[0];
  if (etiqueta === undefined) throw new Error(`no hay elemento con id ${id}`);
  return etiqueta;
}

describe("página de estado", () => {
  it("es un documento válido que carga sitio.js como módulo", () => {
    esperarDocumentoValido(html);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    expect(html).toContain("<title>Estado de los datos · MéxicoAPI</title>");
    expect(html).toContain("<h1>Estado de los datos</h1>");
  });

  // sitio.js busca estos id; sin JS, la tabla y el botón no se ven.
  it("trae la tabla vacía, la región de mensajes y el botón que usa sitio.js", () => {
    const marco = etiquetaDe(html, "marco-estado");
    expect(marco).toMatch(/^<div class="tabla tarjetas" /);
    expect(marco).toContain(' role="region" aria-labelledby="tabla-estado" tabindex="0"');
    expect(marco).toMatch(/\shidden>$/);
    expect(etiquetaDe(html, "filas-estado")).toMatch(/^<tbody /);
    expect(html).toMatch(/<tbody id="filas-estado" data-nombres="[^"]+"><\/tbody>/);
    expect(html).toContain(
      '<p id="mensaje-estado" class="mensaje" role="status" aria-live="polite"></p>',
    );
    expect(html).toContain(
      '<button type="button" id="actualizar-estado" hidden>Actualizar</button>',
    );
  });

  // El orden es el de las celdas que pinta sitio.js.
  it("la tabla tiene caption y un encabezado por cada columna que pinta sitio.js", () => {
    expect(html).toContain(
      '<caption id="tabla-estado">Estado de cada dataset automático, según /v1/status</caption>',
    );
    const columnas = [...html.matchAll(/<th scope="col"(?: class="[^"]+")?>([^<]+)<\/th>/g)].map(
      (m) => m[1],
    );
    expect(columnas).toEqual([
      "Dataset",
      "Estado",
      "Datos al",
      "Última revisión correcta",
      "Plazo",
      "Cobertura",
    ]);
  });

  // as_of no es la fecha del último dato: en el FIX, el domingo dice "Datos al" del domingo.
  it("explica que Datos al no es el último dato de las series, que va aparte", () => {
    expect(html).toContain(
      "<dt>Datos al</dt>\n<dd>La fecha de la última actualización que cambió el dataset. En las series (FIX y UDIS) no es la del último dato: esa va debajo, como «último dato», y es el final de la cobertura.</dd>",
    );
    expect(html).not.toContain("La fecha de los datos que se sirven ahora.");
  });

  // Los nombres de las columnas son las etiquetas que sitio.js pone a cada celda de las tarjetas.
  it("las columnas son las etiquetas que sitio.js pone a cada celda", () => {
    const columnas = [...html.matchAll(/<th scope="col"(?: class="[^"]+")?>([^<]+)<\/th>/g)].map(
      (m) => m[1],
    );
    expect(columnas.slice(1)).toEqual([...ETIQUETAS]);
  });

  it("lleva el nombre de cada dataset del catálogo para que sitio.js lo muestre", () => {
    const [texto] = atributos(html, "data-nombres");
    const nombres = nombresDeDatasets(texto);
    expect(Object.fromEntries(nombres)).toEqual(
      Object.fromEntries(Object.entries(CATALOGO).map(([id, e]) => [id, e.nombre])),
    );
  });

  // /v1/status lista los automáticos: cada renglón sale con su nombre y no solo con el id.
  it("cada dataset automático tiene nombre", () => {
    const nombres = nombresDeDatasets(atributos(html, "data-nombres")[0]);
    for (const id of DATASETS.keys()) expect(nombres.get(id), id).toMatch(/\S/);
  });

  it("escapa los nombres en el atributo", () => {
    const pagina = paginaEstado({ raro: { nombre: `A & "B" <c> 'd'` } });
    expect(pagina).toContain(
      'data-nombres="{&quot;raro&quot;:&quot;A &amp; \\&quot;B\\&quot; &lt;c&gt; &#39;d&#39;&quot;}"',
    );
    const [texto] = atributos(pagina, "data-nombres");
    expect(nombresDeDatasets(texto).get("raro")).toBe(`A & "B" <c> 'd'`);
  });

  it("explica cada estado con las mismas palabras que la tabla", () => {
    for (const palabra of Object.values(NOMBRES_STATUS)) {
      expect(html, palabra).toContain(`<dt>${palabra}</dt>`);
    }
    expect(html).toContain("El bot todavía no reporta ninguna corrida de este dataset");
    expect(html).toContain("o su registro no se pudo leer");
    expect(html).toContain("hasta un minuto");
  });

  // La tabla puede no verse (sin JS o con una falla): la intro no habla de "esta tabla".
  it("la intro se lee bien aunque la tabla no se vea", () => {
    const intro = html.match(/<p class="intro">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(intro).not.toMatch(/tabla/i);
    expect(intro).toContain(
      'Para cada uno, <a href="/v1/status"><code>/v1/status</code></a> dice cuándo terminó bien su última revisión y si eso fue dentro de su plazo.',
    );
  });

  it("sin JavaScript enlaza a /v1/status", () => {
    expect(html).toMatch(/<noscript>[\s\S]*<a href="\/v1\/status">[\s\S]*<\/noscript>/);
  });

  it("solo enlaza al sitio y cada clase existe en la hoja", () => {
    for (const href of atributos(html, "href")) expect(href).toMatch(/^(\/(?!\/)|#)/);
    const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  });
});
