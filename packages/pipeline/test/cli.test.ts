import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { principal } from "../src/cli.js";
import { crearEntorno, HOY, leerFixture } from "./ayudas.js";

const TODOS = ["inegi.estados", "inegi.municipios", "bancos"];

let raiz: string;
let aparte: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "cli-"));
  aparte = await mkdtemp(join(tmpdir(), "cli-aparte-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
  await rm(aparte, { recursive: true, force: true });
});

async function cepConAlta(): Promise<Uint8Array> {
  const cep = JSON.parse(new TextDecoder().decode(await leerFixture("bancos/cep-2026-10-17.json")));
  cep.instituciones.push(["40999", "NUEVO BANCO"]);
  return new TextEncoder().encode(JSON.stringify(cep));
}

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

  it("usa la fecha civil de México por omisión", async () => {
    // 03:00 UTC del 18 es todavía el 17 en la Ciudad de México
    const ahora = new Date("2026-10-18T03:00:00Z");
    const entorno = await crearEntorno(raiz, { ahora });
    expect(await principal(["actualizar", "bancos"], entorno)).toBe(0);
    const m = JSON.parse(await readFile(join(raiz, "bancos", "manifest.json"), "utf8"));
    expect(m.as_of).toBe("2026-10-17");
  });

  it("valida --fecha y no escribe con --seco", async () => {
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
    const salida = join(aparte, "resumen");
    expect(await principal(["actualizar", ...TODOS, "--resumen", salida], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("inegi.estados: ");
    expect(entorno.errores.join("")).toContain("HTTP 404");
    expect(entorno.salida.join("")).toContain("bancos: actualizado");
    const json = JSON.parse(await readFile(`${salida}.json`, "utf8"));
    expect(json.errores).toHaveLength(1);
    expect(json.errores[0].dataset).toBe("inegi.estados");
    expect(json.resultados).toHaveLength(2);
    expect(await readFile(`${salida}.md`, "utf8")).toContain("## Errores");
  });

  it("un alta en el CEP da 3 y escribe", async () => {
    expect(await principal(["actualizar", "bancos"], await crearEntorno(raiz))).toBe(0);
    const cep = JSON.parse(
      new TextDecoder().decode(await leerFixture("bancos/cep-2026-10-17.json")),
    );
    cep.instituciones.push(["40999", "NUEVO BANCO"]);
    const nuevo = new TextEncoder().encode(JSON.stringify(cep));
    const entorno = await crearEntorno(raiz, { cep: nuevo });
    const resumen = join(aparte, "salida", "resumen");
    expect(await principal(["actualizar", "bancos", "--resumen", resumen], entorno)).toBe(3);
    const bancos = JSON.parse(await readFile(join(raiz, "bancos", "bancos.json"), "utf8"));
    expect(bancos.some((b: { codigo: string }) => b.codigo === "999")).toBe(true);
    expect(await readFile(`${resumen}.md`, "utf8")).toContain("bancos");
    expect(JSON.parse(await readFile(`${resumen}.json`, "utf8")).errores).toEqual([]);
  });

  it("un error da 1 aunque otro dataset pida revisión, en cualquier orden", async () => {
    const inicial = await crearEntorno(raiz);
    expect(await principal(["actualizar", "inegi.estados", "bancos"], inicial)).toBe(0);
    const nuevo = await cepConAlta();
    for (const ids of [
      ["inegi.estados", "bancos"],
      ["bancos", "inegi.estados"],
    ]) {
      const entorno = await crearEntorno(raiz, { cep: nuevo, estados: { "mgee/": 404 } });
      expect(await principal(["actualizar", ...ids, "--seco"], entorno)).toBe(1);
      expect(entorno.salida.join("")).toContain("bancos: requiere_revision");
    }
  });

  it("explica en consola los motivos de una revisión", async () => {
    expect(await principal(["actualizar", "bancos"], await crearEntorno(raiz))).toBe(0);
    const entorno = await crearEntorno(raiz, { cep: await cepConAlta() });
    expect(await principal(["actualizar", "bancos"], entorno)).toBe(3);
    expect(entorno.salida.join("")).toMatch(/bancos: requiere_revision[^\n]*\n {2}- /);
  });

  it("rechaza opciones o argumentos que no aplican al comando", async () => {
    const entorno = await crearEntorno(raiz);
    for (const args of [
      ["bancos-historico", "--seco"],
      ["actualizar", "bancos", "--desde", "2026-01"],
      ["verificar", "--resumen", "x"],
      ["bancos-historico", "sobra"],
      ["verificar", "sobra"],
    ]) {
      expect(await principal(args, entorno)).toBe(1);
    }
    const errores = entorno.errores.join("");
    expect(errores).toContain("Opciones que no aplican a bancos-historico: --seco");
    expect(errores).toContain("Argumentos de más para verificar: sobra");
    expect(errores).toContain("Uso:");
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
    expect(await principal(["bancos-historico", "--desde", "2999-11"], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("posterior al mes");
    const caido = await crearEntorno(raiz, { estados: { "cep/instituciones": 404 } });
    expect(await principal(["bancos-historico", "--desde", "2026-10"], caido)).toBe(1);
    expect(caido.errores.join("")).toContain("HTTP 404");
    expect(await readdir(raiz)).toEqual([]);
  });

  it("con un mes sin datos escribe, avisa el hueco y sale 3", async () => {
    const entorno = await crearEntorno(raiz, {
      cepPorFecha: (f) => (f.startsWith("2026-09") ? "{}" : undefined),
    });
    const args = ["bancos-historico", "--desde", "2026-09", "--fecha", HOY];
    expect(await principal(args, entorno)).toBe(3);
    expect(entorno.errores.join("")).toContain("sin datos del CEP en 2026-09");
    expect(await readdir(join(raiz, "bancos"))).toContain("bancos.json");
  });

  it("un bloqueo (HTML) a media captura sale 1, no escribe y no pide más", async () => {
    const entorno = await crearEntorno(raiz, {
      cepPorFecha: (f) => (f.startsWith("2026-08") ? "<html>bloqueado</html>" : undefined),
    });
    const args = ["bancos-historico", "--desde", "2026-06", "--fecha", HOY];
    expect(await principal(args, entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("posible bloqueo");
    expect(await readdir(raiz)).toEqual([]);
    expect(entorno.pedidas.map((u) => u.match(/fecha=(\d\d-\d\d-\d{4})/)?.[1])).toEqual([
      "01-06-2026",
      "01-07-2026",
      "01-08-2026",
    ]);
  });

  it("un JSON sin instituciones pasa al día siguiente", async () => {
    const entorno = await crearEntorno(raiz, {
      cepPorFecha: (f) => (f.endsWith("-01") ? '{"overrideCaptcha":true}' : undefined),
    });
    const args = ["bancos-historico", "--desde", "2026-10", "--fecha", HOY];
    expect(await principal(args, entorno)).toBe(0);
    expect(entorno.pedidas.slice(0, 2).map((u) => u.slice(-10))).toEqual([
      "01-10-2026",
      "02-10-2026",
    ]);
  });

  it("--intervalo fija el cliente y se anuncia la duración", async () => {
    const entorno = await crearEntorno(raiz);
    const args = ["bancos-historico", "--desde", "2026-10", "--fecha", HOY, "--intervalo", "45"];
    expect(await principal(args, entorno)).toBe(0);
    expect(entorno.intervalos).toEqual([45000]);
    expect(entorno.salida[0]).toBe(
      "bancos: 1 meses, un pedido cada 45 s; duración estimada: 1 min\n",
    );
    const porOmision = await crearEntorno(aparte);
    await principal(["bancos-historico", "--desde", "2026-10", "--fecha", HOY], porOmision);
    expect(porOmision.intervalos).toEqual([30000]);
  });

  it("actualizar usa un cliente de 1 s", async () => {
    const entorno = await crearEntorno(raiz);
    await principal(["actualizar", "inegi.estados", "--seco"], entorno);
    expect(entorno.intervalos).toEqual([1000]);
  });

  it("rechaza --intervalo inválido", async () => {
    for (const valor of ["0", "abc", "1.5"]) {
      const entorno = await crearEntorno(raiz);
      expect(await principal(["bancos-historico", "--intervalo", valor], entorno)).toBe(1);
      expect(entorno.errores.join("")).toContain("--intervalo inválido");
      expect(entorno.intervalos).toEqual([]);
    }
  });
});
