import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escribirDirectorioAtomico } from "../src/escritura.js";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "mexicoapi-esc-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("escribirDirectorioAtomico", () => {
  it("crea el directorio con subcarpetas y padres", async () => {
    const destino = join(base, "a", "b", "datos");
    await escribirDirectorioAtomico(
      destino,
      new Map<string, Uint8Array | string>([
        ["raw/mgee.json", "{}\n"],
        ["bancos.json", new Uint8Array([104, 105])],
      ]),
    );
    expect(await readFile(join(destino, "raw", "mgee.json"), "utf8")).toBe("{}\n");
    expect(await readFile(join(destino, "bancos.json"), "utf8")).toBe("hi");
    expect(await readdir(join(base, "a", "b"))).toEqual(["datos"]);
  });

  it("reemplaza el contenido y elimina archivos viejos sin dejar residuos", async () => {
    const destino = join(base, "datos");
    await mkdir(destino);
    await writeFile(join(destino, "viejo.json"), "viejo");
    await escribirDirectorioAtomico(destino, new Map([["nuevo.json", "nuevo"]]));
    expect(await readdir(destino)).toEqual(["nuevo.json"]);
    expect(await readdir(base)).toEqual(["datos"]);
  });

  it("ante un fallo deja intacto el contenido previo", async () => {
    const destino = join(base, "datos");
    await mkdir(destino);
    await writeFile(join(destino, "viejo.json"), "viejo");
    // "x" se escribe como archivo y luego "x/y" necesita que sea directorio: falla en cualquier SO
    const archivos = new Map<string, Uint8Array | string>([
      ["x", "archivo"],
      ["x/y", "no cabe"],
    ]);
    await expect(escribirDirectorioAtomico(destino, archivos)).rejects.toThrow();
    expect(await readdir(destino)).toEqual(["viejo.json"]);
    expect(await readFile(join(destino, "viejo.json"), "utf8")).toBe("viejo");
    expect(await readdir(base)).toEqual(["datos"]);
  });

  it("ante un fallo no deja residuos si el directorio no existia", async () => {
    const destino = join(base, "datos");
    const archivos = new Map<string, Uint8Array | string>([
      ["x", "archivo"],
      ["x/y", "no cabe"],
    ]);
    await expect(escribirDirectorioAtomico(destino, archivos)).rejects.toThrow();
    expect(await readdir(base)).toEqual([]);
  });

  it.each([
    "../fuera.json",
    "a/../../fuera.json",
    "a\\..\\fuera.json",
    "/abs.json",
    "C:\\abs.json",
    "\\abs.json",
  ])("rechaza la ruta %s con RangeError", async (ruta) => {
    const destino = join(base, "datos");
    await expect(escribirDirectorioAtomico(destino, new Map([[ruta, "x"]]))).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(await readdir(base)).toEqual([]);
  });
});
