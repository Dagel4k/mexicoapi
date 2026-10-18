// El paquete tal como llega a quien lo instala: el .tgz de npm pack, armado con
// scripts/publicable.ts e instalado en un proyecto nuevo por el globalSetup (instalar.ts).
import { spawnSync } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

const HUMO = fileURLToPath(new URL("./humo.mjs", import.meta.url));
const UNIVERSAL = fileURLToPath(new URL("./universal.mjs", import.meta.url));
const MANIFIESTO = fileURLToPath(new URL("../../package.json", import.meta.url));
const { dir, empaquetado } = inject("paqueteInstalado");

const leerJson = async (ruta: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(ruta, "utf8")) as Record<string, unknown>;

describe("mexicoapi instalado desde su .tgz", () => {
  it("pasa la prueba de humo con este Node (la misma que corre CI en Node 22.13.0, 22.23.3, 24.21.0 y 26.11.1)", async () => {
    await copyFile(HUMO, join(dir, "humo.mjs"));
    const r = spawnSync(process.execPath, ["humo.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^humo: OK$/m);
  });

  it("pasa la prueba de las entradas universales (la que corre CI en Bun y Deno) con este Node", async () => {
    await copyFile(UNIVERSAL, join(dir, "universal.mjs"));
    const r = spawnSync(process.execPath, ["universal.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^universal: OK$/m);
  });
});

describe("el package.json publicado", () => {
  const instalado = (): Promise<Record<string, unknown>> =>
    leerJson(join(dir, "node_modules", "mexicoapi", "package.json"));

  it("no trae devDependencies ni scripts y no nombra @mexicoapi/core ni workspace:", async () => {
    const publicado = await instalado();
    expect(publicado.devDependencies).toBeUndefined();
    expect(publicado.scripts).toBeUndefined();
    expect(publicado.dependencies).toEqual({});
    const texto = await readFile(join(dir, "node_modules", "mexicoapi", "package.json"), "utf8");
    expect(texto).not.toContain("@mexicoapi/core");
    expect(texto).not.toContain("workspace:");
  });

  it("es el de packages/sdk sin esos dos campos", async () => {
    const { devDependencies: _d, scripts: _s, ...resto } = await leerJson(MANIFIESTO);
    expect(await instalado()).toEqual(resto);
  });
});

describe("npm pack", () => {
  it("publica solo dist, LICENSE, README, CHANGELOG y package.json", () => {
    expect(empaquetado.name).toBe("mexicoapi");
    const rutas = empaquetado.files.map((f) => f.path);
    expect(rutas).toEqual(
      expect.arrayContaining([
        "LICENSE",
        "README.md",
        "CHANGELOG.md",
        "package.json",
        "dist/index.js",
        "dist/index.d.ts",
        "dist/cliente/index.js",
        "dist/cliente/index.d.ts",
        "dist/cliente/paquete.js",
        "dist/nucleo/index.js",
        "dist/nucleo/index.d.ts",
        "dist/datos/index.js",
        "dist/datos/index.d.ts",
        "dist/datos/fix.js",
        "dist/datos/udis.js",
        "dist/datos/generados/inegi-municipios.js",
        "dist/datos/generados/inegi-municipios.d.ts",
        "dist/sepomex/index.js",
        "dist/sepomex/index.d.ts",
        "dist/sepomex/zip.js",
        "dist/cli/index.js",
        "dist/cli/cli.js",
      ]),
    );
    for (const ruta of rutas) {
      expect(ruta).toMatch(
        /^(dist\/[\w/-]+\.(js|d\.ts)|LICENSE|README\.md|CHANGELOG\.md|package\.json)$/,
      );
    }
  });
});
