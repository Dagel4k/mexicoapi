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
import { type ModuloCliente, probarClienteSinRed } from "../cliente/comun.ts";
import { probarCuradosSinRed } from "../cliente/curados.ts";
import { type Modulo, probarModulo } from "../comun.ts";
import {
  type ModuloDatos,
  type ModuloFix,
  type ModuloUdis,
  probarDatos,
  probarFix,
  probarUdis,
} from "../datos/comun.ts";
import {
  type ModuloCalendarios,
  type ModuloConstantes,
  probarCalendarios,
  probarConstantes,
} from "../datos/curados.ts";
import { type ModuloSepomex, probarSepomex } from "../sepomex/comun.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(RAIZ, "dist");
const CONSUMIDOR = fileURLToPath(new URL("./consumidor/", import.meta.url));
const CONSUMIDOR_DOM = fileURLToPath(new URL("./consumidor-dom/", import.meta.url));
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

describe("mexicoapi/cliente sin red desde dist", () => {
  probarClienteSinRed(async () => ({
    cliente: await importar<ModuloCliente>("cliente/index.js"),
    datos: await importar<ModuloDatos>("datos/index.js"),
    fix: await importar<ModuloFix>("datos/fix.js"),
    udis: await importar<ModuloUdis>("datos/udis.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("calendarios y constantes del cliente sin red desde dist", () => {
  probarCuradosSinRed(async () => ({
    cliente: await importar<ModuloCliente>("cliente/index.js"),
    calendarios: await importar<ModuloCalendarios>("datos/calendarios.js"),
    constantes: await importar<ModuloConstantes>("datos/constantes.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
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

describe("mexicoapi/datos/calendarios desde dist", () => {
  probarCalendarios(async () => ({
    calendarios: await importar<ModuloCalendarios>("datos/calendarios.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("mexicoapi/datos/constantes desde dist", () => {
  probarConstantes(() => importar<ModuloConstantes>("datos/constantes.js"));
});

describe("mexicoapi/datos/udis desde dist", () => {
  probarUdis(async () => ({
    udis: await importar<ModuloUdis>("datos/udis.js"),
    mexicoapi: await importar<Modulo>("index.js"),
  }));
});

describe("mexicoapi/sepomex desde dist", () => {
  probarSepomex(() => importar<ModuloSepomex>("sepomex/index.js"));
});

describe("dist", () => {
  it(`la entrada principal pesa ${LIMITE_GZIP_PRINCIPAL} bytes o menos con gzip`, async () => {
    const medida = await medirEntrada(join(DIST, "index.js"));
    expect(medida.archivos.length).toBeGreaterThan(1);
    expect(medida.gzip).toBeLessThanOrEqual(LIMITE_GZIP_PRINCIPAL);
  });

  it(`el cliente pesa ${LIMITE_GZIP_PRINCIPAL} bytes o menos con gzip, sin lo que carga al usar el paquete`, async () => {
    const medida = await medirEntrada(join(DIST, "cliente", "index.js"), { dinamicos: false });
    expect(medida.archivos.length).toBeGreaterThan(1);
    expect(medida.gzip).toBeLessThanOrEqual(LIMITE_GZIP_PRINCIPAL);
  });

  it("el cliente carga su respuesta del paquete, el núcleo y los datos solo al usarlos", async () => {
    const entrada = join(DIST, "cliente", "index.js");
    const enDist = (archivos: string[]) =>
      archivos.map((a) => relative(DIST, a).split(sep).join("/"));
    const alImportar = enDist((await grafoDeModulos(entrada, { dinamicos: false })).archivos);
    const todo = enDist((await grafoDeModulos(entrada)).archivos);
    // Del núcleo, al importar solo carga el catálogo de problemas (lo necesita el MexicoApiError
    // de una respuesta de la API) y las reglas de los valores de la ruta, que se revisan antes de
    // pedirla, con los catálogos de los que salen. Lo demás del núcleo, al usarlo.
    expect(alImportar.filter((a) => !a.startsWith("cliente/")).sort()).toEqual([
      "nucleo/dias-habiles/tipos.js",
      "nucleo/rutas/parametros.js",
      "nucleo/rutas/problemas.js",
    ]);
    expect(alImportar).not.toContain("cliente/paquete.js");
    const despues = todo.filter((a) => !alImportar.includes(a));
    expect(despues).toEqual(
      expect.arrayContaining([
        "cliente/paquete.js",
        "nucleo/index.js",
        "datos/estados.js",
        "datos/municipios.js",
        "datos/bancos.js",
        "datos/fix.js",
        "datos/udis.js",
        "datos/generados/inegi-municipios.js",
      ]),
    );
    for (const archivo of despues) {
      expect(archivo).toMatch(/^(cliente\/paquete(?:-[a-z]+)?\.js|nucleo\/|datos\/)/);
    }
    // Ni la entrada de datos completa: cada dataset se carga por separado.
    expect(despues).not.toContain("datos/index.js");
    expect(despues).not.toContain("datos/meta.js");
  });

  it("revisa como universales la entrada principal, el cliente y las de datos", () => {
    expect(entradasUniversales(manifiesto.exports).map((e) => e.ruta)).toEqual([
      ".",
      "./cliente",
      "./datos",
      "./datos/fix",
      "./datos/udis",
      "./datos/calendarios",
      "./datos/constantes",
    ]);
  });

  it("la entrada de SEPOMEX solo importa módulos de Node y archivos del paquete", async () => {
    const grafo = await grafoDeModulos(join(DIST, "sepomex", "index.js"));
    const externas = grafo.externas.map((e) => e.especificador);
    expect(externas).toEqual(expect.arrayContaining(["node:zlib", "node:https", "node:sqlite"]));
    for (const especificador of externas)
      expect(esModuloDeNode(especificador), especificador).toBe(true);
    const enDist = grafo.archivos.map((a) => relative(DIST, a).split(sep).join("/"));
    expect(enDist).toContain("datos/generados/inegi-municipios.js");
    expect(enDist).not.toContain("datos/index.js");
  });

  it.each(entradasUniversales(manifiesto.exports))(
    "la entrada $ruta no carga la de SEPOMEX",
    async ({ archivo }) => {
      const { archivos } = await grafoDeModulos(join(RAIZ, archivo));
      expect(archivos.filter((a) => relative(DIST, a).startsWith(`sepomex${sep}`))).toEqual([]);
    },
  );

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
    expect(await generadosDe("datos/calendarios.js")).toEqual([
      "dias-inhabiles-cnbv",
      "dias-inhabiles-sat",
    ]);
    expect(await generadosDe("datos/constantes.js")).toEqual([
      "constantes-salario-minimo",
      "constantes-uma",
      "isr-tarifas",
    ]);
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

  it("ningún archivo apunta a un mapa de fuentes", async () => {
    for (const archivo of await archivosDeDist()) {
      expect(await readFile(archivo, "utf8"), archivo).not.toMatch(/sourceMappingURL/);
    }
  });

  it.each([
    ["NodeNext", []],
    ["Bundler", ["--module", "preserve", "--moduleResolution", "bundler"]],
  ])("sus tipos compilan en un proyecto que lo usa con resolución %s", (_nombre, opciones) => {
    const r = spawnSync(process.execPath, [TSC, "-p", CONSUMIDOR, ...opciones], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("el cliente acepta el fetch y el AbortSignal de un proyecto con los tipos del DOM", () => {
    const r = spawnSync(process.execPath, [TSC, "-p", CONSUMIDOR_DOM], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
