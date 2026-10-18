import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Entorno, principal } from "../../src/cli.js";
import { YAML_ISR, YAML_SAT, YAML_UMA } from "./ejemplos.js";

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "curar-"));
  await mkdir(join(raiz, "curado"));
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

/** Entorno sin red: `curar` y `verificar` no piden clientes HTTP. */
function entorno(raizDatos = raiz): Entorno & { salida: string[]; errores: string[] } {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    crearCliente: () => {
      throw new Error("curar no usa la red");
    },
    raizDatos,
    ahora: () => new Date("2026-10-18T12:00:00Z"),
    escribir: (t) => void salida.push(t),
    escribirError: (t) => void errores.push(t),
    salida,
    errores,
  };
}

const escribirYaml = (nombre: string, texto: string) =>
  writeFile(join(raiz, "curado", nombre), texto);

async function instantanea(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const f of await readdir(raiz, { recursive: true, withFileTypes: true })) {
    if (f.isDirectory()) continue;
    const ruta = join(f.parentPath, f.name);
    mapa.set(ruta, (await readFile(ruta)).toString("base64"));
  }
  return mapa;
}

describe("curar", () => {
  it("sin YAML no escribe nada y lo dice", async () => {
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(0);
    expect(e.salida.join("")).toBe(`curar: no hay YAML en ${join(raiz, "curado")}\n`);
    expect(await readdir(raiz)).toEqual(["curado"]);
  });

  it("genera los datos y el manifiesto, verificar pasa y una segunda corrida no cambia nada", async () => {
    await escribirYaml("constantes-uma.yaml", YAML_UMA);
    await escribirYaml("isr-tarifas.yaml", YAML_ISR);
    await escribirYaml("dias-inhabiles-sat.yaml", YAML_SAT);
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(0);
    expect(e.salida).toEqual([
      "dias-inhabiles.sat: actualizado (8 registros)\n",
      "constantes.uma: actualizado (2 registros)\n",
      "isr.tarifas: actualizado (3 registros)\n",
    ]);
    expect((await readdir(join(raiz, "constantes-uma"))).sort()).toEqual([
      "manifest.json",
      "uma.json",
    ]);
    expect(await principal(["verificar"], entorno())).toBe(0);

    const antes = await instantanea();
    const segunda = entorno();
    expect(await principal(["curar"], segunda)).toBe(0);
    expect(segunda.salida).toContain("constantes.uma: sin_cambios (2 registros)\n");
    expect(await instantanea()).toEqual(antes);
  });

  it("actualiza la carpeta cuando cambia el YAML", async () => {
    await escribirYaml("constantes-uma.yaml", YAML_UMA);
    expect(await principal(["curar"], entorno())).toBe(0);
    const sinUna = YAML_UMA.replace(/ {2}uma-2025:[\s\S]*?(?=registros:)/, "").replace(
      /\n {2}- anio: 2025[\s\S]*$/,
      "\n",
    );
    await escribirYaml("constantes-uma.yaml", sinUna);
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(0);
    expect(e.salida).toEqual(["constantes.uma: actualizado (1 registros)\n"]);
    const datos = JSON.parse(await readFile(join(raiz, "constantes-uma", "uma.json"), "utf8"));
    expect(datos.map((r: { anio: number }) => r.anio)).toEqual([2026]);
    expect(await principal(["verificar"], entorno())).toBe(0);
  });

  it("con un YAML inválido sale 1, explica el problema y no escribe ninguno", async () => {
    await escribirYaml("isr-tarifas.yaml", YAML_ISR);
    await escribirYaml(
      "constantes-uma.yaml",
      YAML_UMA.replace('anual: "42794.64"', 'anual: "42749.64"'),
    );
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(1);
    expect(e.errores.join("")).toContain(
      "curado/constantes-uma.yaml: invariante: 2026: anual es 42749.64, se esperaba 42794.64 (mensual × 12)\n",
    );
    expect(e.salida).toEqual([]);
    expect(await readdir(raiz)).toEqual(["curado"]);
  });

  it("sale 1 con archivos ajenos en data/curado o carpetas generadas sin YAML", async () => {
    await escribirYaml("constantes-uma.yml", YAML_UMA);
    await mkdir(join(raiz, "isr-tarifas"));
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(1);
    expect(e.errores).toEqual([
      "curado: archivo no declarado: constantes-uma.yml\n",
      "isr-tarifas: falta curado/isr-tarifas.yaml\n",
    ]);
  });

  it("usa --datos y rechaza opciones o argumentos que no aplican", async () => {
    const otra = join(raiz, "otra");
    await mkdir(join(otra, "curado"), { recursive: true });
    await writeFile(join(otra, "curado", "constantes-uma.yaml"), YAML_UMA);
    expect(await principal(["curar", "--datos", otra], entorno(join(raiz, "no-se-usa")))).toBe(0);
    expect((await readdir(otra)).sort()).toEqual(["constantes-uma", "curado"]);

    const e = entorno();
    expect(await principal(["curar", "--seco"], e)).toBe(1);
    expect(await principal(["curar", "constantes.uma"], e)).toBe(1);
    const errores = e.errores.join("");
    expect(errores).toContain("Opciones que no aplican a curar: --seco");
    expect(errores).toContain("Argumentos de más para curar: constantes.uma");
    expect(errores).toContain("  curar [--datos <ruta>]");
  });

  it("un error de disco sale 1 con el mensaje", async () => {
    await escribirYaml("constantes-uma.yaml", YAML_UMA);
    // Un archivo donde va la carpeta generada: leerla falla.
    await writeFile(join(raiz, "constantes-uma"), "no soy carpeta");
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(1);
    expect(e.errores.join("")).toMatch(/^curar: /);
  });

  it("sin data/curado no hay nada que curar", async () => {
    await rm(join(raiz, "curado"), { recursive: true });
    const e = entorno();
    expect(await principal(["curar"], e)).toBe(0);
    expect(await readdir(raiz)).toEqual([]);
  });
});
