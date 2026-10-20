import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  crearCalendario,
  type DiaInhabilCurado,
  diasDescansoLft,
  FUENTE_LFT_74,
  type FuenteDof,
  sumarDiasHabiles,
  VIGENCIA_LFT,
  validarClabe,
} from "@mexicoapi/core";
import { URL_API } from "@mexicoapi/core/problemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonCanonico, sha256Hex } from "../../src/canonico.js";
import { type ShardCalendario, shardCalendario } from "../../src/curado/calendario.js";
import { curarDatos } from "../../src/curado/curar.js";
import { leerCurado } from "../../src/curado/leer.js";
import {
  CURADOS,
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
} from "../../src/curado/registro.js";
import { ErrorDatos } from "../../src/errores.js";
import { DATASETS } from "../../src/registro.js";
import { coberturasDe, diasLft } from "../../src/sitio/calendarios.js";
import { construirSitio } from "../../src/sitio/construir.js";
import { FRESCURA_HORAS, type Meta, type MetaInterna, URL_DOCS } from "../../src/sitio/meta.js";
import {
  RUTA_DIAS_CNBV,
  RUTA_DIAS_LFT,
  RUTA_DIAS_SAT,
} from "../../src/sitio/paginas/dias-inhabiles.js";
import {
  archivoEncabezados,
  CSP_PAGINAS,
  RUTAS_SITIO,
} from "../../src/sitio/paginas/encabezados.js";
import { paginaEstado } from "../../src/sitio/paginas/estado.js";
import { ESTILO } from "../../src/sitio/paginas/estilo.js";
import { FAVICON } from "../../src/sitio/paginas/favicon.js";
import { escaparHtml } from "../../src/sitio/paginas/html.js";
import { CLABE_EJEMPLO, respuestaRecortada } from "../../src/sitio/paginas/inicio.js";
import { paginaNoEncontrada } from "../../src/sitio/paginas/no-encontrado.js";
import { ROBOTS } from "../../src/sitio/paginas/robots.js";
import * as verificar from "../../src/verificar.js";
import { PRUEBA_LENTA } from "../ayudas.js";
import { YAML_CNBV, YAML_ISR, YAML_SALARIO, YAML_SAT, YAML_UMA } from "../curado/ejemplos.js";
import { datosEstructurados } from "./paginas/estructura.js";
import { encabezadosDe, leerReglas } from "./paginas/reglas-cloudflare.js";

/** Las páginas de datos del build, en el orden del registro. */
const PAGINAS_DE_DATOS = [RUTA_DIAS_SAT, RUTA_DIAS_LFT, RUTA_DIAS_CNBV];

const estados = [
  { cve_ent: "01", nombre: "Aguascalientes", abreviatura: "Ags.", cvegeo: "01" },
  { cve_ent: "09", nombre: "Ciudad de México", abreviatura: "CDMX", cvegeo: "09" },
];
const municipios = [
  {
    cvegeo: "01001",
    cve_ent: "01",
    cve_mun: "001",
    nombre: "Aguascalientes",
    cve_cabecera: "0001",
  },
  { cvegeo: "01002", cve_ent: "01", cve_mun: "002", nombre: "Asientos", cve_cabecera: "0001" },
  { cvegeo: "09002", cve_ent: "09", cve_mun: "002", nombre: "Azcapotzalco", cve_cabecera: null },
];
const bancos = [
  {
    codigo: "002",
    codigo_spei: "40002",
    nombre_corto: "BANAMEX",
    razon_social: "Banco Nacional de México, S.A.",
    sector: "Banca múltiple",
    tipo: "banca_multiple",
    participacion: "directa",
    activo: true,
    baja_detectada: null,
    historial: [
      { codigo_spei: "40002", nombre_corto: "BANAMEX", desde: "2010-01-01", hasta: null },
    ],
  },
  {
    codigo: "099",
    codigo_spei: "90099",
    nombre_corto: "VIEJO",
    razon_social: null,
    sector: null,
    tipo: "otra_entidad",
    participacion: "no_confirmada",
    activo: false,
    baja_detectada: "2020-05-01",
    historial: [
      { codigo_spei: "90098", nombre_corto: "ANTES", desde: "2010-01-01", hasta: "2015-01-01" },
      { codigo_spei: "90099", nombre_corto: "VIEJO", desde: "2015-01-01", hasta: "2020-05-01" },
    ],
  },
];

// La serie cruza tres años: el primero y el último se recortan a la cobertura.
const fix = [
  { fecha_publicacion: "2024-12-31", valor: "20.2683" },
  { fecha_publicacion: "2025-01-02", valor: "20.5098" },
  { fecha_publicacion: "2025-12-31", valor: "17.9852" },
  { fecha_publicacion: "2026-01-02", valor: "17.9123" },
  { fecha_publicacion: "2026-10-16", valor: "18.4250" },
];
const udis = [
  { fecha: "2025-12-30", valor: "8.590112" },
  { fecha: "2025-12-31", valor: "8.591234" },
  { fecha: "2026-01-01", valor: "8.592345" },
];

function manifiesto(dataset: string, archivo: string, datos: unknown[]): string {
  return jsonCanonico({
    dataset,
    schema_version: 1,
    as_of: "2026-10-17",
    fetched_at: "2026-10-18T02:51:10.906Z",
    data_file: archivo,
    data_sha256: sha256Hex(jsonCanonico(datos)),
    records: datos.length,
    sources: [
      {
        name: `Fuente de ${dataset}`,
        url: "https://ejemplo.mx/",
        license: "Licencia",
        license_url: "https://ejemplo.mx/licencia",
        citation: "Cita",
        published_at: "2026-09-01",
        raw: [{ file: "raw/x.json", url: "https://ejemplo.mx/x", sha256: "a".repeat(64) }],
      },
    ],
  });
}

async function crearDatos(raiz: string): Promise<void> {
  const conjuntos: [string, string, string, unknown[]][] = [
    ["inegi-estados", "inegi.estados", "estados.json", estados],
    ["inegi-municipios", "inegi.municipios", "municipios.json", municipios],
    ["bancos", "bancos", "bancos.json", bancos],
    ["tipo-cambio-fix", "tipo-cambio.fix", "fix.json", fix],
    ["udis", "udis", "udis.json", udis],
  ];
  for (const [dir, id, archivo, datos] of conjuntos) {
    await mkdir(join(raiz, dir), { recursive: true });
    await writeFile(join(raiz, dir, archivo), jsonCanonico(datos));
    await writeFile(join(raiz, dir, "manifest.json"), manifiesto(id, archivo, datos));
  }
  // Los curados salen de sus YAML de ejemplo con `curar`, como en el repositorio.
  await mkdir(join(raiz, "curado"), { recursive: true });
  for (const [def, yaml] of [
    [curadoDiasCnbv, YAML_CNBV],
    [curadoDiasSat, YAML_SAT],
    [curadoUma, YAML_UMA],
    [curadoSalarioMinimo, YAML_SALARIO],
    [curadoTarifasIsr, YAML_ISR],
  ] as const) {
    await writeFile(join(raiz, "curado", def.yaml), yaml);
  }
  const { problemas } = await curarDatos(raiz);
  if (problemas.length > 0) throw new Error(problemas.join("; "));
}

async function listar(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  return entradas
    .filter((e) => !e.isDirectory())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

const leerJson = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));

let raiz: string;
let datos: string;
let salida: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "construir-"));
  datos = join(raiz, "data");
  salida = join(raiz, "salida");
  await crearDatos(datos);
  // Los datos mínimos de la prueba no cumplen los invariantes de tamaño de los datasets reales.
  vi.spyOn(verificar, "verificarDatos").mockResolvedValue([]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(raiz, { recursive: true, force: true });
});

describe("construirSitio", { timeout: PRUEBA_LENTA }, () => {
  it("genera exactamente la estructura de archivos", async () => {
    const resultado = await construirSitio({ raizDatos: datos, salida });
    const archivos = await listar(salida);
    expect(archivos).toEqual(
      [
        "404.html",
        "_headers",
        "descargas/SHA256SUMS",
        "descargas/bancos-historial.csv",
        "descargas/bancos.csv",
        "descargas/bancos.json",
        "descargas/bancos.manifest.json",
        "descargas/constantes-salario-minimo.csv",
        "descargas/constantes-salario-minimo.json",
        "descargas/constantes-salario-minimo.manifest.json",
        "descargas/constantes-uma.csv",
        "descargas/constantes-uma.json",
        "descargas/constantes-uma.manifest.json",
        "descargas/dias-inhabiles-cnbv.csv",
        "descargas/dias-inhabiles-cnbv.json",
        "descargas/dias-inhabiles-cnbv.manifest.json",
        "descargas/dias-inhabiles-coberturas.csv",
        "descargas/dias-inhabiles-coberturas.json",
        "descargas/dias-inhabiles-lft.csv",
        "descargas/dias-inhabiles-lft.json",
        "descargas/dias-inhabiles-sat.csv",
        "descargas/dias-inhabiles-sat.json",
        "descargas/dias-inhabiles-sat.manifest.json",
        "descargas/inegi-estados.csv",
        "descargas/inegi-estados.json",
        "descargas/inegi-estados.manifest.json",
        "descargas/inegi-municipios.csv",
        "descargas/inegi-municipios.json",
        "descargas/inegi-municipios.manifest.json",
        "descargas/isr-tarifas.csv",
        "descargas/isr-tarifas.json",
        "descargas/isr-tarifas.manifest.json",
        "descargas/mexicoapi.sqlite",
        "descargas/tipo-cambio-fix.csv",
        "descargas/tipo-cambio-fix.json",
        "descargas/tipo-cambio-fix.manifest.json",
        "descargas/udis.csv",
        "descargas/udis.json",
        "descargas/udis.manifest.json",
        "dias-de-descanso-obligatorio/index.html",
        "dias-inhabiles-bancarios/index.html",
        "dias-inhabiles-sat/index.html",
        "estado/index.html",
        "estilo.css",
        "favicon.svg",
        "index.html",
        "llms-full.txt",
        "llms.txt",
        "robots.txt",
        "sitemap.xml",
        "sitio.js",
        "v1/_internos/calendarios/cnbv.json",
        "v1/_internos/calendarios/sat.json",
        "v1/_internos/constantes.json",
        "v1/_internos/fix/2024.json",
        "v1/_internos/fix/2025.json",
        "v1/_internos/fix/2026.json",
        "v1/_internos/meta.json",
        "v1/_internos/udis/2025.json",
        "v1/_internos/udis/2026.json",
        "v1/bancos.json",
        "v1/bancos/002.json",
        "v1/bancos/099.json",
        "v1/constantes/salario-minimo/2025.json",
        "v1/constantes/salario-minimo/2026.json",
        "v1/constantes/uma.json",
        "v1/constantes/uma/2025.json",
        "v1/constantes/uma/2026.json",
        "v1/estados.json",
        "v1/estados/01.json",
        "v1/estados/01/municipios.json",
        "v1/estados/09.json",
        "v1/estados/09/municipios.json",
        "v1/isr/tarifa/anual/2025.json",
        "v1/isr/tarifa/anual/2026.json",
        "v1/isr/tarifa/mensual/2026.json",
        "v1/municipios.json",
        "v1/municipios/01001.json",
        "v1/municipios/01002.json",
        "v1/municipios/09002.json",
        "v1/openapi.json",
      ].sort(),
    );
    expect(resultado.archivos).toBe(archivos.length);
    expect(resultado.bytes).toBeGreaterThan(0);
  });

  it("escribe el documento OpenAPI con sangría de 2 espacios", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const texto = await readFile(join(salida, "v1", "openapi.json"), "utf8");
    expect(texto).toBe(`${JSON.stringify(JSON.parse(texto), null, 2)}
`);
    expect(JSON.parse(texto).openapi).toBe("3.1.0");
  });

  it("escribe shards minificados con data y meta", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const texto = await readFile(join(salida, "v1/estados/01.json"), "utf8");
    expect(texto.startsWith('{"data":{"cve_ent":"01","nombre":"Aguascalientes"')).toBe(true);
    expect(texto).not.toMatch(/\n/);
    const lista = await leerJson(join(salida, "v1/bancos.json"));
    expect(lista.data).toEqual(bancos);
    const uno = await leerJson(join(salida, "v1/bancos/099.json"));
    expect(uno.data).toEqual(bancos[1]);
    expect(uno.meta.dataset).toBe("bancos");
  });

  it("los municipios de un estado son solo los suyos y llevan la meta de municipios", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const de01 = await leerJson(join(salida, "v1/estados/01/municipios.json"));
    expect(de01.data.map((m: { cvegeo: string }) => m.cvegeo)).toEqual(["01001", "01002"]);
    expect(de01.meta.dataset).toBe("inegi.municipios");
    const de09 = await leerJson(join(salida, "v1/estados/09/municipios.json"));
    expect(de09.data).toEqual([municipios[2]]);
  });

  it("meta trae docs y fuentes sin published_at ni raw", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const { meta } = (await leerJson(join(salida, "v1/estados.json"))) as { meta: Meta };
    expect(meta).toEqual({
      dataset: "inegi.estados",
      as_of: "2026-10-17",
      sources: [
        {
          name: "Fuente de inegi.estados",
          url: "https://ejemplo.mx/",
          license: "Licencia",
          license_url: "https://ejemplo.mx/licencia",
          citation: "Cita",
        },
      ],
      docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/inegi-estados.md",
    });
  });

  it("meta interna trae registros, hash y frescura", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    expect(Object.keys(interna.datasets).sort()).toEqual([
      "bancos",
      "inegi.estados",
      "inegi.municipios",
      "tipo-cambio.fix",
      "udis",
    ]);
    expect(interna.datasets.bancos).toMatchObject({ records: 2, frescura_horas: 72 });
    expect(interna.datasets["inegi.estados"]).toMatchObject({
      records: 2,
      frescura_horas: 216,
      data_sha256: sha256Hex(jsonCanonico(estados)),
    });
    expect(interna.datasets["inegi.municipios"]?.meta.dataset).toBe("inegi.municipios");
    expect(interna.datasets["tipo-cambio.fix"]).toMatchObject({ records: 5, frescura_horas: 72 });
    expect(interna.datasets["tipo-cambio.fix"]?.meta.docs).toBe(
      "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/tipo-cambio-fix.md",
    );
  });

  it("meta interna trae la cobertura solo de las series", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    expect(interna.datasets["tipo-cambio.fix"]?.cobertura).toEqual({
      desde: "2024-12-31",
      hasta: "2026-10-16",
    });
    expect(interna.datasets.udis?.cobertura).toEqual({ desde: "2025-12-30", hasta: "2026-01-01" });
    for (const id of ["bancos", "inegi.estados", "inegi.municipios"]) {
      expect(interna.datasets[id], id).not.toHaveProperty("cobertura");
    }
  });

  it("escribe un shard minificado por año de cada serie, con su tramo", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const texto = await readFile(join(salida, "v1/_internos/fix/2024.json"), "utf8");
    expect(texto).toBe(
      '{"tramo":{"desde":"2024-12-31","hasta":"2024-12-31"},"datos":[{"fecha_publicacion":"2024-12-31","valor":"20.2683"}]}',
    );
    expect(await leerJson(join(salida, "v1/_internos/fix/2025.json"))).toEqual({
      tramo: { desde: "2025-01-01", hasta: "2025-12-31" },
      datos: [fix[1], fix[2]],
    });
    expect(await leerJson(join(salida, "v1/_internos/fix/2026.json"))).toEqual({
      tramo: { desde: "2026-01-01", hasta: "2026-10-16" },
      datos: [fix[3], fix[4]],
    });
    expect(await leerJson(join(salida, "v1/_internos/udis/2025.json"))).toEqual({
      tramo: { desde: "2025-12-30", hasta: "2025-12-31" },
      datos: [udis[0], udis[1]],
    });
    expect(await leerJson(join(salida, "v1/_internos/udis/2026.json"))).toEqual({
      tramo: { desde: "2026-01-01", hasta: "2026-01-01" },
      datos: [udis[2]],
    });
  });

  it("meta interna lleva los curados aparte, sin frescura, para que /v1/status siga igual", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    expect(Object.keys(interna)).toEqual(["datasets", "curados"]);
    expect(Object.keys(interna.curados).sort()).toEqual(CURADOS.map((d) => d.id).sort());
    for (const def of CURADOS) {
      const m = await leerJson(join(datos, def.directorio, "manifest.json"));
      expect(interna.curados[def.id], def.id).toEqual({
        meta: {
          dataset: def.id,
          as_of: m.as_of,
          sources: m.sources.map(
            ({ name, url, license, license_url, citation }: Record<string, string>) => ({
              name,
              url,
              license,
              license_url,
              citation,
            }),
          ),
          docs: `${URL_DOCS}/datos/${def.directorio}.md`,
        },
        records: m.records,
        data_sha256: m.data_sha256,
      });
    }
    expect(interna.curados["constantes.uma"]?.meta.sources.map((f) => f.license)).toEqual([
      "Términos de libre uso de la información del INEGI",
      "Términos de libre uso de la información del INEGI",
    ]);
  });

  it("escribe el calendario interno de cada autoridad, minificado, listo para crearCalendario", async () => {
    await construirSitio({ raizDatos: datos, salida });
    for (const [def, autoridad] of [
      [curadoDiasCnbv, "cnbv"],
      [curadoDiasSat, "sat"],
    ] as const) {
      const texto = await readFile(
        join(salida, `v1/_internos/calendarios/${autoridad}.json`),
        "utf8",
      );
      expect(texto, autoridad).not.toMatch(/\n/);
      const lectura = await leerCurado(def, datos);
      const registros = (await leerJson(
        join(datos, def.directorio, def.archivo),
      )) as DiaInhabilCurado[];
      expect(JSON.parse(texto), autoridad).toEqual(
        shardCalendario(autoridad, registros, lectura?.documento?.cobertura ?? null),
      );
    }
    const sat = (await leerJson(
      join(salida, "v1/_internos/calendarios/sat.json"),
    )) as ShardCalendario;
    const calendario = (tipo: "general" | "declaraciones_pagos") => {
      const plazo = sat.plazos[tipo] as NonNullable<ShardCalendario["plazos"][typeof tipo]>;
      return crearCalendario({
        autoridad: sat.autoridad,
        cobertura: plazo.cobertura,
        dias: sat.dias.filter(
          (d) => d.fecha >= plazo.cobertura.desde && d.fecha <= plazo.cobertura.hasta,
        ),
        fuenteFinDeSemana: (anio) => sat.fuentes_fin_de_semana[String(anio)] as FuenteDof,
        excluirTipos: plazo.excluir_tipos,
      });
    };
    // El ejemplo trae el 20 de julio como vacaciones.
    const desde = "2026-07-17";
    expect(sumarDiasHabiles({ calendario: calendario("general"), desde, dias: 1 }).resultado).toBe(
      "2026-07-21",
    );
    expect(
      sumarDiasHabiles({ calendario: calendario("declaraciones_pagos"), desde, dias: 1 }).resultado,
    ).toBe("2026-07-20");
  });

  it("escribe los shards de constantes con data y la meta de su curado", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    const meta = (id: string) => interna.curados[id]?.meta;
    const uma = (await leerJson(join(datos, "constantes-uma/uma.json"))) as Array<{ anio: number }>;
    const lista = await leerJson(join(salida, "v1/constantes/uma.json"));
    expect(lista).toEqual({ data: uma, meta: meta("constantes.uma") });
    expect(lista.data.map((u: { anio: number }) => u.anio)).toEqual([2025, 2026]);
    expect(await leerJson(join(salida, "v1/constantes/uma/2026.json"))).toEqual({
      data: uma[1],
      meta: meta("constantes.uma"),
    });
    const texto = await readFile(join(salida, "v1/constantes/uma/2026.json"), "utf8");
    expect(texto.startsWith('{"data":{"anio":2026,"diaria":"117.31"')).toBe(true);

    const salario = await leerJson(join(salida, "v1/constantes/salario-minimo/2026.json"));
    expect(salario.meta).toEqual(meta("constantes.salario-minimo"));
    expect(salario.data.map((s: Record<string, string>) => [s.zona, s.diario])).toEqual([
      ["general", "315.04"],
      ["zlfn", "440.87"],
    ]);

    const tarifas = (await leerJson(join(datos, "isr-tarifas/tarifas.json"))) as Array<{
      anio: number;
      periodo: string;
    }>;
    for (const t of tarifas) {
      const shard = await leerJson(join(salida, `v1/isr/tarifa/${t.periodo}/${t.anio}.json`));
      expect(shard, `${t.periodo} ${t.anio}`).toEqual({ data: t, meta: meta("isr.tarifas") });
    }
    // Los años de cada carpeta: el Worker distingue un año anterior a los datos de uno que
    // todavía no se carga.
    expect(await leerJson(join(salida, "v1/_internos/constantes.json"))).toEqual({
      "constantes/salario-minimo": [2025, 2026],
      "constantes/uma": [2025, 2026],
      "isr/tarifa/anual": [2025, 2026],
      "isr/tarifa/mensual": [2026],
    });
    const mensual = await leerJson(join(salida, "v1/isr/tarifa/mensual/2026.json"));
    expect(mensual.data.tramos).toHaveLength(11);
    expect(mensual.data.tramos.at(-1)).toEqual({
      limite_inferior: "425642.00",
      limite_superior: null,
      cuota_fija: "133488.54",
      tasa_excedente: "35.00",
    });
  });

  it("los csv de los curados aplanan la fuente en columnas fuente_*", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const renglones = async (n: string) =>
      (await readFile(join(salida, "descargas", n), "utf8")).split("\r\n");
    const fuente = "fuente_nombre,fuente_url,fuente_fecha_publicacion,fuente_fragmento";

    const sat = await renglones("dias-inhabiles-sat.csv");
    expect(sat[0]).toBe(`fecha,autoridad,motivo,tipo,${fuente}`);
    // Las 4 vacaciones del YAML y los 8 días del art. 12 de 2026 que agrega la regla.
    expect(sat).toHaveLength(12 + 2);
    expect(sat.at(-1)).toBe("");
    expect(sat[1]).toBe(
      '2026-01-01,sat,1o. de enero,descanso,"Código Fiscal de la Federación, artículo 12",' +
        "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf,2026-04-09," +
        '"Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; el primer lunes de febrero en conmemoración del 5 de febrero; el tercer lunes de marzo en conmemoración del 21 de marzo; el 1o. y 5 de mayo; el 16 de septiembre; el tercer lunes de noviembre en conmemoración del 20 de noviembre; el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo y el 25 de diciembre."',
    );
    expect((await renglones("dias-inhabiles-cnbv.csv"))[0]).toBe(
      `fecha,autoridad,motivo,tipo,${fuente}`,
    );

    // La LFT no tiene dataset: su lista se calcula por regla, de 2007 a 2100, con la cita del
    // art. 74 y la fecha de la última reforma de la ley.
    const lft = await renglones("dias-inhabiles-lft.csv");
    expect(lft[0]).toBe(`fecha,autoridad,motivo,tipo,${fuente}`);
    expect(lft).toHaveLength(diasLft().length + 2);
    // Antes del 2024-10-01, el texto de la reforma de 2006; después, el vigente.
    const de2006 = diasDescansoLft(2007)[0]?.fuente;
    expect(lft[1]).toBe(
      `2007-01-01,lft,1 de enero,descanso,"Ley Federal del Trabajo, artículo 74",https://www.diputados.gob.mx/LeyesBiblio/ref/lft/LFT_ref24_17ene06.pdf,2006-01-17,"${de2006?.fragmento}"`,
    );
    expect(lft.find((r) => r.startsWith("2024-10-01,"))).toBe(
      `2024-10-01,lft,"1 de octubre de cada seis años, transmisión del Poder Ejecutivo Federal",descanso,"Ley Federal del Trabajo, artículo 74",https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf,${VIGENCIA_LFT},"${FUENTE_LFT_74.fragmento}"`,
    );
    expect(lft.at(-2)?.startsWith("2100-12-25,lft,25 de diciembre,descanso,")).toBe(true);
    const json = await readFile(join(salida, "descargas/dias-inhabiles-lft.json"), "utf8");
    expect(json).toBe(jsonCanonico(diasLft()));
    const encabezados = await readFile(join(salida, "_headers"), "utf8");
    expect(encabezados).toContain(
      "/descargas/dias-inhabiles-lft.json\n  Content-Type: application/json; charset=utf-8",
    );
    expect(encabezados).toContain(
      "/descargas/dias-inhabiles-lft.csv\n  Content-Type: text/csv; charset=utf-8",
    );

    const uma = await renglones("constantes-uma.csv");
    expect(uma[0]).toBe(`anio,diaria,mensual,anual,vigencia_desde,${fuente}`);
    expect(uma[1]).toMatch(
      /^2025,113\.14,3439\.46,41273\.52,2025-02-01,INEGI\. Unidad de medida y actualización,https:\/\/dof\.gob\.mx\/nota_detalle\.php\?codigo=5746930&fecha=10\/01\/2025,2025-01-10,"\[\.\.\.\] es de \$113\.14/,
    );

    const salario = await renglones("constantes-salario-minimo.csv");
    expect(salario[0]).toBe(`anio,zona,diario,vigencia_desde,${fuente}`);
    expect(salario.slice(1, 5).map((r) => r.split(",").slice(0, 4).join(","))).toEqual([
      "2025,general,278.80,2025-01-01",
      "2025,zlfn,419.88,2025-01-01",
      "2026,general,315.04,2026-01-01",
      "2026,zlfn,440.87,2026-01-01",
    ]);

    const isr = await renglones("isr-tarifas.csv");
    expect(isr[0]).toBe(
      `anio,periodo,tramo,limite_inferior,limite_superior,cuota_fija,tasa_excedente,${fuente}`,
    );
    expect(isr).toHaveLength(33 + 2);
    expect(isr[1]?.startsWith("2025,anual,1,0.01,8952.49,0.00,1.92,")).toBe(true);
    expect(isr[11]?.startsWith("2025,anual,11,4511707.38,,1414947.85,35.00,")).toBe(true);
    expect(isr[33]?.startsWith("2026,mensual,11,425642.00,,133488.54,35.00,")).toBe(true);
  });

  it("publica la cobertura de cada calendario por tipo de plazo en json, csv y sqlite", async () => {
    await construirSitio({ raizDatos: datos, salida });
    // La LFT y la CNBV no aceptan tipo_plazo en la API: su renglón no nombra ninguno.
    const esperadas = [
      { autoridad: "lft", tipo_plazo: null, desde: "2007-01-01", hasta: "2100-12-31" },
      { autoridad: "cnbv", tipo_plazo: null, desde: "2026-01-01", hasta: "2026-12-31" },
      { autoridad: "sat", tipo_plazo: "general", desde: "2026-01-01", hasta: "2026-11-30" },
      {
        autoridad: "sat",
        tipo_plazo: "declaraciones_pagos",
        desde: "2026-01-01",
        hasta: "2026-12-31",
      },
    ];
    const json = await readFile(join(salida, "descargas/dias-inhabiles-coberturas.json"), "utf8");
    expect(json).toBe(jsonCanonico(esperadas));
    expect(await readFile(join(salida, "descargas/dias-inhabiles-coberturas.csv"), "utf8")).toBe(
      "autoridad,tipo_plazo,desde,hasta\r\n" +
        "lft,,2007-01-01,2100-12-31\r\n" +
        "cnbv,,2026-01-01,2026-12-31\r\n" +
        "sat,general,2026-01-01,2026-11-30\r\n" +
        "sat,declaraciones_pagos,2026-01-01,2026-12-31\r\n",
    );
    // Es la cobertura de la lista descargable. En la CNBV es la misma que usa el Worker; en el
    // SAT, el Worker calcula los días del art. 12 hasta 2100 y su declaraciones_pagos llega ahí.
    const delWorker = async (autoridad: string) =>
      coberturasDe(
        (await leerJson(
          join(salida, `v1/_internos/calendarios/${autoridad}.json`),
        )) as ShardCalendario,
      );
    expect(await delWorker("cnbv")).toEqual(esperadas.slice(1, 2));
    expect(await delWorker("sat")).toEqual([
      esperadas[2],
      { ...esperadas[3], hasta: "2100-12-31" },
    ]);
    const db = new DatabaseSync(join(salida, "descargas/mexicoapi.sqlite"), { readOnly: true });
    expect(
      db.prepare("SELECT * FROM coberturas_calendario ORDER BY autoridad, tipo_plazo").all(),
    ).toEqual([esperadas[1], esperadas[0], esperadas[3], esperadas[2]]);
    db.close();
    const encabezados = await readFile(join(salida, "_headers"), "utf8");
    expect(encabezados).toContain(
      "/descargas/dias-inhabiles-coberturas.json\n  Content-Type: application/json; charset=utf-8",
    );
    expect(encabezados).toContain(
      "/descargas/dias-inhabiles-coberturas.csv\n  Content-Type: text/csv; charset=utf-8",
    );
    const sumas = await readFile(join(salida, "descargas/SHA256SUMS"), "utf8");
    expect(sumas).toContain(`${sha256Hex(json)}  dias-inhabiles-coberturas.json\n`);
  });

  it("falla con ErrorDatos si falta un curado o su YAML", async () => {
    await rm(join(datos, "curado", "dias-inhabiles-sat.yaml"));
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      name: "ErrorDatos",
      dataset: "dias-inhabiles.sat",
      message: expect.stringContaining("curado/dias-inhabiles-sat.yaml"),
    });
    await writeFile(join(datos, "curado", curadoDiasSat.yaml), YAML_SAT);
    await writeFile(join(datos, "curado", curadoDiasCnbv.yaml), "dataset: dias-inhabiles.cnbv\n");
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      name: "ErrorDatos",
      dataset: "dias-inhabiles.cnbv",
      message: expect.stringMatching(/^curado\/dias-inhabiles-cnbv\.yaml: .*cobertura: falta/),
    });
    await writeFile(join(datos, "curado", curadoDiasCnbv.yaml), YAML_CNBV);
    await rm(join(datos, "constantes-uma"), { recursive: true });
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      name: "ErrorDatos",
      dataset: "constantes.uma",
    });
    await expect(readdir(salida)).rejects.toThrow();
  });

  it("falla sin escribir si una serie no está en orden por fecha", async () => {
    const desordenada = [fix[1], fix[0], ...fix.slice(2)];
    await writeFile(join(datos, "tipo-cambio-fix/fix.json"), jsonCanonico(desordenada));
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      name: "ErrorDatos",
      dataset: "tipo-cambio.fix",
    });
    await expect(readdir(salida)).rejects.toThrow();
  });

  it("las descargas json y manifiesto son idénticas byte a byte a data/", async () => {
    await construirSitio({ raizDatos: datos, salida });
    for (const [dir, archivo] of [
      ["inegi-estados", "estados.json"],
      ["inegi-municipios", "municipios.json"],
      ["bancos", "bancos.json"],
      ["tipo-cambio-fix", "fix.json"],
      ["udis", "udis.json"],
      ...CURADOS.map((d) => [d.directorio, d.archivo] as const),
    ] as const) {
      expect(await readFile(join(salida, "descargas", `${dir}.json`))).toEqual(
        await readFile(join(datos, dir, archivo)),
      );
      expect(await readFile(join(salida, "descargas", `${dir}.manifest.json`))).toEqual(
        await readFile(join(datos, dir, "manifest.json")),
      );
    }
  });

  it("los csv llevan las columnas del contrato", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const csv = (n: string) => readFile(join(salida, "descargas", n), "utf8");
    expect(await csv("inegi-estados.csv")).toBe(
      "cve_ent,nombre,abreviatura,cvegeo\r\n01,Aguascalientes,Ags.,01\r\n09,Ciudad de México,CDMX,09\r\n",
    );
    expect((await csv("inegi-municipios.csv")).split("\r\n")[0]).toBe(
      "cvegeo,cve_ent,cve_mun,nombre,cve_cabecera",
    );
    expect((await csv("inegi-municipios.csv")).split("\r\n")[3]).toBe("09002,09,002,Azcapotzalco,");
    expect(await csv("bancos.csv")).toBe(
      "codigo,codigo_spei,nombre_corto,razon_social,sector,tipo,participacion,activo,baja_detectada\r\n" +
        '002,40002,BANAMEX,"Banco Nacional de México, S.A.",Banca múltiple,banca_multiple,directa,true,\r\n' +
        "099,90099,VIEJO,,,otra_entidad,no_confirmada,false,2020-05-01\r\n",
    );
    expect(await csv("bancos-historial.csv")).toBe(
      "codigo,codigo_spei,nombre_corto,desde,hasta\r\n" +
        "002,40002,BANAMEX,2010-01-01,\r\n" +
        "099,90098,ANTES,2010-01-01,2015-01-01\r\n" +
        "099,90099,VIEJO,2015-01-01,2020-05-01\r\n",
    );
    expect(await csv("tipo-cambio-fix.csv")).toBe(
      "fecha_publicacion,valor\r\n" +
        "2024-12-31,20.2683\r\n2025-01-02,20.5098\r\n2025-12-31,17.9852\r\n" +
        "2026-01-02,17.9123\r\n2026-10-16,18.4250\r\n",
    );
    expect(await csv("udis.csv")).toBe(
      "fecha,valor\r\n2025-12-30,8.590112\r\n2025-12-31,8.591234\r\n2026-01-01,8.592345\r\n",
    );
  });

  it("el sqlite trae todos los datasets", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const db = new DatabaseSync(join(salida, "descargas/mexicoapi.sqlite"), { readOnly: true });
    expect(db.prepare("SELECT dataset, records FROM datasets ORDER BY dataset").all()).toEqual([
      { dataset: "bancos", records: 2 },
      { dataset: "constantes.salario-minimo", records: 4 },
      { dataset: "constantes.uma", records: 2 },
      { dataset: "dias-inhabiles.cnbv", records: 11 },
      // Las 4 vacaciones del YAML y los 8 días del art. 12 de 2026.
      { dataset: "dias-inhabiles.sat", records: 12 },
      { dataset: "inegi.estados", records: 2 },
      { dataset: "inegi.municipios", records: 3 },
      { dataset: "isr.tarifas", records: 3 },
      { dataset: "tipo-cambio.fix", records: 5 },
      { dataset: "udis", records: 3 },
    ]);
    const cuenta = (tabla: string) =>
      (db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
    // 11 de la CNBV, 12 del SAT (sus 4 vacaciones y los 8 días del art. 12 de 2026) y los de la
    // LFT de 2007 a 2100.
    expect(["dias_inhabiles", "uma", "salario_minimo", "isr_tramos"].map(cuenta)).toEqual([
      23 + diasLft().length,
      2,
      4,
      33,
    ]);
    expect(
      db
        .prepare(
          "SELECT min(fecha) AS desde, max(fecha) AS hasta, count(*) AS n FROM dias_inhabiles WHERE autoridad = 'lft'",
        )
        .get(),
    ).toEqual({ desde: "2007-01-01", hasta: "2100-12-25", n: 673 });
    expect(
      db
        .prepare(
          "SELECT autoridad, fecha, tipo, fuente_url FROM dias_inhabiles WHERE autoridad = 'sat' AND fecha = '2026-07-20'",
        )
        .get(),
    ).toEqual({
      autoridad: "sat",
      fecha: "2026-07-20",
      tipo: "vacaciones",
      fuente_url: "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
    });
    expect(
      db
        .prepare(
          "SELECT limite_inferior, limite_superior, cuota_fija FROM isr_tramos WHERE anio = 2025 AND periodo = 'anual' AND tramo = 11",
        )
        .get(),
    ).toEqual({ limite_inferior: "4511707.38", limite_superior: null, cuota_fija: "1414947.85" });
    expect(db.prepare("SELECT * FROM tipo_cambio_fix ORDER BY fecha_publicacion").all()).toEqual(
      fix,
    );
    expect(db.prepare("SELECT * FROM udis ORDER BY fecha").all()).toEqual(udis);
    db.close();
  });

  it("SHA256SUMS lista cada descarga ordenada, sin él mismo", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const sumas = await readFile(join(salida, "descargas/SHA256SUMS"), "utf8");
    const descargas = (await listar(join(salida, "descargas"))).filter((n) => n !== "SHA256SUMS");
    const esperado = await Promise.all(
      descargas.map(
        async (n) => `${sha256Hex(await readFile(join(salida, "descargas", n)))}  ${n}\n`,
      ),
    );
    expect(sumas).toBe(esperado.join(""));
  });

  it("_headers une las reglas de las descargas y del sitio sin choques", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const texto = await readFile(join(salida, "_headers"), "utf8");
    const descargas = await listar(join(salida, "descargas"));
    expect(texto).toBe(archivoEncabezados(descargas, PAGINAS_DE_DATOS));
    const reglas = leerReglas(texto);
    expect(reglas.length).toBeLessThanOrEqual(100);
    for (const linea of texto.split("\n")) expect(linea.length).toBeLessThanOrEqual(2000);
    const rutas = descargas.map((n) => `/descargas/${n}`);
    expect(reglas.map((r) => r.ruta)).toEqual([
      "/*",
      ...rutas,
      ...RUTAS_SITIO,
      ...PAGINAS_DE_DATOS,
    ]);
    // Cada página de datos lleva la CSP de las páginas: sin su regla, solo tendría la de /*.
    for (const ruta of PAGINAS_DE_DATOS) {
      expect(texto, ruta).toContain(`\n${ruta}\n  Content-Security-Policy: ${CSP_PAGINAS}\n`);
    }
    // Ninguna ruta recibe el mismo encabezado de dos reglas (Cloudflare los juntaría con coma).
    for (const ruta of [...rutas, ...RUTAS_SITIO, ...PAGINAS_DE_DATOS]) {
      for (const [nombre, valores] of encabezadosDe(reglas, ruta)) {
        expect(valores, `${ruta} ${nombre}`).toHaveLength(1);
      }
    }
    expect(texto).toContain(
      "/descargas/inegi-estados.json\n  Content-Type: application/json; charset=utf-8",
    );
    expect(texto).toContain("/descargas/bancos.csv\n  Content-Type: text/csv; charset=utf-8");
    expect(texto).toContain("/descargas/mexicoapi.sqlite\n  Content-Type: application/vnd.sqlite3");
    expect(texto).toContain("/descargas/SHA256SUMS\n  Content-Type: text/plain; charset=utf-8");
    // Cada descarga lleva los encabezados de seguridad (de /*), CORS y caché.
    for (const ruta of rutas) {
      expect(Object.fromEntries(encabezadosDe(reglas, ruta)), ruta).toMatchObject({
        "access-control-allow-origin": ["*"],
        "x-content-type-options": ["nosniff"],
        "x-frame-options": ["DENY"],
        "content-security-policy": ["default-src 'none'"],
        "cache-control": ["public, max-age=3600, stale-while-revalidate=86400"],
      });
    }
    // Lo que no existe solo recibe /*: ni CORS, ni CSP, ni la caché de las descargas.
    expect(Object.fromEntries(encabezadosDe(reglas, "/descargas/nada.csv"))).toEqual({
      "x-content-type-options": ["nosniff"],
      "referrer-policy": ["no-referrer"],
      "x-frame-options": ["DENY"],
      "strict-transport-security": ["max-age=31536000"],
      vary: ["Accept-Encoding"],
      "permissions-policy": ["camera=(), microphone=(), geolocation=()"],
      "cross-origin-opener-policy": ["same-origin"],
    });
    expect(texto).toContain(`\n/\n  Content-Security-Policy: ${CSP_PAGINAS}\n`);
  });

  it("escribe la página de inicio, el 404, la hoja de estilo, el favicon y robots.txt", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const inicio = await readFile(join(salida, "index.html"), "utf8");
    // Un renglón por dataset, con la fecha de su manifiesto.
    const ids = [...DATASETS.keys(), ...CURADOS.map((c) => c.id)];
    for (const id of ids) expect(inicio, id).toContain(`<span class="id">${id}</span>`);
    expect(inicio.match(/<span class="id">/g)).toHaveLength(ids.length);
    // Los de DATASETS los actualiza el bot; los de CURADOS, una persona.
    expect(inicio.match(/<span class="detalle">Automático<\/span><\/th>/g)).toHaveLength(
      DATASETS.size,
    );
    expect(inicio.match(/<span class="detalle">Curado<\/span><\/th>/g)).toHaveLength(
      CURADOS.length,
    );
    expect(inicio).toContain('<time datetime="2026-10-17">2026-10-17</time>');
    expect(inicio).toContain("Fuente de inegi.estados");
    // Cada descarga aparece en la lista, enlazada.
    for (const nombre of await listar(join(salida, "descargas"))) {
      expect(inicio, nombre).toContain(`<a href="/descargas/${nombre}">${nombre}</a>`);
    }
    expect(await readFile(join(salida, "404.html"), "utf8")).toBe(paginaNoEncontrada());
    expect(await readFile(join(salida, "estilo.css"), "utf8")).toBe(ESTILO);
    expect(await readFile(join(salida, "robots.txt"), "utf8")).toBe(ROBOTS);
    expect(await readFile(join(salida, "favicon.svg"), "utf8")).toBe(FAVICON);
  });

  // Lo que se indexa: cada página que declara canónica está en el sitemap, y solo esas. La portada
  // y /estado/ llevan la fecha más reciente de los datos; cada página de datos, la de los suyos.
  it("escribe sitemap.xml con cada página canónica y la fecha de sus datos", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const sitemap = await readFile(join(salida, "sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] as string);
    expect(locs).toEqual(["/", "/estado/", ...PAGINAS_DE_DATOS].map((ruta) => `${URL_API}${ruta}`));
    const canonicas: string[] = [];
    for (const archivo of (await listar(salida)).filter((n) => n.endsWith(".html"))) {
      const html = await readFile(join(salida, archivo), "utf8");
      const canonica = /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];
      if (canonica !== undefined) canonicas.push(canonica);
    }
    expect([...locs].sort()).toEqual(canonicas.sort());
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    const fechas = [...Object.values(interna.datasets), ...Object.values(interna.curados)].map(
      (d) => d.meta.as_of,
    );
    const masReciente = [...fechas].sort().at(-1);
    expect(masReciente).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const asOf = (id: string): string => interna.curados[id]?.meta.as_of as string;
    expect(sitemap.match(/<lastmod>[^<]*<\/lastmod>/g)).toEqual(
      [
        masReciente,
        masReciente,
        asOf("dias-inhabiles.sat"),
        VIGENCIA_LFT,
        asOf("dias-inhabiles.cnbv"),
      ].map((fecha) => `<lastmod>${fecha}</lastmod>`),
    );
  });

  // El año de las páginas es el del FIX más reciente de los datos, no el del día del build.
  it("escribe una página por calendario con el año del FIX más reciente y el siguiente", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const h1 = async (ruta: string): Promise<string | undefined> =>
      /<h1>([^<]*)<\/h1>/.exec(
        await readFile(join(salida, ruta.slice(1), "index.html"), "utf8"),
      )?.[1];
    expect(fix.at(-1)?.fecha_publicacion).toBe("2026-10-16");
    expect(await h1(RUTA_DIAS_SAT)).toBe("Días inhábiles del SAT 2026 y 2027");
    expect(await h1(RUTA_DIAS_LFT)).toBe("Días de descanso obligatorio 2026 y 2027 (LFT)");
    // La CNBV de los datos de prueba solo trae 2026.
    expect(await h1(RUTA_DIAS_CNBV)).toBe("Días inhábiles bancarios 2026 (CNBV)");

    const conOtroAnio = [...fix, { fecha_publicacion: "2027-01-04", valor: "18.0000" }];
    await writeFile(join(datos, "tipo-cambio-fix/fix.json"), jsonCanonico(conOtroAnio));
    await construirSitio({ raizDatos: datos, salida });
    expect(await h1(RUTA_DIAS_SAT)).toBe("Días inhábiles del SAT 2027 y 2028");
    expect(await h1(RUTA_DIAS_LFT)).toBe("Días de descanso obligatorio 2027 y 2028 (LFT)");
    expect(await h1(RUTA_DIAS_CNBV)).toBe("Días inhábiles bancarios 2026 (CNBV)");
  });

  // La portada lleva a cada página; cada página a la portada, y su JSON-LD a descargas que existen.
  it("la portada enlaza cada página de datos, y cada Dataset descarga archivos del build", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const inicio = await readFile(join(salida, "index.html"), "utf8");
    const seccion = inicio.slice(
      inicio.indexOf('<section id="consultar-datos"'),
      inicio.indexOf('<section id="datos"'),
    );
    for (const ruta of PAGINAS_DE_DATOS) {
      expect(seccion, ruta).toContain(`<dt><a href="${ruta}">`);
      const html = await readFile(join(salida, ruta.slice(1), "index.html"), "utf8");
      expect(html, ruta).toContain('<li><a href="/">MéxicoAPI</a></li>');
      const datasets = datosEstructurados(html).filter((n) => n["@type"] === "Dataset");
      expect(datasets, ruta).toHaveLength(1);
      const distribucion = (datasets[0] as { distribution: { contentUrl: string }[] }).distribution;
      const descargas = distribucion.map((d) => d.contentUrl);
      expect(descargas.length, ruta).toBe(2);
      for (const url of descargas) {
        expect(url.startsWith(`${URL_API}/descargas/`), url).toBe(true);
        await expect(
          readFile(join(salida, url.slice(URL_API.length + 1))),
          url,
        ).resolves.toBeDefined();
      }
    }
    // Los renglones de la tabla de datos del SAT y la CNBV llevan a su página.
    for (const [id, ruta] of [
      ["dias-inhabiles.sat", RUTA_DIAS_SAT],
      ["dias-inhabiles.cnbv", RUTA_DIAS_CNBV],
    ]) {
      const renglon = inicio.slice(inicio.indexOf(`<span class="id">${id}</span>`));
      expect(renglon.slice(0, renglon.indexOf("</th>")), id).toContain(`<a href="${ruta}">`);
    }
  });

  // El ejemplo sale de los datos del build con el mismo validador que usa el Worker; la prueba de
  // integración lo compara contra la respuesta real.
  it("la página de inicio muestra la respuesta recortada de la CLABE de los ejemplos", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const inicio = await readFile(join(salida, "index.html"), "utf8");
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    const meta = interna.datasets.bancos?.meta as Meta;
    const catalogo = new Map(
      bancos.map(({ codigo, nombre_corto, activo }) => [codigo, { codigo, nombre_corto, activo }]),
    );
    const esperado = respuestaRecortada({
      data: validarClabe(CLABE_EJEMPLO, { bancos: catalogo }),
      meta,
    });
    expect(esperado).toMatchObject({
      data: { valido: true, detalle: { banco: { codigo: "002" } } },
    });
    expect(inicio).toContain(escaparHtml(JSON.stringify(esperado, null, 2)));
  });

  it("falla si la CLABE de los ejemplos deja de ser válida con el catálogo", async () => {
    await writeFile(join(datos, "bancos/bancos.json"), jsonCanonico(bancos.slice(1)));
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      name: "ErrorDatos",
      dataset: "bancos",
      message: expect.stringContaining(CLABE_EJEMPLO),
    });
  });

  it("escribe la página de estado y copia sitio.js tal cual", async () => {
    await construirSitio({ raizDatos: datos, salida });
    expect(await readFile(join(salida, "estado/index.html"), "utf8")).toBe(paginaEstado());
    const fuente = await readFile(new URL("../../src/sitio/cliente/sitio.js", import.meta.url));
    expect((await readFile(join(salida, "sitio.js"))).equals(fuente)).toBe(true);
    expect(fuente.toString("utf8").startsWith("// @ts-check\n")).toBe(true);
  });

  // Un dataset nuevo sale de los manifiestos que carga el build, igual que en la página de inicio.
  it("escribe llms.txt con un renglón por dataset y llms-full.txt con las docs", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const llms = await readFile(join(salida, "llms.txt"), "utf8");
    const defs = [...DATASETS.values(), ...CURADOS];
    const renglones = llms.split("\n").filter((l) => /^- .*, as_of /.test(l));
    expect(renglones).toHaveLength(defs.length);
    for (const def of defs) {
      const { as_of } = (await leerJson(join(datos, def.directorio, "manifest.json"))) as {
        as_of: string;
      };
      expect(llms, def.id).toContain(`: \`${def.id}\`, as_of ${as_of}, `);
    }
    expect(llms).toContain(`(${URL_DOCS}/datos/inegi-estados.md): \`inegi.estados\``);
    // En las series, el último dato es el fin de su cobertura; los demás no lo llevan.
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    for (const [id, hasta] of [
      ["tipo-cambio.fix", "2026-10-16"],
      ["udis", "2026-01-01"],
    ] as const) {
      expect(interna.datasets[id]?.cobertura?.hasta).toBe(hasta);
      expect(llms).toMatch(new RegExp(`: \`${id}\`, as_of [0-9-]+, último dato ${hasta}, \`GET `));
    }
    expect(llms.match(/, último dato /g)).toHaveLength(2);
    const completo = await readFile(join(salida, "llms-full.txt"), "utf8");
    expect(completo.startsWith("# docs/api/README.md\n\n# API v1\n")).toBe(true);
    expect(completo).toContain("\n# docs/api/problemas.md\n\n");
    expect(completo).toContain("\n# docs/datos/udis.md\n\n");
  });

  it("es determinista", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const primera = new Map(
      await Promise.all(
        (await listar(salida)).map(
          async (n) => [n, sha256Hex(await readFile(join(salida, n)))] as const,
        ),
      ),
    );
    await construirSitio({ raizDatos: datos, salida });
    for (const [n, hash] of primera) {
      expect(sha256Hex(await readFile(join(salida, n)))).toBe(hash);
    }
  });

  it("si los datos no verifican, falla y deja la salida previa intacta", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const antes = await listar(salida);
    await writeFile(join(salida, "marca.txt"), "previa");
    vi.mocked(verificar.verificarDatos).mockResolvedValue(["bancos: data_sha256 no coincide"]);
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toThrow(
      /bancos: data_sha256 no coincide/,
    );
    expect(await listar(salida)).toEqual([...antes, "marca.txt"].sort());
  });

  it("falla con ErrorDatos si falta un dataset", async () => {
    await rm(join(datos, "bancos"), { recursive: true });
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toThrow(ErrorDatos);
    await expect(readdir(salida)).rejects.toThrow();
  });

  it("rechaza datos con riesgo de inyección en hojas de cálculo", async () => {
    const peligrosos = estados.map((e, i) => (i === 0 ? { ...e, nombre: "=CMD()" } : e));
    await writeFile(join(datos, "inegi-estados/estados.json"), jsonCanonico(peligrosos));
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toThrow(ErrorDatos);
    await expect(readdir(salida)).rejects.toThrow();
  });
});

describe("salida y frescura", { timeout: PRUEBA_LENTA }, () => {
  const SALIDA_MALA = /no puede ser la carpeta de datos, contenerla ni estar dentro de ella/;

  it("rechaza una salida igual a los datos o que los contiene", async () => {
    for (const mala of [datos, raiz, join(datos, "..", "..")]) {
      await expect(construirSitio({ raizDatos: datos, salida: mala })).rejects.toThrow(SALIDA_MALA);
    }
    expect((await listar(datos)).length).toBeGreaterThan(0);
  });

  it("rechaza una salida dentro de los datos", async () => {
    for (const mala of [join(datos, "x"), join(datos, "bancos", "sitio")]) {
      await expect(construirSitio({ raizDatos: datos, salida: mala })).rejects.toThrow(SALIDA_MALA);
      await expect(readdir(mala)).rejects.toThrow();
    }
  });

  it("una carpeta que empieza con .. no es la carpeta de arriba", async () => {
    // Los datos en <raiz>/..datos: la salida <raiz> los contiene aunque la ruta relativa
    // empiece con "..".
    const puntos = join(raiz, "..datos");
    await crearDatos(puntos);
    await expect(construirSitio({ raizDatos: puntos, salida: raiz })).rejects.toThrow(SALIDA_MALA);
    // Y una salida <datos>/..sitio está dentro de los datos.
    await expect(
      construirSitio({ raizDatos: datos, salida: join(datos, "..sitio") }),
    ).rejects.toThrow(SALIDA_MALA);
    // Una hermana que empieza con .. sí se acepta.
    await construirSitio({ raizDatos: datos, salida: join(raiz, "..sitio") });
    expect(await listar(join(raiz, "..sitio"))).toContain("v1/openapi.json");
  });

  it("todo dataset registrado tiene frescura", () => {
    for (const id of DATASETS.keys()) expect(FRESCURA_HORAS[id]).toBeGreaterThan(0);
  });

  it("el error de inyección nombra dataset y columna", async () => {
    const peligrosos = estados.map((e, i) => (i === 0 ? { ...e, nombre: "=CMD()" } : e));
    await writeFile(join(datos, "inegi-estados/estados.json"), jsonCanonico(peligrosos));
    await expect(construirSitio({ raizDatos: datos, salida })).rejects.toMatchObject({
      dataset: "inegi.estados",
      message: expect.stringContaining("columna nombre"),
    });
  });
});
