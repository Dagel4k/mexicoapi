import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { principal } from "../src/cli.js";
import { crearEntorno, HOY, leerFixture } from "./ayudas.js";

const TODOS = ["inegi.estados", "inegi.municipios", "bancos"];

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "cli-"));
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

async function instantanea(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const f of await readdir(raiz, { recursive: true, withFileTypes: true })) {
    if (f.isDirectory()) continue;
    const ruta = join(f.parentPath, f.name);
    mapa.set(ruta, (await readFile(ruta)).toString("base64"));
  }
  return mapa;
}

describe("actualizar", () => {
  it("crea los tres datasets y una segunda corrida no cambia nada", async () => {
    const entorno = await crearEntorno(raiz);
    expect(await principal(["actualizar", ...TODOS], entorno)).toBe(0);
    for (const d of ["inegi-estados", "inegi-municipios", "bancos"]) {
      expect(await readdir(join(raiz, d))).toContain("manifest.json");
    }
    const antes = await instantanea();
    const segundo = await crearEntorno(raiz);
    expect(await principal(["actualizar", ...TODOS], segundo)).toBe(0);
    expect(await instantanea()).toEqual(antes);
    expect(segundo.salida.join("")).toContain("bancos: sin_cambios");
    expect(await principal(["verificar"], await crearEntorno(raiz))).toBe(0);
  });

  it("usa la fecha de México por omisión y valida --fecha", async () => {
    const entorno = await crearEntorno(raiz);
    expect(await principal(["actualizar", "inegi.estados", "--seco"], entorno)).toBe(0);
    expect(await readdir(raiz)).toEqual([]);
    expect(await principal(["actualizar", "bancos", "--fecha", "2026-02-30"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("Fecha inválida");
  });

  it("con el CEP sin instituciones da 1 y deja data/bancos intacto", async () => {
    expect(await principal(["actualizar", "bancos"], await crearEntorno(raiz))).toBe(0);
    const antes = await instantanea();
    const vacio = await leerFixture("bancos/cep-sin-instituciones.json");
    const entorno = await crearEntorno(raiz, { cep: vacio });
    expect(await principal(["actualizar", "bancos"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toMatch(/^bancos: /);
    expect(await instantanea()).toEqual(antes);
  });

  it("un error no impide correr los siguientes, y el HTTP trae URL y estado", async () => {
    const entorno = await crearEntorno(raiz, { estados: { "mgee/": 404 } });
    const salida = join(raiz, "..", `resumen-${Date.now()}`);
    expect(await principal(["actualizar", ...TODOS, "--resumen", salida], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("inegi.estados: ");
    expect(entorno.errores.join("")).toContain("HTTP 404");
    expect(entorno.salida.join("")).toContain("bancos: actualizado");
    const json = JSON.parse(await readFile(`${salida}.json`, "utf8"));
    expect(json.errores).toHaveLength(1);
    expect(json.errores[0].dataset).toBe("inegi.estados");
    expect(json.resultados).toHaveLength(2);
    expect(await readFile(`${salida}.md`, "utf8")).toContain("## Errores");
    await rm(`${salida}.json`);
    await rm(`${salida}.md`);
  });

  it("un alta en el CEP da 3 y escribe", async () => {
    expect(await principal(["actualizar", "bancos"], await crearEntorno(raiz))).toBe(0);
    const cep = JSON.parse(
      new TextDecoder().decode(await leerFixture("bancos/cep-2026-10-17.json")),
    );
    cep.instituciones.push(["40999", "NUEVO BANCO"]);
    const nuevo = new TextEncoder().encode(JSON.stringify(cep));
    const entorno = await crearEntorno(raiz, { cep: nuevo });
    const resumen = join(raiz, "salida", "resumen");
    expect(await principal(["actualizar", "bancos", "--resumen", resumen], entorno)).toBe(3);
    const bancos = JSON.parse(await readFile(join(raiz, "bancos", "bancos.json"), "utf8"));
    expect(bancos.some((b: { codigo: string }) => b.codigo === "999")).toBe(true);
    expect(await readFile(`${resumen}.md`, "utf8")).toContain("bancos");
    expect(JSON.parse(await readFile(`${resumen}.json`, "utf8")).errores).toEqual([]);
  });

  it("rechaza ids desconocidos, argumentos vacíos y opciones inválidas", async () => {
    const entorno = await crearEntorno(raiz);
    expect(await principal(["actualizar", "nada"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("Dataset desconocido: nada");
    expect(await principal(["actualizar"], entorno)).toBe(1);
    expect(await principal(["actualizar", "bancos", "--rara"], entorno)).toBe(1);
    expect(await principal(["bailar"], entorno)).toBe(1);
    expect(await principal([], entorno)).toBe(1);
  });

  it("--datos reemplaza la raíz del entorno", async () => {
    const otra = join(raiz, "otra");
    const entorno = await crearEntorno(join(raiz, "no-se-usa"));
    expect(await principal(["actualizar", "inegi.estados", "--datos", otra], entorno)).toBe(0);
    expect(await readdir(otra)).toEqual(["inegi-estados"]);
  });
});

describe("verificar", () => {
  it("sale 1 e imprime los problemas", async () => {
    await principal(["actualizar", "inegi.estados"], await crearEntorno(raiz));
    await rm(join(raiz, "inegi-estados", "estados.json"));
    const entorno = await crearEntorno(raiz);
    expect(await principal(["verificar"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("inegi-estados: falta el archivo de datos");
  });
});

describe("bancos-historico", () => {
  it("sale 1 si ya existe bancos.json", async () => {
    await principal(["actualizar", "bancos"], await crearEntorno(raiz));
    const entorno = await crearEntorno(raiz);
    expect(await principal(["bancos-historico"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("ya existe");
  });

  it("captura el mes actual y escribe el crudo histórico", async () => {
    const entorno = await crearEntorno(raiz);
    const args = ["bancos-historico", "--desde", "2026-10", "--fecha", HOY];
    expect(await principal(args, entorno), entorno.errores.join("")).toBe(0);
    expect(await readdir(join(raiz, "bancos", "raw"))).toContain("cep-historico.json");
    expect(await principal(["verificar"], await crearEntorno(raiz))).toBe(0);
  });

  it("valida fecha y mes de inicio, y reporta fallos de red con exit 1", async () => {
    const entorno = await crearEntorno(raiz);
    expect(await principal(["bancos-historico", "--fecha", "x"], entorno)).toBe(1);
    expect(await principal(["bancos-historico", "--desde", "2026-13"], entorno)).toBe(1);
    const caido = await crearEntorno(raiz, { estados: { "cep/instituciones": 404 } });
    expect(await principal(["bancos-historico", "--desde", "2026-10"], caido)).toBe(1);
    expect(caido.errores.join("")).toContain("HTTP 404");
    expect(await readdir(raiz)).toEqual([]);
  });
});
