// construirSitio con los datos reales del repositorio. Va aparte de construir.test.ts para que
// Vitest lo corra en paralelo con él, y arma el sitio una sola vez para todo el archivo: las pruebas
// solo lo leen. La de bytes iguales arma una segunda corrida para compararla con esa.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CoberturaSerie,
  type DiaInhabilCurado,
  fixPublicado,
  type TipoCambioFix,
  type Udi,
  udiDeFecha,
} from "@mexicoapi/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/canonico.js";
import { coberturasDeLaLista, shardCalendario } from "../../src/curado/calendario.js";
import { leerCurado } from "../../src/curado/leer.js";
import {
  CURADOS,
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
} from "../../src/curado/registro.js";
import { DATASETS } from "../../src/registro.js";
import { coberturasDe } from "../../src/sitio/calendarios.js";
import { construirSitio } from "../../src/sitio/construir.js";
import { type MetaInterna, URL_ARCHIVOS, URL_DOCS } from "../../src/sitio/meta.js";
import { enlaceSeguro } from "../../src/sitio/paginas/html.js";

const REAL = fileURLToPath(new URL("../../../../data", import.meta.url));

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
let salida: string;
beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "construir-reales-"));
  salida = join(raiz, "salida");
  await construirSitio({ raizDatos: REAL, salida });
}, 120_000);
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("con los datos reales del repositorio", () => {
  // Los conteos salen de cada manifiesto: un PR de datos que agrega un registro no rompe la prueba.
  it("construye un shard por registro de cada manifiesto, con claves únicas", async () => {
    const interna = (await leerJson(join(salida, "v1/_internos/meta.json"))) as MetaInterna;
    const shards = async (d: string) =>
      (await readdir(join(salida, "v1", d))).filter((n) => n.endsWith(".json")).sort();
    const casos = [
      ["estados", "inegi-estados", "inegi.estados", "cve_ent"],
      ["municipios", "inegi-municipios", "inegi.municipios", "cvegeo"],
      ["bancos", "bancos", "bancos", "codigo"],
    ] as const;
    for (const [ruta, directorio, id, clave] of casos) {
      const { records } = (await leerJson(join(REAL, directorio, "manifest.json"))) as {
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
      (await leerJson(join(REAL, def.directorio, def.archivo))) as T[];
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
    const coberturas: unknown[] = [];
    for (const [def, autoridad] of [
      [curadoDiasCnbv, "cnbv"],
      [curadoDiasSat, "sat"],
    ] as const) {
      const lectura = await leerCurado(def, REAL);
      const registros = await registrosDe<DiaInhabilCurado>(def);
      const cobertura = lectura?.documento?.cobertura ?? null;
      const shard = shardCalendario(autoridad, registros, cobertura);
      expect(
        await leerJson(join(salida, `v1/_internos/calendarios/${autoridad}.json`)),
        autoridad,
      ).toEqual(shard);
      // Las descargas llevan la cobertura de la lista, no la del calendario del Worker.
      const plazos = coberturasDeLaLista(autoridad, registros, cobertura);
      coberturas.push(...coberturasDe({ autoridad, plazos }));
    }
    expect(await leerJson(join(salida, "descargas/dias-inhabiles-coberturas.json"))).toEqual(
      coberturas,
    );
  }, 120_000);

  it("parte cada serie en shards por año que el núcleo acepta y juntos son la serie", async () => {
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
      const serie = (await leerJson(join(REAL, archivo))) as Record<string, string>[];
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

  it("escribe las páginas con los datos reales y dos corridas dan los mismos bytes", async () => {
    // Una segunda corrida, solo para comparar bytes con la de beforeAll.
    const otra = join(raiz, "otra");
    await construirSitio({ raizDatos: REAL, salida: otra });
    const archivos = await listar(salida);
    expect(await listar(otra)).toEqual(archivos);
    for (const n of [
      "index.html",
      "estado/index.html",
      "sitio.js",
      "404.html",
      "estilo.css",
      "favicon.svg",
      "robots.txt",
      "llms.txt",
      "llms-full.txt",
      "_headers",
    ]) {
      expect(archivos).toContain(n);
    }
    for (const n of archivos) {
      expect(sha256Hex(await readFile(join(otra, n))), n).toBe(
        sha256Hex(await readFile(join(salida, n))),
      );
    }

    const inicio = await readFile(join(salida, "index.html"), "utf8");
    for (const def of [...DATASETS.values(), ...CURADOS]) {
      const { as_of, sources } = (await leerJson(join(REAL, def.directorio, "manifest.json"))) as {
        as_of: string;
        sources: { name: string; url: string; license: string; license_url: string }[];
      };
      expect(inicio, def.id).toContain(`<span class="id">${def.id}</span>`);
      expect(inicio, def.id).toContain(`<time datetime="${as_of}">`);
      // Toda fuente real es https y sale enlazada, igual que su licencia.
      for (const f of sources) {
        expect(inicio, f.url).toContain(enlaceSeguro(f.url, f.name));
        expect(inicio, f.license_url).toContain(enlaceSeguro(f.license_url, f.license));
        expect(enlaceSeguro(f.url, f.name), f.url).toMatch(/^<a href="https:/);
      }
    }
    // Cada enlace al repositorio apunta a un archivo que existe, incluidas las docs de cada dataset.
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const enlaces = [...inicio.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1] as string)
      .filter((href) => href.startsWith(`${URL_ARCHIVOS}/`))
      .map((href) => href.slice(URL_ARCHIVOS.length + 1));
    expect(enlaces.length).toBeGreaterThanOrEqual(DATASETS.size + CURADOS.length + 5);
    expect(enlaces).toContain("docs/datos/inegi-estados.md");
    // La ruta de cada dataset sale con sus parámetros obligatorios y el & escapado.
    expect(inicio).toContain("<code>/v1/dias-inhabiles?autoridad=cnbv&amp;anio={anio}</code>");
    expect(inicio).toContain("<code>/v1/udis?fecha={fecha}</code>");
    for (const ruta of enlaces) {
      await expect(readFile(join(repo, ruta)), ruta).resolves.toBeDefined();
    }

    // llms.txt: cada dataset con el as_of de su manifiesto.
    const llms = await readFile(join(salida, "llms.txt"), "utf8");
    for (const def of [...DATASETS.values(), ...CURADOS]) {
      const { as_of } = (await leerJson(join(REAL, def.directorio, "manifest.json"))) as {
        as_of: string;
      };
      expect(llms, def.id).toContain(`\`${def.id}\`, as_of ${as_of}, `);
    }

    // llms-full.txt: la referencia, los errores y cada doc de dataset, en ese orden y completos.
    const completo = await readFile(join(salida, "llms-full.txt"), "utf8");
    const deDatos = (await readdir(join(repo, "docs", "datos"))).filter((n) => n.endsWith(".md"));
    const orden = [
      "docs/api/README.md",
      "docs/api/problemas.md",
      ...deDatos.sort().map((n) => `docs/datos/${n}`),
    ];
    expect(completo.match(/^# docs\/.+$/gm)).toEqual(orden.map((r) => `# ${r}`));
    for (const ruta of orden) {
      const titulo = (await readFile(join(repo, ruta), "utf8")).split("\n")[0] as string;
      expect(completo, ruta).toContain(`# ${ruta}\n\n${titulo}\n`);
    }
    // Ningún enlace relativo sobrevive y cada uno reescrito apunta a un archivo del repositorio.
    const destinos = [...completo.matchAll(/\]\(([^)\s]*)/g)].map((m) => m[1] as string);
    expect(destinos.length).toBeGreaterThan(50);
    const reescritos: string[] = [];
    for (const destino of destinos) {
      expect(destino, destino).toMatch(/^(https:\/\/|#)/);
      if (destino.startsWith(`${URL_ARCHIVOS}/`)) {
        reescritos.push(destino.slice(URL_ARCHIVOS.length + 1).split("#")[0] as string);
      }
    }
    expect(reescritos).toContain("DATA_LICENSE.md");
    expect(reescritos).toContain("docs/operacion/datos-curados.md");
    for (const ruta of reescritos) {
      await expect(readFile(join(repo, ruta)), ruta).resolves.toBeDefined();
    }
  }, 120_000);
});
