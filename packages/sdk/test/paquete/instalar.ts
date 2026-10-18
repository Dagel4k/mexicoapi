// globalSetup de las pruebas del paquete: arma el paquete como se publica (scripts/publicable.ts),
// lo empaqueta con npm pack ahí e instala el .tgz en un proyecto nuevo de una carpeta temporal,
// como lo haría quien lo usa. Las pruebas reciben la carpeta del proyecto y lo que npm dijo del
// paquete. npm instala con --offline: el paquete no tiene dependencias y el .tgz es local, así
// que nunca consulta el registro. Pide `pnpm -r build` antes.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { armarPublicable } from "../../scripts/publicable.ts";

/** Lo que dice `npm pack --json` de un paquete. */
export interface Empaquetado {
  name: string;
  version: string;
  filename: string;
  /** Bytes del .tgz. */
  size: number;
  unpackedSize: number;
  files: { path: string; size: number }[];
}

declare module "vitest" {
  export interface ProvidedContext {
    /** Proyecto con mexicoapi instalado desde su .tgz y lo que dijo npm pack. */
    paqueteInstalado: { dir: string; empaquetado: Empaquetado };
  }
}

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

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

export default async function instalarPaquete(proyecto: TestProject): Promise<() => Promise<void>> {
  const temporal = await mkdtemp(join(tmpdir(), "mexicoapi-paquete-"));
  try {
    const publicable = join(temporal, "publicable");
    await armarPublicable(RAIZ, publicable);
    const [empaquetado] = JSON.parse(
      npm(`pack --json --pack-destination "${temporal}"`, publicable),
    ) as Empaquetado[];
    if (empaquetado === undefined) throw new Error("npm pack no dijo qué empaquetó");
    const dir = join(temporal, "consumidor");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "consumidor", private: true, type: "module" })}\n`,
    );
    npm(
      `install --offline --no-audit --no-fund --no-package-lock --ignore-scripts "${join(temporal, empaquetado.filename)}"`,
      dir,
    );
    proyecto.provide("paqueteInstalado", { dir, empaquetado });
  } catch (error) {
    await rm(temporal, { recursive: true, force: true });
    throw error;
  }
  return () => rm(temporal, { recursive: true, force: true });
}
