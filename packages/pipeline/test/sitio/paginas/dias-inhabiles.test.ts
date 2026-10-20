// Las páginas de los calendarios con los datos reales de data/: cada fecha, motivo y tipo de una
// tabla es el de `/v1/dias-inhabiles` para ese año, calculado con las mismas funciones del núcleo
// que usa el Worker.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DiaInhabil,
  type DiaInhabilCurado,
  FUENTE_LFT_74,
  FUENTE_LFT_715,
  type Manifiesto,
  VIGENCIA_LFT,
} from "@mexicoapi/core";
import { type CalendarioCurado, diasInhabilesCurados } from "@mexicoapi/core/curados";
import { URL_API } from "@mexicoapi/core/problemas";
import { diasInhabilesLft, fechaEnTexto, metaLft } from "@mexicoapi/core/rutas";
import { beforeAll, describe, expect, it } from "vitest";
import { leerCurado } from "../../../src/curado/leer.js";
import { curadoDiasCnbv, curadoDiasSat } from "../../../src/curado/registro.js";
import { metaDesdeManifiesto, URL_DOCS } from "../../../src/sitio/meta.js";
import { DESCRIPCION_DATASET } from "../../../src/sitio/paginas/datos-estructurados.js";
import {
  type CalendarioDePagina,
  calendarioDePagina,
  paginaDiasCnbv,
  paginaDiasLft,
  paginaDiasSat,
  paginasDeCalendarios,
  RUTA_DIAS_CNBV,
  RUTA_DIAS_LFT,
  RUTA_DIAS_SAT,
} from "../../../src/sitio/paginas/dias-inhabiles.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { escaparHtml } from "../../../src/sitio/paginas/html.js";
import {
  type PaginaDatos,
  paginaDeDatos,
  registrarPaginas,
} from "../../../src/sitio/paginas/pagina-datos.js";
import { atributos, datosEstructurados, desescapar, esperarDocumentoValido } from "./estructura.js";

const REAL = fileURLToPath(new URL("../../../../../data", import.meta.url));

type Definicion = typeof curadoDiasSat;

/** El calendario de una autoridad con los archivos reales, como lo arma el build. */
async function calendarioReal(def: Definicion, autoridad: "sat" | "cnbv") {
  const dir = join(REAL, def.directorio);
  const registros = JSON.parse(
    await readFile(join(dir, def.archivo), "utf8"),
  ) as DiaInhabilCurado[];
  const manifiesto = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifiesto;
  const cobertura = (await leerCurado(def, REAL))?.documento?.cobertura ?? null;
  return {
    manifiesto,
    registros,
    pagina: calendarioDePagina(
      autoridad,
      registros,
      cobertura,
      metaDesdeManifiesto(manifiesto, def.directorio),
    ),
  };
}

/** Lo que enlazan las páginas en /descargas/, con un contenido cualquiera. */
const DESCARGAS = new Map(
  [
    "dias-inhabiles-sat.json",
    "dias-inhabiles-sat.csv",
    "dias-inhabiles-sat.manifest.json",
    "dias-inhabiles-cnbv.json",
    "dias-inhabiles-cnbv.csv",
    "dias-inhabiles-cnbv.manifest.json",
    "dias-inhabiles-lft.json",
    "dias-inhabiles-lft.csv",
    "dias-inhabiles-coberturas.json",
  ].map((n) => [n, "[]"]),
);

let sat: CalendarioDePagina;
let cnbv: CalendarioDePagina;
let manifiestoSat: Manifiesto;
let manifiestoCnbv: Manifiesto;
let vacacionesSat: DiaInhabilCurado[];
beforeAll(async () => {
  const deSat = await calendarioReal(curadoDiasSat, "sat");
  const deCnbv = await calendarioReal(curadoDiasCnbv, "cnbv");
  sat = deSat.pagina;
  cnbv = deCnbv.pagina;
  manifiestoSat = deSat.manifiesto;
  manifiestoCnbv = deCnbv.manifiesto;
  vacacionesSat = deSat.registros.filter((r) => r.tipo === "vacaciones");
});

/** El año de las páginas en el build: el de la fecha más reciente del FIX en data/. */
async function anioDelFix(): Promise<number> {
  const fix = JSON.parse(await readFile(join(REAL, "tipo-cambio-fix", "fix.json"), "utf8")) as {
    fecha_publicacion: string;
  }[];
  return Number(fix.at(-1)?.fecha_publicacion.slice(0, 4));
}

/** El HTML de una página, armada con las tres en el registro. */
function html(pagina: PaginaDatos, anio = 2026): string {
  const registro = registrarPaginas(paginasDeCalendarios({ anio, sat, cnbv }));
  const conLaPagina = new Map(registro);
  conLaPagina.set(pagina.ruta, pagina);
  return paginaDeDatos(pagina, conLaPagina, DESCARGAS);
}

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

interface Renglon {
  fecha: string;
  dia: string;
  motivo: string;
  tipo: string | undefined;
}

/** Los renglones de la tabla de un año, con la fecha de su `<time>`; [] si no hay tabla. */
function renglones(pagina: string, anio: number): Renglon[] {
  const inicio = pagina.indexOf(`<caption id="dias-${anio}">`);
  if (inicio === -1) return [];
  const cuerpo = pagina.slice(
    pagina.indexOf("<tbody>", inicio),
    pagina.indexOf("</tbody>", inicio),
  );
  const filas = [
    ...cuerpo.matchAll(
      /<tr><th scope="row"><time datetime="([^"]+)">([^<]+)<\/time><span class="detalle">([^<]+)<\/span><\/th><td>([^<]*)<\/td>(?:<td>([^<]*)<\/td>)?<\/tr>/g,
    ),
  ].map((m) => ({
    fecha: m[1] as string,
    texto: m[2] as string,
    dia: m[3] as string,
    motivo: desescapar(m[4] as string),
    tipo: m[5],
  }));
  // Ningún renglón se escapa de la expresión.
  expect(filas).toHaveLength(cuerpo.match(/<tr>/g)?.length ?? 0);
  for (const f of filas) {
    // El día de la semana y la fecha en texto, revisados sin el núcleo.
    expect(f.dia, f.fecha).toBe(NOMBRES_DIA[new Date(`${f.fecha}T12:00:00Z`).getUTCDay()]);
    expect(`${f.texto} de ${f.fecha.slice(0, 4)}`, f.fecha).toBe(fechaEnTexto(f.fecha));
  }
  return filas.map(({ fecha, dia, motivo, tipo }) => ({ fecha, dia, motivo, tipo }));
}

const TIPO: Record<string, string> = { descanso: "Descanso", vacaciones: "Vacaciones" };

/** Lo que la tabla debe mostrar de la lista de la API. */
const esperado = (dias: readonly DiaInhabil[], conTipo: boolean) =>
  dias.map((d) => ({
    fecha: d.fecha,
    motivo: d.motivo,
    tipo: conTipo ? TIPO[d.tipo] : undefined,
  }));

const sinDia = (filas: Renglon[]) => filas.map(({ dia: _, ...resto }) => resto);

function seccion(pagina: string, id: string): string {
  const inicio = pagina.indexOf(`<section id="${id}"`);
  expect(inicio, id).toBeGreaterThan(0);
  return pagina.slice(inicio, pagina.indexOf("</section>", inicio));
}

const dataset = (pagina: string): Record<string, unknown> =>
  datosEstructurados(pagina).find((n) => n["@type"] === "Dataset") as Record<string, unknown>;

/** Lo que toda página de calendario cumple. */
function esperarPaginaDeCalendario(pagina: PaginaDatos, texto: string): void {
  esperarDocumentoValido(texto);
  expect(texto).toContain(`<h1>${escaparHtml(pagina.h1)}</h1>`);
  expect(pagina.titulo).toBe(`${pagina.h1} · MéxicoAPI`);
  expect([...pagina.descripcion].length).toBeLessThanOrEqual(155);
  const descripcion = dataset(texto).description as string;
  expect(descripcion.length).toBeGreaterThanOrEqual(DESCRIPCION_DATASET.minimo);
  expect(descripcion.length).toBeGreaterThan(pagina.descripcion.length);
  const clases = new Set(atributos(texto, "class").flatMap((c) => c.split(" ")));
  for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  // Cada tabla tiene caption y cada celda de encabezado su scope.
  for (const [th] of texto.matchAll(/<th\b[^>]*>/g)) expect(th).toMatch(/ scope="(col|row)"/);
  expect(texto.match(/<table\b/g)?.length).toBe(texto.match(/<caption id="[^"]+">/g)?.length);
  // Los encabezados bajan de uno en uno.
  const niveles = [...texto.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < niveles.length; i++) {
    expect((niveles[i] as number) - (niveles[i - 1] as number)).toBeLessThanOrEqual(1);
  }
}

describe("días inhábiles del SAT", () => {
  it("el año de las páginas es el del FIX más reciente, y la del SAT habla de él y del siguiente", async () => {
    const anio = await anioDelFix();
    const pagina = paginaDiasSat(anio, sat);
    expect(pagina.ruta).toBe(RUTA_DIAS_SAT);
    expect(pagina.h1).toBe(`Días inhábiles del SAT ${anio} y ${anio + 1}`);
    esperarPaginaDeCalendario(pagina, html(pagina, anio));
  });

  it("cada tabla es la lista de /v1/dias-inhabiles de su año, con fecha, día, motivo y tipo", () => {
    const texto = html(paginaDiasSat(2026, sat));
    for (const anio of [2026, 2027]) {
      const api = diasInhabilesCurados(sat.calendario, anio);
      expect(api.dias.length, String(anio)).toBeGreaterThan(0);
      expect(sinDia(renglones(texto, anio)), String(anio)).toEqual(esperado(api.dias, true));
    }
    expect(renglones(texto, 2028)).toEqual([]);
  });

  it("cuenta los días de cada año por tipo", () => {
    const texto = html(paginaDiasSat(2026, sat));
    for (const anio of [2026, 2027]) {
      const { dias } = diasInhabilesCurados(sat.calendario, anio);
      const descanso = dias.filter((d) => d.tipo === "descanso").length;
      const vacaciones = dias.length - descanso;
      const resumen =
        vacaciones === 0
          ? `<p>${dias.length} días, todos de descanso del artículo 12.</p>`
          : `<p>${dias.length} días: ${descanso} de descanso del artículo 12 y ${vacaciones} de vacaciones.</p>`;
      expect(seccion(texto, `anio-${anio}`), String(anio)).toContain(resumen);
    }
  });

  // El segundo periodo de vacaciones de 2026 no se ha publicado: la página no lo inventa ni da a
  // entender que el año está completo.
  it("dice hasta dónde están publicadas las vacaciones y que las de después no están", () => {
    const texto = html(paginaDiasSat(2026, sat));
    const { desde, hasta } = sat.calendario.general.cobertura;
    expect(hasta < "2026-12-31").toBe(true);
    expect(seccion(texto, "anio-2026")).toContain(
      `<p class="aviso">Las vacaciones de 2026 están publicadas del ${fechaEnTexto(desde)} al ${fechaEnTexto(hasta)}; las demás no se han publicado o no se han cargado, así que en esta lista pueden faltar días de vacaciones.</p>`,
    );
    expect(seccion(texto, "anio-2027")).toContain(
      '<p class="aviso">Las vacaciones del SAT de 2027 no se han publicado o no se han cargado: esta lista solo trae los días del artículo 12, que fija la ley.</p>',
    );
    // Ningún día de 2027 es de vacaciones, y ninguno de 2026 pasa de la cobertura.
    expect(renglones(texto, 2027).every((r) => r.tipo === "Descanso")).toBe(true);
    for (const r of renglones(texto, 2026).filter((r) => r.tipo === "Vacaciones")) {
      expect(r.fecha <= hasta, r.fecha).toBe(true);
    }
    const pendiente = seccion(texto, "pendiente");
    const declaraciones = sat.calendario.plazos.get("declaraciones_pagos")?.cobertura;
    expect(declaraciones).toBeDefined();
    expect(pendiente).toContain(
      `Para un plazo general, la lista está completa del ${fechaEnTexto(desde)} al ${fechaEnTexto(hasta)}`,
    );
    expect(pendiente).toContain(
      `la lista está completa del ${fechaEnTexto(declaraciones?.desde as string)} al ${fechaEnTexto(declaraciones?.hasta as string)}`,
    );
    expect(pendiente).toContain("<code>calendario-incompleto</code>");
  });

  it("con las vacaciones de los dos años publicadas, dice que las listas están completas", () => {
    const completo = calendarioDePagina(
      "sat",
      vacacionesSat,
      { vacaciones: { desde: "2026-01-01", hasta: "2027-12-31" } },
      sat.meta,
    );
    const texto = html(paginaDiasSat(2026, completo));
    for (const anio of [2026, 2027]) {
      expect(seccion(texto, `anio-${anio}`)).toContain(
        `<p>La lista de ${anio} está completa para cualquier plazo.</p>`,
      );
    }
    expect(texto).not.toContain("no se han publicado");
  });

  it("explica la diferencia entre plazos generales y de declaraciones y pagos con el calendario", () => {
    const plazos = seccion(html(paginaDiasSat(2026, sat)), "plazos");
    expect(plazos).toContain(
      '<tr><th scope="row">Descanso</th><td>Inhábil</td><td>Inhábil</td></tr>',
    );
    expect(plazos).toContain(
      '<tr><th scope="row">Vacaciones</th><td>Inhábil</td><td>Hábil</td></tr>',
    );
    expect(sat.calendario.plazos.get("declaraciones_pagos")?.excluirTipos).toEqual(["vacaciones"]);
    expect(sat.calendario.general.excluirTipos).toEqual([]);
    expect(plazos).toContain("<code>tipo_plazo=declaraciones_pagos</code>");
  });

  // En 2030 el SAT no descuenta el 1o. de octubre: la API lo advierte y la página también.
  it("en un año de transmisión del Poder Ejecutivo muestra el aviso de la API", () => {
    const texto = html(paginaDiasSat(2030, sat), 2030);
    const [aviso] = diasInhabilesCurados(sat.calendario, 2030).avisos.filter(
      (a) => a.codigo === "transmision-poder-ejecutivo",
    );
    expect(aviso).toBeDefined();
    expect(seccion(texto, "anio-2030")).toContain(
      `<p class="aviso">${escaparHtml(aviso?.texto as string)}</p>`,
    );
    expect(seccion(texto, "anio-2031")).not.toContain("transmisión");
  });

  it("cita sus fuentes del manifiesto y el texto de cada día, con su fecha de datos", () => {
    const texto = html(paginaDiasSat(2026, sat));
    expect(texto).toContain(`<time datetime="${manifiestoSat.as_of}">`);
    const fuente = seccion(texto, "fuente");
    for (const f of manifiestoSat.sources) {
      expect(fuente, f.name).toContain(`">${escaparHtml(f.name)}</a>`);
    }
    for (const d of diasInhabilesCurados(sat.calendario, 2026).dias) {
      expect(fuente, d.fecha).toContain(`<p>${escaparHtml(d.fuente.fragmento as string)}</p>`);
    }
  });

  it("su Dataset describe la lista descargable, con su cobertura y sus fuentes", () => {
    const pagina = paginaDiasSat(2026, sat);
    const nodo = dataset(html(pagina));
    expect(nodo).toMatchObject({
      name: "Días inhábiles del SAT",
      url: `${URL_API}/dias-inhabiles-sat/`,
      dateModified: manifiestoSat.as_of,
      temporalCoverage: `${sat.lista.desde}/${sat.lista.hasta}`,
      license: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      isBasedOn: [...new Set(manifiestoSat.sources.map((s) => s.url))],
    });
    expect(nodo.distribution).toEqual([
      expect.objectContaining({ contentUrl: `${URL_API}/descargas/dias-inhabiles-sat.json` }),
      expect.objectContaining({ contentUrl: `${URL_API}/descargas/dias-inhabiles-sat.csv` }),
    ]);
    expect(pagina.consultas).toEqual([
      "/v1/dias-inhabiles?autoridad=sat&anio=2026",
      "/v1/dias-inhabiles?autoridad=sat&anio=2027",
    ]);
    expect(pagina.docs).toBe(`${URL_DOCS}/datos/dias-inhabiles-sat.md`);
    expect(pagina.dataset).toBe("dias-inhabiles.sat");
    expect(pagina.relacionadas).toEqual([RUTA_DIAS_LFT, RUTA_DIAS_CNBV]);
  });
});

describe("días de descanso obligatorio (LFT)", () => {
  it("cada tabla es la lista de /v1/dias-inhabiles?autoridad=lft de su año", () => {
    const pagina = paginaDiasLft(2026);
    expect(pagina.ruta).toBe(RUTA_DIAS_LFT);
    expect(pagina.h1).toBe("Días de descanso obligatorio 2026 y 2027 (LFT)");
    const texto = html(pagina);
    esperarPaginaDeCalendario(pagina, texto);
    for (const anio of [2026, 2027]) {
      const { dias } = diasInhabilesLft(anio);
      expect(sinDia(renglones(texto, anio)), String(anio)).toEqual(esperado(dias, false));
      expect(seccion(texto, `anio-${anio}`)).toContain(`<p>${dias.length} días.</p>`);
    }
  });

  it("avisa lo que no trae (art. 715) y dice cuándo es la siguiente transmisión del Poder Ejecutivo", () => {
    const texto = html(paginaDiasLft(2026));
    expect(seccion(texto, "art-715")).toContain(
      "el artículo 715 también excluye los festivos que señale el calendario oficial y los días en que las autoridades laborales suspenden labores",
    );
    expect(seccion(texto, "transmision")).toContain(
      "El primero desde 2026 es el 1 de octubre de 2030.",
    );
    // En 2030 el día está en la tabla, con el motivo del núcleo.
    const de2030 = html(paginaDiasLft(2030), 2030);
    const octubre = renglones(de2030, 2030).find((r) => r.fecha === "2030-10-01");
    expect(octubre?.motivo).toBe(
      diasInhabilesLft(2030).dias.find((d) => d.fecha === "2030-10-01")?.motivo,
    );
    expect(seccion(de2030, "transmision")).toContain(
      "El primero desde 2030 es el 1 de octubre de 2030.",
    );
  });

  // 2100 es el último año del calendario: sin el siguiente ni otra transmisión.
  it("al final de la cobertura solo muestra los años que existen", () => {
    const pagina = paginaDiasLft(2100);
    expect(pagina.h1).toBe("Días de descanso obligatorio 2100 (LFT)");
    const texto = html(pagina, 2100);
    expect(renglones(texto, 2101)).toEqual([]);
    expect(texto).not.toContain('id="transmision"');
    expect(() => paginaDiasLft(2101)).toThrow(/2101/);
  });

  it("cita la fuente de la API y los artículos 74 y 715, con la fecha de la última reforma", () => {
    const texto = html(paginaDiasLft(2026));
    expect(texto).toContain(
      `<time datetime="${VIGENCIA_LFT}">${fechaEnTexto(VIGENCIA_LFT)}</time>`,
    );
    const fuente = seccion(texto, "fuente");
    for (const f of metaLft("dias-inhabiles").sources) {
      expect(fuente).toContain(`">${escaparHtml(f.name)}</a>`);
    }
    expect(fuente).toContain(`<p>${escaparHtml(FUENTE_LFT_74.fragmento as string)}</p>`);
    expect(fuente).toContain(`<p>${escaparHtml(FUENTE_LFT_715.fragmento as string)}</p>`);
    expect(dataset(texto)).toMatchObject({
      name: "Días de descanso obligatorio de la Ley Federal del Trabajo",
      temporalCoverage: "2007-01-01/2100-12-31",
      dateModified: VIGENCIA_LFT,
    });
  });
});

describe("días inhábiles bancarios (CNBV)", () => {
  it("cada tabla es la lista de /v1/dias-inhabiles?autoridad=cnbv de su año", () => {
    const pagina = paginaDiasCnbv(2026, cnbv);
    expect(pagina.ruta).toBe(RUTA_DIAS_CNBV);
    expect(pagina.h1).toBe("Días inhábiles bancarios 2026 (CNBV)");
    const texto = html(pagina);
    esperarPaginaDeCalendario(pagina, texto);
    const { dias } = diasInhabilesCurados(cnbv.calendario, 2026);
    expect(sinDia(renglones(texto, 2026))).toEqual(esperado(dias, false));
    expect(texto).toContain(`<time datetime="${manifiestoCnbv.as_of}">`);
  });

  // Un año que no está cargado no se lista: la página lo dice y la API responde 422.
  it("dice qué años cubre, que el siguiente no se ha cargado y que la API trae los anteriores", () => {
    const texto = html(paginaDiasCnbv(2026, cnbv));
    expect(renglones(texto, 2027)).toEqual([]);
    const cobertura = seccion(texto, "cobertura");
    const { desde, hasta } = cnbv.calendario.amplia;
    expect(cobertura).toContain(
      `La lista está completa del ${fechaEnTexto(desde)} al ${fechaEnTexto(hasta)}.`,
    );
    expect(cobertura).toContain("La API y las descargas también traen 2025.");
    expect(cobertura).toContain(
      '<p class="aviso">El calendario de 2027 no se ha cargado: la CNBV publica sus disposiciones en el DOF cada año y se agregan cuando salen. Mientras tanto, la API responde 422 <code>calendario-incompleto</code> para ese año.</p>',
    );
  });

  it("con dos años cubiertos muestra los dos, sin avisos de años faltantes", () => {
    const pagina = paginaDiasCnbv(2025, cnbv);
    expect(pagina.h1).toBe("Días inhábiles bancarios 2025 y 2026 (CNBV)");
    const texto = html(pagina, 2025);
    for (const anio of [2025, 2026]) {
      const { dias } = diasInhabilesCurados(cnbv.calendario, anio);
      expect(sinDia(renglones(texto, anio))).toEqual(esperado(dias, false));
    }
    expect(texto).not.toContain("no se ha cargado");
    expect(texto).not.toContain("también traen");
  });

  // Antes de que la CNBV publique el año, la página se queda con el último que tiene.
  it("si el año actual no está cargado, muestra el último que sí y lo dice", () => {
    const pagina = paginaDiasCnbv(2027, cnbv);
    expect(pagina.h1).toBe("Días inhábiles bancarios 2026 (CNBV)");
    const texto = html(pagina, 2027);
    expect(renglones(texto, 2026).length).toBeGreaterThan(0);
    expect(seccion(texto, "cobertura")).toContain(
      "Los calendarios de 2027 y 2028 no se han cargado",
    );
    expect(texto).toContain("La API y las descargas también traen 2025.");
  });

  it("su Dataset y su fuente son los del manifiesto", () => {
    const texto = html(paginaDiasCnbv(2026, cnbv));
    expect(dataset(texto)).toMatchObject({
      name: "Días inhábiles bancarios de la CNBV",
      temporalCoverage: `${cnbv.lista.desde}/${cnbv.lista.hasta}`,
      dateModified: manifiestoCnbv.as_of,
      isBasedOn: manifiestoCnbv.sources.map((s) => s.url),
    });
    const fuente = seccion(texto, "fuente");
    for (const f of manifiestoCnbv.sources) {
      expect(fuente).toContain(`">${escaparHtml(f.name)}</a>`);
    }
  });
});

describe("registro de los calendarios", () => {
  it("las tres páginas se enlazan entre sí y se registran sin errores", () => {
    const paginas = paginasDeCalendarios({ anio: 2026, sat, cnbv });
    expect(paginas.map((p) => p.ruta)).toEqual([RUTA_DIAS_SAT, RUTA_DIAS_LFT, RUTA_DIAS_CNBV]);
    expect(RUTA_DIAS_SAT).toBe("/dias-inhabiles-sat/");
    expect(RUTA_DIAS_LFT).toBe("/dias-de-descanso-obligatorio/");
    expect(RUTA_DIAS_CNBV).toBe("/dias-inhabiles-bancarios/");
    const registro = registrarPaginas(paginas);
    for (const p of paginas) {
      expect(p.relacionadas.length, p.ruta).toBe(2);
      esperarDocumentoValido(paginaDeDatos(p, registro, DESCARGAS));
    }
  });

  it("falla si el calendario del SAT no cubre el año", () => {
    const corto: CalendarioDePagina = {
      ...sat,
      calendario: { ...sat.calendario, amplia: { desde: "2026-01-01", hasta: "2026-06-30" } },
    } as CalendarioDePagina & { calendario: CalendarioCurado };
    expect(() => paginaDiasSat(2026, corto)).toThrow(/SAT/);
  });
});
