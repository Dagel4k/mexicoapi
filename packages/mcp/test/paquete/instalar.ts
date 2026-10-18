// globalSetup de las pruebas del paquete: arma mexicoapi y mexicoapi-mcp como se publican (con sus
// scripts/publicable.ts), los empaqueta con npm pack e instala los dos .tgz en un proyecto nuevo
// de una carpeta temporal, como el job paquete-mcp de CI. npm instala con --offline: la dependencia
// mexicoapi@^<versión> del servidor la cumple el .tgz local, así que nunca consulta el registro
// (donde mexicoapi todavía no existe). Pide `pnpm -r build` antes.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { armarPublicable } from "../../../sdk/scripts/publicable.ts";

/** Lo que dice `npm pack --json` de un paquete. */
export interface Empaquetado {
  name: string;
  version: string;
  filename: string;
  files: { path: string; size: number }[];
}

declare module "vitest" {
  export interface ProvidedContext {
    /** Proyecto con mexicoapi y mexicoapi-mcp instalados desde sus .tgz y lo que dijo npm pack. */
    paqueteMcp: { dir: string; empaquetado: Empaquetado };
  }
}

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const SDK = fileURLToPath(new URL("../../../sdk/", import.meta.url));

/**
 * Corre npm (en Windows es un .cmd: va con shell y el comando entero, con las rutas entre comillas).
 * Con tiempo límite: un npm colgado no deja la corrida esperando hasta el límite del job.
 */
function npm(comando: string, cwd: string): string {
  const r = spawnSync(`npm ${comando}`, { cwd, encoding: "utf8", shell: true, timeout: 120_000 });
  if (r.error !== undefined) throw new Error(`npm ${comando} no terminó: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`npm ${comando} salió con ${r.status}:\n${r.stderr}`);
  return r.stdout;
}

function empaquetar(carpeta: string, destino: string): Empaquetado {
  const [empaquetado] = JSON.parse(
    npm(`pack --json --pack-destination "${destino}"`, carpeta),
  ) as Empaquetado[];
  if (empaquetado === undefined) throw new Error(`npm pack no dijo qué empaquetó en ${carpeta}`);
  return empaquetado;
}

export default async function instalarPaquetes(
  proyecto: TestProject,
): Promise<() => Promise<void>> {
  const temporal = await mkdtemp(join(tmpdir(), "mexicoapi-mcp-paquete-"));
  try {
    await armarPublicable(SDK, join(temporal, "publicable-sdk"));
    const sdk = empaquetar(join(temporal, "publicable-sdk"), temporal);
    // El servidor se arma con su script, como en CI y al publicar.
    const script = join(RAIZ, "scripts", "publicable.ts");
    const armado = spawnSync(process.execPath, [script, join(temporal, "publicable-mcp")], {
      encoding: "utf8",
      timeout: 120_000,
    });
    if (armado.status !== 0) {
      throw new Error(`publicable.ts salió con ${armado.status}:\n${armado.stderr}`);
    }
    const mcp = empaquetar(join(temporal, "publicable-mcp"), temporal);
    const dir = join(temporal, "consumidor");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "consumidor", private: true, type: "module" })}\n`,
    );
    npm(
      "install --offline --no-audit --no-fund --no-package-lock --ignore-scripts " +
        `"${join(temporal, sdk.filename)}" "${join(temporal, mcp.filename)}"`,
      dir,
    );
    proyecto.provide("paqueteMcp", { dir, empaquetado: mcp });
  } catch (error) {
    await rm(temporal, { recursive: true, force: true });
    throw error;
  }
  return () => rm(temporal, { recursive: true, force: true });
}
