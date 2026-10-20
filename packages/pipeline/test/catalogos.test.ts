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

  it("lee la guía de la API, los datasets y los dos paquetes, sin sus CHANGELOG", async () => {
    const c = await leerJson("context7.json");
    // Lista de permitidas: docs/operacion y docs/diseno son del mantenimiento, no del uso.
    expect(c.folders).toEqual(["docs/api", "docs/datos", "packages/sdk", "packages/mcp"]);
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
    const sdk = await leerTexto("packages/sdk/README.md");
    const mcp = await leerTexto("packages/mcp/README.md");
    // Las funciones que nombran las reglas salen de la entrada principal de mexicoapi o, la del
    // catálogo de bancos, de mexicoapi/datos.
    const principal = await leerTexto("packages/sdk/src/index.ts");
    const datos = await leerTexto("packages/sdk/src/datos/index.ts");
    const funciones = [
      ...new Set([...reglas.matchAll(/\b([a-z]+[A-Z]\w*)\(\)/g)].map((m) => m[1] as string)),
    ];
    expect(funciones.sort()).toEqual([
      "catalogoClabe",
      "hoyEnMexico",
      "validarClabe",
      "validarCurp",
      "validarNss",
      "validarRfc",
    ]);
    for (const f of funciones) {
      const exportada = new RegExp(`(^|[\\s{,])${f}(?=[\\s,}])`, "m");
      expect(f === "catalogoClabe" ? datos : principal, f).toMatch(exportada);
    }
    expect(reglas).toContain("Ciudad de México (America/Mexico_City)");
    expect(api).toContain("son días de la Ciudad de México (`America/Mexico_City`)");
    expect(reglas).toContain("autoridad=sat manda siempre tipo_plazo (tipoPlazo en el paquete)");
    expect(api).toContain("Con `autoridad=sat`, `tipo_plazo` es obligatorio.");
    expect(api).toContain("Sin `tipo_plazo` responde 400 `parametro-faltante`");
    expect(sdk).toContain("Con autoridad=sat falta tipoPlazo");
    expect(reglas).toContain("meta.sources");
    expect(api).toContain("| `sources` | Lista de fuentes");
    expect(mcp).toContain("`fuente` y `fuentes`: la publicación oficial con su URL, para citarla.");
    expect(mcp).toContain(
      "El servidor no envía a ninguna API una CLABE, un RFC, una CURP o un NSS: los valida en tu equipo",
    );
    // Sin el catálogo, validarClabe() no revisa que el banco exista.
    expect(reglas).toContain("{ bancos: catalogoClabe() } de mexicoapi/datos");
    expect(sdk).toContain('import { catalogoClabe } from "mexicoapi/datos";');
    expect(sdk).toContain("Sin el catálogo no se revisa que el banco exista");
    expect(sdk).toContain('validarClabe("999010077777777774", { bancos }).errores; // ["banco"]');
    expect(reglas).toContain("avisos[].codigo (en el paquete, desde 0.2.0)");
    expect(api).toContain("la 0.1.0 no trae `avisos`");
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
