import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { directorioCache } from "../../src/sepomex/cache.js";
import * as sepomex from "../../src/sepomex/index.js";
import {
  type CodigoPostal,
  colonias,
  cp,
  type EstadoSepomex,
  estado,
  type FetchSepomex,
  importar,
  LIMITES,
  sync,
} from "../../src/sepomex/index.js";
import { fetchFalso, lineasTxt, txt, zipOficial } from "./ayudas.js";
import { probarSepomex, rechazo } from "./comun.js";

describe("mexicoapi/sepomex desde src", () => {
  probarSepomex(async () => sepomex);
});

describe("directorioCache", () => {
  it("usa LOCALAPPDATA en Windows", () => {
    expect(
      directorioCache(
        { LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" },
        "win32",
        "C:\\Users\\ana",
      ),
    ).toBe("C:\\Users\\ana\\AppData\\Local\\mexicoapi\\sepomex");
    expect(directorioCache({}, "win32", "C:\\Users\\ana")).toBe(
      "C:\\Users\\ana\\AppData\\Local\\mexicoapi\\sepomex",
    );
    expect(directorioCache({ LOCALAPPDATA: "relativo" }, "win32", "C:\\Users\\ana")).toBe(
      "C:\\Users\\ana\\AppData\\Local\\mexicoapi\\sepomex",
    );
  });

  it("usa XDG_CACHE_HOME o ~/.cache en los demás sistemas", () => {
    expect(directorioCache({ XDG_CACHE_HOME: "/var/cache/ana" }, "linux", "/home/ana")).toBe(
      "/var/cache/ana/mexicoapi/sepomex",
    );
    expect(directorioCache({}, "darwin", "/Users/ana")).toBe("/Users/ana/.cache/mexicoapi/sepomex");
    // La especificación XDG ignora una ruta relativa.
    expect(directorioCache({ XDG_CACHE_HOME: "cache" }, "linux", "/home/ana")).toBe(
      "/home/ana/.cache/mexicoapi/sepomex",
    );
  });

  it("por omisión mira el entorno de este proceso", () => {
    expect(sepomex.directorio()).toBe(directorioCache(process.env, process.platform));
    expect(sepomex.directorio()).toMatch(/mexicoapi[\\/]sepomex$/);
  });
});

describe("caché", () => {
  let trabajo: string;
  let dir: string;
  const aviso = () => {};

  beforeEach(async () => {
    trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
    dir = join(trabajo, "cache");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
  });

  const archivo = async (nombre: string, bytes: Uint8Array) => {
    const ruta = join(trabajo, nombre);
    await writeFile(ruta, bytes);
    return ruta;
  };

  it("sin dir usa el directorio por omisión del entorno", async () => {
    vi.stubEnv("LOCALAPPDATA", trabajo);
    vi.stubEnv("XDG_CACHE_HOME", trabajo);
    try {
      const e = await importar(await archivo("cp.zip", zipOficial()), { aviso });
      expect(e.dir).toBe(join(trabajo, "mexicoapi", "sepomex"));
      expect((await cp("80000"))?.cp).toBe("80000");
      expect((await estado())?.dir).toBe(e.dir);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("por omisión escribe el aviso en stderr", async () => {
    const escrito: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((texto) => {
      escrito.push(String(texto));
      return true;
    });
    await importar(await archivo("cp.zip", zipOficial()), { dir });
    expect(escrito.join("")).toMatch(/^Aviso de Correos de México: "El Catálogo Nacional/);
    expect(escrito.join("")).toContain("No vienen de MéxicoAPI");
  });

  it("si falla al escribir no deja archivos nuevos ni cambia la caché", async () => {
    await mkdir(join(dir, "meta.json"), { recursive: true });
    await expect(importar(await archivo("cp.zip", zipOficial()), { dir, aviso })).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["meta.json"]);
  });

  it("borra los archivos de la descarga anterior y responde con la nueva", async () => {
    const primera = await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    expect((await cp("80000", { dir }))?.asentamientos[0]?.nombre).toBe("Culiacán Centro");
    const otra = lineasTxt().map((l) => l.replace("Culiacán Centro", "Centro Nuevo"));
    const segunda = await importar(await archivo("b.txt", txt(otra)), { dir, aviso });
    expect(segunda.json).not.toBe(primera.json);
    expect((await cp("80000", { dir }))?.asentamientos[0]?.nombre).toBe("Centro Nuevo");
    const quedan = (await readdir(dir)).sort();
    const nombres = [segunda.json, segunda.sqlite]
      .filter((r): r is string => r !== null)
      .map((r) => r.slice(dir.length + 1));
    expect(quedan).toEqual(["meta.json", ...nombres].sort());
  });

  it("no borra otros archivos del directorio", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notas.txt"), "mías");
    await writeFile(join(dir, "codigos.json"), "{}");
    await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    expect(await readdir(dir)).toEqual(expect.arrayContaining(["notas.txt", "codigos.json"]));
  });

  it("guarda un meta.json legible con el resumen y el aviso", async () => {
    const e = await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta).toMatchObject({
      formato: 1,
      filas: e.filas,
      codigos_postales: e.codigos_postales,
      aviso: e.aviso,
      nota: e.nota,
      json: e.json.slice(dir.length + 1),
    });
  });

  it.each([
    ["no es JSON", "{"],
    ["otro formato", JSON.stringify({ formato: 2 })],
    ["una ruta fuera del directorio", "RUTA"],
  ])("dice que la caché está dañada si meta.json %s", async (_caso, contenido) => {
    const e = await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    const meta = await readFile(join(dir, "meta.json"), "utf8");
    const nuevo =
      contenido === "RUTA"
        ? meta.replace(e.json.slice(dir.length + 1), "../../fuera.json")
        : contenido;
    await writeFile(join(dir, "meta.json"), nuevo);
    await rechazo(estado({ dir }), "cache-invalida", /dañado.*sepomex\.sync\(\)/);
    await rechazo(cp("80000", { dir }), "cache-invalida", /dañado/);
  });

  it("dice que la caché está dañada si no puede leer meta.json", async () => {
    await mkdir(join(dir, "meta.json"), { recursive: true });
    await rechazo(estado({ dir }), "cache-invalida", /dañado \(meta\.json\)/);
  });

  it("dice que la caché está dañada si falta o se rompe el JSON del catálogo", async () => {
    const e = await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
    await writeFile(e.json, '{"formato":1,"codigos":[]}');
    await rechazo(cp("80000", { dir }), "cache-invalida", /dañado/);
    await writeFile(e.json, "{");
    await rechazo(cp("80000", { dir }), "cache-invalida", /dañado/);
    await rm(e.json);
    await rechazo(cp("80000", { dir }), "cache-invalida", /dañado/);
  });

  it("dice si no puede leer el archivo a importar o si pasa del límite", async () => {
    await rechazo(
      importar(join(trabajo, "no-existe.zip"), { dir, aviso }),
      "archivo-invalido",
      /No se pudo leer/,
    );
    const grande = join(trabajo, "grande.txt");
    await writeFile(grande, "");
    await truncate(grande, LIMITES.txt + 1);
    await rechazo(
      importar(grande, { dir, aviso }),
      "archivo-invalido",
      /pesa 60\.0 MB y el límite es 60\.0 MB/,
    );
  });

  it("acepta que el sitio entregue el TXT sin comprimir", async () => {
    const e = await sync({ dir, aviso, fetch: fetchFalso({ post: { cuerpo: txt() } }).fetch });
    expect(e.filas).toBe(lineasTxt().length - 2);
  });

  it("revisa el tamaño que declara y el que entrega el sitio", async () => {
    await rechazo(
      sync({
        dir,
        aviso,
        fetch: fetchFalso({ post: { headers: { "Content-Length": String(LIMITES.zip + 1) } } })
          .fetch,
      }),
      "archivo-invalido",
      /pesa 20\.0 MB y el límite es 20\.0 MB/,
    );
    const enorme: FetchSepomex = async (_url, init) => ({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () =>
        init.method === "GET"
          ? new TextEncoder().encode(`${"x".repeat(LIMITES.pagina)}y`).buffer
          : new ArrayBuffer(0),
    });
    await rechazo(
      sync({ dir, aviso, fetch: enorme }),
      "archivo-invalido",
      /La respuesta pasa de 1\.0 MB/,
    );
  });

  it("dice si la respuesta se corta o si el transporte ya dio un SepomexError", async () => {
    const cortada: FetchSepomex = async () => ({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => Promise.reject(new Error("socket hang up")),
    });
    await rechazo(sync({ dir, aviso, fetch: cortada }), "sin-respuesta", /socket hang up/);
    const limite = new sepomex.SepomexError("archivo-invalido", "La respuesta pasa de 20.0 MB.");
    await expect(sync({ dir, aviso, fetch: () => Promise.reject(limite) })).rejects.toBe(limite);
    await rechazo(
      sync({ dir, aviso, fetch: () => Promise.reject("texto") }),
      "sin-respuesta",
      /\(texto\)/,
    );
  });
});

describe("tipos", () => {
  it("cp da un CodigoPostal o null, y estado un EstadoSepomex o null", () => {
    expectTypeOf(cp).returns.resolves.toEqualTypeOf<CodigoPostal | null>();
    expectTypeOf(estado).returns.resolves.toEqualTypeOf<EstadoSepomex | null>();
    expectTypeOf(colonias).returns.resolves.toEqualTypeOf<
      readonly CodigoPostal["asentamientos"][number][]
    >();
    expectTypeOf<CodigoPostal["municipio"]["cvegeo"]>().toEqualTypeOf<string | null>();
    // El fetch global sirve como FetchSepomex.
    expectTypeOf(globalThis.fetch).toExtend<FetchSepomex>();
  });
});
