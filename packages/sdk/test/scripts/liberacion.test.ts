import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  comoAnotacion,
  compararVersiones,
  estadoEnNpm,
  leerEtiqueta,
  leerTodo,
  npmView,
  PAQUETES,
  principal,
  type RespuestaNpm,
  revisarFecha,
  revisarManifiesto,
  revisarVerify,
} from "../../scripts/liberacion.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/liberacion.ts", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-liberacion-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), contenido);
}

/** Un repositorio con packages/sdk y packages/mcp en la versión y con el historial indicados. */
async function repoFalso(version = "1.2.3", encabezado = `## ${version} (2026-10-20)`) {
  for (const [nombre, carpeta] of Object.entries(PAQUETES)) {
    await escribir(`${carpeta}/package.json`, `${JSON.stringify({ name: nombre, version })}\n`);
    await escribir(`${carpeta}/CHANGELOG.md`, `# Cambios\n\n${encabezado}\n\n- algo\n`);
  }
}

const respuesta = (status: number | null, stdout = "", stderr = ""): RespuestaNpm => ({
  status,
  stdout,
  stderr,
});

const NO_EXISTE = respuesta(
  1,
  '{\n  "error": {\n    "code": "E404"\n  }\n}\n',
  "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/mexicoapi - Not found\n",
);

/** Una corrida del check `verify` como la devuelve la API de check runs de GitHub. */
function corrida(extra: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "verify",
    head_sha: SHA,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions" },
    ...extra,
  };
}

const checks = (...corridas: unknown[]) => ({ total_count: corridas.length, check_runs: corridas });

function consola(extra: Record<string, unknown> = {}) {
  const salida: string[] = [];
  const errores: string[] = [];
  const consultas: string[] = [];
  return {
    salida,
    errores,
    consultas,
    opciones: {
      raiz: dir,
      salida: (t: string) => salida.push(t),
      errores: (t: string) => errores.push(t),
      consultarNpm: (nombre: string) => {
        consultas.push(nombre);
        return respuesta(0, '["1.2.2"]\n');
      },
      leerEntrada: async () => JSON.stringify(checks(corrida())),
      ...extra,
    },
  };
}

describe("leerEtiqueta", () => {
  it("lee el paquete, la versión y la carpeta de cada etiqueta", () => {
    expect(leerEtiqueta("mexicoapi@0.1.1")).toEqual({
      nombre: "mexicoapi",
      version: "0.1.1",
      carpeta: "packages/sdk",
    });
    expect(leerEtiqueta("mexicoapi-mcp@12.30.4")).toEqual({
      nombre: "mexicoapi-mcp",
      version: "12.30.4",
      carpeta: "packages/mcp",
    });
  });

  it("cada paquete vive en su carpeta del repositorio", async () => {
    for (const [nombre, carpeta] of Object.entries(PAQUETES)) {
      const manifiesto = JSON.parse(await readFile(join(REPO, carpeta, "package.json"), "utf8"));
      expect(manifiesto.name).toBe(nombre);
    }
  });

  it.each([
    "",
    "mexicoapi",
    "mexicoapi@",
    "mexicoapi@1.2",
    "mexicoapi@1.2.3.4",
    "mexicoapi@v1.2.3",
    "mexicoapi@01.2.3",
    "mexicoapi@1.02.3",
    "mexicoapi@1.2.3+build.1",
    "mexicoapi@1.2.3 ",
    "mexicoapi-mcp@1.2.3\n",
    "v1.2.3",
    "1.2.3",
    "@mexicoapi/core@1.2.3",
    "otro@1.2.3",
    "MexicoAPI@1.2.3",
    "constructor@1.2.3",
    "__proto__@1.2.3",
    "mexicoapi@mexicoapi@1.2.3",
  ])("rechaza %j", (etiqueta) => {
    expect(() => leerEtiqueta(etiqueta)).toThrow(/mexicoapi@X\.Y\.Z.*mexicoapi-mcp@X\.Y\.Z/);
  });

  it("rechaza una pre-versión con su propio motivo", () => {
    expect(() => leerEtiqueta("mexicoapi@1.2.3-beta.1")).toThrow(/pre-versiones/);
    expect(() => leerEtiqueta("mexicoapi-mcp@0.2.0-rc.1")).toThrow(/pre-versiones/);
  });
});

describe("revisarManifiesto", () => {
  const liberacion = leerEtiqueta("mexicoapi@1.2.3");

  it("acepta el package.json del paquete y la versión de la etiqueta", () => {
    expect(() =>
      revisarManifiesto({ name: "mexicoapi", version: "1.2.3", private: false }, liberacion),
    ).not.toThrow();
  });

  it("falla si la versión no es la de la etiqueta", () => {
    expect(() => revisarManifiesto({ name: "mexicoapi", version: "1.2.2" }, liberacion)).toThrow(
      /mexicoapi@1\.2\.3.*packages\/sdk\/package\.json.*1\.2\.2/,
    );
  });

  it("falla si el nombre no es el del paquete", () => {
    expect(() => revisarManifiesto({ name: "otro", version: "1.2.3" }, liberacion)).toThrow(
      /packages\/sdk\/package\.json.*"otro"/,
    );
  });

  it.each([null, [], "mexicoapi", { version: "1.2.3" }])("falla con %j", (manifiesto) => {
    expect(() => revisarManifiesto(manifiesto, liberacion)).toThrow(/package\.json/);
  });
});

describe("revisarFecha", () => {
  it("acepta un primer encabezado con la versión y su fecha", () => {
    expect(() =>
      revisarFecha("# Cambios\n\n## 1.2.3 (2026-10-20)\n\n## 1.2.2 (sin publicar)\n", "1.2.3"),
    ).not.toThrow();
    expect(() => revisarFecha("# Cambios\r\n\r\n## 1.2.3 (2024-02-29)\r\n", "1.2.3")).not.toThrow();
  });

  it("falla si la versión todavía dice sin publicar", () => {
    expect(() => revisarFecha("# Cambios\n\n## 1.2.3 (sin publicar)\n", "1.2.3")).toThrow(
      /"## 1\.2\.3 \(sin publicar\)".*fecha/,
    );
  });

  it.each([
    "## 1.2.2 (2026-10-20)",
    "## 1.2.30 (2026-10-20)",
    "## 1.2.3",
    "## 1.2.3 2026-10-20",
    "## 1.2.3 (20-10-2026)",
    "## 1.2.3 (2026-13-01)",
    "## 1.2.3 (2026-02-30)",
    "## 1.2.3 (2025-02-29)",
    "## 1.2.3 (2026-10-20) con nota",
    "##  1.2.3 (2026-10-20)",
  ])("falla con el encabezado %j", (encabezado) => {
    expect(() => revisarFecha(`# Cambios\n\n${encabezado}\n`, "1.2.3")).toThrow(
      /## 1\.2\.3 \(AAAA-MM-DD\)/,
    );
  });

  it("falla sin encabezados", () => {
    expect(() => revisarFecha("# Cambios\n", "1.2.3")).toThrow(/ningún encabezado/);
  });
});

describe("compararVersiones", () => {
  it("compara major, minor y patch como números", () => {
    expect(compararVersiones("1.2.3", "1.2.3")).toBe(0);
    expect(compararVersiones("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compararVersiones("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compararVersiones("0.9.9", "1.0.0")).toBeLessThan(0);
    expect(compararVersiones("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(
      compararVersiones("10000000000000000001.0.0", "10000000000000000000.0.0"),
    ).toBeGreaterThan(0);
  });

  it("ordena las pre-versiones como semver e ignora los metadatos de build", () => {
    const orden = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < orden.length; i += 1) {
      for (let j = 0; j < orden.length; j += 1) {
        expect(Math.sign(compararVersiones(orden[i] ?? "", orden[j] ?? ""))).toBe(Math.sign(i - j));
      }
    }
    expect(compararVersiones("1.0.0+a", "1.0.0+b")).toBe(0);
    expect(compararVersiones("1.0.0-2", "1.0.0-10")).toBeLessThan(0);
  });

  it("falla con algo que no es una versión semver", () => {
    expect(() => compararVersiones("1.2", "1.2.3")).toThrow(/"1\.2"/);
    expect(() => compararVersiones("1.2.3", "latest")).toThrow(/"latest"/);
  });
});

describe("estadoEnNpm", () => {
  const liberacion = leerEtiqueta("mexicoapi@1.2.3");

  it("es publicable si la versión es mayor que todas las de npm", () => {
    expect(estadoEnNpm(respuesta(0, '[\n  "1.0.0",\n  "1.2.2"\n]\n'), liberacion)).toEqual({
      estado: "publicable",
      ultima: "1.2.2",
    });
    expect(
      estadoEnNpm(
        respuesta(0, '["1.2.2", "1.3.0-beta.1", "1.2.3-rc.1"]'),
        leerEtiqueta("mexicoapi@1.3.0"),
      ),
    ).toEqual({ estado: "publicable", ultima: "1.3.0-beta.1" });
  });

  it("acepta la respuesta de npm con una sola versión", () => {
    expect(estadoEnNpm(respuesta(0, '"1.0.0"\n'), liberacion)).toEqual({
      estado: "publicable",
      ultima: "1.0.0",
    });
  });

  it("dice sin-paquete si npm responde 404: el paquete todavía no existe", () => {
    expect(estadoEnNpm(NO_EXISTE, liberacion)).toEqual({ estado: "sin-paquete" });
  });

  it("falla si la versión ya está en npm", () => {
    expect(() => estadoEnNpm(respuesta(0, '["1.2.2", "1.2.3"]'), liberacion)).toThrow(
      /mexicoapi@1\.2\.3 ya está en npm/,
    );
  });

  it("falla si la versión es menor que la más reciente de npm", () => {
    expect(() => estadoEnNpm(respuesta(0, '["1.2.2", "1.3.0"]'), liberacion)).toThrow(
      /1\.2\.3 es menor que 1\.3\.0/,
    );
  });

  it.each([
    respuesta(1, "", "npm error code ENOTFOUND\nnpm error network request failed\n"),
    respuesta(1, "", "npm error code E500\n"),
    respuesta(1, "", ""),
    respuesta(null, "", ""),
  ])("falla cerrado si npm no responde (%j)", (r) => {
    expect(() => estadoEnNpm(r, liberacion)).toThrow(/no se pudo consultar npm/);
  });

  it.each(["", "no es json", "{}", "[]", "[1]", '["1.2"]'])(
    "falla con una respuesta inesperada de npm (%j)",
    (stdout) => {
      expect(() => estadoEnNpm(respuesta(0, stdout), liberacion)).toThrow(/npm/);
    },
  );
});

describe("revisarVerify", () => {
  it("acepta un verify terminado con éxito en el commit", () => {
    expect(() => revisarVerify(checks(corrida()), SHA)).not.toThrow();
  });

  it("toma la corrida más reciente de verify", () => {
    const vieja = corrida({ id: 9, conclusion: "failure" });
    expect(() => revisarVerify(checks(corrida(), vieja), SHA)).not.toThrow();
    const nueva = corrida({ id: 11, conclusion: "failure" });
    expect(() => revisarVerify(checks(corrida(), nueva), SHA)).toThrow(/failure/);
  });

  it("ignora los checks de otro nombre, otra app u otro commit", () => {
    for (const ajena of [
      corrida({ name: "verificacion" }),
      corrida({ app: { slug: "otra-app" } }),
      corrida({ app: null }),
      corrida({ head_sha: "f".repeat(40) }),
    ]) {
      expect(() => revisarVerify(checks(ajena), SHA)).toThrow(/no tiene el check verify/);
    }
    expect(() => revisarVerify(checks(), SHA)).toThrow(/no tiene el check verify/);
  });

  it("falla si verify todavía corre", () => {
    expect(() =>
      revisarVerify(checks(corrida({ status: "in_progress", conclusion: null })), SHA),
    ).toThrow(/todavía no termina.*vuelve a correr/s);
  });

  it.each(["failure", "cancelled", "skipped", "neutral", "timed_out", "action_required"])(
    "falla si verify terminó con %s",
    (conclusion) => {
      expect(() => revisarVerify(checks(corrida({ conclusion })), SHA)).toThrow(conclusion);
    },
  );

  it.each([null, {}, { check_runs: "x" }, { check_runs: [null] }, { check_runs: [{ id: "1" }] }])(
    "falla con una respuesta inesperada de la API (%j)",
    (r) => {
      expect(() => revisarVerify(r, SHA)).toThrow(/API de GitHub/);
    },
  );
});

describe("npmView y leerTodo", () => {
  it("npmView pide a npm la lista de versiones del paquete", () => {
    const llamadas: unknown[] = [];
    const r = npmView("mexicoapi-mcp", (comando, opciones) => {
      llamadas.push([comando, opciones]);
      return { status: 0, stdout: '["1.0.0"]\n', stderr: null };
    });
    expect(llamadas).toEqual([
      ["npm view mexicoapi-mcp versions --json", { encoding: "utf8", shell: true }],
    ]);
    expect(r).toEqual({ status: 0, stdout: '["1.0.0"]\n', stderr: "" });
  });

  it("leerTodo junta los pedazos del flujo, aunque partan un carácter", async () => {
    const texto = Buffer.from('{"año":1}');
    const flujo = Readable.from([texto.subarray(0, 4), texto.subarray(4), ""]);
    expect(await leerTodo(flujo)).toBe('{"año":1}');
  });
});

describe("principal", () => {
  it("revisar escribe el paquete, la versión y la carpeta para GITHUB_OUTPUT", async () => {
    await repoFalso();
    for (const [etiqueta, carpeta] of [
      ["mexicoapi@1.2.3", "packages/sdk"],
      ["mexicoapi-mcp@1.2.3", "packages/mcp"],
    ] as const) {
      const c = consola();
      expect(await principal(["revisar", etiqueta], c.opciones)).toBe(0);
      const [nombre] = etiqueta.split("@");
      expect(c.salida.join("")).toBe(`nombre=${nombre}\nversion=1.2.3\ncarpeta=${carpeta}\n`);
      expect(c.errores).toEqual([]);
    }
  });

  it("revisar falla si el package.json es de otra versión", async () => {
    await repoFalso("1.2.2", "## 1.2.3 (2026-10-20)");
    const c = consola();
    expect(await principal(["revisar", "mexicoapi@1.2.3"], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/^liberacion: .*1\.2\.2/);
    expect(c.salida).toEqual([]);
  });

  it("revisar falla si el historial todavía dice sin publicar", async () => {
    await repoFalso("1.2.3", "## 1.2.3 (sin publicar)");
    const c = consola();
    expect(await principal(["revisar", "mexicoapi-mcp@1.2.3"], c.opciones)).toBe(1);
    expect(c.errores.join("")).toMatch(/packages\/mcp\/CHANGELOG\.md.*sin publicar/);
  });

  it("revisar falla si falta un archivo o la etiqueta no sirve", async () => {
    const sinRepo = consola();
    expect(await principal(["revisar", "mexicoapi@1.2.3"], sinRepo.opciones)).toBe(1);
    expect(sinRepo.errores.join("")).toMatch(/packages\/sdk\/package\.json/);
    await repoFalso();
    await rm(join(dir, "packages/sdk/CHANGELOG.md"));
    const sinHistorial = consola();
    expect(await principal(["revisar", "mexicoapi@1.2.3"], sinHistorial.opciones)).toBe(1);
    expect(sinHistorial.errores.join("")).toMatch(/packages\/sdk\/CHANGELOG\.md/);
    const mala = consola();
    expect(await principal(["revisar", "mexicoapi@1.2"], mala.opciones)).toBe(1);
    expect(mala.errores.join("")).toMatch(/mexicoapi@X\.Y\.Z/);
  });

  it("npm consulta las versiones del paquete y escribe el estado", async () => {
    const c = consola();
    expect(await principal(["npm", "mexicoapi-mcp@1.2.3"], c.opciones)).toBe(0);
    expect(c.consultas).toEqual(["mexicoapi-mcp"]);
    expect(c.salida.join("")).toBe("estado=publicable\nultima=1.2.2\n");
    const nuevo = consola({ consultarNpm: () => NO_EXISTE });
    expect(await principal(["npm", "mexicoapi@1.2.3"], nuevo.opciones)).toBe(0);
    expect(nuevo.salida.join("")).toBe("estado=sin-paquete\n");
  });

  it("npm falla si la versión ya está o npm no responde", async () => {
    const ya = consola({ consultarNpm: () => respuesta(0, '["1.2.3"]') });
    expect(await principal(["npm", "mexicoapi@1.2.3"], ya.opciones)).toBe(1);
    expect(ya.errores.join("")).toMatch(/ya está en npm/);
    const caido = consola({ consultarNpm: () => respuesta(1, "", "npm error code ETIMEDOUT\n") });
    expect(await principal(["npm", "mexicoapi@1.2.3"], caido.opciones)).toBe(1);
    expect(caido.errores.join("")).toMatch(/no se pudo consultar npm: npm error code ETIMEDOUT/);
    expect(caido.salida).toEqual([]);
  });

  it("verify lee la respuesta de la API de la entrada", async () => {
    const c = consola();
    expect(await principal(["verify", SHA], c.opciones)).toBe(0);
    expect(c.salida.join("")).toMatch(new RegExp(`verify terminó bien en ${SHA}`));
    const rojo = consola({
      leerEntrada: async () => JSON.stringify(checks(corrida({ conclusion: "failure" }))),
    });
    expect(await principal(["verify", SHA], rojo.opciones)).toBe(1);
    const basura = consola({ leerEntrada: async () => "<html>" });
    expect(await principal(["verify", SHA], basura.opciones)).toBe(1);
    expect(basura.errores.join("")).toMatch(/API de GitHub/);
    const corto = consola();
    expect(await principal(["verify", "abc123"], corto.opciones)).toBe(1);
    expect(corto.errores.join("")).toMatch(/"abc123" no es el SHA/);
  });

  it.each([[[]], [["revisar"]], [["npm", "a", "b"]], [["otro", "mexicoapi@1.2.3"]]])(
    "con %j muestra el uso y devuelve 2",
    async (argv) => {
      const c = consola();
      expect(await principal(argv, c.opciones)).toBe(2);
      expect(c.errores.join("")).toMatch(/uso: node scripts\/liberacion\.ts/);
    },
  );

  it("con anotar escribe el error como anotación de GitHub Actions en una línea", async () => {
    const c = consola({
      anotar: true,
      consultarNpm: () => respuesta(1, "", "npm error 100% roto\r\nsegunda línea\n"),
    });
    expect(await principal(["npm", "mexicoapi@1.2.3"], c.opciones)).toBe(1);
    expect(c.errores.join("")).toBe(
      "::error title=liberacion::no se pudo consultar npm: npm error 100%25 roto\n",
    );
  });

  it("comoAnotacion escapa lo que GitHub Actions leería como otra línea", () => {
    expect(comoAnotacion("50% listo\r\nsigue")).toBe(
      "::error title=liberacion::50%25 listo%0D%0Asigue\n",
    );
  });

  it("como script sale con el código de principal", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/uso:/);
  });

  it("como script lee el repositorio desde su raíz", () => {
    const env = { ...process.env, GITHUB_ACTIONS: "" };
    const r = spawnSync(process.execPath, [SCRIPT, "revisar", "mexicoapi@999.0.0"], {
      encoding: "utf8",
      env,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^liberacion: .*packages\/sdk\/package\.json dice "\d+\.\d+\.\d+"/);
  });

  it("como script lee verify de stdin y, en GitHub Actions, anota el error", () => {
    const verde = spawnSync(process.execPath, [SCRIPT, "verify", SHA], {
      encoding: "utf8",
      input: JSON.stringify(checks(corrida())),
      env: { ...process.env, GITHUB_ACTIONS: "" },
    });
    expect(verde.status).toBe(0);
    expect(verde.stdout).toBe(`verify terminó bien en ${SHA}\n`);
    const rojo = spawnSync(process.execPath, [SCRIPT, "verify", SHA], {
      encoding: "utf8",
      input: JSON.stringify(checks(corrida({ conclusion: "failure" }))),
      env: { ...process.env, GITHUB_ACTIONS: "true" },
    });
    expect(rojo.status).toBe(1);
    expect(rojo.stderr).toMatch(/^::error title=liberacion::verify terminó con failure/);
  });
});
