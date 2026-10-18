import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Estado, Municipio } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estadosInegi, municipiosInegi } from "../../src/datasets/inegi.js";
import { diferenciar } from "../../src/diferencias.js";
import { ErrorDatos } from "../../src/errores.js";
import { crearCliente, ErrorHttp } from "../../src/http.js";
import {
  type Contexto,
  type CrudoCapturado,
  ejecutarDataset,
  type FuenteCapturada,
} from "../../src/marco.js";

const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/inegi");
const BASE = "https://gaia.inegi.org.mx/wscatgeo/v2/";
const claves = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, "0"));

async function leer(nombre: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(dirFixtures, nombre)));
}

const crudo = (file: string, bytes: Uint8Array): CrudoCapturado => ({
  file,
  url: `${BASE}${file}`,
  bytes,
  obtenido_en: "2026-10-17T10:00:00.000Z",
});

const texto = (s: string) => new TextEncoder().encode(s);

let crudosEstados: CrudoCapturado[];
let crudosMunicipios: CrudoCapturado[];

const fuente = (crudos: CrudoCapturado[]): FuenteCapturada => ({
  name: "n",
  url: BASE,
  license: "l",
  license_url: "https://l.test",
  citation: "c",
  published_at: null,
  crudos,
});

const ctxVacio = {} as Contexto;

beforeEach(async () => {
  crudosEstados = [crudo("raw/mgee.json", await leer("mgee.json"))];
  crudosMunicipios = await Promise.all(
    claves.map(async (c) => crudo(`raw/mgem-${c}.json`, await leer(`mgem-${c}.json`))),
  );
});

async function estados(): Promise<Estado[]> {
  return (await estadosInegi.construir([fuente(crudosEstados)], null, ctxVacio)).registros;
}

async function municipios(): Promise<Municipio[]> {
  return (await municipiosInegi.construir([fuente(crudosMunicipios)], null, ctxVacio)).registros;
}

describe("estados", () => {
  it("construye los 32 estados con nombre y abreviatura", async () => {
    const r = await estados();
    expect(r).toHaveLength(32);
    expect(r.find((e) => e.cve_ent === "09")).toEqual({
      cve_ent: "09",
      nombre: "Ciudad de México",
      abreviatura: "CDMX",
      cvegeo: "09",
    });
    expect(estadosInegi.invariantes(r)).toEqual([]);
    for (const e of r) expect(e.nombre).toBe(e.nombre.normalize("NFC"));
  });

  it("rechaza overrideCaptcha, HTML y formas distintas con ErrorDatos", async () => {
    for (const cuerpo of [
      '{"overrideCaptcha":true}',
      "<html><body>Mantenimiento</body></html>",
      '{"datos":[{"cvegeo":"01"}]}',
    ]) {
      const e = await estadosInegi
        .construir([fuente([crudo("raw/mgee.json", texto(cuerpo))])], null, ctxVacio)
        .catch((x) => x);
      expect(e).toBeInstanceOf(ErrorDatos);
      expect(e.dataset).toBe("inegi.estados");
    }
  });

  it("falla sin el crudo esperado", async () => {
    await expect(estadosInegi.construir([fuente([])], null, ctxVacio)).rejects.toBeInstanceOf(
      ErrorDatos,
    );
  });

  it("los invariantes detectan faltantes, repetidos, fuera de rango y cvegeo distinto", async () => {
    const r = await estados();
    expect(estadosInegi.invariantes(r.slice(1))[0]).toContain("32");
    const repetido = [...r.slice(1), { ...(r[1] as Estado) }];
    expect(estadosInegi.invariantes(repetido).join(" ")).toContain("repetidas: 02");
    expect(estadosInegi.invariantes(repetido).join(" ")).toContain("faltan cve_ent: 01");
    const fuera = r.map((e) => (e.cve_ent === "32" ? { ...e, cve_ent: "33", cvegeo: "33" } : e));
    expect(estadosInegi.invariantes(fuera).join(" ")).toContain("fuera de 01 a 32: 33");
    const otro = r.map((e) => (e.cve_ent === "05" ? { ...e, cvegeo: "55" } : e));
    expect(estadosInegi.invariantes(otro).join(" ")).toContain("cvegeo distinto de cve_ent en: 05");
  });

  it("cualquier diferencia pide revisión", async () => {
    const r = await estados();
    const cambiado = r.map((e) => (e.cve_ent === "01" ? { ...e, nombre: "Otro" } : e));
    const rev = estadosInegi.revisar(diferenciar(r, cambiado, estadosInegi.clave), r);
    expect(rev).toEqual({
      requiereRevision: true,
      motivos: ["cambio en el catálogo de estados"],
    });
  });
});

describe("municipios", () => {
  it("construye 2,478 municipios con las claves oficiales", async () => {
    const r = await municipios();
    expect(r).toHaveLength(2478);
    expect(municipiosInegi.invariantes(r)).toEqual([]);
    expect(r.find((m) => m.cvegeo === "25006")).toEqual({
      cvegeo: "25006",
      cve_ent: "25",
      cve_mun: "006",
      nombre: "Culiacán",
      cve_cabecera: "0001",
    });
    const sinCabecera = r.filter((m) => m.cve_cabecera === "----");
    expect(sinCabecera.map((m) => m.cve_ent)).toEqual(Array(16).fill("09"));
    expect(r.find((m) => m.cvegeo === "25019")?.nombre).toBe("Eldorado");
    expect(r.find((m) => m.cvegeo === "25020")?.nombre).toBe("Juan José Ríos");
    for (const m of r) expect(m.nombre).toBe(m.nombre.normalize("NFC"));
  });

  it("un mgem con un municipio de otro estado lanza ErrorDatos", async () => {
    const i = claves.indexOf("17");
    const json = JSON.parse(new TextDecoder().decode(crudosMunicipios[i]?.bytes));
    json.datos[0].cve_ent = "18";
    crudosMunicipios[i] = crudo("raw/mgem-17.json", texto(JSON.stringify(json)));
    const e = await municipios().catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("mgem-17");
  });

  it("falta uno de los 32 crudos o sobra uno: ErrorDatos", async () => {
    crudosMunicipios.splice(5, 1);
    const falta = await municipios().catch((x) => x);
    expect(falta).toBeInstanceOf(ErrorDatos);
    expect(falta.message).toContain("raw/mgem-06.json");

    crudosMunicipios = [...crudosMunicipios, crudo("raw/mgem-06.json", texto("{}"))];
    crudosMunicipios.push(crudo("raw/otro.json", texto("{}")));
    const sobra = await municipios().catch((x) => x);
    expect(sobra).toBeInstanceOf(ErrorDatos);
    expect(sobra.message).toContain("raw/otro.json");
  });

  it("HTML o JSON ajeno en un mgem lanza ErrorDatos", async () => {
    crudosMunicipios[0] = crudo("raw/mgem-01.json", texto("<html></html>"));
    await expect(municipios()).rejects.toBeInstanceOf(ErrorDatos);
    crudosMunicipios[0] = crudo("raw/mgem-01.json", texto('{"overrideCaptcha":true}'));
    await expect(municipios()).rejects.toBeInstanceOf(ErrorDatos);
  });

  it("los invariantes detectan pocos municipios, cvegeo mal formado y estados vacíos", async () => {
    const r = await municipios();
    const pocos = municipiosInegi.invariantes(r.slice(0, 100)).join(" ");
    expect(pocos).toContain("al menos 2400");
    expect(pocos).toContain("estados sin municipios");
    const mal = r.map((m, i) => (i === 0 ? { ...m, cvegeo: "01999" } : m));
    expect(municipiosInegi.invariantes(mal).join(" ")).toContain("cvegeo distinto");
  });

  it("revisar: 13 cambios sobre 2,478 piden revisión y 12 no", async () => {
    const r = await municipios();
    const con = (n: number) => r.map((m, i) => (i < n ? { ...m, nombre: `${m.nombre} X` } : m));
    const rev13 = municipiosInegi.revisar(diferenciar(r, con(13), municipiosInegi.clave), r);
    expect(rev13.requiereRevision).toBe(true);
    expect(rev13.motivos[0]).toContain("0.52 %");
    const rev12 = municipiosInegi.revisar(diferenciar(r, con(12), municipiosInegi.clave), r);
    expect(rev12).toEqual({ requiereRevision: false, motivos: [] });
  });
});

describe("capturar", () => {
  let raiz: string;
  let pedidas: string[];
  let falla17: boolean;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "inegi-"));
    pedidas = [];
    falla17 = false;
  });
  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  const ctx = (): Contexto => {
    let t = 0;
    const fetchFalso: typeof fetch = async (entrada) => {
      const url = String(entrada);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      pedidas.push(url);
      if (url === `${BASE}mgee/`) return new Response(await leer("mgee.json"));
      const m = /mgem\/(\d{2})$/.exec(url);
      if (m === null) return new Response("", { status: 404 });
      if (falla17 && m[1] === "17") return new Response("", { status: 503 });
      return new Response(await leer(`mgem-${m[1]}.json`));
    };
    const cliente = crearCliente({
      fetch: fetchFalso,
      esperar: async () => {},
      ahora: () => {
        t += 2000;
        return Date.UTC(2026, 9, 17, 12) + t;
      },
    });
    return { cliente, fecha: "2026-10-17", raizDatos: raiz };
  };

  it("estados pide una URL y municipios las 32 en orden, con la misma fuente", async () => {
    const c = ctx();
    const [fe] = await estadosInegi.capturar(c);
    const [fm] = await municipiosInegi.capturar(c);
    expect(pedidas).toEqual([`${BASE}mgee/`, ...claves.map((k) => `${BASE}mgem/${k}`)]);
    expect(fe?.crudos.map((x) => x.file)).toEqual(["raw/mgee.json"]);
    expect(fm?.crudos.map((x) => x.file)).toEqual(claves.map((k) => `raw/mgem-${k}.json`));
    expect(fm?.crudos[16]?.url).toBe(`${BASE}mgem/17`);
    expect(fe).toMatchObject({
      url: BASE,
      license: "Términos de libre uso de la información del INEGI",
      license_url: "https://www.inegi.org.mx/inegi/terminos.html",
      published_at: null,
    });
    expect({ ...fe, crudos: [] }).toEqual({ ...fm, crudos: [] });
    expect(fm?.crudos[0]?.bytes).toEqual(await leer("mgem-01.json"));
  });

  it("corrida completa escribe estados y municipios", async () => {
    const c = ctx();
    const e = await ejecutarDataset(estadosInegi, c);
    const m = await ejecutarDataset(municipiosInegi, c);
    expect(e.resultado).toMatchObject({ estado: "actualizado", registros: 32 });
    expect(m.resultado).toMatchObject({ estado: "actualizado", registros: 2478 });
    const mm = JSON.parse(await readFile(join(raiz, "inegi-municipios", "manifest.json"), "utf8"));
    expect(mm.records).toBe(2478);
    expect(mm.sources[0].raw).toHaveLength(32);
    const me = JSON.parse(await readFile(join(raiz, "inegi-estados", "manifest.json"), "utf8"));
    expect(me.records).toBe(32);
  });

  it("si el estado 17 falla siempre, lanza ErrorHttp y no escribe nada", async () => {
    falla17 = true;
    const e = await ejecutarDataset(municipiosInegi, ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect(e.estado).toBe(503);
    expect(await readdir(raiz)).toEqual([]);
  });
});
