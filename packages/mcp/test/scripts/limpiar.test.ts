import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiar } from "../../scripts/limpiar.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/limpiar.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-mcp-limpiar-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("limpiar", () => {
  it("borra dist completo, con lo que tsc ya no genera, y deja lo demás", async () => {
    await mkdir(join(dir, "dist", "consultas"), { recursive: true });
    await writeFile(join(dir, "dist", "index.js"), "\n");
    await writeFile(join(dir, "dist", "consultas", "borrado.js"), "\n");
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "index.ts"), "\n");
    await writeFile(join(dir, "package.json"), "{}\n");
    await limpiar(dir);
    expect((await readdir(dir)).sort()).toEqual(["package.json", "src"]);
  });

  it("no falla si dist no existe", async () => {
    await limpiar(dir);
    expect(await readdir(dir)).toEqual([]);
  });

  it("como script no recibe argumentos", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "otra-carpeta"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso: node scripts\/limpiar\.ts/);
  });
});
