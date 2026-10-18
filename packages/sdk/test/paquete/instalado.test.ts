// El paquete tal como llega a quien lo instala: el .tgz de npm pack, instalado en un proyecto nuevo
// por el globalSetup (instalar.ts).
import { spawnSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

const HUMO = fileURLToPath(new URL("./humo.mjs", import.meta.url));
const { dir, empaquetado } = inject("paqueteInstalado");

describe("mexicoapi instalado desde su .tgz", () => {
  it("pasa la prueba de humo con este Node (la misma que corre CI en Node 20, 22 y 24)", async () => {
    await copyFile(HUMO, join(dir, "humo.mjs"));
    const r = spawnSync(process.execPath, ["humo.mjs"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^humo: OK$/m);
  });
});

describe("npm pack", () => {
  it("publica solo dist, LICENSE, README y package.json", () => {
    expect(empaquetado.name).toBe("mexicoapi");
    const rutas = empaquetado.files.map((f) => f.path);
    expect(rutas).toEqual(
      expect.arrayContaining([
        "LICENSE",
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
      expect(ruta).toMatch(/^(dist\/[\w/-]+\.(js|d\.ts)|LICENSE|README\.md|package\.json)$/);
    }
  });
});
