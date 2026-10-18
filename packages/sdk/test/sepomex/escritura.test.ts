// Si el SQLite falla a medio guardar, no queda nada nuevo y la caché anterior sigue igual.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { estado, importar, SepomexError } from "../../src/sepomex/index.js";
import { lineasTxt, txt, zipOficial } from "./ayudas.js";

const sqlite = vi.hoisted(() => ({ falla: false }));

vi.mock("../../src/sepomex/sqlite.js", async (original) => {
  const real = await original<typeof import("../../src/sepomex/sqlite.js")>();
  return {
    ...real,
    escribirSqlite: (...args: Parameters<typeof real.escribirSqlite>) => {
      if (sqlite.falla) {
        // Deja un archivo a medias, como con el disco lleno.
        real.escribirSqlite(args[0], args[1], [], {});
        throw new Error("database or disk is full");
      }
      real.escribirSqlite(...args);
    },
  };
});

let trabajo: string;

beforeEach(async () => {
  trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
  sqlite.falla = false;
});

afterEach(async () => {
  await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
});

it("si el SQLite falla, borra lo nuevo y deja la caché anterior", async () => {
  const dir = join(trabajo, "cache");
  const zip = join(trabajo, "cp.zip");
  await writeFile(zip, zipOficial());
  const antes = await importar(zip, { dir, aviso: () => {} });
  const archivos = (await readdir(dir)).sort();
  sqlite.falla = true;
  const nuevo = join(trabajo, "nuevo.txt");
  await writeFile(nuevo, txt(lineasTxt().map((l) => l.replace("Culiacán Centro", "Otro"))));
  const error = await importar(nuevo, { dir, aviso: () => {} }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SepomexError);
  expect((error as SepomexError).tipo).toBe("escritura");
  expect((error as SepomexError).message).toMatch(
    /No se pudo guardar el catálogo en .*cache \(database or disk is full\)/,
  );
  expect(((error as SepomexError).cause as Error).message).toBe("database or disk is full");
  expect((await readdir(dir)).sort()).toEqual(archivos);
  expect(await estado({ dir })).toEqual(antes);
});
