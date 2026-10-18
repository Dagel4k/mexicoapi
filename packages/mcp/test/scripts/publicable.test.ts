import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifiestoPublicable } from "../../../sdk/scripts/publicable.ts";
import { principal, rangoMexicoapi } from "../../scripts/publicable.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/publicable.ts", import.meta.url));
const MCP = fileURLToPath(new URL("../../", import.meta.url));
const SDK = fileURLToPath(new URL("../../../sdk/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-mcp-publicable-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

const leerJson = async (ruta: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(ruta, "utf8")) as Record<string, unknown>;

/** Un manifiesto como el de packages/mcp, con lo que solo sirve en el repositorio. */
const MANIFIESTO = {
  name: "mexicoapi-mcp",
  version: "0.4.0",
  type: "module",
  bin: { "mexicoapi-mcp": "dist/index.js" },
  files: ["dist", "README.md", "LICENSE"],
  scripts: { build: "tsc", prepack: "node scripts/publicable.ts" },
  dependencies: { mexicoapi: "workspace:*" },
  devDependencies: { "@modelcontextprotocol/sdk": "1.0.0" },
};

/** packages/sdk y packages/mcp compilados, en `dir/sdk` y `dir/mcp`. */
async function repoFalso(sdk: object = { name: "mexicoapi", version: "1.2.3" }): Promise<void> {
  await escribir("sdk/package.json", `${JSON.stringify(sdk)}\n`);
  await escribir("mcp/package.json", `${JSON.stringify(MANIFIESTO, null, 2)}\n`);
  await escribir("mcp/dist/index.js", "#!/usr/bin/env node\n");
  await escribir("mcp/README.md", "# mexicoapi-mcp\n");
  await escribir("mcp/LICENSE", "MIT\n");
}

function consola() {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    salida,
    errores,
    opciones: {
      raiz: join(dir, "mcp"),
      raizSdk: join(dir, "sdk"),
      salida: (t: string) => salida.push(t),
      errores: (t: string) => errores.push(t),
    },
  };
}

describe("rangoMexicoapi", () => {
  it("es ^ y la versión de packages/sdk", async () => {
    await repoFalso();
    expect(await rangoMexicoapi(join(dir, "sdk"))).toBe("^1.2.3");
    await repoFalso({ name: "mexicoapi", version: "1.0.0-beta.2" });
    expect(await rangoMexicoapi(join(dir, "sdk"))).toBe("^1.0.0-beta.2");
  });

  it.each([
    [{ name: "otro", version: "1.2.3" }],
    [{ name: "mexicoapi" }],
    [{ name: "mexicoapi", version: "^1.2.3" }],
    [{ name: "mexicoapi", version: "1.2" }],
    [{ name: "mexicoapi", version: "workspace:*" }],
  ])("rechaza un manifiesto que no es el de mexicoapi con versión exacta (%j)", async (sdk) => {
    await repoFalso(sdk);
    await expect(rangoMexicoapi(join(dir, "sdk"))).rejects.toThrow(/mexicoapi con una versión/);
  });
});

describe("principal", () => {
  it("arma el paquete con mexicoapi en ^ y la versión de packages/sdk", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(0);
    expect(c.errores).toEqual([]);
    expect(c.salida.join("")).toMatch(/mexicoapi-mcp@0\.4\.0 .*npm pack.*npm publish/s);
    const { devDependencies: _d, scripts: _s, ...resto } = MANIFIESTO;
    expect(await leerJson(join(dir, "publicable", "package.json"))).toEqual({
      ...resto,
      dependencies: { mexicoapi: "^1.2.3" },
    });
    expect((await readdir(join(dir, "publicable"))).sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist",
      "package.json",
    ]);
  });

  it("devuelve 1 sin escribir nada si packages/sdk no da una versión", async () => {
    await repoFalso({ name: "mexicoapi", version: "latest" });
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^publicable: .*mexicoapi con una versión exacta/);
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("como prepack de npm se niega: el paquete no se empaqueta desde packages/mcp", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal([], { ...c.opciones, evento: "prepack" })).toBe(1);
    expect(c.errores.join("")).toMatch(
      /^publicable: mexicoapi-mcp no se empaqueta desde aquí.*publicable\.ts <destino>/s,
    );
  });

  it("con argumentos de más muestra el uso y devuelve 2", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal(["a", "b"], c.opciones)).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/publicable\.ts <destino>/);
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});

describe("el package.json de packages/mcp", () => {
  it("se publica sin lo del monorepo y con mexicoapi en ^ y la versión de packages/sdk", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    const sdk = await leerJson(join(SDK, "package.json"));
    expect(manifiesto.dependencies).toEqual({ mexicoapi: "workspace:*" });
    const publicable = manifiestoPublicable(manifiesto, {
      mexicoapi: await rangoMexicoapi(SDK),
    });
    expect(publicable.dependencies).toEqual({ mexicoapi: `^${String(sdk.version)}` });
    expect(publicable.devDependencies).toBeUndefined();
    expect(publicable.scripts).toBeUndefined();
  });

  it("publica dist, README.md y LICENSE, y npm pack desde aquí se niega", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    expect(manifiesto.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(manifiesto.bin).toEqual({ "mexicoapi-mcp": "dist/index.js" });
    expect((manifiesto.scripts as Record<string, string>).prepack).toBe(
      "node scripts/publicable.ts",
    );
  });

  it("compila desde un dist vacío: tsc no borra lo que ya no está en src", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    expect((manifiesto.scripts as Record<string, string>).build).toBe(
      "node scripts/limpiar.ts && tsc -p tsconfig.build.json",
    );
  });

  it("trae la misma licencia que el repositorio", async () => {
    expect(await readFile(join(MCP, "LICENSE"), "utf8")).toBe(
      await readFile(join(REPO, "LICENSE"), "utf8"),
    );
  });
});
