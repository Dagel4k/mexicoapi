// La página de la calculadora con los calendarios reales de data/: sin Dataset, con el formulario
// oculto hasta que corra sitio.js, y con la explicación y los ejemplos que valen sin JavaScript.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiaInhabilCurado, Manifiesto } from "@mexicoapi/core";
import { metaLft } from "@mexicoapi/core/rutas";
import { beforeAll, describe, expect, it } from "vitest";
import { leerCurado } from "../../../src/curado/leer.js";
import { curadoDiasCnbv, curadoDiasSat } from "../../../src/curado/registro.js";
import { metaDesdeManifiesto } from "../../../src/sitio/meta.js";
import { paginaCalculadora } from "../../../src/sitio/paginas/calculadora.js";
import {
  type CalendarioDePagina,
  calendarioDePagina,
  paginasDeCalendarios,
  RUTA_CALCULADORA,
  RUTA_DIAS_CNBV,
  RUTA_DIAS_LFT,
  RUTA_DIAS_SAT,
} from "../../../src/sitio/paginas/dias-inhabiles.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { paginaDeDatos, registrarPaginas } from "../../../src/sitio/paginas/pagina-datos.js";
import { datosEstructurados, esperarDocumentoValido } from "./estructura.js";

const REAL = fileURLToPath(new URL("../../../../../data", import.meta.url));

async function calendario(def: typeof curadoDiasSat, autoridad: "sat" | "cnbv") {
  const dir = join(REAL, def.directorio);
  const registros = JSON.parse(
    await readFile(join(dir, def.archivo), "utf8"),
  ) as DiaInhabilCurado[];
  const manifiesto = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifiesto;
  const cobertura = (await leerCurado(def, REAL))?.documento?.cobertura ?? null;
  return calendarioDePagina(
    autoridad,
    registros,
    cobertura,
    metaDesdeManifiesto(manifiesto, def.directorio),
  );
}

let sat: CalendarioDePagina;
let cnbv: CalendarioDePagina;
beforeAll(async () => {
  sat = await calendario(curadoDiasSat, "sat");
  cnbv = await calendario(curadoDiasCnbv, "cnbv");
});

const DESCARGAS = new Map(
  [
    "dias-inhabiles-sat.json",
    "dias-inhabiles-sat.csv",
    "dias-inhabiles-sat.manifest.json",
    "dias-inhabiles-cnbv.json",
    "dias-inhabiles-cnbv.csv",
    "dias-inhabiles-cnbv.manifest.json",
  ].map((a) => [a, "[]"] as const),
);

function armar() {
  const pagina = paginaCalculadora({ sat, cnbv });
  const registro = registrarPaginas([...paginasDeCalendarios({ anio: 2026, sat, cnbv }), pagina]);
  return { pagina, registro, html: paginaDeDatos(pagina, registro, DESCARGAS) };
}

describe("/calculadora-dias-habiles/", () => {
  it("es una página sin Dataset, con el formulario oculto hasta que corra sitio.js", () => {
    const { pagina, html } = armar();
    esperarDocumentoValido(html);
    expect(pagina.ruta).toBe(RUTA_CALCULADORA);
    expect(pagina.h1).toBe("Calculadora de días hábiles: SAT, LFT y bancos");
    expect(pagina.titulo).toBe("Calculadora de días hábiles: SAT, LFT y bancos · MéxicoAPI");
    expect([...pagina.descripcion].length).toBeLessThanOrEqual(155);
    expect(pagina.conjunto).toBeNull();
    expect(pagina.dataset).toBeNull();
    expect(datosEstructurados(html).filter((n) => n["@type"] === "Dataset")).toHaveLength(0);
    expect(html).toMatch(/<form[^>]*id="form-dias"[^>]*\shidden/);
    expect(html).not.toMatch(/<form[^>]*\saction=/);
    expect(html).toMatch(/<noscript>/);
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    for (const id of [
      "dias-autoridad",
      "campo-tipo-plazo",
      "dias-tipo-plazo",
      "dias-desde",
      "dias-dias",
      "dias-incompleto",
      "resultado-dias",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("cada clase que usa tiene su regla en el estilo", () => {
    const { html } = armar();
    const clases = new Set(
      [...html.matchAll(/ class="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(" ")),
    );
    for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
    expect(ESTILO).toContain("#resultado-dias");
  });

  it("explica cómo cuenta cada autoridad con lo que respalda la documentación", () => {
    const { html } = armar();
    expect(html).toMatch(/artículo 12 del Código Fiscal de la Federación/);
    expect(html).toMatch(/artículo 74/);
    expect(html).toMatch(/artículo 733/);
    expect(html).toMatch(/<code>desde<\/code> no se cuenta/);
    expect(html).toMatch(/calendario bancario/);
    expect(html).toContain("lft-art-715");
    expect(html).toContain("prorroga-art-12");
  });

  it("enlaza ejemplos de la API que existen en la documentación", () => {
    const { pagina, html } = armar();
    expect(pagina.consultas).toHaveLength(4);
    for (const consulta of pagina.consultas) {
      expect(consulta).toMatch(/^\/v1\/dias-habiles\?autoridad=(lft|cnbv|sat)&/);
      expect(html).toContain(`href="${consulta.replaceAll("&", "&amp;")}"`);
    }
    expect(pagina.guiaApi).toMatch(/README\.md#dias-habiles$/);
  });

  it("dice las coberturas de los calendarios y cita las tres fuentes", () => {
    const { pagina, html } = armar();
    expect(html).toContain("2007");
    expect(html).toContain("calendario-incompleto");
    expect(pagina.fuentes.length).toBeGreaterThanOrEqual(3);
    expect(pagina.datosAl).toBe(
      [sat.meta.as_of, cnbv.meta.as_of, metaLft("dias-habiles").as_of].sort().at(-1) ?? "",
    );
  });

  it("se enlaza desde los calendarios y ellos desde la calculadora", () => {
    const { pagina, registro } = armar();
    for (const ruta of [RUTA_DIAS_SAT, RUTA_DIAS_LFT, RUTA_DIAS_CNBV]) {
      expect(registro.get(ruta)?.relacionadas, ruta).toContain(RUTA_CALCULADORA);
    }
    expect(pagina.relacionadas).toEqual([RUTA_DIAS_SAT, RUTA_DIAS_LFT, RUTA_DIAS_CNBV]);
  });
});
