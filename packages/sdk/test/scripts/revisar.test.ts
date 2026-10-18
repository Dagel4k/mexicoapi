import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENTRADAS_SOLO_NODE,
  entradasUniversales,
  esModuloDeNode,
  especificadores,
  grafoDeModulos,
  IMPORT_DINAMICO,
  medirEntrada,
} from "../../scripts/revisar.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-revisar-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

describe("especificadores", () => {
  it("encuentra los imports y reexports estáticos y dinámicos que emite tsc", () => {
    const codigo = [
      'import a from "./a.js";',
      'import { b, c as d } from "./b.js";',
      'import * as e from "../e.js";',
      'import f, { g } from "./f.js";',
      'import "./efecto.js";',
      'export { h } from "./h.js";',
      'export * from "./todo.js";',
      'export * as ns from "./ns.js";',
      "import { i, } from './comillas.js';",
      'import {\n  j,\n  k,\n} from "./varias-lineas.js";',
      'const l = await import("./dinamico.js");',
      'export const m = () => import ( "node:fs" );',
    ].join("\n");
    expect(especificadores(codigo)).toEqual([
      "./a.js",
      "./b.js",
      "../e.js",
      "./f.js",
      "./efecto.js",
      "./h.js",
      "./todo.js",
      "./ns.js",
      "./comillas.js",
      "./varias-lineas.js",
      "./dinamico.js",
      "node:fs",
    ]);
  });

  it("encuentra imports compactos, sin espacios ni saltos de línea", () => {
    const codigo = [
      'import{a}from"./a.js";export*from"./b.js";',
      "export*as ns from'./c.js';import d,{e as f}from\"./d.js\";",
      'import"./efecto.js";import*as g from"./g.js";',
      'export{h}from"./h.js";const i=()=>import("./i.js");',
      'import{fromage}from"./j.js";',
    ].join("");
    expect(especificadores(codigo)).toEqual([
      "./a.js",
      "./b.js",
      "./c.js",
      "./d.js",
      "./efecto.js",
      "./g.js",
      "./h.js",
      "./i.js",
      "./j.js",
    ]);
  });

  it("encuentra imports después de un comentario o de otra sentencia en la misma línea", () => {
    const codigo = [
      '/* encabezado */ import { a } from "./a.js";',
      '"use strict"; import "./b.js";',
      'const c = 1; export { c as d } from "./d.js";',
      '// línea\nexport * from "./e.js";',
    ].join("\n");
    expect(especificadores(codigo)).toEqual(["./a.js", "./b.js", "./d.js", "./e.js"]);
  });

  it("ignora lo que no es un import", () => {
    const codigo = [
      'export const ruta = "./no.js";',
      'export default "./tampoco.js";',
      "const url = new URL(import.meta.url);",
      'const texto = "import x from \\"./texto.js\\"";',
      "export function desde() { return Array.from([1]); }",
      'module.exports = "./cjs.js"; const imports = "./variable.js";',
      'objeto.import("./metodo.js"); const exportar = { from: "./clave.js" };',
      'const $import = (x) => x; $import("./identificador.js");',
    ].join("\n");
    expect(especificadores(codigo)).toEqual([]);
  });

  it("marca un import dinámico que no es literal", () => {
    expect(especificadores('const m = await import("node:" + nombre);')).toEqual([IMPORT_DINAMICO]);
    expect(especificadores("const m = await import(ruta);")).toEqual([IMPORT_DINAMICO]);
  });
});

describe("esModuloDeNode", () => {
  it.each(["node:fs", "node:sqlite", "fs", "fs/promises", "path/posix", "process", "zlib"])(
    "%s es de Node",
    (especificador) => {
      expect(esModuloDeNode(especificador)).toBe(true);
    },
  );

  it.each(["./fs.js", "../path.js", "mexicoapi", "@mexicoapi/core", "fsx", IMPORT_DINAMICO])(
    "%s no es de Node",
    (especificador) => {
      expect(esModuloDeNode(especificador)).toBe(false);
    },
  );
});

describe("grafoDeModulos", () => {
  it("sigue los imports relativos desde la entrada y junta los externos", async () => {
    await escribir("dist/index.js", 'export * from "./a.js";\nimport "./sub/b.js";\n');
    await escribir("dist/a.js", 'import { b } from "./sub/b.js";\nexport const a = b;\n');
    await escribir(
      "dist/sub/b.js",
      'import { a } from "../a.js";\nimport { x } from "node:fs";\nexport const b = () => import("./c.js");\n',
    );
    await escribir("dist/sub/c.js", 'import "fs";\nimport "algun-paquete";\n');
    await escribir("dist/fuera.js", 'import "node:path";\n');

    const grafo = await grafoDeModulos(join(dir, "dist/index.js"));

    expect(grafo.archivos).toEqual([
      join(dir, "dist/index.js"),
      join(dir, "dist/a.js"),
      join(dir, "dist/sub/b.js"),
      join(dir, "dist/sub/c.js"),
    ]);
    expect(grafo.externas).toEqual([
      { archivo: join(dir, "dist/sub/b.js"), especificador: "node:fs" },
      { archivo: join(dir, "dist/sub/c.js"), especificador: "fs" },
      { archivo: join(dir, "dist/sub/c.js"), especificador: "algun-paquete" },
    ]);
  });

  it("falla si un import relativo no existe", async () => {
    await escribir("dist/index.js", 'export * from "./falta.js";\n');
    await expect(grafoDeModulos(join(dir, "dist/index.js"))).rejects.toThrow(
      /index\.js importa \.\/falta\.js/,
    );
  });
});

describe("medirEntrada", () => {
  it("suma los bytes del grafo y mide el gzip de los archivos concatenados", async () => {
    const index = 'export * from "./a.js";\n';
    const a = `export const a = ${JSON.stringify("México ".repeat(50))};\n`;
    await escribir("dist/index.js", index);
    await escribir("dist/a.js", a);
    await escribir("dist/b.js", "export const b = 2;\n");

    const medida = await medirEntrada(join(dir, "dist/index.js"));

    const bytesIndex = await readFile(join(dir, "dist/index.js"));
    const bytesA = await readFile(join(dir, "dist/a.js"));
    expect(medida.archivos).toEqual([join(dir, "dist/index.js"), join(dir, "dist/a.js")]);
    expect(medida.bytes).toBe(bytesIndex.length + bytesA.length);
    expect(medida.gzip).toBe(gzipSync(Buffer.concat([bytesIndex, bytesA])).length);
    expect(medida.gzip).toBeLessThan(medida.bytes);
    expect(medida.externas).toEqual([]);
  });
});

describe("entradasUniversales", () => {
  it("toma las entradas con import salvo las de Node y package.json", () => {
    expect([...ENTRADAS_SOLO_NODE]).toEqual(expect.arrayContaining(["./sepomex", "./cli"]));
    const entradas = entradasUniversales({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./datos": { types: "./dist/datos/index.d.ts", import: "./dist/datos/index.js" },
      "./sepomex": { types: "./dist/sepomex/index.d.ts", import: "./dist/sepomex/index.js" },
      "./package.json": "./package.json",
      "./nula": null,
      "./sin-import": { types: "./dist/sin-import.d.ts" },
    });
    expect(entradas).toEqual([
      { ruta: ".", archivo: "./dist/index.js" },
      { ruta: "./datos", archivo: "./dist/datos/index.js" },
    ]);
  });
});
