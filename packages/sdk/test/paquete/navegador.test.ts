// mexicoapi en un bundle para el navegador: cada entrada universal del paquete instalado desde su
// .tgz (globalSetup instalar.ts), empaquetada con esbuild con platform "browser" como lo hace CI
// con scripts/navegador.ts.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { type Entrada, empaquetarEntradas } from "../../scripts/navegador.ts";
import { entradasUniversales, LIMITE_GZIP_PRINCIPAL } from "../../scripts/revisar.ts";

const { dir } = inject("paqueteInstalado");

let entradas: Entrada[];

beforeAll(async () => {
  entradas = await empaquetarEntradas(dir);
});

describe("mexicoapi en un bundle para el navegador", () => {
  it("empaqueta cada entrada universal sin módulos de Node ni archivos de fuera", async () => {
    const { exports } = JSON.parse(
      await readFile(join(dir, "node_modules", "mexicoapi", "package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(entradas.map((e) => e.ruta)).toEqual(entradasUniversales(exports).map((e) => e.ruta));
    for (const entrada of entradas) {
      expect(entrada.problemas, entrada.especificador).toEqual([]);
      expect(entrada.bytes, entrada.especificador).toBeGreaterThan(0);
    }
  });

  it(`la entrada principal pesa ${LIMITE_GZIP_PRINCIPAL} bytes o menos con gzip`, () => {
    const [principal] = entradas;
    expect(principal?.especificador).toBe("mexicoapi");
    expect(principal?.gzip).toBeLessThanOrEqual(LIMITE_GZIP_PRINCIPAL);
  });
});
