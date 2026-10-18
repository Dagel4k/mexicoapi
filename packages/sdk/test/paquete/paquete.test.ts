// Revisa el paquete tal como se publicaría: necesita `pnpm -r build` antes.
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { declarados } from "../../scripts/datos.ts";
import {
  entradasUniversales,
  esModuloDeNode,
  grafoDeModulos,
  LIMITE_GZIP_PRINCIPAL,
  medirEntrada,
} from "../../scripts/revisar.ts";
import { type Modulo, probarModulo } from "../comun.ts";
import {
  type ModuloDatos,
  type ModuloFix,
  type ModuloUdis,
  probarDatos,
  probarFix,
  probarUdis,
} from "../datos/comun.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(RAIZ, "dist");
const CONSUMIDOR = fileURLToPath(new URL("./consumidor/", import.meta.url));
const manifiesto = JSON.parse(await readFile(join(RAIZ, "package.json"), "utf8")) as {
  exports: Record<string, { types: string; import: string } | string>;
};
const TSC = join(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin",
  "tsc",
);

const importar = async <T>(archivo: string): Promise<T> =>
  (await import(pathToFileURL(join(DIST, archivo)).href)) as T;

/** Módulos de dist/datos/generados que carga una entrada, por nombre. */
async function generadosDe(entrada: string): Promise<string[]> {
  const { archivos } = await grafoDeModulos(join(DIST, entrada));
  return archivos
    .filter((a) => relative(DIST, a).startsWith(join("datos", "generados") + sep))
    .map((a) => basename(a, ".js"))
    .sort();
}

async function archivosDeDist(): Promise<string[]> {
  const entradas = await readdir(DIST, { recursive: true, withFileTypes: true });
  return entradas.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

describe("mexicoapi desde dist", () => {
  probarModulo(() => importar<Modulo>("index.js"));
});

describe("mexicoapi/datos desde dist", () => {
  probarDatos(async () => ({
    datos: await importar<ModuloDatos>("datos/index.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("mexicoapi/datos/fix desde dist", () => {
  probarFix(async () => ({
    fix: await importar<ModuloFix>("datos/fix.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("mexicoapi/datos/udis desde dist", () => {
  probarUdis(async () => ({
    udis: await importar<ModuloUdis>("datos/udis.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("dist", () => {
  it(`la entrada principal pesa ${LIMITE_GZIP_PRINCIPAL} bytes o menos con gzip`, async () => {
    const medida = await medirEntrada(join(DIST, "index.js"));
    expect(medida.archivos.length).toBeGreaterThan(1);
    expect(medida.gzip).toBeLessThanOrEqual(LIMITE_GZIP_PRINCIPAL);
  });

  it("revisa como universales la entrada principal y las de datos", () => {
    expect(entradasUniversales(manifiesto.exports).map((e) => e.ruta)).toEqual([
      ".",
      "./datos",
      "./datos/fix",
      "./datos/udis",
    ]);
  });

  it("cada entrada carga solo sus datos: la principal ninguno y el FIX y las UDIS aparte", async () => {
    const principal = await grafoDeModulos(join(DIST, "index.js"));
    expect(principal.archivos.filter((a) => relative(DIST, a).startsWith(`datos${sep}`))).toEqual(
      [],
    );
    expect(await generadosDe("datos/index.js")).toEqual([
      "bancos",
      "inegi-estados",
      "inegi-municipios",
    ]);
    expect(await generadosDe("datos/fix.js")).toEqual(["tipo-cambio-fix"]);
    expect(await generadosDe("datos/udis.js")).toEqual(["udis"]);
  });

  it("trae un módulo generado y sus tipos por cada declaración de src/datos/generados", async () => {
    const nombres = await declarados(join(RAIZ, "src", "datos", "generados"));
    expect(nombres.length).toBeGreaterThan(0);
    expect((await readdir(join(DIST, "datos", "generados"))).sort()).toEqual(
      nombres.flatMap((n) => [`${n}.d.ts`, `${n}.js`]),
    );
  });

  it.each(entradasUniversales(manifiesto.exports))(
    "la entrada $ruta no importa módulos de Node ni paquetes",
    async ({ archivo }) => {
      const grafo = await grafoDeModulos(join(RAIZ, archivo));
      expect(grafo.externas.filter((e) => esModuloDeNode(e.especificador))).toEqual([]);
      expect(grafo.externas).toEqual([]);
    },
  );

  it("ningún archivo importa ni menciona @mexicoapi/core", async () => {
    const archivos = await archivosDeDist();
    expect(archivos.some((a) => a.endsWith(join("nucleo", "index.js")))).toBe(true);
    for (const archivo of archivos) {
      expect(await readFile(archivo, "utf8"), archivo).not.toContain("@mexicoapi/core");
    }
  });

  it("solo trae .js y .d.ts, sin mapas ni pruebas", async () => {
    for (const archivo of await archivosDeDist()) {
      expect(archivo).toMatch(/\.(js|d\.ts)$/);
      expect(archivo).not.toMatch(/\.test\./);
    }
  });

  it.each([
    ["NodeNext", []],
    ["Bundler", ["--module", "preserve", "--moduleResolution", "bundler"]],
  ])("sus tipos compilan en un proyecto que lo usa con resolución %s", (_nombre, opciones) => {
    const r = spawnSync(process.execPath, [TSC, "-p", CONSUMIDOR, ...opciones], {
      encoding: "utf8",
    });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("npm pack", () => {
  it("publica solo dist, LICENSE, README y package.json", () => {
    // Con shell porque en Windows npm es un .cmd; el comando va entero, sin argumentos aparte.
    const r = spawnSync("npm pack --dry-run --json", { cwd: RAIZ, encoding: "utf8", shell: true });
    expect(r.status, r.stderr).toBe(0);
    const [paquete] = JSON.parse(r.stdout) as [{ name: string; files: { path: string }[] }];
    expect(paquete.name).toBe("mexicoapi");
    const rutas = paquete.files.map((f) => f.path);
    expect(rutas).toEqual(
      expect.arrayContaining([
        "LICENSE",
        "package.json",
        "dist/index.js",
        "dist/index.d.ts",
        "dist/nucleo/index.js",
        "dist/nucleo/index.d.ts",
        "dist/datos/index.js",
        "dist/datos/index.d.ts",
        "dist/datos/fix.js",
        "dist/datos/udis.js",
        "dist/datos/generados/inegi-municipios.js",
        "dist/datos/generados/inegi-municipios.d.ts",
      ]),
    );
    for (const ruta of rutas) {
      expect(ruta).toMatch(/^(dist\/[\w/-]+\.(js|d\.ts)|LICENSE|README\.md|package\.json)$/);
    }
  });
});
