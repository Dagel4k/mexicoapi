import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Destino {
  types: string;
  import: string;
  default: string;
}

interface Manifiesto {
  name: string;
  version: string;
  private?: boolean;
  license: string;
  type: string;
  sideEffects: boolean;
  main: string;
  bin?: Record<string, string>;
  types: string;
  engines: Record<string, string>;
  files: string[];
  repository: Record<string, string>;
  exports: Record<string, Destino | string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: string[];
}

const RAIZ = new URL("../", import.meta.url);
const manifiesto = JSON.parse(readFileSync(new URL("package.json", RAIZ), "utf8")) as Manifiesto;

describe("package.json de mexicoapi", () => {
  it("no tiene dependencias de ejecución", () => {
    expect(manifiesto.dependencies).toEqual({});
    expect(manifiesto.peerDependencies).toBeUndefined();
    expect(manifiesto.optionalDependencies).toBeUndefined();
    expect(manifiesto.bundleDependencies).toBeUndefined();
  });

  it("se puede publicar como ESM universal", () => {
    expect(manifiesto.name).toBe("mexicoapi");
    expect(manifiesto.private).toBeUndefined();
    expect(manifiesto.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifiesto.license).toBe("MIT");
    expect(manifiesto.type).toBe("module");
    expect(manifiesto.sideEffects).toBe(false);
    expect(manifiesto.engines).toEqual({ node: ">=22.13" });
    expect(manifiesto.files).toEqual(["dist", "README.md", "CHANGELOG.md", "LICENSE"]);
    expect(manifiesto.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Dagel4k/mexicoapi.git",
      directory: "packages/sdk",
    });
  });

  it("cada entrada declara sus tipos, su import y un default igual al import, dentro de dist", () => {
    const entradas = Object.entries(manifiesto.exports).filter(
      ([ruta]) => ruta !== "./package.json",
    );
    expect(entradas.map(([ruta]) => ruta)).toContain(".");
    for (const [ruta, destino] of entradas) {
      if (typeof destino === "string") throw new Error(`${ruta} no declara types e import`);
      // `default` va al final: con él, require() carga el ESM (Node 22.12 o posterior).
      expect(Object.keys(destino), ruta).toEqual(["types", "import", "default"]);
      expect(destino.import, ruta).toMatch(/^\.\/dist\/[\w/-]+\.js$/);
      expect(destino.types, ruta).toBe(destino.import.replace(/\.js$/, ".d.ts"));
      expect(destino.default, ruta).toBe(destino.import);
    }
  });

  it("publica la entrada principal, el cliente, los datos (con el FIX y las UDIS aparte) y SEPOMEX", () => {
    expect(Object.keys(manifiesto.exports)).toEqual([
      ".",
      "./cliente",
      "./datos",
      "./datos/fix",
      "./datos/udis",
      "./datos/calendarios",
      "./datos/constantes",
      "./sepomex",
      "./package.json",
    ]);
  });

  it("main y types apuntan a la entrada principal", () => {
    expect(manifiesto.exports["."]).toEqual({
      types: manifiesto.types,
      import: manifiesto.main,
      default: manifiesto.main,
    });
  });

  it("el binario mexicoapi apunta a la CLI compilada", () => {
    expect(manifiesto.bin).toEqual({ mexicoapi: "dist/cli/index.js" });
  });

  it("el LICENSE del paquete es el del repositorio", () => {
    expect(readFileSync(new URL("LICENSE", RAIZ), "utf8")).toBe(
      readFileSync(new URL("../../LICENSE", RAIZ), "utf8"),
    );
  });
});
