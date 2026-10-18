import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cargarEsbuild,
  type Esbuild,
  empaquetarEntradas,
  principal,
} from "../../scripts/navegador.ts";
import { LIMITE_GZIP_PRINCIPAL } from "../../scripts/revisar.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/navegador.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-navegador-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

/** Instala en `dir` un mexicoapi falso con esos archivos y un `exports` con una entrada por cada uno. */
async function paqueteFalso(entradas: Record<string, string>, otros: Record<string, string> = {}) {
  const exports: Record<string, unknown> = {};
  for (const ruta of Object.keys(entradas)) {
    const archivo = ruta === "." ? "./dist/index.js" : `./dist/${ruta.slice(2)}.js`;
    exports[ruta] = { types: archivo.replace(/\.js$/, ".d.ts"), import: archivo, default: archivo };
  }
  exports["./package.json"] = "./package.json";
  const manifiesto = { name: "mexicoapi", version: "1.2.3", type: "module", exports };
  await escribir("node_modules/mexicoapi/package.json", JSON.stringify(manifiesto));
  for (const [ruta, codigo] of Object.entries(entradas)) {
    const archivo = ruta === "." ? "dist/index.js" : `dist/${ruta.slice(2)}.js`;
    await escribir(join("node_modules/mexicoapi", archivo), codigo);
  }
  for (const [ruta, codigo] of Object.entries(otros)) await escribir(ruta, codigo);
}

function consola() {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    salida,
    errores,
    opciones: {
      salida: (texto: string) => salida.push(texto),
      errores: (texto: string) => errores.push(texto),
    },
  };
}

describe("cargarEsbuild", () => {
  it("da el esbuild que trae wrangler, sin ser dependencia de este paquete", async () => {
    const require = createRequire(import.meta.url);
    const wrangler = JSON.parse(
      await readFile(require.resolve("wrangler/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const esbuild = cargarEsbuild();
    expect(esbuild.version).toBe(wrangler.dependencies.esbuild);
    expect(typeof esbuild.build).toBe("function");
  });
});

describe("empaquetarEntradas", () => {
  it("empaqueta cada entrada universal por su nombre y mide el bundle con gzip", async () => {
    await paqueteFalso(
      {
        ".": 'export { sumar } from "./util.js";\n',
        "./datos": 'export const datos = ["a", "b"];\n',
        "./sepomex": 'import { gunzipSync } from "node:zlib";\nexport const cp = gunzipSync;\n',
      },
      { "node_modules/mexicoapi/dist/util.js": "export const sumar = (a, b) => a + b;\n" },
    );
    const entradas = await empaquetarEntradas(dir);
    expect(entradas.map((e) => [e.ruta, e.especificador, e.problemas])).toEqual([
      [".", "mexicoapi", []],
      ["./datos", "mexicoapi/datos", []],
    ]);
    for (const e of entradas) {
      expect(e.bytes).toBeGreaterThan(0);
      expect(e.gzip).toBeGreaterThan(0);
    }
  });

  it("señala cada módulo de Node que importa una entrada, con o sin node: y aunque sea indirecto", async () => {
    await paqueteFalso(
      { ".": 'export * from "./uno.js";\n' },
      {
        "node_modules/mexicoapi/dist/uno.js":
          'import { readFileSync } from "node:fs";\nexport * from "./dos.js";\nexport const leer = readFileSync;\n',
        "node_modules/mexicoapi/dist/dos.js":
          'import { join } from "path";\nexport const unir = join;\nexport const azar = () => import("node:crypto");\n',
      },
    );
    const [principal] = await empaquetarEntradas(dir);
    expect(principal?.problemas).toEqual([
      "importa node:fs (en node_modules/mexicoapi/dist/uno.js)",
      "importa path (en node_modules/mexicoapi/dist/dos.js)",
      "importa node:crypto (en node_modules/mexicoapi/dist/dos.js)",
    ]);
  });

  it("falla la entrada principal que pasa del tope con gzip, pero no las demás", async () => {
    const pesado = `export const relleno = ${JSON.stringify(randomBytes(30_000).toString("base64"))};\n`;
    await paqueteFalso({ ".": pesado, "./datos": pesado });
    const [principal, datos] = await empaquetarEntradas(dir);
    expect(principal?.gzip).toBeGreaterThan(LIMITE_GZIP_PRINCIPAL);
    expect(principal?.problemas).toEqual([
      `pesa ${principal?.gzip} bytes con gzip; el tope de la entrada principal es ${LIMITE_GZIP_PRINCIPAL}`,
    ]);
    expect(datos?.gzip).toBeGreaterThan(LIMITE_GZIP_PRINCIPAL);
    expect(datos?.problemas).toEqual([]);
  });

  it("señala lo que no se puede resolver", async () => {
    await paqueteFalso({ ".": 'export * from "./falta.js";\n' });
    const [principal] = await empaquetarEntradas(dir);
    expect(principal?.bytes).toBe(0);
    expect(principal?.problemas).toEqual([
      expect.stringMatching(
        /Could not resolve "\.\/falta\.js" \(node_modules\/mexicoapi\/dist\/index\.js:1\)/,
      ),
    ]);
  });

  it("señala los archivos que carga de fuera del paquete", async () => {
    await paqueteFalso(
      { ".": 'export { otro } from "otro";\n' },
      {
        "node_modules/otro/package.json": '{"name":"otro","type":"module","main":"index.js"}',
        "node_modules/otro/index.js": "export const otro = 1;\n",
      },
    );
    const [principal] = await empaquetarEntradas(dir);
    expect(principal?.problemas).toEqual([
      "carga node_modules/otro/index.js, de fuera del paquete",
    ]);
  });

  it("deja pasar un error de esbuild que no es de empaquetado", async () => {
    await paqueteFalso({ ".": "export const a = 1;\n" });
    const roto: Esbuild = {
      version: "0.0.0",
      build: () => Promise.reject(new Error("el servicio de esbuild se detuvo")),
    };
    await expect(empaquetarEntradas(dir, roto)).rejects.toThrow(/se detuvo/);
  });

  it("dice un error de esbuild sin ubicación tal cual", async () => {
    await paqueteFalso({ ".": "export const a = 1;\n" });
    const sinUbicacion: Esbuild = {
      version: "0.0.0",
      build: () =>
        Promise.reject(
          Object.assign(new Error("Build failed"), {
            errors: [{ text: "no hay memoria", location: null }],
          }),
        ),
    };
    const [principal] = await empaquetarEntradas(dir, sinUbicacion);
    expect(principal?.problemas).toEqual(["no hay memoria"]);
  });

  it.each([0, 2])("falla si esbuild da %i archivos en vez de uno", async (cuantos) => {
    await paqueteFalso({ ".": "export const a = 1;\n" });
    const raro: Esbuild = {
      version: "0.0.0",
      build: () =>
        Promise.resolve({
          outputFiles: Array.from({ length: cuantos }, () => ({ contents: new Uint8Array(1) })),
          metafile: { inputs: {} },
        }),
    };
    await expect(empaquetarEntradas(dir, raro)).rejects.toThrow(
      `esbuild dio ${cuantos} archivos para mexicoapi, no uno`,
    );
  });

  it("no empaqueta nada si el paquete no declara exports", async () => {
    await escribir("node_modules/mexicoapi/package.json", '{"name":"mexicoapi","main":"i.js"}');
    expect(await empaquetarEntradas(dir)).toEqual([]);
  });

  it("falla si mexicoapi no está instalado en el proyecto", async () => {
    await expect(empaquetarEntradas(dir)).rejects.toThrow(/package\.json/);
  });
});

describe("principal", () => {
  it("dice la versión de esbuild y lo que pesa cada entrada, y devuelve 0", async () => {
    await paqueteFalso({ ".": "export const a = 1;\n", "./datos": "export const b = 2;\n" });
    const c = consola();
    expect(await principal([dir], c.opciones)).toBe(0);
    const salida = c.salida.join("");
    expect(salida).toMatch(/^navegador: esbuild \d+\.\d+\.\d+, platform browser, format esm$/m);
    expect(salida).toMatch(
      new RegExp(
        `^navegador: mexicoapi: \\d+ bytes, \\d+ con gzip \\(tope ${LIMITE_GZIP_PRINCIPAL}\\)$`,
        "m",
      ),
    );
    expect(salida).toMatch(/^navegador: mexicoapi\/datos: \d+ bytes, \d+ con gzip$/m);
    expect(salida).toMatch(/^navegador: OK$/m);
    expect(c.errores).toEqual([]);
  });

  it("devuelve 1 con cada problema", async () => {
    await paqueteFalso({
      ".": 'import "node:fs";\nexport const a = 1;\n',
      "./datos": 'export * from "./falta.js";\n',
    });
    const c = consola();
    expect(await principal([dir], c.opciones)).toBe(1);
    const errores = c.errores.join("");
    expect(errores).toMatch(/^navegador: mexicoapi: importa node:fs /m);
    expect(errores).toMatch(/^navegador: mexicoapi\/datos: Could not resolve/m);
    expect(c.salida.join("")).not.toMatch(/OK/);
  });

  it("devuelve 1 si el paquete no declara su entrada principal", async () => {
    await paqueteFalso({ "./datos": "export const b = 2;\n" });
    const c = consola();
    expect(await principal([dir], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^navegador: .*entrada principal/m);
  });

  it("devuelve 1 con el motivo si no encuentra el paquete", async () => {
    const c = consola();
    expect(await principal([dir], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^navegador: .*package\.json/);
  });

  it.each([[[]], [["a", "b"]]])("con %j muestra el uso y devuelve 2", async (argv) => {
    const c = consola();
    expect(await principal(argv, c.opciones)).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/navegador\.ts <proyecto>/);
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});
