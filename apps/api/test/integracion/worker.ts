import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { unstable_startWorker } from "wrangler";
import { diferenciasConDatos } from "./publico.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** Origen del Worker local, por ejemplo `http://127.0.0.1:51234/`. */
    urlApi: string;
  }
}

const RAIZ = new URL("../../", import.meta.url);

/**
 * Levanta el Worker de wrangler.jsonc en workerd, en un puerto libre, y lo cierra al terminar.
 * Antes revisa que su `public/` haya salido de los `data/` de hoy.
 */
export default async function levantarWorker(proyecto: TestProject): Promise<() => Promise<void>> {
  if (!existsSync(new URL("public/v1/openapi.json", RAIZ))) {
    throw new Error(
      "Falta apps/api/public: corre `pnpm -r build` antes de las pruebas de integración.",
    );
  }
  const diferencias = await diferenciasConDatos(
    new URL("public/", RAIZ),
    new URL("../../data/", RAIZ),
  );
  if (diferencias.length > 0) {
    throw new Error(
      `apps/api/public no corresponde a data/ (${diferencias.join("; ")}): corre \`pnpm -r build\` antes de las pruebas de integración.`,
    );
  }
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL("wrangler.jsonc", RAIZ)),
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      // Sin estado en .wrangler/state: el Worker no usa KV, D1 ni R2 en local.
      persist: false,
      watch: false,
      logLevel: "error",
    },
  });
  try {
    await worker.ready;
    proyecto.provide("urlApi", (await worker.url).href);
  } catch (error) {
    await worker.dispose();
    throw error;
  }
  return () => worker.dispose();
}
