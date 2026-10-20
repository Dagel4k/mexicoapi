// Las páginas de indicadores y constantes con los datos reales de data/: cada cifra y fecha de una
// tabla es la del registro que sirve la API para lo mismo.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Manifiesto,
  SalarioMinimo,
  TarifaIsr,
  TipoCambioFix,
  Udi,
  Uma,
} from "@mexicoapi/core";
import { fechaEnTexto } from "@mexicoapi/core/rutas";
import { beforeAll, describe, expect, it } from "vitest";
import { metaDesdeManifiesto } from "../../../src/sitio/meta.js";
import { DESCRIPCION_DATASET } from "../../../src/sitio/paginas/datos-estructurados.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { escaparHtml } from "../../../src/sitio/paginas/html.js";
import {
  type EntradaIndicadores,
  paginasDeIndicadores,
  RUTA_FIX,
  RUTA_ISR,
  RUTA_SALARIO_MINIMO,
  RUTA_UDIS,
  RUTA_UMA,
} from "../../../src/sitio/paginas/indicadores.js";
import {
  type PaginaDatos,
  paginaDeDatos,
  registrarPaginas,
} from "../../../src/sitio/paginas/pagina-datos.js";
import { atributos, datosEstructurados, esperarDocumentoValido } from "./estructura.js";

const REAL = fileURLToPath(new URL("../../../../../data", import.meta.url));

async function leer<T>(directorio: string, archivo: string) {
  const dir = join(REAL, directorio);
  const manifiesto = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifiesto;
  return {
    registros: JSON.parse(await readFile(join(dir, archivo), "utf8")) as T[],
    meta: metaDesdeManifiesto(manifiesto, directorio),
  };
}

let entrada: EntradaIndicadores;
let guiaApi: string;
beforeAll(async () => {
  guiaApi = await readFile(join(REAL, "..", "docs", "api", "README.md"), "utf8");
  entrada = {
    fix: await leer<TipoCambioFix>("tipo-cambio-fix", "fix.json"),
    udis: await leer<Udi>("udis", "udis.json"),
    uma: await leer<Uma>("constantes-uma", "uma.json"),
    salarioMinimo: await leer<SalarioMinimo>("constantes-salario-minimo", "salario-minimo.json"),
    isr: await leer<TarifaIsr>("isr-tarifas", "tarifas.json"),
  };
});

const DESCARGAS = new Map(
  ["tipo-cambio-fix", "udis", "constantes-uma", "constantes-salario-minimo", "isr-tarifas"].flatMap(
    (n) => [`${n}.json`, `${n}.csv`, `${n}.manifest.json`].map((a) => [a, "[]"] as const),
  ),
);

/** Las cinco páginas en un registro que también trae la del calendario bancario que enlaza el FIX. */
function armar(e: EntradaIndicadores = entrada) {
  const paginas = paginasDeIndicadores(e);
  const cnbv = {
    ...(paginas[0] as PaginaDatos),
    ruta: "/dias-inhabiles-bancarios/",
    relacionadas: [],
  };
  const registro = registrarPaginas([...paginas, cnbv]);
  const textos = new Map(paginas.map((p) => [p.ruta, paginaDeDatos(p, registro, DESCARGAS)]));
  return { paginas, registro, textos };
}

const dePagina = (ruta: string, e = entrada) => {
  const { paginas, textos } = armar(e);
  return {
    pagina: paginas.find((p) => p.ruta === ruta) as PaginaDatos,
    html: textos.get(ruta) as string,
  };
};

/** Las filas del `<tbody>` de la tabla cuyo caption tiene ese id. */
function filas(html: string, id: string): string[] {
  const inicio = html.indexOf(`<caption id="${id}">`);
  expect(inicio, id).toBeGreaterThan(0);
  const cuerpo = html.slice(html.indexOf("<tbody>", inicio), html.indexOf("</tbody>", inicio));
  const trs = cuerpo.match(/<tr[ >].*?<\/tr>/gs) ?? [];
  expect(trs.length, id).toBe(cuerpo.match(/<tr[ >]/g)?.length);
  return trs;
}

/** Los `value` de los `<data>` de una fila, que son el texto de la API sin formato. */
const valores = (fila: string): string[] =>
  [...fila.matchAll(/<data value="([^"]*)">/g)].map((m) => m[1] as string);
const fechaDeFila = (fila: string): string => /<time datetime="([^"]+)">/.exec(fila)?.[1] as string;

/** Lo que toda página cumple. */
function esperarPagina(pagina: PaginaDatos, html: string): void {
  esperarDocumentoValido(html);
  expect(html).toContain(`<h1>${escaparHtml(pagina.h1)}</h1>`);
  expect(pagina.titulo).toBe(`${pagina.h1} · MéxicoAPI`);
  expect([...pagina.descripcion].length).toBeLessThanOrEqual(155);
  const nodos = datosEstructurados(html);
  const datasets = nodos.filter((n) => n["@type"] === "Dataset");
  expect(datasets).toHaveLength(1);
  const descripcion = (datasets[0] as Record<string, unknown>).description as string;
  expect(descripcion.length).toBeGreaterThanOrEqual(DESCRIPCION_DATASET.minimo);
  expect(descripcion.length).toBeGreaterThan(pagina.descripcion.length);
  const clases = new Set(atributos(html, "class").flatMap((c) => c.split(" ")));
  for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  for (const [th] of html.matchAll(/<th\b[^>]*>/g)) expect(th).toMatch(/ scope="(col|row)"/);
  expect(html.match(/<table\b/g)?.length).toBe(html.match(/<caption id="[^"]+">/g)?.length);
  const niveles = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < niveles.length; i++) {
    expect((niveles[i] as number) - (niveles[i - 1] as number)).toBeLessThanOrEqual(1);
  }
  // "Datos al", la cita de la fuente, curl, paquete, descargas y relacionadas.
  expect(html).toContain(`<p class="datos-al">Datos al <time datetime="${pagina.datosAl}">`);
  expect(html).toContain('id="fuente"');
  expect(html).toContain("<h3>API</h3>");
  expect(html).toContain('curl "$API');
  expect(html).toContain("<h3>Paquete de npm</h3>");
  expect(html).toContain("<h3>Descargas</h3>");
  expect(html).toContain('id="relacionadas"');
  for (const m of html.matchAll(/href="(\/descargas\/[^"]+)"/g)) {
    expect(DESCARGAS.has((m[1] as string).slice("/descargas/".length)), m[1]).toBe(true);
  }
}

const sumar = (fecha: string, dias: number): string =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

describe("registro", () => {
  it("las cinco rutas, cada una con su dataset de la portada, en orden", () => {
    const { paginas } = armar();
    expect(paginas.map((p) => [p.ruta, p.dataset])).toEqual([
      ["/tipo-de-cambio-fix/", "tipo-cambio.fix"],
      ["/udis/", "udis"],
      ["/uma/", "constantes.uma"],
      ["/salario-minimo/", "constantes.salario-minimo"],
      ["/tarifas-isr/", "isr.tarifas"],
    ]);
    expect([RUTA_FIX, RUTA_UDIS, RUTA_UMA, RUTA_SALARIO_MINIMO, RUTA_ISR]).toEqual(
      paginas.map((p) => p.ruta),
    );
  });

  it("cada página es válida y trae sus secciones", () => {
    const { paginas, textos } = armar();
    for (const p of paginas) esperarPagina(p, textos.get(p.ruta) as string);
  });

  it("el paquete usa funciones que el SDK exporta", async () => {
    const sdk = await readFile(join(REAL, "..", "packages", "sdk", "src", "index.ts"), "utf8");
    const cliente = await readFile(
      join(REAL, "..", "packages", "sdk", "src", "cliente", "tipos.ts"),
      "utf8",
    );
    const { paginas } = armar();
    for (const p of paginas) {
      const codigo = p.paquete?.codigo as string;
      for (const [, nombre] of codigo.matchAll(/api\.([a-zA-Z]+)\(/g)) {
        expect(cliente, nombre).toMatch(new RegExp(`\\b${nombre}\\(`));
      }
      if (codigo.includes("hoyEnMexico")) expect(sdk).toContain("hoyEnMexico");
    }
  });
});

describe("tipo de cambio FIX", () => {
  it("muestra el último FIX con su fecha de publicación y la de determinación", () => {
    const { html } = dePagina(RUTA_FIX);
    const serie = entrada.fix.registros;
    const ultimo = serie.at(-1) as TipoCambioFix;
    const anterior = serie.at(-2) as TipoCambioFix;
    const fila = filas(html, "fix-ultimo");
    expect(valores(fila[0] as string)).toEqual([ultimo.valor]);
    expect(html).toContain(`<time datetime="${ultimo.fecha_publicacion}">`);
    // Banxico lo muestra con la fecha del día hábil bancario anterior: la publicación anterior.
    expect(fila.join("")).toContain(`<time datetime="${anterior.fecha_publicacion}">`);
    expect(html).toContain("fecha de determinación");
  });

  it("la tabla trae las últimas 30 publicaciones, de la más reciente a la más antigua", () => {
    const { html } = dePagina(RUTA_FIX);
    const esperado = entrada.fix.registros.slice(-30).reverse();
    const f = filas(html, "fix-ultimos");
    expect(f.map((x) => [fechaDeFila(x), valores(x)[0]])).toEqual(
      esperado.map((r) => [r.fecha_publicacion, r.valor]),
    );
    // El texto visible es el valor tal cual.
    expect(f[0]).toContain(`>${esperado[0]?.valor}</data>`);
  });

  it("explica operación y publicación y dice cuál FIX aplica a un día", () => {
    const { html, pagina } = dePagina(RUTA_FIX);
    const ultimo = entrada.fix.registros.at(-1) as TipoCambioFix;
    const anterior = entrada.fix.registros.at(-2) as TipoCambioFix;
    const siguiente = sumar(ultimo.fecha_publicacion, 1);
    const f = filas(html, "fix-operacion");
    // Un pago del día de la última publicación usa la anterior; el siguiente usa la última.
    expect(f.map((x) => [fechaDeFila(x), valores(x)[0]])).toEqual([
      [siguiente, ultimo.valor],
      [ultimo.fecha_publicacion, anterior.valor],
    ]);
    expect(html).toContain("artículo 20");
    expect(html).toContain("Ciudad de México");
    expect(pagina.consultas).toEqual([
      "/v1/tipo-cambio/fix/ultimo",
      `/v1/tipo-cambio/fix?operacion=${siguiente}`,
      `/v1/tipo-cambio/fix?publicado=${ultimo.fecha_publicacion}`,
    ]);
    expect(pagina.paquete?.codigo).toContain("fixParaOperacion(hoyEnMexico())");
  });

  it("dice que la publicación y la operación son fechas distintas, con lo de la guía", () => {
    const { html } = dePagina(RUTA_FIX);
    expect(guiaApi).toContain("`fecha_publicacion` es el día de la publicación en el DOF");
    expect(html).toContain("día de la publicación en el DOF");
    expect(html).toContain("no el día al que se aplica");
  });

  it("el Dataset cubre de 2020-01-02 en adelante y descarga la serie", () => {
    const { html } = dePagina(RUTA_FIX);
    const d = datosEstructurados(html).find((n) => n["@type"] === "Dataset") as Record<
      string,
      unknown
    >;
    expect(d.temporalCoverage).toBe(`${entrada.fix.registros[0]?.fecha_publicacion}/..`);
    expect(JSON.stringify(d.distribution)).toContain("tipo-cambio-fix.csv");
  });
});

describe("UDIS", () => {
  it("lista los 30 días anteriores a la fecha de referencia, ella y todos los publicados después", () => {
    const { html } = dePagina(RUTA_UDIS);
    const referencia = (entrada.fix.registros.at(-1) as TipoCambioFix).fecha_publicacion;
    const esperado = entrada.udis.registros.filter((u) => u.fecha >= sumar(referencia, -30));
    const f = filas(html, "udis-tabla");
    expect(f.map((x) => [fechaDeFila(x), valores(x)[0]])).toEqual(
      esperado.map((u) => [u.fecha, u.valor]),
    );
    expect(f.length).toBeGreaterThan(30);
    // Cada fila lleva su fecha para que sitio.js resalte la de hoy.
    expect(f.map((x) => /^<tr data-fecha="([^"]+)">/.exec(x)?.[1])).toEqual(
      esperado.map((u) => u.fecha),
    );
    // Los publicados después de la referencia llegan hasta el último cargado.
    expect(fechaDeFila(f.at(-1) as string)).toBe(entrada.udis.registros.at(-1)?.fecha);
    expect(html).toContain(`>${esperado.at(-1)?.valor}</data>`);
  });

  it("explica que se publican por adelantado y que la fila de hoy se resalta", () => {
    const { html, pagina } = dePagina(RUTA_UDIS);
    const ultima = entrada.udis.registros.at(-1) as Udi;
    expect(html).toContain("por adelantado");
    expect(html).toContain("se resalta");
    expect(html).not.toContain('aria-current="date"');
    expect(pagina.queEsDatosAl).toContain(fechaEnTexto(ultima.fecha));
    expect(pagina.consultas[0]).toMatch(/^\/v1\/udis\?fecha=\d{4}-\d{2}-\d{2}$/);
    expect(pagina.paquete?.codigo).toContain("api.udi(hoyEnMexico())");
  });
});

describe("UMA", () => {
  it("una fila por año con diaria, mensual y anual de la API", () => {
    const { html } = dePagina(RUTA_UMA);
    const f = filas(html, "uma-tabla");
    const esperado = [...entrada.uma.registros].sort((a, b) => b.anio - a.anio);
    expect(f.map((x) => valores(x))).toEqual(esperado.map((u) => [u.diaria, u.mensual, u.anual]));
    expect(f.map((x) => /<th scope="row">(\d{4})/.exec(x)?.[1])).toEqual(
      esperado.map((u) => String(u.anio)),
    );
    // La vigencia de cada año.
    for (const [i, u] of esperado.entries()) {
      expect(f[i]).toContain(`<time datetime="${u.vigencia_desde}">`);
    }
    // Con separador de miles a la vista, sin él en el valor.
    expect(f[0]).toContain(">42,794.64</data>");
    expect(f[0]).toContain('<data value="42794.64">');
  });

  it("dice cuál rige en la fecha de referencia y que en enero sigue la del año anterior", () => {
    const { html } = dePagina(RUTA_UMA);
    const referencia = (entrada.fix.registros.at(-1) as TipoCambioFix).fecha_publicacion;
    const vigente = [...entrada.uma.registros]
      .reverse()
      .find((u) => u.vigencia_desde <= referencia);
    expect(html).toContain(
      `La UMA vigente el ${fechaEnTexto(referencia)} es la de ${vigente?.anio}`,
    );
    expect(html).toContain("en enero");
    expect(html).toContain("2017");
  });

  it("si la UMA del año de referencia no está, lo avisa y no inventa", () => {
    const { html } = dePagina(RUTA_UMA, {
      ...entrada,
      fix: {
        ...entrada.fix,
        registros: [
          ...entrada.fix.registros,
          { fecha_publicacion: "2027-03-01", valor: "20.0000" },
        ],
      },
    });
    expect(html).toContain("La UMA de 2027 todavía no se ha cargado");
    expect(filas(html, "uma-tabla")).toHaveLength(entrada.uma.registros.length);
  });
});

describe("salario mínimo", () => {
  it("una fila por año con el general y el de la frontera norte", () => {
    const { html } = dePagina(RUTA_SALARIO_MINIMO);
    const f = filas(html, "salario-tabla");
    const anios = [...new Set(entrada.salarioMinimo.registros.map((s) => s.anio))].sort(
      (a, b) => b - a,
    );
    expect(f).toHaveLength(anios.length);
    for (const [i, anio] of anios.entries()) {
      const de = (zona: string) =>
        entrada.salarioMinimo.registros.find((s) => s.anio === anio && s.zona === zona);
      expect(valores(f[i] as string), String(anio)).toEqual([
        (de("general") as SalarioMinimo).diario,
        (de("zlfn") as SalarioMinimo).diario,
      ]);
      expect(f[i]).toContain(`<time datetime="${de("general")?.vigencia_desde}">`);
    }
  });

  it("avisa si falta el salario mínimo del año de referencia", () => {
    const { html } = dePagina(RUTA_SALARIO_MINIMO, {
      ...entrada,
      fix: {
        ...entrada.fix,
        registros: [
          ...entrada.fix.registros,
          { fecha_publicacion: "2027-03-01", valor: "20.0000" },
        ],
      },
    });
    expect(html).toContain("El salario mínimo de 2027 todavía no se ha cargado");
  });
});

describe("tarifas de ISR", () => {
  it("una tabla por tarifa con cada tramo igual al de la API", () => {
    const { html } = dePagina(RUTA_ISR);
    for (const t of entrada.isr.registros) {
      const f = filas(html, `isr-${t.periodo}-${t.anio}`);
      expect(f).toHaveLength(t.tramos.length);
      for (const [i, tramo] of t.tramos.entries()) {
        expect(valores(f[i] as string), `${t.periodo} ${t.anio} ${i + 1}`).toEqual([
          tramo.limite_inferior,
          tramo.limite_superior ?? "",
          tramo.cuota_fija,
          tramo.tasa_excedente,
        ]);
      }
      expect(f.at(-1)).toContain("en adelante");
    }
  });

  it("primero la mensual y luego las anuales, la más reciente antes, con la cita del Anexo 8", () => {
    const { html, pagina } = dePagina(RUTA_ISR);
    const ids = [...html.matchAll(/<caption id="(isr-[^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["isr-mensual-2026", "isr-anual-2026", "isr-anual-2025"]);
    expect(pagina.citas.flatMap((c) => c.fragmentos)).toEqual(
      entrada.isr.registros.map((t) => t.fuente.fragmento),
    );
    expect(html).toContain("Anexo 8");
    expect(pagina.consultas).toContain("/v1/isr/tarifa/mensual/2026");
  });
});
