import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { URL_DOCS } from "@mexicoapi/core/problemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DatasetLeido,
  declarados,
  generarDatos,
  leerDataset,
  moduloDeDatos,
  PREFIJO_VIRTUAL,
  pluginDatos,
  principal,
  URL_DOCS_DATOS,
} from "../../scripts/datos.ts";
import { especificadores } from "../../scripts/revisar.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/datos.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-datos-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

const leer = (ruta: string): Promise<string> => readFile(join(dir, ruta), "utf8");
const canonico = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;
const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");

const FUENTE = {
  name: "Fuente de prueba",
  url: "https://ejemplo.mx/fuente",
  license: "Libre uso",
  license_url: "https://ejemplo.mx/licencia",
  citation: "Fuente de prueba, consultada en https://ejemplo.mx/fuente",
  published_at: null,
  raw: [{ file: "raw/crudo.json", url: "https://ejemplo.mx/crudo", sha256: "0".repeat(64) }],
};

const REGISTROS = [
  { clave: "01", nombre: 'O\'Higgins \\ “comillas” "dobles"' },
  { clave: "02", nombre: "Peñón\u2028línea\u2029párrafo\nsalto", extra: { lista: [1, 2.5, null] } },
];

/** Un dataset como lo deja el pipeline en data/<directorio>, con su manifest. */
async function dataset(
  directorio = "prueba-uno",
  registros: unknown = REGISTROS,
  cambios: Record<string, unknown> = {},
): Promise<string> {
  const texto = canonico(registros);
  await escribir(`data/${directorio}/registros.json`, texto);
  await escribir(
    `data/${directorio}/manifest.json`,
    canonico({
      dataset: `prueba.${directorio}`,
      schema_version: 1,
      as_of: "2026-10-17",
      fetched_at: "2026-10-18T01:09:01.957Z",
      data_file: "registros.json",
      data_sha256: sha256(texto),
      records: Array.isArray(registros) ? registros.length : 0,
      sources: [FUENTE],
      ...cambios,
    }),
  );
  return texto;
}

const DECLARACION =
  "export declare const datos: readonly unknown[];\nexport declare const meta: {};\n";

async function importar(codigo: string, nombre = "modulo"): Promise<Record<string, unknown>> {
  const ruta = join(dir, "importados", `${nombre}.js`);
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, codigo);
  return (await import(pathToFileURL(ruta).href)) as Record<string, unknown>;
}

describe("URL_DOCS_DATOS", () => {
  it("es la carpeta de datos de la documentación del núcleo", () => {
    expect(URL_DOCS_DATOS).toBe(`${URL_DOCS}/datos`);
  });
});

describe("leerDataset", () => {
  it("lee el manifest y los registros, y deja en meta solo lo que se publica de las fuentes", async () => {
    const texto = await dataset();
    const leido = await leerDataset(join(dir, "data"), "prueba-uno");
    expect(leido).toEqual({
      directorio: "prueba-uno",
      archivo: "registros.json",
      sha256: sha256(texto),
      registros: REGISTROS,
      meta: {
        dataset: "prueba.prueba-uno",
        as_of: "2026-10-17",
        sources: [
          {
            name: FUENTE.name,
            url: FUENTE.url,
            license: FUENTE.license,
            license_url: FUENTE.license_url,
            citation: FUENTE.citation,
          },
        ],
        docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/prueba-uno.md",
      },
    });
  });

  it("falla si el archivo de datos no coincide con el sha256 del manifest", async () => {
    await dataset();
    await writeFile(join(dir, "data/prueba-uno/registros.json"), canonico([REGISTROS[0]]));
    await expect(leerDataset(join(dir, "data"), "prueba-uno")).rejects.toThrow(
      /prueba-uno\/registros\.json: el sha256 .* no coincide con el del manifest/,
    );
  });

  it("falla si el archivo no está en la forma canónica del pipeline", async () => {
    const texto = JSON.stringify(REGISTROS);
    await dataset();
    await writeFile(join(dir, "data/prueba-uno/registros.json"), texto);
    const manifiesto = JSON.parse(await leer("data/prueba-uno/manifest.json"));
    manifiesto.data_sha256 = sha256(texto);
    await writeFile(join(dir, "data/prueba-uno/manifest.json"), canonico(manifiesto));
    await expect(leerDataset(join(dir, "data"), "prueba-uno")).rejects.toThrow(/forma canónica/);
  });

  it("falla si los registros no son un arreglo o no son los que dice el manifest", async () => {
    await dataset("objeto", { a: 1 });
    await expect(leerDataset(join(dir, "data"), "objeto")).rejects.toThrow(/no es un arreglo/);
    await dataset("cuenta", REGISTROS, { records: 3 });
    await expect(leerDataset(join(dir, "data"), "cuenta")).rejects.toThrow(
      /cuenta: el manifest dice 3 registros y hay 2/,
    );
  });

  it("falla con el nombre del dataset si falta el manifest o el archivo de datos", async () => {
    await expect(leerDataset(join(dir, "data"), "nada")).rejects.toThrow(/nada: falta manifest/);
    await dataset();
    await rm(join(dir, "data/prueba-uno/registros.json"));
    await expect(leerDataset(join(dir, "data"), "prueba-uno")).rejects.toThrow(
      /prueba-uno: falta registros\.json/,
    );
  });

  it("falla si el manifest no es JSON", async () => {
    await escribir("data/roto/manifest.json", "{");
    await expect(leerDataset(join(dir, "data"), "roto")).rejects.toThrow(
      /roto: manifest\.json no es JSON válido/,
    );
  });

  it.each([
    ["dataset", { dataset: 1 }],
    ["as_of", { as_of: "17/10/2026" }],
    ["data_file", { data_file: "../fuera.json" }],
    ["data_file", { data_file: "sub/registros.json" }],
    ["data_sha256", { data_sha256: "abc" }],
    ["records", { records: -1 }],
    ["records", { records: 1.5 }],
    ["sources", { sources: "ninguna" }],
    ["sources", { sources: [{ ...FUENTE, license_url: null }] }],
    ["sources", { sources: [null] }],
  ])("falla si el manifest tiene %s inválido", async (campo, cambio) => {
    await dataset("raro", REGISTROS, cambio);
    await expect(leerDataset(join(dir, "data"), "raro")).rejects.toThrow(
      new RegExp(`raro: manifest\\.json tiene ${campo} inválido`),
    );
  });

  it("falla si el manifest no es un objeto", async () => {
    await escribir("data/arreglo/manifest.json", "[]");
    await expect(leerDataset(join(dir, "data"), "arreglo")).rejects.toThrow(
      /arreglo: manifest\.json tiene dataset inválido/,
    );
  });
});

describe("moduloDeDatos", () => {
  let leido: DatasetLeido;

  beforeEach(async () => {
    await dataset();
    leido = await leerDataset(join(dir, "data"), "prueba-uno");
  });

  it("no importa nada y exporta los registros y su meta, congelados a fondo", async () => {
    const codigo = moduloDeDatos(leido);
    expect(especificadores(codigo)).toEqual([]);
    const m = await importar(codigo);
    expect(Object.keys(m).sort()).toEqual(["datos", "meta"]);
    expect(m.datos).toEqual(REGISTROS);
    expect(m.meta).toEqual(leido.meta);
    const datos = m.datos as (typeof REGISTROS)[number][];
    expect(Object.isFrozen(datos)).toBe(true);
    expect(Object.isFrozen(datos[1])).toBe(true);
    expect(Object.isFrozen((datos[1] as { extra: { lista: unknown[] } }).extra.lista)).toBe(true);
    expect(Object.isFrozen((m.meta as { sources: unknown[] }).sources[0])).toBe(true);
  });

  it("conserva el texto exacto: el JSON canónico de los datos da el sha256 del manifest", async () => {
    const m = await importar(moduloDeDatos(leido));
    expect(sha256(canonico(m.datos))).toBe(leido.sha256);
  });

  it("lleva los datos en una sola cadena para JSON.parse y nombra su origen", () => {
    const codigo = moduloDeDatos(leido);
    expect(codigo).toMatch(
      /^\/\/ Generado desde data\/prueba-uno\/registros\.json \(sha256 [0-9a-f]{64}\)/,
    );
    expect(codigo).toContain("JSON.parse('[");
    expect(codigo).not.toContain("\u2028");
    expect(codigo).not.toContain("\u2029");
    expect(codigo.split("\n").length).toBeLessThanOrEqual(6);
  });
});

describe("declarados", () => {
  it("lista las declaraciones .d.ts en orden y sin extensión", async () => {
    await escribir("generados/udis.d.ts", DECLARACION);
    await escribir("generados/bancos.d.ts", DECLARACION);
    await escribir("generados/notas.txt", "");
    expect(await declarados(join(dir, "generados"))).toEqual(["bancos", "udis"]);
  });

  it("falla con un nombre que no puede ser una carpeta de data/", async () => {
    await escribir("generados/Mal Nombre.d.ts", DECLARACION);
    await expect(declarados(join(dir, "generados"))).rejects.toThrow(/Mal Nombre/);
  });
});

describe("generarDatos", () => {
  const opciones = () => ({
    datos: join(dir, "data"),
    declaraciones: join(dir, "src/generados"),
    destino: join(dir, "dist/generados"),
  });

  it("escribe un módulo y copia su declaración por cada dataset declarado", async () => {
    await dataset("prueba-uno");
    await dataset("prueba-dos", [{ clave: "x" }]);
    await dataset("sin-declarar");
    await escribir("src/generados/prueba-uno.d.ts", DECLARACION);
    await escribir("src/generados/prueba-dos.d.ts", DECLARACION);
    await escribir("dist/generados/viejo.js", "export {};\n");

    const generados = await generarDatos(opciones());

    expect(generados.map((g) => [g.directorio, g.registros])).toEqual([
      ["prueba-dos", 1],
      ["prueba-uno", 2],
    ]);
    expect((await readdir(join(dir, "dist/generados"))).sort()).toEqual([
      "prueba-dos.d.ts",
      "prueba-dos.js",
      "prueba-uno.d.ts",
      "prueba-uno.js",
    ]);
    const codigo = await leer("dist/generados/prueba-uno.js");
    expect(codigo).toBe(moduloDeDatos(await leerDataset(join(dir, "data"), "prueba-uno")));
    expect(generados[1]?.bytes).toBe(Buffer.byteLength(codigo));
    expect(await leer("dist/generados/prueba-uno.d.ts")).toBe(DECLARACION);
  });

  it("no toca el destino si un dataset declarado no verifica", async () => {
    await dataset("prueba-uno");
    await escribir("src/generados/prueba-uno.d.ts", DECLARACION);
    await escribir("src/generados/falta.d.ts", DECLARACION);
    await escribir("dist/generados/viejo.js", "export {};\n");
    await expect(generarDatos(opciones())).rejects.toThrow(/falta: falta manifest/);
    expect(await readdir(join(dir, "dist/generados"))).toEqual(["viejo.js"]);
  });

  it("falla si no hay declaraciones", async () => {
    await mkdir(join(dir, "src/generados"), { recursive: true });
    await expect(generarDatos(opciones())).rejects.toThrow(/No hay declaraciones/);
  });

  describe("calendarios curados", () => {
    const FDS = {
      nombre: "Disposiciones 2026",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=1",
      fecha_publicacion: "2025-12-10",
      fragmento: "IX. Los sábados y domingos.",
    };
    const DIAS = [
      {
        fecha: "2026-12-25",
        autoridad: "cnbv",
        motivo: "25 de diciembre",
        tipo: "descanso",
        fuente: FDS,
      },
    ];
    const CALENDARIO = {
      autoridad: "cnbv",
      plazos: {
        general: { cobertura: { desde: "2026-01-01", hasta: "2026-12-31" }, excluir_tipos: [] },
      },
      fuentes_fin_de_semana: { "2026": FDS },
    };
    const CON_CALENDARIO = `${DECLARACION}export declare const calendario: {};\n`;

    it("un calendario exporta su calendario.json tal cual, congelado", async () => {
      await dataset("dias-cal", DIAS);
      await escribir("data/dias-cal/calendario.json", canonico(CALENDARIO));
      await escribir("src/generados/dias-cal.d.ts", CON_CALENDARIO);
      await generarDatos(opciones());
      const m = await importar(await leer("dist/generados/dias-cal.js"), "dias-cal");
      expect(Object.keys(m).sort()).toEqual(["calendario", "datos", "meta"]);
      expect(m.calendario).toEqual(CALENDARIO);
      expect(Object.isFrozen((m.calendario as { plazos: object }).plazos)).toBe(true);
    });

    it("sin calendario.json no hay calendario", async () => {
      await dataset("constante", [{ anio: 2026 }]);
      expect((await leerDataset(join(dir, "data"), "constante")).calendario).toBeUndefined();
    });

    it("la declaración y calendario.json deben coincidir", async () => {
      await dataset("dias-cal", DIAS);
      await escribir("data/dias-cal/calendario.json", canonico(CALENDARIO));
      await escribir("src/generados/dias-cal.d.ts", DECLARACION);
      await expect(generarDatos(opciones())).rejects.toThrow(
        "data/dias-cal/calendario.json existe, pero dias-cal.d.ts no declara calendario",
      );
      await rm(join(dir, "data/dias-cal/calendario.json"));
      await escribir("src/generados/dias-cal.d.ts", CON_CALENDARIO);
      await expect(generarDatos(opciones())).rejects.toThrow(
        "dias-cal.d.ts declara calendario, pero falta data/dias-cal/calendario.json",
      );
    });

    it.each([
      ["no es JSON", "{", /dias-cal\/calendario\.json no es JSON válido/],
      ["no está en forma canónica", JSON.stringify(CALENDARIO), /no está en la forma canónica/],
      ["no es un objeto", canonico([CALENDARIO]), /solo autoridad, plazos y fuentes_fin_de_semana/],
      [
        "le falta una llave",
        canonico({ autoridad: "cnbv", plazos: CALENDARIO.plazos }),
        /solo autoridad, plazos y fuentes_fin_de_semana/,
      ],
      [
        "trae los días",
        canonico({ ...CALENDARIO, dias: [] }),
        /solo autoridad, plazos y fuentes_fin_de_semana/,
      ],
      [
        "es de otra autoridad que sus días",
        canonico({ ...CALENDARIO, autoridad: "sat" }),
        /calendario\.json es de sat y sus días de cnbv/,
      ],
    ])("un calendario.json que %s detiene el build", async (_caso, texto, error) => {
      await dataset("dias-cal", DIAS);
      await escribir("data/dias-cal/calendario.json", texto);
      await expect(leerDataset(join(dir, "data"), "dias-cal")).rejects.toThrow(error);
    });
  });
});

describe("pluginDatos", () => {
  const importador = (archivo: string): string => join(dir, "src/datos", archivo);

  it("resuelve ./generados/<dataset>.js desde src/datos a un módulo virtual", () => {
    const plugin = pluginDatos(join(dir, "data"));
    expect(plugin.name).toBe("mexicoapi-datos");
    expect(plugin.resolveId("./generados/inegi-estados.js", importador("estados.ts"))).toBe(
      `${PREFIJO_VIRTUAL}inegi-estados`,
    );
  });

  it.each([
    ["./generados/inegi-estados.js", undefined],
    ["./generados/inegi-estados.js", join("otra", "carpeta", "estados.ts")],
    ["./otros/inegi-estados.js", join("src", "datos", "estados.ts")],
    ["./generados/sub/x.js", join("src", "datos", "estados.ts")],
    ["node:fs", join("src", "datos", "estados.ts")],
  ])("no resuelve %s desde %s", (fuente, desde) => {
    const plugin = pluginDatos(join(dir, "data"));
    expect(plugin.resolveId(fuente, desde)).toBeNull();
  });

  it("carga el módulo virtual con el mismo código que genera el build", async () => {
    await dataset();
    const plugin = pluginDatos(join(dir, "data"));
    expect(await plugin.load(`${PREFIJO_VIRTUAL}prueba-uno`)).toBe(
      moduloDeDatos(await leerDataset(join(dir, "data"), "prueba-uno")),
    );
    expect(await plugin.load(join(dir, "src/datos/estados.ts"))).toBeNull();
  });
});

describe("principal", () => {
  function consola() {
    const salida: string[] = [];
    const errores: string[] = [];
    return {
      salida,
      errores,
      opciones: {
        raiz: join(dir, "sdk"),
        datos: join(dir, "data"),
        salida: (texto: string) => salida.push(texto),
        errores: (texto: string) => errores.push(texto),
      },
    };
  }

  it("genera dist/datos/generados desde src/datos/generados y lo cuenta", async () => {
    await dataset("prueba-uno");
    await escribir("sdk/src/datos/generados/prueba-uno.d.ts", DECLARACION);
    const c = consola();
    expect(await principal([], c.opciones)).toBe(0);
    expect((await readdir(join(dir, "sdk/dist/datos/generados"))).sort()).toEqual([
      "prueba-uno.d.ts",
      "prueba-uno.js",
    ]);
    expect(c.salida.join("")).toMatch(
      /^datos: 1 módulo en dist\/datos\/generados\n {2}prueba-uno: 2 registros, \d+ bytes\n$/,
    );
    expect(c.errores).toEqual([]);
  });

  it("devuelve 1 con el motivo si falla", async () => {
    await escribir("sdk/src/datos/generados/falta.d.ts", DECLARACION);
    const c = consola();
    expect(await principal([], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^datos: falta: falta manifest/);
  });

  it("con argumentos muestra el uso y devuelve 2", async () => {
    const c = consola();
    expect(await principal(["otro"], c.opciones)).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/datos\.ts/);
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "otro"], { encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});
