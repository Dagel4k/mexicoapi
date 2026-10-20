import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifiestoPublicable, revisarHistorial } from "../../../sdk/scripts/publicable.ts";
import {
  comandoNpmView,
  principal,
  publicadaEnNpm,
  type RespuestaNpm,
  rangoMexicoapi,
} from "../../scripts/publicable.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/publicable.ts", import.meta.url));
const MCP = fileURLToPath(new URL("../../", import.meta.url));
const SDK = fileURLToPath(new URL("../../../sdk/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-mcp-publicable-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

const leerJson = async (ruta: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(ruta, "utf8")) as Record<string, unknown>;

/** Un manifiesto como el de packages/mcp, con lo que solo sirve en el repositorio. */
const MANIFIESTO = {
  name: "mexicoapi-mcp",
  version: "0.4.0",
  type: "module",
  bin: { "mexicoapi-mcp": "dist/index.js" },
  files: ["dist", "README.md", "CHANGELOG.md", "LICENSE"],
  scripts: { build: "tsc", prepack: "node scripts/publicable.ts" },
  dependencies: { mexicoapi: "workspace:*" },
  devDependencies: { "@modelcontextprotocol/sdk": "1.0.0" },
};

/** packages/sdk y packages/mcp compilados, en `dir/sdk` y `dir/mcp`. */
async function repoFalso(sdk: object = { name: "mexicoapi", version: "1.2.3" }): Promise<void> {
  await escribir("sdk/package.json", `${JSON.stringify(sdk)}\n`);
  await escribir("mcp/package.json", `${JSON.stringify(MANIFIESTO, null, 2)}\n`);
  await escribir("mcp/dist/index.js", "#!/usr/bin/env node\n");
  await escribir("mcp/README.md", "# mexicoapi-mcp\n");
  await escribir("mcp/LICENSE", "MIT\n");
  await escribir("mcp/CHANGELOG.md", "# Cambios\n\n## 0.4.0 (sin publicar)\n\n- primera versión\n");
}

function consola() {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    salida,
    errores,
    opciones: {
      raiz: join(dir, "mcp"),
      raizSdk: join(dir, "sdk"),
      salida: (t: string) => salida.push(t),
      errores: (t: string) => errores.push(t),
    },
  };
}

describe("rangoMexicoapi", () => {
  it("es ^ y la versión de packages/sdk", async () => {
    await repoFalso();
    expect(await rangoMexicoapi(join(dir, "sdk"))).toBe("^1.2.3");
    await repoFalso({ name: "mexicoapi", version: "1.0.0-beta.2" });
    expect(await rangoMexicoapi(join(dir, "sdk"))).toBe("^1.0.0-beta.2");
  });

  it.each([
    [{ name: "otro", version: "1.2.3" }],
    [{ name: "mexicoapi" }],
    [{ name: "mexicoapi", version: "^1.2.3" }],
    [{ name: "mexicoapi", version: "1.2" }],
    [{ name: "mexicoapi", version: "workspace:*" }],
  ])("rechaza un manifiesto que no es el de mexicoapi con versión exacta (%j)", async (sdk) => {
    await repoFalso(sdk);
    await expect(rangoMexicoapi(join(dir, "sdk"))).rejects.toThrow(/mexicoapi con una versión/);
  });
});

/** Lo que responde `npm view` (probado a mano con npm 11). */
const NPM_PUBLICADA: RespuestaNpm = { status: 0, stdout: '"1.2.3"\n', stderr: "" };
const NPM_404: RespuestaNpm = {
  status: 1,
  stdout: '{ "error": { "code": "E404" } }\n',
  stderr:
    "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/mexicoapi\n",
};
const NPM_SIN_RED: RespuestaNpm = {
  status: 1,
  stdout: "",
  stderr: "npm error code ENOTFOUND\nnpm error network request failed\n",
};

describe("publicadaEnNpm", () => {
  it("es true solo si npm responde esa versión", () => {
    expect(publicadaEnNpm(NPM_PUBLICADA, "1.2.3")).toBe(true);
    expect(publicadaEnNpm(NPM_PUBLICADA, "1.2.4")).toBe(false);
    expect(publicadaEnNpm({ status: 0, stdout: "\n", stderr: "" }, "1.2.3")).toBe(false);
  });

  it("es false con un 404, del paquete o de la versión", () => {
    expect(publicadaEnNpm(NPM_404, "1.2.3")).toBe(false);
  });

  it("lanza si npm falló por otra cosa, para no confundirlo con un 404", () => {
    expect(() => publicadaEnNpm(NPM_SIN_RED, "1.2.3")).toThrow(
      /no se pudo consultar npm: npm error code ENOTFOUND/,
    );
    expect(() => publicadaEnNpm({ status: null, stdout: "", stderr: "" }, "1.2.3")).toThrow(
      /no se pudo consultar npm/,
    );
  });
});

describe("comandoNpmView", () => {
  it("fuera de Windows llama a npm sin shell, con los argumentos aparte", () => {
    for (const plataforma of ["linux", "darwin"] as const) {
      expect(comandoNpmView("mexicoapi@1.2.3", plataforma)).toEqual({
        comando: "npm",
        argumentos: ["view", "mexicoapi@1.2.3", "version", "--json"],
        shell: false,
      });
    }
  });

  it("en Windows, donde npm es un .cmd, usa shell con una sola línea y sin argumentos aparte", () => {
    expect(comandoNpmView("mexicoapi@1.2.3", "win32")).toEqual({
      comando: "npm view mexicoapi@1.2.3 version --json",
      argumentos: [],
      shell: true,
    });
  });

  it("rechaza una especificación que no sea mexicoapi@<versión exacta>", () => {
    for (const spec of ["mexicoapi@1.2.3 && calc", "mexicoapi@^1.2.3", "otro@1.2.3", "mexicoapi"]) {
      expect(() => comandoNpmView(spec, "win32")).toThrow(/especificación/);
      expect(() => comandoNpmView(spec, "linux")).toThrow(/especificación/);
    }
  });
});

describe("principal con --publicar", () => {
  it("arma el paquete si mexicoapi@<versión del sdk> ya está en npm", async () => {
    await repoFalso();
    const c = consola();
    const pedidos: string[] = [];
    const consultarNpm = (spec: string): RespuestaNpm => {
      pedidos.push(spec);
      return NPM_PUBLICADA;
    };
    const destino = join(dir, "publicable");
    expect(await principal(["--publicar", destino], { ...c.opciones, consultarNpm })).toBe(0);
    expect(pedidos).toEqual(["mexicoapi@1.2.3"]);
    expect(c.errores).toEqual([]);
    expect((await leerJson(join(destino, "package.json"))).dependencies).toEqual({
      mexicoapi: "^1.2.3",
    });
  });

  it("se niega sin escribir nada si esa versión no está en npm", async () => {
    await repoFalso();
    const c = consola();
    const opciones = { ...c.opciones, consultarNpm: () => NPM_404 };
    expect(await principal([join(dir, "publicable"), "--publicar"], opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(
      /^publicable: mexicoapi@1\.2\.3 todavía no está en npm: publícalo antes que mexicoapi-mcp/,
    );
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("se niega si no pudo consultar npm", async () => {
    await repoFalso();
    const c = consola();
    const opciones = { ...c.opciones, consultarNpm: () => NPM_SIN_RED };
    expect(await principal(["--publicar", join(dir, "publicable")], opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^publicable: no se pudo consultar npm/);
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("sin --publicar no consulta npm, y sin destino solo muestra el uso", async () => {
    await repoFalso();
    const c = consola();
    const consultarNpm = (): RespuestaNpm => {
      throw new Error("no debía consultar npm");
    };
    expect(await principal([join(dir, "publicable")], { ...c.opciones, consultarNpm })).toBe(0);
    expect(await principal(["--publicar"], { ...c.opciones, consultarNpm })).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/publicable\.ts/);
  });
});

describe("principal", () => {
  it("arma el paquete con mexicoapi en ^ y la versión de packages/sdk", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(0);
    expect(c.errores).toEqual([]);
    expect(c.salida.join("")).toMatch(/mexicoapi-mcp@0\.4\.0 .*npm pack.*npm publish/s);
    const { devDependencies: _d, scripts: _s, ...resto } = MANIFIESTO;
    expect(await leerJson(join(dir, "publicable", "package.json"))).toEqual({
      ...resto,
      dependencies: { mexicoapi: "^1.2.3" },
    });
    expect((await readdir(join(dir, "publicable"))).sort()).toEqual([
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "dist",
      "package.json",
    ]);
  });

  it("devuelve 1 sin escribir nada si packages/sdk no da una versión", async () => {
    await repoFalso({ name: "mexicoapi", version: "latest" });
    const c = consola();
    expect(await principal([join(dir, "publicable")], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^publicable: .*mexicoapi con una versión exacta/);
    await expect(readdir(join(dir, "publicable"))).rejects.toThrow();
  });

  it("como prepack de npm se niega: el paquete no se empaqueta desde packages/mcp", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal([], { ...c.opciones, evento: "prepack" })).toBe(1);
    expect(c.errores.join("")).toMatch(
      /^publicable: mexicoapi-mcp no se empaqueta desde aquí.*publicable\.ts <destino>/s,
    );
  });

  it("con argumentos de más muestra el uso y devuelve 2", async () => {
    await repoFalso();
    const c = consola();
    expect(await principal(["a", "b"], c.opciones)).toBe(2);
    expect(c.errores.join("")).toMatch(/uso: node scripts\/publicable\.ts <destino>/);
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });
});

describe("el package.json de packages/mcp", () => {
  it("se publica sin lo del monorepo y con mexicoapi en ^ y la versión de packages/sdk", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    const sdk = await leerJson(join(SDK, "package.json"));
    expect(manifiesto.dependencies).toEqual({ mexicoapi: "workspace:*" });
    const publicable = manifiestoPublicable(manifiesto, {
      mexicoapi: await rangoMexicoapi(SDK),
    });
    expect(publicable.dependencies).toEqual({ mexicoapi: `^${String(sdk.version)}` });
    expect(publicable.devDependencies).toBeUndefined();
    expect(publicable.scripts).toBeUndefined();
  });

  it("publica dist, README.md, CHANGELOG.md y LICENSE, y npm pack desde aquí se niega", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    expect(manifiesto.files).toEqual(["dist", "README.md", "CHANGELOG.md", "LICENSE"]);
    expect(manifiesto.bin).toEqual({ "mexicoapi-mcp": "dist/index.js" });
    expect((manifiesto.scripts as Record<string, string>).prepack).toBe(
      "node scripts/publicable.ts",
    );
  });

  it("compila desde un dist vacío: tsc no borra lo que ya no está en src", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    expect((manifiesto.scripts as Record<string, string>).build).toBe(
      "node scripts/limpiar.ts && tsc -p tsconfig.build.json",
    );
  });

  it("trae un historial de cambios cuyo primer encabezado es la versión", async () => {
    await expect(revisarHistorial(MCP)).resolves.toBeUndefined();
  });

  it("lleva su nombre del registro de MCP, el mismo de server.json, con la misma versión", async () => {
    const manifiesto = await leerJson(join(MCP, "package.json"));
    const servidor = await leerJson(join(MCP, "server.json"));
    // El registro conserva las mayúsculas del usuario de GitHub.
    expect(manifiesto.mcpName).toBe("io.github.Dagel4k/mexicoapi-mcp");
    const publicable = manifiestoPublicable(manifiesto, { mexicoapi: await rangoMexicoapi(SDK) });
    expect(publicable.mcpName).toBe(manifiesto.mcpName);
    expect(servidor.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    );
    expect(servidor.name).toBe(manifiesto.mcpName);
    expect(servidor.version).toBe(manifiesto.version);
    // El esquema pide 100 caracteres o menos; en bytes, por si el registro los cuenta así.
    expect(Buffer.byteLength(String(servidor.description))).toBeLessThanOrEqual(100);
    expect(servidor.repository).toEqual({
      url: "https://github.com/Dagel4k/mexicoapi",
      source: "github",
      subfolder: "packages/mcp",
    });
    const [paquete, ...otros] = servidor.packages as Record<string, unknown>[];
    expect(otros).toEqual([]);
    expect(paquete).toMatchObject({
      registryType: "npm",
      identifier: manifiesto.name,
      version: manifiesto.version,
      transport: { type: "stdio" },
    });
    const variables = paquete?.environmentVariables as Record<string, unknown>[];
    expect(variables.map((v) => [v.name, v.isRequired])).toEqual([
      ["MEXICOAPI_BASE", false],
      ["MEXICOAPI_SIN_RED", false],
    ]);
  });

  it("trae la misma licencia que el repositorio", async () => {
    expect(await readFile(join(MCP, "LICENSE"), "utf8")).toBe(
      await readFile(join(REPO, "LICENSE"), "utf8"),
    );
  });
});
