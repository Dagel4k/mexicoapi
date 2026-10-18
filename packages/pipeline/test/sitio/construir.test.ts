import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  type CoberturaSerie,
  crearCalendario,
  type DiaInhabilCurado,
  type FuenteDof,
  fixPublicado,
  sumarDiasHabiles,
  type TipoCambioFix,
  type Udi,
  udiDeFecha,
} from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonCanonico, sha256Hex } from "../../src/canonico.js";
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
import { type ShardCalendario, shardCalendario } from "../../src/sitio/calendarios.js";
import { construirSitio } from "../../src/sitio/construir.js";
import { FRESCURA_HORAS, type Meta, type MetaInterna, URL_DOCS } from "../../src/sitio/meta.js";
import * as verificar from "../../src/verificar.js";
import { PRUEBA_LENTA } from "../ayudas.js";
import { YAML_CNBV, YAML_ISR, YAML_SALARIO, YAML_SAT, YAML_UMA } from "../curado/ejemplos.js";

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
    expect(sat).toHaveLength(8 + 2);
    expect(sat.at(-1)).toBe("");
    expect(sat[1]).toBe(
      '2026-01-01,sat,1o. de enero,descanso,"Código Fiscal de la Federación, artículo 12",' +
        "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf,2026-04-09," +
        '"Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; el primer lunes de febrero en conmemoración del 5 de febrero; el tercer lunes de marzo en conmemoración del 21 de marzo; el 1o. y 5 de mayo; el 16 de septiembre; el tercer lunes de noviembre en conmemoración del 20 de noviembre; el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo y el 25 de diciembre."',
    );
    expect((await renglones("dias-inhabiles-cnbv.csv"))[0]).toBe(
      `fecha,autoridad,motivo,tipo,${fuente}`,
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
      { dataset: "dias-inhabiles.sat", records: 8 },
      { dataset: "inegi.estados", records: 2 },
      { dataset: "inegi.municipios", records: 3 },
      { dataset: "isr.tarifas", records: 3 },
      { dataset: "tipo-cambio.fix", records: 5 },
      { dataset: "udis", records: 3 },
    ]);
    const cuenta = (tabla: string) =>
      (db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
    expect(["dias_inhabiles", "uma", "salario_minimo", "isr_tramos"].map(cuenta)).toEqual([
      19, 2, 4, 33,
    ]);
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

  it("_headers tiene una regla por descarga más la general, y menos de 100", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const texto = await readFile(join(salida, "_headers"), "utf8");
    const reglas = texto.split("\n").filter((l) => l.startsWith("/"));
    expect(reglas.length).toBeLessThan(100);
    const descargas = (await listar(join(salida, "descargas"))).map((n) => `/descargas/${n}`);
    expect([...reglas].sort()).toEqual([...descargas, "/descargas/*"].sort());
    expect(texto).toContain(
      "/descargas/inegi-estados.json\n  Content-Type: application/json; charset=utf-8",
    );
    expect(texto).toContain("/descargas/bancos.csv\n  Content-Type: text/csv; charset=utf-8");
    expect(texto).toContain("/descargas/udis.csv\n  Content-Type: text/csv; charset=utf-8");
    expect(texto).toContain(
      "/descargas/tipo-cambio-fix.manifest.json\n  Content-Type: application/json; charset=utf-8",
    );
    expect(texto).toContain("/descargas/mexicoapi.sqlite\n  Content-Type: application/vnd.sqlite3");
    expect(texto).toContain("/descargas/SHA256SUMS\n  Content-Type: text/plain; charset=utf-8");
    expect(texto).toContain("/descargas/*\n  Access-Control-Allow-Origin: *");
    expect(texto).toContain("  X-Content-Type-Options: nosniff");
    expect(texto).toContain("  Content-Security-Policy: default-src 'none'");
    expect(texto).toContain("  Cache-Control: public, max-age=3600, stale-while-revalidate=86400");
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

describe("con los datos reales del repositorio", () => {
  // Los conteos salen de cada manifiesto: un PR de datos que agrega un registro no rompe la prueba.
  it("construye un shard por registro de cada manifiesto, con claves únicas", async () => {
    vi.restoreAllMocks();
    const real = fileURLToPath(new URL("../../../../data", import.meta.url));
    await construirSitio({ raizDatos: real, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    const shards = async (d: string) =>
      (await readdir(join(salida, "v1", d))).filter((n) => n.endsWith(".json")).sort();
    const casos = [
      ["estados", "inegi-estados", "inegi.estados", "cve_ent"],
      ["municipios", "inegi-municipios", "inegi.municipios", "cvegeo"],
      ["bancos", "bancos", "bancos", "codigo"],
    ] as const;
    for (const [ruta, directorio, id, clave] of casos) {
      const { records } = (await leerJson(join(real, directorio, "manifest.json"))) as {
        records: number;
      };
      expect(records, id).toBeGreaterThan(0);
      expect(interna.datasets[id]?.records, id).toBe(records);
      const lista = (await leerJson(join(salida, "v1", `${ruta}.json`))) as {
        data: Record<string, string>[];
      };
      const claves = lista.data.map((r) => r[clave] as string);
      expect(claves, id).toHaveLength(records);
      expect(new Set(claves).size, id).toBe(records);
      expect(await shards(ruta), id).toEqual(claves.map((c) => `${c}.json`).sort());
    }
    // Los 32 estados no cambian.
    expect(await shards("estados")).toHaveLength(32);
    let porEstado = 0;
    for (const nombre of await shards("estados")) {
      const suyos = await leerJson(
        join(salida, "v1/estados", nombre.replace(".json", ""), "municipios.json"),
      );
      porEstado += (suyos.data as unknown[]).length;
    }
    expect(porEstado).toBe(interna.datasets["inegi.municipios"]?.records);
    // El meta.docs de cada dataset apunta a un archivo que existe en docs/.
    const docs = fileURLToPath(new URL("../../../../docs/", import.meta.url));
    for (const [id, d] of [
      ...Object.entries(interna.datasets),
      ...Object.entries(interna.curados),
    ]) {
      expect(d.meta.docs.startsWith(`${URL_DOCS}/datos/`), id).toBe(true);
      await expect(
        readFile(join(docs, d.meta.docs.slice(URL_DOCS.length + 1))),
        id,
      ).resolves.toBeDefined();
    }

    // Los curados: un shard por UMA, por año de salario y por tarifa, y un calendario por
    // autoridad igual al que arma shardCalendario con su YAML.
    expect(Object.keys(interna.curados).sort()).toEqual(CURADOS.map((d) => d.id).sort());
    const registrosDe = async <T>(def: (typeof CURADOS)[number]) =>
      (await leerJson(join(real, def.directorio, def.archivo))) as T[];
    const uma = await registrosDe<{ anio: number }>(curadoUma);
    expect(uma.length).toBe(interna.curados["constantes.uma"]?.records);
    expect(await shards("constantes/uma")).toEqual(uma.map((u) => `${u.anio}.json`).sort());
    const salario = await registrosDe<{ anio: number }>(curadoSalarioMinimo);
    expect(await shards("constantes/salario-minimo")).toEqual(
      [...new Set(salario.map((s) => `${s.anio}.json`))].sort(),
    );
    for (const nombre of await shards("constantes/salario-minimo")) {
      const { data } = await leerJson(join(salida, "v1/constantes/salario-minimo", nombre));
      expect(
        data.map((s: { zona: string }) => s.zona),
        nombre,
      ).toEqual(["general", "zlfn"]);
    }
    for (const t of await registrosDe<{ anio: number; periodo: string }>(curadoTarifasIsr)) {
      const { data } = await leerJson(join(salida, `v1/isr/tarifa/${t.periodo}/${t.anio}.json`));
      expect(data, `${t.periodo} ${t.anio}`).toEqual(t);
    }
    // El índice de años coincide con los shards de cada carpeta.
    const indice = (await leerJson(join(salida, "v1/_internos/constantes.json"))) as Record<
      string,
      number[]
    >;
    for (const [carpeta, anios] of Object.entries(indice)) {
      expect(await shards(carpeta), carpeta).toEqual(anios.map((a) => `${a}.json`).sort());
    }
    expect(Object.keys(indice).sort()).toEqual([
      "constantes/salario-minimo",
      "constantes/uma",
      "isr/tarifa/anual",
      "isr/tarifa/mensual",
    ]);
    for (const [def, autoridad] of [
      [curadoDiasCnbv, "cnbv"],
      [curadoDiasSat, "sat"],
    ] as const) {
      const lectura = await leerCurado(def, real);
      expect(
        await leerJson(join(salida, `v1/_internos/calendarios/${autoridad}.json`)),
        autoridad,
      ).toEqual(
        shardCalendario(
          autoridad,
          await registrosDe<DiaInhabilCurado>(def),
          lectura?.documento?.cobertura ?? null,
        ),
      );
    }
  }, 120_000);

  it("parte cada serie en shards por año que el núcleo acepta y juntos son la serie", async () => {
    vi.restoreAllMocks();
    const real = fileURLToPath(new URL("../../../../data", import.meta.url));
    await construirSitio({ raizDatos: real, salida });
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    type Consultar = (
      datos: unknown[],
      tramo: CoberturaSerie,
      cobertura: CoberturaSerie,
      fecha: string,
    ) => string;
    const casos: [string, string, string, string, Consultar][] = [
      [
        "tipo-cambio.fix",
        "tipo-cambio-fix/fix.json",
        "fix",
        "fecha_publicacion",
        (d, t, c, f) => fixPublicado(d as TipoCambioFix[], t, c, f).tipo,
      ],
      [
        "udis",
        "udis/udis.json",
        "udis",
        "fecha",
        (d, t, c, f) => udiDeFecha(d as Udi[], t, c, f).tipo,
      ],
    ];
    for (const [id, archivo, carpeta, clave, consultar] of casos) {
      const serie = (await leerJson(join(real, archivo))) as Record<string, string>[];
      const fechas = serie.map((r) => r[clave] as string);
      const cobertura = { desde: fechas[0] as string, hasta: fechas.at(-1) as string };
      expect(interna.datasets[id]?.cobertura, id).toEqual(cobertura);
      const anios = Array.from(
        { length: Number(cobertura.hasta.slice(0, 4)) - Number(cobertura.desde.slice(0, 4)) + 1 },
        (_, i) => String(Number(cobertura.desde.slice(0, 4)) + i),
      );
      expect((await readdir(join(salida, "v1/_internos", carpeta))).sort(), id).toEqual(
        anios.map((a) => `${a}.json`),
      );
      const juntos: unknown[] = [];
      for (const anio of anios) {
        const shard = (await leerJson(join(salida, "v1/_internos", carpeta, `${anio}.json`))) as {
          tramo: { desde: string; hasta: string };
          datos: Record<string, string>[];
        };
        const desde = `${anio}-01-01` < cobertura.desde ? cobertura.desde : `${anio}-01-01`;
        const hasta = `${anio}-12-31` > cobertura.hasta ? cobertura.hasta : `${anio}-12-31`;
        expect(shard.tramo, `${id} ${anio}`).toEqual({ desde, hasta });
        const primera = shard.datos[0]?.[clave] as string;
        expect(consultar(shard.datos, shard.tramo, cobertura, primera), `${id} ${anio}`).toBe(
          "encontrado",
        );
        juntos.push(...shard.datos);
      }
      expect(juntos, id).toEqual(serie);
    }
  }, 120_000);
});
