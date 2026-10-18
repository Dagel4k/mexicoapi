import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonCanonico, sha256Hex } from "../../src/canonico.js";
import { ErrorDatos } from "../../src/errores.js";
import { DATASETS } from "../../src/registro.js";
import { construirSitio } from "../../src/sitio/construir.js";
import { FRESCURA_HORAS, type Meta, type MetaInterna, URL_DOCS } from "../../src/sitio/meta.js";
import * as verificar from "../../src/verificar.js";
import { PRUEBA_LENTA } from "../ayudas.js";

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
  ];
  for (const [dir, id, archivo, datos] of conjuntos) {
    await mkdir(join(raiz, dir), { recursive: true });
    await writeFile(join(raiz, dir, archivo), jsonCanonico(datos));
    await writeFile(join(raiz, dir, "manifest.json"), manifiesto(id, archivo, datos));
  }
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
        "descargas/inegi-estados.csv",
        "descargas/inegi-estados.json",
        "descargas/inegi-estados.manifest.json",
        "descargas/inegi-municipios.csv",
        "descargas/inegi-municipios.json",
        "descargas/inegi-municipios.manifest.json",
        "descargas/mexicoapi.sqlite",
        "v1/_internos/meta.json",
        "v1/bancos.json",
        "v1/bancos/002.json",
        "v1/bancos/099.json",
        "v1/estados.json",
        "v1/estados/01.json",
        "v1/estados/01/municipios.json",
        "v1/estados/09.json",
        "v1/estados/09/municipios.json",
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
    ]);
    expect(interna.datasets.bancos).toMatchObject({ records: 2, frescura_horas: 72 });
    expect(interna.datasets["inegi.estados"]).toMatchObject({
      records: 2,
      frescura_horas: 216,
      data_sha256: sha256Hex(jsonCanonico(estados)),
    });
    expect(interna.datasets["inegi.municipios"]?.meta.dataset).toBe("inegi.municipios");
  });

  it("las descargas json y manifiesto son idénticas byte a byte a data/", async () => {
    await construirSitio({ raizDatos: datos, salida });
    for (const [dir, archivo] of [
      ["inegi-estados", "estados.json"],
      ["inegi-municipios", "municipios.json"],
      ["bancos", "bancos.json"],
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
  });

  it("el sqlite trae todos los datasets", async () => {
    await construirSitio({ raizDatos: datos, salida });
    const db = new DatabaseSync(join(salida, "descargas/mexicoapi.sqlite"), { readOnly: true });
    expect(db.prepare("SELECT dataset, records FROM datasets ORDER BY dataset").all()).toEqual([
      { dataset: "bancos", records: 2 },
      { dataset: "inegi.estados", records: 2 },
      { dataset: "inegi.municipios", records: 3 },
    ]);
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
    for (const [id, d] of Object.entries(interna.datasets)) {
      expect(d.meta.docs.startsWith(`${URL_DOCS}/datos/`), id).toBe(true);
      await expect(
        readFile(join(docs, d.meta.docs.slice(URL_DOCS.length + 1))),
        id,
      ).resolves.toBeDefined();
    }
  }, 120_000);
});
