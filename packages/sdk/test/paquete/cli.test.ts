// El binario construido, lanzado como lo haría npm: `node dist/cli/index.js`.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entradasUniversales, grafoDeModulos } from "../../scripts/revisar.ts";
import { type Corrida, probarCli } from "../cli/comun.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const BIN = join(RAIZ, "dist", "cli", "index.js");
const manifiesto = JSON.parse(await readFile(join(RAIZ, "package.json"), "utf8")) as {
  version: string;
  bin: Record<string, string>;
  exports: Record<string, { types: string; import: string } | string>;
};

let cache: string;
beforeEach(async () => {
  cache = await mkdtemp(join(tmpdir(), "mexicoapi-bin-"));
});
afterEach(async () => {
  await rm(cache, { recursive: true, force: true });
});

function correr(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<Corrida> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [BIN, ...argv], {
      // La caché de SEPOMEX y la base de la API quedan fuera del entorno real de quien prueba.
      env: {
        ...process.env,
        MEXICOAPI_BASE: "",
        // Sin MEXICOAPI_BASE la CLI usaría la API pública: las pruebas no salen a la red.
        MEXICOAPI_SIN_RED: "1",
        LOCALAPPDATA: cache,
        XDG_CACHE_HOME: cache,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let salida = "";
    let errores = "";
    hijo.stdout.setEncoding("utf8").on("data", (t: string) => {
      salida += t;
    });
    hijo.stderr.setEncoding("utf8").on("data", (t: string) => {
      errores += t;
    });
    hijo.on("error", rechazar);
    hijo.on("close", (codigo) => resolver({ codigo: codigo ?? -1, salida, errores }));
  });
}

describe("mexicoapi (binario)", () => {
  it("package.json declara el binario dentro de dist", () => {
    expect(manifiesto.bin).toEqual({ mexicoapi: "dist/cli/index.js" });
  });

  it("conserva el shebang de Node", async () => {
    const primera = (await readFile(BIN, "utf8")).split("\n", 1)[0];
    expect(primera).toBe("#!/usr/bin/env node");
  });

  it("ninguna entrada universal carga la CLI", async () => {
    for (const { archivo } of entradasUniversales(manifiesto.exports)) {
      const { archivos } = await grafoDeModulos(join(RAIZ, archivo));
      expect(archivos.filter((a) => a.includes(join(RAIZ, "dist", "cli") + sep))).toEqual([]);
    }
  });

  probarCli(correr, manifiesto.version);

  it("sepomex sync --help no toca la red", async () => {
    const c = await correr(["sepomex", "sync", "--help"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("mexicoapi sepomex sync");
  });
});
