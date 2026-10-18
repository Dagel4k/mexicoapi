import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armarPublicable,
  manifiestoPublicable,
  principal,
  revisarHistorial,
} from "../../scripts/publicable.ts";

// cp de verdad, salvo cuando una prueba pide que falle después de `copiasBuenas` llamadas.
const fallo = vi.hoisted(() => ({ copiasBuenas: Number.POSITIVE_INFINITY }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    cp: async (...args: Parameters<typeof real.cp>) => {
      if (fallo.copiasBuenas <= 0) throw new Error("ENOSPC: disco lleno");
      fallo.copiasBuenas -= 1;
      return real.cp(...args);
    },
  };
});

const SCRIPT = fileURLToPath(new URL("../../scripts/publicable.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-publicable-"));
});

afterEach(async () => {
  fallo.copiasBuenas = Number.POSITIVE_INFINITY;
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

/** Un manifiesto como el de packages/sdk, con lo que solo sirve en el repositorio. */
const MANIFIESTO = {
  name: "mexicoapi",
  version: "1.2.3",
  type: "module",
  main: "./dist/index.js",
  bin: { mexicoapi: "dist/cli/index.js" },
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" },
    "./package.json": "./package.json",
  },
  files: ["dist", "README.md", "CHANGELOG.md", "LICENSE"],
  scripts: { build: "tsc", prepack: "node scripts/publicable.ts" },
  dependencies: {},
  devDependencies: { "@mexicoapi/core": "workspace:*", wrangler: "4.149.0" },
};

/** Un packages/sdk compilado en `dir/sdk`. */
async function paqueteFalso(manifiesto: object = MANIFIESTO): Promise<void> {
  await escribir("sdk/package.json", `${JSON.stringify(manifiesto, null, 2)}\n`);
  await escribir("sdk/dist/index.js", "export const a = 1;\n");
  await escribir("sdk/dist/index.d.ts", "export declare const a = 1;\n");
  await escribir("sdk/dist/cli/index.js", "#!/usr/bin/env node\n");
  await escribir("sdk/README.md", "# mexicoapi\n");
  await escribir("sdk/LICENSE", "MIT\n");
  await escribir("sdk/CHANGELOG.md", "# Cambios\n\n## 1.2.3 (sin publicar)\n\n- primera versión\n");
  await escribir("sdk/src/index.ts", "export const a = 1;\n");
  await escribir("sdk/node_modules/x/index.js", "\n");
}

function consola() {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    salida,
    errores,
    opciones: {
      raiz: join(dir, "sdk"),
      salida: (t: string) => salida.push(t),
      errores: (t: string) => errores.push(t),
    },
  };
}

describe("manifiestoPublicable", () => {
  it("quita devDependencies y scripts y deja lo demás igual", () => {
    const { devDependencies: _d, scripts: _s, ...resto } = MANIFIESTO;
    const publicable = manifiestoPublicable(MANIFIESTO);
    expect(publicable).toEqual(resto);
    expect(Object.keys(publicable)).toEqual(Object.keys(resto));
    expect(JSON.stringify(publicable)).not.toMatch(/@mexicoapi\/|workspace:/);
  });

  it("no cambia el manifiesto que recibe", () => {
    const copia = structuredClone(MANIFIESTO);
    manifiestoPublicable(copia);
    expect(copia).toEqual(MANIFIESTO);
  });

  it.each([
    [{ dependencies: { "@mexicoapi/core": "workspace:*" } }, /@mexicoapi\/core/],
    [{ peerDependencies: { x: "workspace:^" } }, /workspace:/],
    [{ optionalDependencies: { "@mexicoapi/pipeline": "0.0.0" } }, /@mexicoapi\/pipeline/],
  ])("rechaza un paquete interno en lo que queda (%j)", (extra, mensaje) => {
    expect(() => manifiestoPublicable({ ...MANIFIESTO, ...extra })).toThrow(mensaje);
  });

  it("publica con su versión los rangos workspace: de las dependencias indicadas", () => {
    const manifiesto = {
      ...MANIFIESTO,
      name: "mexicoapi-mcp",
      dependencies: { a: "1.0.0", mexicoapi: "workspace:*", z: "2.0.0" },
      peerDependencies: { mexicoapi: "workspace:^" },
    };
    const publicable = manifiestoPublicable(manifiesto, { mexicoapi: "^1.2.3" });
    expect(publicable.dependencies).toEqual({ a: "1.0.0", mexicoapi: "^1.2.3", z: "2.0.0" });
    expect(Object.keys(publicable.dependencies as object)).toEqual(["a", "mexicoapi", "z"]);
    expect(publicable.peerDependencies).toEqual({ mexicoapi: "^1.2.3" });
    expect(Object.keys(publicable)).toEqual(
      Object.keys(manifiesto).filter((c) => c !== "devDependencies" && c !== "scripts"),
    );
    // El del repositorio no se toca.
    expect(manifiesto.dependencies.mexicoapi).toBe("workspace:*");
  });

  it("deja igual un rango que no es workspace: aunque traiga versión indicada", () => {
    const manifiesto = { ...MANIFIESTO, dependencies: { mexicoapi: "0.1.0" } };
    expect(manifiestoPublicable(manifiesto, { mexicoapi: "^9.9.9" }).dependencies).toEqual({
      mexicoapi: "0.1.0",
    });
  });

  it("rechaza un workspace: sin versión indicada", () => {
    const manifiesto = {
      ...MANIFIESTO,
      dependencies: { mexicoapi: "workspace:*", otro: "workspace:*" },
    };
    expect(() => manifiestoPublicable(manifiesto, { mexicoapi: "^1.2.3" })).toThrow(/workspace:/);
  });

  it("rechaza una versión indicada que es otro rango workspace:", () => {
    const manifiesto = { ...MANIFIESTO, dependencies: { mexicoapi: "workspace:*" } };
    expect(() => manifiestoPublicable(manifiesto, { mexicoapi: "workspace:^" })).toThrow(
      /workspace:/,
    );
  });
});

describe("revisarHistorial", () => {
  const conHistorial = async (changelog: string | null): Promise<string> => {
    await escribir("pkg/package.json", '{ "name": "mexicoapi", "version": "1.2.3" }\n');
    if (changelog !== null) await escribir("pkg/CHANGELOG.md", changelog);
    return join(dir, "pkg");
  };

  it("acepta un primer encabezado que empieza con la versión", async () => {
    const carpeta = await conHistorial(
      "# Cambios\n\n## 1.2.3 (sin publicar)\n\n## 1.2.2 (2026-01-01)\n",
    );
    await expect(revisarHistorial(carpeta)).resolves.toBeUndefined();
    const fechada = await conHistorial("# Cambios\n\n## 1.2.3 (2026-10-20)\n");
    await expect(revisarHistorial(fechada)).resolves.toBeUndefined();
  });

  it("el de packages/sdk empieza con su versión", async () => {
    await expect(
      revisarHistorial(fileURLToPath(new URL("../../", import.meta.url))),
    ).resolves.toBeUndefined();
  });

  it("falla si falta el archivo", async () => {
    await expect(revisarHistorial(await conHistorial(null))).rejects.toThrow(/CHANGELOG\.md/);
  });

  it("falla si el primer encabezado es de otra versión", async () => {
    const carpeta = await conHistorial(
      "# Cambios\n\n## 1.2.2 (2026-01-01)\n\n## 1.2.3 (sin publicar)\n",
    );
    await expect(revisarHistorial(carpeta)).rejects.toThrow(/1\.2\.2.*1\.2\.3/s);
  });

  it("acepta una pre-versión y no la confunde con su versión final", async () => {
    await escribir("pkg/package.json", '{ "name": "mexicoapi", "version": "0.1.0-rc.1" }\n');
    await escribir("pkg/CHANGELOG.md", "# Cambios\n\n## 0.1.0-rc.1 (sin publicar)\n");
    await expect(revisarHistorial(join(dir, "pkg"))).resolves.toBeUndefined();
    await escribir("pkg/CHANGELOG.md", "# Cambios\n\n## 0.1.0 (sin publicar)\n");
    await expect(revisarHistorial(join(dir, "pkg"))).rejects.toThrow(/0\.1\.0-rc\.1/);
  });

  it("acepta un CHANGELOG.md con CRLF y no deja el retorno de carro en el error", async () => {
    const crlf = await conHistorial("# Cambios\r\n\r\n## 1.2.3 (sin publicar)\r\n\r\n- algo\r\n");
    await expect(revisarHistorial(crlf)).resolves.toBeUndefined();
    const soloVersion = await conHistorial("# Cambios\r\n\r\n## 1.2.3\r\n");
    await expect(revisarHistorial(soloVersion)).resolves.toBeUndefined();
    const otra = await conHistorial("# Cambios\r\n\r\n## 1.2.2 (2026-01-01)\r\n");
    await expect(revisarHistorial(otra)).rejects.toThrow('es "## 1.2.2 (2026-01-01)", pero');
  });

  it("no confunde 1.2.30 con 1.2.3 y falla sin encabezados", async () => {
    const otra = await conHistorial("# Cambios\n\n## 1.2.30 (x)\n");
    await expect(revisarHistorial(otra)).rejects.toThrow();
    const vacio = await conHistorial("# Cambios\n");
    await expect(revisarHistorial(vacio)).rejects.toThrow(/encabezado/);
  });
});

describe("armarPublicable", () => {
  it("copia lo que lista files y escribe el manifiesto publicable", async () => {
    await paqueteFalso();
    const destino = join(dir, "publicable");
    expect(await armarPublicable(join(dir, "sdk"), destino)).toEqual(MANIFIESTO.files);
    expect(await listar("publicable")).toEqual([
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "dist/cli/index.js",
      "dist/index.d.ts",
      "dist/index.js",
      "package.json",
    ]);
    expect(JSON.parse(await leer("publicable/package.json"))).toEqual(
      manifiestoPublicable(MANIFIESTO),
    );
    expect(await leer("publicable/package.json")).toMatch(/^\{\n {2}"name": "mexicoapi",.*\}\n$/s);
    // El de packages/sdk no se toca.
    expect(JSON.parse(await leer("sdk/package.json"))).toEqual(MANIFIESTO);
  });

  it("falla sin dejar nada si el historial no es de la versión", async () => {
    await paqueteFalso();
    await escribir("sdk/CHANGELOG.md", "# Cambios\n\n## 0.0.1 (sin publicar)\n");
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      /0\.0\.1/,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("acepta un destino vacío que ya existe", async () => {
    await paqueteFalso();
    await mkdir(join(dir, "vacio"));
    await armarPublicable(join(dir, "sdk"), join(dir, "vacio"));
    expect(await listar("vacio")).toContain("package.json");
  });

  it("no escribe en un destino con archivos", async () => {
    await paqueteFalso();
    await escribir("ocupado/algo.txt", "no borrar\n");
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "ocupado"))).rejects.toThrow(
      /no está vacío/,
    );
    expect(await listar("ocupado")).toEqual(["algo.txt"]);
  });

  it("no escribe dentro del paquete", async () => {
    await paqueteFalso();
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "sdk", "publicable"))).rejects.toThrow(
      /fuera de/,
    );
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "sdk"))).rejects.toThrow(/fuera de/);
  });

  it("falla si falta algo de files, sin dejar el destino a medias", async () => {
    await paqueteFalso();
    await rm(join(dir, "sdk", "README.md"));
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      /README\.md/,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it.each([
    ["una entrada de exports", "dist/index.js", /\.\/dist\/index\.js/],
    ["el binario", "dist/cli/index.js", /dist\/cli\/index\.js/],
  ])("falla si %s apunta a un archivo que no se compiló", async (_que, archivo, mensaje) => {
    await paqueteFalso();
    await rm(join(dir, "sdk", archivo));
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      mensaje,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("si falla una copia, borra la carpeta que creó", async () => {
    await paqueteFalso();
    fallo.copiasBuenas = 1;
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      /disco lleno/,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("si falla una copia en un destino vacío que ya existía, lo deja vacío", async () => {
    await paqueteFalso();
    await mkdir(join(dir, "vacio"));
    fallo.copiasBuenas = 2;
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "vacio"))).rejects.toThrow(
      /disco lleno/,
    );
    expect(await readdir(join(dir, "vacio"))).toEqual([]);
  });

  it("escribe las dependencias workspace: con la versión indicada", async () => {
    const manifiesto = { ...MANIFIESTO, dependencies: { mexicoapi: "workspace:*" } };
    await paqueteFalso(manifiesto);
    await armarPublicable(join(dir, "sdk"), join(dir, "publicable"), { mexicoapi: "^1.2.3" });
    const publicado = JSON.parse(await leer("publicable/package.json"));
    expect(publicado.dependencies).toEqual({ mexicoapi: "^1.2.3" });
    expect(publicado).toEqual(manifiestoPublicable(manifiesto, { mexicoapi: "^1.2.3" }));
  });

  it("falla si queda un workspace: sin versión, sin escribir nada", async () => {
    await paqueteFalso({ ...MANIFIESTO, dependencies: { mexicoapi: "workspace:*" } });
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      /workspace:/,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("si falta algo de files, dice cómo compilar ese paquete", async () => {
    await paqueteFalso({ ...MANIFIESTO, name: "otro-paquete" });
    await rm(join(dir, "sdk", "dist"), { recursive: true });
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      "pnpm --filter otro-paquete... build",
    );
  });

  it("falla si el manifiesto no trae files", async () => {
    const { files: _f, ...sinFiles } = MANIFIESTO;
    await paqueteFalso(sinFiles);
    await expect(armarPublicable(join(dir, "sdk"), join(dir, "publicable"))).rejects.toThrow(
      /files/,
    );
  });
});

describe("principal", () => {
  it("arma el paquete y dice dónde", async () => {
    await paqueteFalso();
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(0);
    expect(c.salida.join("")).toMatch(/mexicoapi@1\.2\.3 .*publicable.*npm pack.*npm publish/s);
    expect(c.errores).toEqual([]);
    expect(await listar("publicable")).toContain("package.json");
  });

  it("publica las dependencias workspace: con las versiones que recibe", async () => {
    await paqueteFalso({ ...MANIFIESTO, dependencies: { mexicoapi: "workspace:*" } });
    const c = consola();
    const opciones = { ...c.opciones, versiones: { mexicoapi: "^1.2.3" } };
    expect(await principal([join(dir, "publicable")], opciones)).toBe(0);
    expect(JSON.parse(await leer("publicable/package.json")).dependencies).toEqual({
      mexicoapi: "^1.2.3",
    });
  });

  it("devuelve 1 con el motivo si falla", async () => {
    await paqueteFalso();
    await rm(join(dir, "sdk", "dist"), { recursive: true });
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^publicable: .*dist/);
  });

  it.each([[[]], [["a", "b"]]])("con %j muestra el uso y devuelve 2", async (argv) => {
    const c = consola();
    expect(await principal(argv, c.opciones)).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/publicable\.ts <destino>/);
  });

  it("como prepack de npm se niega: el paquete no se empaqueta desde packages/sdk", async () => {
    await paqueteFalso();
    const c = consola();
    expect(await principal([], { ...c.opciones, evento: "prepack" })).toBe(1);
    expect(c.errores.join("")).toMatch(/no se empaqueta desde aquí.*publicable\.ts <destino>/s);
  });

  it("como prepack nombra el paquete que se intentó empaquetar", async () => {
    await paqueteFalso({ ...MANIFIESTO, name: "otro-paquete" });
    const c = consola();
    expect(await principal([], { ...c.opciones, evento: "prepack" })).toBe(1);
    expect(c.errores.join("")).toMatch(/^publicable: otro-paquete no se empaqueta desde aquí/);
    const sinManifiesto = consola();
    const opciones = { ...sinManifiesto.opciones, raiz: join(dir, "no-existe"), evento: "prepack" };
    expect(await principal([], opciones)).toBe(1);
    expect(sinManifiesto.errores.join("")).toMatch(/^publicable: el paquete no se empaqueta/);
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});
