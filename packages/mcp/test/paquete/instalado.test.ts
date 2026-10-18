// mexicoapi-mcp tal como llega a quien lo instala: el .tgz de npm pack, armado con
// scripts/publicable.ts e instalado junto al .tgz de mexicoapi en un proyecto nuevo por el
// globalSetup (instalar.ts).
import { spawnSync } from "node:child_process";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

const HUMO = fileURLToPath(new URL("./humo.mjs", import.meta.url));
const MANIFIESTO = fileURLToPath(new URL("../../package.json", import.meta.url));
const MANIFIESTO_SDK = fileURLToPath(new URL("../../../sdk/package.json", import.meta.url));
const { dir, empaquetado } = inject("paqueteMcp");

const leerJson = async (ruta: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(ruta, "utf8")) as Record<string, unknown>;

describe("mexicoapi-mcp instalado desde su .tgz", () => {
  it("pasa la prueba de humo con este Node (la misma que corre CI en Node 22.13.0, 22.23.3 y 24.21.0)", async () => {
    await copyFile(HUMO, join(dir, "humo.mjs"));
    const r = spawnSync(process.execPath, ["humo.mjs"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^humo: tools\/list: 13 herramientas$/m);
    expect(r.stdout).toMatch(/^humo: tools\/call udis$/m);
    expect(r.stdout).toMatch(/^humo: tools\/call codigo_postal sin catálogo$/m);
    expect(r.stdout).toMatch(/^humo: OK$/m);
  });

  it("usa el mexicoapi del .tgz local, instalado una sola vez", async () => {
    const sdk = await leerJson(MANIFIESTO_SDK);
    const instalado = await leerJson(join(dir, "node_modules", "mexicoapi", "package.json"));
    expect(instalado.version).toBe(sdk.version);
    const dentro = readdir(join(dir, "node_modules", "mexicoapi-mcp", "node_modules"));
    await expect(dentro).rejects.toThrow();
  });
});

describe("el package.json publicado", () => {
  it("es el de packages/mcp sin devDependencies ni scripts y con mexicoapi en ^", async () => {
    const { devDependencies: _d, scripts: _s, ...resto } = await leerJson(MANIFIESTO);
    const sdk = await leerJson(MANIFIESTO_SDK);
    const archivo = join(dir, "node_modules", "mexicoapi-mcp", "package.json");
    expect(await leerJson(archivo)).toEqual({
      ...resto,
      dependencies: { mexicoapi: `^${String(sdk.version)}` },
    });
    const texto = await readFile(archivo, "utf8");
    expect(texto).not.toContain("workspace:");
    expect(texto).not.toContain("@mexicoapi/");
    expect(texto).not.toContain("@modelcontextprotocol/sdk");
  });
});

describe("npm pack", () => {
  it("publica solo el JavaScript de dist, LICENSE, README y package.json", () => {
    expect(empaquetado.name).toBe("mexicoapi-mcp");
    const rutas = empaquetado.files.map((f) => f.path);
    expect(rutas).toEqual(
      expect.arrayContaining([
        "LICENSE",
        "README.md",
        "package.json",
        "dist/index.js",
        "dist/binario.js",
        "dist/protocolo.js",
        "dist/stdio.js",
        "dist/catalogo.js",
        "dist/consultas/codigo-postal.js",
      ]),
    );
    // Solo un binario: sin archivos de tipos, que nadie importa.
    for (const ruta of rutas) {
      expect(ruta).toMatch(/^(dist\/[\w/-]+\.js|LICENSE|README\.md|package\.json)$/);
    }
  });
});
