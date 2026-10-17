import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escribirDirectorioAtomico } from "../src/escritura.js";

const fsMock = vi.hoisted(() => ({
  rename: null as null | ((...a: unknown[]) => Promise<void>),
  rm: null as null | ((...a: unknown[]) => Promise<void>),
}));

vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: (...a: Parameters<typeof real.rename>) => fsMock.rename?.(...a) ?? real.rename(...a),
    rm: (...a: Parameters<typeof real.rm>) => fsMock.rm?.(...a) ?? real.rm(...a),
  };
});

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "mexicoapi-esc-"));
});

afterEach(async () => {
  fsMock.rename = null;
  fsMock.rm = null;
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

  async function previo(): Promise<string> {
    const destino = join(base, "datos");
    await mkdir(destino);
    await writeFile(join(destino, "viejo.json"), "viejo");
    return destino;
  }

  it("restaura el respaldo si falla el segundo rename", async () => {
    const destino = await previo();
    let n = 0;
    fsMock.rename = async (...a) => {
      n++;
      if (n === 2) throw new Error("EPERM simulado");
      return (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rename(
        a[0] as string,
        a[1] as string,
      );
    };
    await expect(
      escribirDirectorioAtomico(destino, new Map([["n.json", "nuevo"]])),
    ).rejects.toThrow("EPERM simulado");
    expect(await readdir(destino)).toEqual(["viejo.json"]);
    expect(await readdir(base)).toEqual(["datos"]);
  });

  it("restaura aunque falle borrar el temporal y relanza el error original", async () => {
    const destino = await previo();
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let n = 0;
    fsMock.rename = async (...a) => {
      n++;
      if (n === 2) throw new Error("EPERM simulado");
      return real.rename(a[0] as string, a[1] as string);
    };
    fsMock.rm = async (...a) => {
      if (String(a[0]).includes(".tmp-")) throw new Error("EBUSY simulado");
      return real.rm(a[0] as string, a[1] as object);
    };
    await expect(
      escribirDirectorioAtomico(destino, new Map([["n.json", "nuevo"]])),
    ).rejects.toThrow("EPERM simulado");
    expect(await readFile(join(destino, "viejo.json"), "utf8")).toBe("viejo");
    expect((await readdir(base)).filter((x) => x.includes(".bak-"))).toEqual([]);
  });

  it("no falla si borrar el respaldo falla tras el intercambio", async () => {
    const destino = await previo();
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    fsMock.rm = async (...a) => {
      if (String(a[0]).includes(".bak-")) throw new Error("EBUSY simulado");
      return real.rm(a[0] as string, a[1] as object);
    };
    await escribirDirectorioAtomico(destino, new Map([["n.json", "nuevo"]]));
    expect(await readdir(destino)).toEqual(["n.json"]);
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
