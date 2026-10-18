// sync sin fetch propio usa el transporte de node:https (aquí uno falso, sin red), y sin
// node:sqlite guarda solo el JSON.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchFalso } from "./ayudas.js";

const falso = fetchFalso();

vi.mock("node:sqlite", () => {
  throw new Error("Este Node no trae node:sqlite.");
});

vi.mock("../../src/sepomex/http.js", () => ({
  crearTransporte: vi.fn(() => falso.fetch),
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

it("sin fetch usa el transporte de node:https y sin node:sqlite guarda solo el JSON", async () => {
  const { sync } = await import("../../src/sepomex/index.js");
  const { crearTransporte } = await import("../../src/sepomex/http.js");
  const estado = await sync({ dir, aviso: () => {} });
  expect(crearTransporte).toHaveBeenCalledWith({ esperaMs: 60_000 });
  expect(falso.llamadas).toHaveLength(2);
  expect(estado.sqlite).toBeNull();
  expect(estado.sin_sqlite).toMatch(
    /^No se pudo cargar node:sqlite \(.*\): la caché queda solo en JSON\.$/,
  );
  expect((await readdir(dir)).sort()).toEqual(
    ["meta.json", estado.json.slice(dir.length + 1)].sort(),
  );
});
