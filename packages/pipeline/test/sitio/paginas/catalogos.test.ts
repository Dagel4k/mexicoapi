// Las páginas de los catálogos con los datos reales de data/: la tabla de bancos, los estados con
// sus 32 páginas de municipios y el validador de CLABE.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Banco, Estado, Manifiesto, Municipio } from "@mexicoapi/core";
import { beforeAll, describe, expect, it } from "vitest";
import { metaDesdeManifiesto } from "../../../src/sitio/meta.js";
import {
  type EntradaCatalogos,
  paginaMunicipios,
  paginasDeCatalogos,
  RUTA_BANCOS,
  RUTA_MUNICIPIOS,
  RUTA_VALIDAR_CLABE,
  rutaDeEstado,
} from "../../../src/sitio/paginas/catalogos.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";
import { escaparHtml } from "../../../src/sitio/paginas/html.js";
import {
  type PaginaDatos,
  paginaDeDatos,
  registrarPaginas,
  rutasParaEncabezados,
} from "../../../src/sitio/paginas/pagina-datos.js";
import { datosEstructurados, esperarDocumentoValido } from "./estructura.js";

const REAL = fileURLToPath(new URL("../../../../../data", import.meta.url));

async function leer<T>(directorio: string, archivo: string) {
  const dir = join(REAL, directorio);
  const manifiesto = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifiesto;
  return {
    registros: JSON.parse(await readFile(join(dir, archivo), "utf8")) as T[],
    meta: metaDesdeManifiesto(manifiesto, directorio),
  };
}

let entrada: EntradaCatalogos;
beforeAll(async () => {
  entrada = {
    bancos: await leer<Banco>("bancos", "bancos.json"),
    estados: await leer<Estado>("inegi-estados", "estados.json"),
    municipios: await leer<Municipio>("inegi-municipios", "municipios.json"),
  };
});

const DESCARGAS = new Map(
  [
    "bancos.json",
    "bancos.csv",
    "bancos-historial.csv",
    "bancos.manifest.json",
    "inegi-estados.json",
    "inegi-estados.csv",
    "inegi-estados.manifest.json",
    "inegi-municipios.json",
    "inegi-municipios.csv",
    "inegi-municipios.manifest.json",
  ].map((a) => [a, "[]"] as const),
);

function armar() {
  const paginas = paginasDeCatalogos(entrada);
  const registro = registrarPaginas(paginas);
  const textos = new Map(paginas.map((p) => [p.ruta, paginaDeDatos(p, registro, DESCARGAS)]));
  return { paginas, registro, textos };
}

const dePagina = (ruta: string) => {
  const { paginas, textos } = armar();
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
  return cuerpo.match(/<tr[ >].*?<\/tr>/gs) ?? [];
}

const celdas = (fila: string): string[] =>
  [...fila.matchAll(/<t[hd]\b[^>]*>(.*?)<\/t[hd]>/gs)].map((m) =>
    (m[1] as string).replace(/<[^>]+>/g, ""),
  );

function esperarPagina(pagina: PaginaDatos, html: string): void {
  esperarDocumentoValido(html);
  expect(html).toContain(`<h1>${escaparHtml(pagina.h1)}</h1>`);
  expect(pagina.titulo).toBe(`${pagina.h1} · MéxicoAPI`);
  expect([...pagina.descripcion].length).toBeLessThanOrEqual(155);
  const clases = new Set(
    [...html.matchAll(/ class="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(" ")),
  );
  for (const clase of clases) expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
  expect(html).toContain(`<p class="datos-al">Datos al <time datetime="${pagina.datosAl}">`);
  expect(html).toContain('id="fuente"');
  expect(html.match(/<table\b/g)?.length).toBe(html.match(/<caption id="[^"]+">/g)?.length);
}

describe("registro", () => {
  it("bancos, validador, municipios y una página por estado, en ese orden", () => {
    const { paginas, registro } = armar();
    expect(paginas.slice(0, 3).map((p) => p.ruta)).toEqual([
      RUTA_BANCOS,
      RUTA_VALIDAR_CLABE,
      RUTA_MUNICIPIOS,
    ]);
    expect([RUTA_BANCOS, RUTA_VALIDAR_CLABE, RUTA_MUNICIPIOS]).toEqual([
      "/bancos-clabe/",
      "/validar-clabe/",
      "/municipios/",
    ]);
    expect(paginas).toHaveLength(3 + 32);
    expect(registro.size).toBe(35);
    expect(paginas.slice(3).map((p) => p.superior)).toEqual(Array(32).fill(RUTA_MUNICIPIOS));
  });

  it("la ruta de cada estado es /municipios/{cve_ent}-{nombre sin acentos}/", () => {
    const rutas = entrada.estados.registros.map(rutaDeEstado);
    expect(rutas).toContain("/municipios/25-sinaloa/");
    expect(rutas).toContain("/municipios/05-coahuila-de-zaragoza/");
    expect(rutas).toContain("/municipios/16-michoacan-de-ocampo/");
    expect(rutas).toContain("/municipios/30-veracruz-de-ignacio-de-la-llave/");
    expect(new Set(rutas).size).toBe(32);
    for (const ruta of rutas) expect(ruta).toMatch(/^\/municipios\/\d\d-[a-z]+(-[a-z]+)*\/$/);
  });

  it("una regla de _headers por página de arriba, con comodín para la familia", () => {
    const { registro } = armar();
    const rutas = rutasParaEncabezados(registro);
    expect(rutas).toEqual(["/bancos-clabe/", "/validar-clabe/", "/municipios/*"]);
  });
});

describe("/bancos-clabe/", () => {
  it("lista cada banco con su código de 3 dígitos, nombre y estado", () => {
    const { pagina, html } = dePagina(RUTA_BANCOS);
    esperarPagina(pagina, html);
    expect(pagina.h1).toBe("Códigos de banco de la CLABE");
    const trs = filas(html, "bancos-tabla");
    expect(trs).toHaveLength(entrada.bancos.registros.length);
    trs.forEach((tr, i) => {
      const banco = entrada.bancos.registros[i] as Banco;
      const [codigo, nombre, estado] = celdas(tr);
      expect(codigo).toBe(banco.codigo);
      expect(codigo).toMatch(/^\d{3}$/);
      expect(nombre).toContain(escaparHtml(banco.nombre_corto));
      expect(estado).toMatch(banco.activo ? /^Activo$/ : /^Inactivo/);
    });
  });

  it("cita a Banxico, la fecha del manifiesto y declara su Dataset", () => {
    const { pagina, html } = dePagina(RUTA_BANCOS);
    expect(pagina.datosAl).toBe(entrada.bancos.meta.as_of);
    expect(pagina.dataset).toBe("bancos");
    expect(pagina.fuentes).toEqual(entrada.bancos.meta.sources);
    expect(html).toContain("banxico.org.mx/cep");
    expect(html).toContain("Banco de México");
    const datasets = datosEstructurados(html).filter((n) => n["@type"] === "Dataset");
    expect(datasets).toHaveLength(1);
    expect(html).toContain('curl "$API');
    expect(html).toContain("<h3>Paquete de npm</h3>");
    expect(html).toContain('href="/descargas/bancos.json"');
    expect(html).toContain(`href="${RUTA_VALIDAR_CLABE}"`);
  });

  it("cuenta las instituciones activas e inactivas con los datos", () => {
    const { html } = dePagina(RUTA_BANCOS);
    const total = entrada.bancos.registros.length;
    const activas = entrada.bancos.registros.filter((b) => b.activo).length;
    expect(html).toContain(`${total} instituciones`);
    expect(html).toContain(`${activas} activas`);
  });
});

describe("/municipios/", () => {
  it("lista los 32 estados con su clave, sus municipios y el enlace a su página", () => {
    const { pagina, html } = dePagina(RUTA_MUNICIPIOS);
    esperarPagina(pagina, html);
    const trs = filas(html, "municipios-estados");
    expect(trs).toHaveLength(32);
    trs.forEach((tr, i) => {
      const estado = entrada.estados.registros[i] as Estado;
      const cuantos = entrada.municipios.registros.filter((m) => m.cve_ent === estado.cve_ent);
      const [clave, nombre, numero] = celdas(tr);
      expect(clave).toBe(estado.cve_ent);
      expect(nombre).toBe(estado.nombre);
      expect((numero as string).replace(",", "")).toBe(String(cuantos.length));
      expect(tr).toContain(`<a href="${rutaDeEstado(estado)}">`);
    });
    expect(pagina.dataset).toBe("inegi.municipios");
    expect(pagina.fuentes.some((f) => f.url.includes("inegi.org.mx"))).toBe(true);
    expect(datosEstructurados(html).filter((n) => n["@type"] === "Dataset")).toHaveLength(1);
  });
});

describe("/municipios/{cve_ent}-{estado}/", () => {
  it("lista los municipios del estado con clave de 3 dígitos y CVEGEO", () => {
    const { paginas, textos } = armar();
    const hijas = paginas.filter((p) => p.superior === RUTA_MUNICIPIOS);
    expect(hijas).toHaveLength(32);
    let suma = 0;
    for (const hija of hijas) {
      const html = textos.get(hija.ruta) as string;
      esperarPagina(hija, html);
      const estado = entrada.estados.registros.find((e) => rutaDeEstado(e) === hija.ruta) as Estado;
      const suyos = entrada.municipios.registros.filter((m) => m.cve_ent === estado.cve_ent);
      const trs = filas(html, "municipios-estado");
      expect(trs, hija.ruta).toHaveLength(suyos.length);
      suma += trs.length;
      trs.forEach((tr, i) => {
        const m = suyos[i] as Municipio;
        const [clave, cvegeo, nombre] = celdas(tr);
        expect(clave).toBe(m.cve_mun);
        expect(clave).toMatch(/^\d{3}$/);
        expect(cvegeo).toBe(m.cvegeo);
        expect(nombre).toBe(m.nombre);
      });
      expect(hija.conjunto).toBeNull();
      expect(hija.dataset).toBeNull();
      expect(datosEstructurados(html).filter((n) => n["@type"] === "Dataset")).toHaveLength(0);
      expect(html).toContain("inegi.org.mx");
    }
    expect(suma).toBe(entrada.municipios.registros.length);
  });

  it("tiene migas de tres niveles", () => {
    const { html } = dePagina("/municipios/25-sinaloa/");
    const migas = datosEstructurados(html).find((n) => n["@type"] === "BreadcrumbList") as {
      itemListElement: { name: string }[];
    };
    expect(migas.itemListElement.map((i) => i.name)).toEqual([
      "MéxicoAPI",
      "Municipios",
      "Sinaloa",
    ]);
  });
});

describe("/validar-clabe/", () => {
  it("trae el formulario sin Dataset ni CLABE en la red", () => {
    const { pagina, html } = dePagina(RUTA_VALIDAR_CLABE);
    esperarPagina(pagina, html);
    expect(pagina.conjunto).toBeNull();
    expect(pagina.dataset).toBeNull();
    expect(datosEstructurados(html).filter((n) => n["@type"] === "Dataset")).toHaveLength(0);
    for (const id of ["form-clabe", "entrada-clabe", "resultado-clabe", "estado-catalogo"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<script type="module" src="/sitio.js"></script>');
    // Sin `name`, aunque el formulario se enviara la CLABE no iría en una URL.
    const entradaClabe = /<input[^>]*id="entrada-clabe"[^>]*>/.exec(html)?.[0] as string;
    expect(entradaClabe).not.toMatch(/\sname=/);
    expect(html).toMatch(/<form[^>]*id="form-clabe"[^>]*\shidden/);
    expect(html).not.toMatch(/<form[^>]*\saction=/);
  });

  it("explica qué revisa y qué no, y que la CLABE no sale de la página", () => {
    const { html } = dePagina(RUTA_VALIDAR_CLABE);
    expect(html).toMatch(/formato, el dígito verificador y el banco/);
    expect(html).toMatch(/no confirma que la cuenta exista/i);
    expect(html).toMatch(/no sale de tu equipo/);
    expect(html).toContain("/descargas/bancos.json");
  });

  it("enlaza el catálogo de bancos y la fuente de su fecha", () => {
    const { pagina } = dePagina(RUTA_VALIDAR_CLABE);
    expect(pagina.descargas.map((d) => d.archivo)).toEqual(["bancos.json"]);
    expect(pagina.datosAl).toBe(entrada.bancos.meta.as_of);
    expect(pagina.relacionadas).toEqual([RUTA_BANCOS]);
  });
});

/** Un catálogo mínimo, para los casos que los datos reales no traen. */
function pequena(): EntradaCatalogos {
  const banco = (codigo: string, extra: Partial<Banco> = {}): Banco => ({
    codigo,
    codigo_spei: `4${codigo}`,
    nombre_corto: `BANCO ${codigo}`,
    razon_social: null,
    sector: null,
    tipo: "banca_multiple",
    participacion: "directa",
    activo: true,
    baja_detectada: null,
    historial: [
      {
        codigo_spei: `4${codigo}`,
        nombre_corto: `BANCO ${codigo}`,
        desde: "2012-05-01",
        hasta: null,
      },
    ],
    ...extra,
  });
  const { meta } = entrada.bancos;
  return {
    bancos: {
      meta,
      registros: [
        banco("040", { razon_social: "Razón & Cía." }),
        banco("041", { activo: false, baja_detectada: "2020-03-01" }),
        banco("042", {
          activo: false,
          historial: [
            {
              codigo_spei: "4042",
              nombre_corto: "VIEJO",
              desde: "2010-01-01",
              hasta: "2012-05-01",
            },
            { codigo_spei: "4042", nombre_corto: "BANCO 042", desde: "2012-05-01", hasta: null },
          ],
        }),
      ],
    },
    estados: {
      meta: { ...entrada.estados.meta, as_of: "2026-10-20" },
      registros: [
        { cve_ent: "09", nombre: "Ciudad de México", abreviatura: "CDMX", cvegeo: "09" },
        { cve_ent: "10", nombre: "Durango", abreviatura: "Dgo.", cvegeo: "10" },
      ],
    },
    municipios: {
      meta: { ...entrada.municipios.meta, as_of: "2026-10-18" },
      registros: [
        {
          cvegeo: "09002",
          cve_ent: "09",
          cve_mun: "002",
          nombre: "Azcapotzalco",
          cve_cabecera: null,
        },
        { cvegeo: "10001", cve_ent: "10", cve_mun: "001", nombre: "Durango", cve_cabecera: "0001" },
      ],
    },
  };
}

describe("con un catálogo pequeño", () => {
  it("bancos: ejemplo del primero si no hay 012, razón social e inactivos con y sin baja", () => {
    const paginas = paginasDeCatalogos(pequena());
    const registro = registrarPaginas(paginas);
    const bancos = paginas[0] as PaginaDatos;
    const html = paginaDeDatos(bancos, registro, DESCARGAS);
    expect(bancos.consultas).toEqual(["/v1/bancos", "/v1/bancos/040"]);
    expect(html).toContain("3 instituciones: 1 activas y 2 inactivas");
    expect(html).toContain("Razón &amp; Cía.");
    expect(html).toContain("baja detectada el 2020-03-01");
    expect(filas(html, "bancos-tabla")[2]).not.toContain("baja detectada");
    expect(bancos.conjunto?.coberturaTemporal).toBe("2010-01-01/..");
  });

  it("municipios: ejemplo del primer estado si no está el 25, la fecha más reciente y sin municipios", () => {
    const paginas = paginasDeCatalogos(pequena());
    const municipios = paginas[2] as PaginaDatos;
    expect(municipios.consultas).toContain("/v1/estados/09/municipios");
    expect(municipios.datosAl).toBe("2026-10-20");
    const otra = pequena();
    otra.estados.meta.as_of = "2026-10-01";
    expect(paginasDeCatalogos(otra)[2]?.datosAl).toBe("2026-10-18");
    const sinDurango = pequena();
    sinDurango.municipios = {
      ...sinDurango.municipios,
      registros: sinDurango.municipios.registros.slice(0, 1),
    };
    expect(() => paginasDeCatalogos(sinDurango)).toThrow(/estado 10 no tiene municipios/);
  });

  it("la Ciudad de México habla de alcaldías", () => {
    const paginas = paginasDeCatalogos(pequena());
    const registro = registrarPaginas(paginas);
    const cdmx = paginas.find((p) => p.ruta === "/municipios/09-ciudad-de-mexico/") as PaginaDatos;
    const html = paginaDeDatos(cdmx, registro, DESCARGAS);
    expect(cdmx.h1).toBe("Alcaldías de Ciudad de México: claves INEGI y CVEGEO");
    expect(html).toContain("tiene 1 alcaldías");
    const durango = paginas.find((p) => p.ruta === "/municipios/10-durango/") as PaginaDatos;
    expect(durango.h1).toMatch(/^Municipios de Durango/);
  });

  it("un estado sin municipios en la tabla cuenta cero", () => {
    const sin = pequena();
    sin.estados = {
      ...sin.estados,
      registros: [
        ...sin.estados.registros,
        { cve_ent: "11", nombre: "Otro", abreviatura: "O", cvegeo: "11" },
      ],
    };
    const municipios = paginaMunicipios(sin.estados, sin.municipios);
    expect(municipios.contenido).toContain('Otro</a></td><td class="num">0</td>');
  });
});
