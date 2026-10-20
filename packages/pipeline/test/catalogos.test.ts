import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// context7.json y glama.json van en la raíz: Context7 y Glama los leen del repositorio en GitHub.

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

const leerJson = async (ruta: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(RAIZ, ruta), "utf8")) as Record<string, unknown>;

const leerTexto = (ruta: string): Promise<string> => readFile(join(RAIZ, ruta), "utf8");

/** El largo como lo cuenta JSON Schema: en caracteres, no en unidades de UTF-16. */
const largo = (texto: string): number => [...texto].length;

describe("context7.json", () => {
  it("usa solo campos del esquema de Context7, dentro de sus límites", async () => {
    const c = await leerJson("context7.json");
    // El esquema (https://context7.com/schema/context7.json) no admite otros campos.
    expect(Object.keys(c).sort()).toEqual([
      "$schema",
      "description",
      "excludeFiles",
      "folders",
      "projectTitle",
      "rules",
    ]);
    expect(c.$schema).toBe("https://context7.com/schema/context7.json");
    expect(c.projectTitle).toBe("MéxicoAPI");
    const descripcion = c.description as string;
    expect(largo(descripcion)).toBeGreaterThanOrEqual(10);
    expect(largo(descripcion)).toBeLessThanOrEqual(500);
    const reglas = c.rules as string[];
    expect(reglas.length).toBeGreaterThan(0);
    expect(reglas.length).toBeLessThanOrEqual(50);
    expect(new Set(reglas).size).toBe(reglas.length);
    for (const regla of reglas) {
      expect(largo(regla), regla).toBeGreaterThan(0);
      expect(largo(regla), regla).toBeLessThanOrEqual(255);
    }
  });

  it("lee docs y los dos paquetes, sin sus CHANGELOG", async () => {
    const c = await leerJson("context7.json");
    expect(c.folders).toEqual(["docs", "packages/sdk", "packages/mcp"]);
    for (const carpeta of c.folders as string[]) {
      expect((await stat(join(RAIZ, carpeta))).isDirectory(), carpeta).toBe(true);
    }
    // excludeFiles lleva solo el nombre, sin ruta: uno cubre el historial de los dos paquetes.
    expect(c.excludeFiles).toEqual(["CHANGELOG.md"]);
    for (const paquete of ["packages/sdk", "packages/mcp"]) {
      const historiales = (await readdir(join(RAIZ, paquete))).filter((a) => /^changelog/i.test(a));
      expect(historiales, paquete).toEqual(["CHANGELOG.md"]);
    }
  });

  it("cada regla dice lo que hacen hoy el código y la documentación", async () => {
    const reglas = ((await leerJson("context7.json")).rules as string[]).join("\n");
    const api = await leerTexto("docs/api/README.md");
    const mcp = await leerTexto("packages/mcp/README.md");
    const indice = await leerTexto("packages/sdk/src/index.ts");
    // Las funciones que nombran las reglas salen de la entrada principal de mexicoapi.
    const funciones = [...reglas.matchAll(/\b([a-z]+[A-Z]\w*)\(\)/g)].map((m) => m[1] as string);
    expect(funciones.sort()).toEqual([
      "hoyEnMexico",
      "validarClabe",
      "validarCurp",
      "validarNss",
      "validarRfc",
    ]);
    for (const f of funciones) expect(indice, f).toMatch(new RegExp(`^\\s+${f},\\r?$`, "m"));
    expect(reglas).toContain("Ciudad de México (America/Mexico_City)");
    expect(api).toContain("son días de la Ciudad de México (`America/Mexico_City`)");
    expect(reglas).toContain("autoridad=sat");
    expect(api).toContain("Con `autoridad=sat`, `tipo_plazo` es obligatorio.");
    expect(api).toContain("Sin `tipo_plazo` responde 400 `parametro-faltante`");
    expect(reglas).toContain("meta.sources");
    expect(api).toContain("| `sources` | Lista de fuentes");
    expect(mcp).toContain("`fuente` y `fuentes`: la publicación oficial con su URL, para citarla.");
    expect(mcp).toContain(
      "El servidor no envía a ninguna API una CLABE, un RFC, una CURP o un NSS: los valida en tu equipo",
    );
    expect(reglas).toContain("avisos[].codigo");
    expect(api).toContain("El texto es para mostrarlo y puede cambiar de redacción");
    expect(api).toContain("trata uno que no conozcas como `otro`");
  });
});

describe("glama.json", () => {
  it("declara a Dagel4k como mantenedor, con el esquema de Glama", async () => {
    expect(await leerJson("glama.json")).toEqual({
      $schema: "https://glama.ai/mcp/schemas/server.json",
      maintainers: ["Dagel4k"],
    });
  });
});
