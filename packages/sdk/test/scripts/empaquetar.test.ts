import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copiarNucleo,
  principal,
  reescribirImports,
  subrutasDelNucleo,
  ubicarNucleo,
} from "../../scripts/empaquetar.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/empaquetar.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-empaquetar-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

const leer = (ruta: string): Promise<string> => readFile(join(dir, ruta), "utf8");

async function listar(ruta: string): Promise<string[]> {
  const entradas = await readdir(join(dir, ruta), { recursive: true, withFileTypes: true });
  return entradas
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(join(dir, ruta).length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

/** Un núcleo compilado como lo deja `tsc` en packages/core, enlazado como lo hace pnpm. */
async function nucleoFalso(raiz = "sdk"): Promise<void> {
  const base = `${raiz}/node_modules/@mexicoapi/core`;
  await escribir(
    `${base}/package.json`,
    JSON.stringify({
      name: "@mexicoapi/core",
      exports: {
        ".": {
          "@mexicoapi/source": "./src/index.ts",
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
        "./curados": {
          "@mexicoapi/source": "./src/sub/curados.ts",
          types: "./dist/sub/curados.d.ts",
          import: "./dist/sub/curados.js",
        },
      },
    }),
  );
  await escribir(`${base}/dist/sub/curados.js`, 'export { a } from "../a.js";\n');
  await escribir(`${base}/dist/sub/curados.d.ts`, 'export { a } from "../a.js";\n');
  await escribir(`${base}/dist/index.js`, 'export { a } from "./a.js";\n');
  await escribir(`${base}/dist/index.d.ts`, 'export { a } from "./a.js";\n');
  await escribir(`${base}/dist/a.js`, "export const a = 1;\n");
  await escribir(`${base}/dist/a.d.ts`, "export declare const a = 1;\n");
}

describe("ubicarNucleo", () => {
  it("devuelve la entrada import del núcleo enlazado", async () => {
    await nucleoFalso();
    const entrada = await ubicarNucleo(join(dir, "sdk"));
    expect(entrada).toBe(join(dir, "sdk/node_modules/@mexicoapi/core/dist/index.js"));
  });

  it("pide compilar el núcleo si falta su dist", async () => {
    await nucleoFalso();
    await rm(join(dir, "sdk/node_modules/@mexicoapi/core/dist"), { recursive: true });
    await expect(ubicarNucleo(join(dir, "sdk"))).rejects.toThrow(
      /pnpm --filter @mexicoapi\/core build/,
    );
  });

  it("falla si el paquete no tiene @mexicoapi/core enlazado", async () => {
    await mkdir(join(dir, "sdk"), { recursive: true });
    await expect(ubicarNucleo(join(dir, "sdk"))).rejects.toThrow(/@mexicoapi\/core/);
  });

  it.each([
    [{ ".": { types: "./dist/index.d.ts" } }],
    [{ "./otra": { import: "./dist/otra.js" } }],
    [undefined],
  ])("falla si el núcleo no declara una entrada import en %j", async (exports) => {
    await escribir(
      "sdk/node_modules/@mexicoapi/core/package.json",
      JSON.stringify({ name: "@mexicoapi/core", exports }),
    );
    await expect(ubicarNucleo(join(dir, "sdk"))).rejects.toThrow(/entrada import/);
  });
});

describe("subrutasDelNucleo", () => {
  const paquete = () => join(dir, "sdk/node_modules/@mexicoapi/core");

  it("da la entrada import de cada subruta del núcleo", async () => {
    await nucleoFalso();
    const raiz = join(dir, "sdk");
    expect(await subrutasDelNucleo(raiz, await ubicarNucleo(raiz))).toEqual({
      "./curados": join(paquete(), "dist/sub/curados.js"),
    });
  });

  it.each([
    ["sin entrada import", { types: "./dist/sub/x.d.ts" }, /\.\/x no declara una entrada import/],
    ["fuera de la carpeta que se copia", { import: "./otra/x.js" }, /\.\/x está fuera de/],
    ["que no existe", { import: "./dist/sub/x.js" }, /Falta .*x\.js/],
  ])("falla con una subruta %s", async (_caso, x, error) => {
    await nucleoFalso();
    const manifiesto = JSON.parse(await leer("sdk/node_modules/@mexicoapi/core/package.json"));
    manifiesto.exports["./x"] = x;
    await escribir("sdk/node_modules/@mexicoapi/core/package.json", JSON.stringify(manifiesto));
    await escribir("sdk/node_modules/@mexicoapi/core/otra/x.js", "export {};\n");
    const raiz = join(dir, "sdk");
    await expect(subrutasDelNucleo(raiz, await ubicarNucleo(raiz))).rejects.toThrow(error);
  });
});

describe("copiarNucleo", () => {
  it("copia los .js y .d.ts del núcleo, con subcarpetas, y nada más", async () => {
    await escribir("core/index.js", "export {};\n");
    await escribir("core/index.d.ts", "export {};\n");
    await escribir("core/sub/x.js", "export const x = 1;\n");
    await escribir("core/sub/x.d.ts", "export declare const x = 1;\n");
    await escribir("core/sub/x.js.map", "{}");
    await escribir("core/tsconfig.tsbuildinfo", "{}");
    const copiados = await copiarNucleo(join(dir, "core/index.js"), join(dir, "dist/nucleo"));
    expect(copiados).toEqual(["index.d.ts", "index.js", "sub/x.d.ts", "sub/x.js"]);
    expect(await listar("dist/nucleo")).toEqual(copiados);
    expect(await leer("dist/nucleo/sub/x.js")).toBe("export const x = 1;\n");
  });

  it("borra lo que quedó de una copia anterior", async () => {
    await escribir("core/index.js", "export {};\n");
    await escribir("dist/nucleo/viejo.js", "export {};\n");
    await copiarNucleo(join(dir, "core/index.js"), join(dir, "dist/nucleo"));
    expect(await listar("dist/nucleo")).toEqual(["index.js"]);
  });

  it("falla si la entrada del núcleo no existe", async () => {
    await mkdir(join(dir, "core"), { recursive: true });
    await expect(
      copiarNucleo(join(dir, "core/index.js"), join(dir, "dist/nucleo")),
    ).rejects.toThrow(/index\.js/);
  });
});

describe("reescribirImports", () => {
  it("cambia @mexicoapi/core por la ruta relativa al núcleo en .js y .d.ts", async () => {
    await escribir("dist/nucleo/index.js", "export {};\n");
    await escribir("dist/index.js", 'export { a } from "@mexicoapi/core";\n');
    await escribir(
      "dist/index.d.ts",
      "export type { T } from '@mexicoapi/core';\nexport { a } from \"@mexicoapi/core\";\n",
    );
    await escribir(
      "dist/datos/index.js",
      'import { a } from "@mexicoapi/core";\nimport "@mexicoapi/core";\n' +
        'export const b = () => import("@mexicoapi/core");\n',
    );
    await escribir(
      "dist/datos/index.d.ts",
      'export declare const t: import("@mexicoapi/core").T;\n',
    );
    await escribir("dist/sin-nucleo.js", "export const c = 3;\n");

    const cambiados = await reescribirImports(join(dir, "dist"), join(dir, "dist/nucleo/index.js"));

    expect(cambiados).toEqual(["datos/index.d.ts", "datos/index.js", "index.d.ts", "index.js"]);
    expect(await leer("dist/index.js")).toBe('export { a } from "./nucleo/index.js";\n');
    expect(await leer("dist/index.d.ts")).toBe(
      "export type { T } from './nucleo/index.js';\nexport { a } from \"./nucleo/index.js\";\n",
    );
    expect(await leer("dist/datos/index.js")).toBe(
      'import { a } from "../nucleo/index.js";\nimport "../nucleo/index.js";\n' +
        'export const b = () => import("../nucleo/index.js");\n',
    );
    expect(await leer("dist/datos/index.d.ts")).toBe(
      'export declare const t: import("../nucleo/index.js").T;\n',
    );
    expect(await leer("dist/sin-nucleo.js")).toBe("export const c = 3;\n");
  });

  it("cambia una subruta del núcleo por la ruta relativa a su archivo", async () => {
    await escribir("dist/nucleo/index.js", "export {};\n");
    await escribir("dist/nucleo/sub/curados.js", "export {};\n");
    await escribir(
      "dist/cliente/x.js",
      'import { a } from "@mexicoapi/core";\nimport { b } from "@mexicoapi/core/curados";\n' +
        "export const c = () => import('@mexicoapi/core/curados');\n",
    );
    await escribir("dist/cliente/x.d.ts", 'export type { T } from "@mexicoapi/core/curados";\n');
    const cambiados = await reescribirImports(
      join(dir, "dist"),
      join(dir, "dist/nucleo/index.js"),
      { "./curados": join(dir, "dist/nucleo/sub/curados.js") },
    );
    expect(cambiados).toEqual(["cliente/x.d.ts", "cliente/x.js"]);
    expect(await leer("dist/cliente/x.js")).toBe(
      'import { a } from "../nucleo/index.js";\nimport { b } from "../nucleo/sub/curados.js";\n' +
        "export const c = () => import('../nucleo/sub/curados.js');\n",
    );
    expect(await leer("dist/cliente/x.d.ts")).toBe(
      'export type { T } from "../nucleo/sub/curados.js";\n',
    );
  });

  it("no toca los archivos del núcleo", async () => {
    const texto = '// copiado de "@mexicoapi/core"\nexport {};\n';
    await escribir("dist/nucleo/index.js", texto);
    await escribir("dist/index.js", 'export * from "@mexicoapi/core";\n');
    await reescribirImports(join(dir, "dist"), join(dir, "dist/nucleo/index.js"));
    expect(await leer("dist/nucleo/index.js")).toBe(texto);
  });

  it("falla si queda una mención que no es un import del núcleo", async () => {
    await escribir("dist/nucleo/index.js", "export {};\n");
    await escribir("dist/sub.js", 'export { a } from "@mexicoapi/core/fechas";\n');
    await expect(
      reescribirImports(join(dir, "dist"), join(dir, "dist/nucleo/index.js")),
    ).rejects.toThrow(/sub\.js.*@mexicoapi\/core/);
  });

  it("un comentario que nombra el núcleo también falla, y el mensaje lo dice", async () => {
    await escribir("dist/nucleo/index.js", "export {};\n");
    await escribir("dist/nota.js", "// Viene de @mexicoapi/core.\nexport const a = 1;\n");
    await expect(
      reescribirImports(join(dir, "dist"), join(dir, "dist/nucleo/index.js")),
    ).rejects.toThrow(
      "nota.js todavía menciona @mexicoapi/core después de reescribir sus imports: una subruta que el núcleo no exporta o un comentario que lo nombra (la revisión no distingue comentarios).",
    );
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
        salida: (texto: string) => salida.push(texto),
        errores: (texto: string) => errores.push(texto),
      },
    };
  }

  it("preparar borra dist si el núcleo ya está compilado", async () => {
    await nucleoFalso();
    await escribir("sdk/dist/viejo.js", "export {};\n");
    const c = consola();
    expect(await principal(["preparar"], c.opciones)).toBe(0);
    await expect(readdir(join(dir, "sdk/dist"))).rejects.toThrow();
  });

  it("preparar falla antes de tsc si falta compilar el núcleo, sin borrar dist", async () => {
    await nucleoFalso();
    await rm(join(dir, "sdk/node_modules/@mexicoapi/core/dist"), { recursive: true });
    await escribir("sdk/dist/viejo.js", "export {};\n");
    const c = consola();
    expect(await principal(["preparar"], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/compila el núcleo antes/);
    expect(await listar("sdk/dist")).toEqual(["viejo.js"]);
  });

  it("nucleo copia el núcleo a dist/nucleo y reescribe los imports, también los de subrutas", async () => {
    await nucleoFalso();
    await escribir("sdk/dist/index.js", 'export { a } from "@mexicoapi/core";\n');
    await escribir("sdk/dist/datos/x.js", 'export { a } from "@mexicoapi/core/curados";\n');
    const c = consola();
    expect(await principal(["nucleo"], c.opciones)).toBe(0);
    expect(await listar("sdk/dist")).toEqual([
      "datos/x.js",
      "index.js",
      "nucleo/a.d.ts",
      "nucleo/a.js",
      "nucleo/index.d.ts",
      "nucleo/index.js",
      "nucleo/sub/curados.d.ts",
      "nucleo/sub/curados.js",
    ]);
    expect(await leer("sdk/dist/index.js")).toBe('export { a } from "./nucleo/index.js";\n');
    expect(await leer("sdk/dist/datos/x.js")).toBe(
      'export { a } from "../nucleo/sub/curados.js";\n',
    );
    expect(c.salida.join("")).toMatch(/6 archivos del núcleo.*reescritos en 2 archivos\n/s);
    expect(c.errores).toEqual([]);
  });

  it("nucleo devuelve 1 con el motivo si falla", async () => {
    await mkdir(join(dir, "sdk/dist"), { recursive: true });
    const c = consola();
    expect(await principal(["nucleo"], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/@mexicoapi\/core/);
  });

  it.each([[[]], [["otro"]], [["nucleo", "extra"]]])(
    "con %j muestra el uso y devuelve 2",
    async (argv) => {
      const c = consola();
      expect(await principal(argv, c.opciones)).toBe(2);
      expect(c.errores.join("")).toMatch(/uso: node scripts\/empaquetar\.ts preparar\|nucleo/);
    },
  );

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});
