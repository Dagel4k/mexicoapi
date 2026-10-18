import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { sha256Hex } from "../src/canonico.js";
import { ErrorDatos } from "../src/errores.js";
import { ErrorHttp } from "../src/http.js";
import {
  type Construccion,
  type Contexto,
  type DefinicionDataset,
  ejecutarDataset,
  type FuenteCapturada,
  leerRegistros,
} from "../src/marco.js";

interface Reg {
  id: string;
  nombre: string;
}

let raiz: string;
let entrada: Reg[];
let avisos: string[];
let marcaRevision: boolean;
let invariantesFalla: string[];
let crudos: FuenteCapturada["crudos"];

const instante = "2026-10-17T10:00:00.000Z";
const mkCrudos = (): FuenteCapturada["crudos"] => [
  {
    file: "raw/a.json",
    url: "https://x.test/a",
    bytes: new TextEncoder().encode("AAA"),
    obtenido_en: "2026-10-17T10:00:05.000Z",
  },
  {
    file: "raw/b.json",
    url: "https://x.test/b",
    bytes: new TextEncoder().encode("BBB"),
    obtenido_en: instante,
  },
];

const def = (): DefinicionDataset<Reg> => ({
  id: "toy.reg",
  directorio: "toy",
  archivo: "reg.json",
  esquema: z.object({ id: z.string().min(1), nombre: z.string() }),
  clave: (r) => r.id,
  capturar: async () => [
    {
      name: "Fuente",
      url: "https://x.test",
      license: "L",
      license_url: "https://l.test",
      citation: "C",
      published_at: null,
      crudos,
    },
  ],
  construir: async (): Promise<Construccion<Reg>> => ({ registros: entrada, avisos }),
  invariantes: () => invariantesFalla,
  revisar: () => ({
    requiereRevision: marcaRevision,
    motivos: marcaRevision ? ["revisa esto"] : [],
  }),
});

const ctx = (): Contexto => ({
  cliente: {} as Contexto["cliente"],
  fecha: "2026-10-17",
  raizDatos: raiz,
});

async function foto(dir: string): Promise<Record<string, [string, number]>> {
  const salida: Record<string, [string, number]> = {};
  const rec = async (d: string, pref: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await rec(p, `${pref}${e.name}/`);
      else salida[pref + e.name] = [(await readFile(p)).toString("hex"), (await stat(p)).mtimeMs];
    }
  };
  await rec(dir, "");
  return salida;
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "mexicoapi-marco-"));
  entrada = [
    { id: "02", nombre: "Dos" },
    { id: "01", nombre: "Uno" },
  ];
  avisos = [];
  marcaRevision = false;
  invariantesFalla = [];
  crudos = mkCrudos();
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("ejecutarDataset", () => {
  it("primera corrida: snapshot inicial con datos, crudos y manifiesto", async () => {
    const { resultado, diferencias } = await ejecutarDataset(def(), ctx());
    expect(resultado).toMatchObject({
      dataset: "toy.reg",
      estado: "actualizado",
      altas: 2,
      bajas: 0,
      cambios: 0,
      registros: 2,
    });
    expect(resultado.motivos).toContain("snapshot inicial");
    expect(diferencias.altas).toHaveLength(2);
    const dir = join(raiz, "toy");
    const texto = await readFile(join(dir, "reg.json"), "utf8");
    const esperado = [
      { id: "01", nombre: "Uno" },
      { id: "02", nombre: "Dos" },
    ];
    expect(texto).toBe(`${JSON.stringify(esperado, null, 2)}\n`);
    const m = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    expect(m).toMatchObject({
      dataset: "toy.reg",
      schema_version: 1,
      as_of: "2026-10-17",
      fetched_at: instante,
      data_file: "reg.json",
      data_sha256: sha256Hex(texto),
      records: 2,
    });
    expect(m.sources[0].raw).toEqual([
      { file: "raw/a.json", url: "https://x.test/a", sha256: sha256Hex("AAA") },
      { file: "raw/b.json", url: "https://x.test/b", sha256: sha256Hex("BBB") },
    ]);
    expect(await readFile(join(dir, "raw/a.json"), "utf8")).toBe("AAA");
    expect(await leerRegistros(def(), raiz)).toEqual(esperado);
  });

  it("segunda corrida igual: sin_cambios y no toca nada", async () => {
    await ejecutarDataset(def(), ctx());
    const antes = await foto(join(raiz, "toy"));
    const { resultado } = await ejecutarDataset(def(), ctx());
    expect(resultado.estado).toBe("sin_cambios");
    expect(resultado.escrito).toBe(false);
    expect(await foto(join(raiz, "toy"))).toEqual(antes);
  });

  it("sin diferencias pero con avisos: requiere revisión y no escribe", async () => {
    const primera = await ejecutarDataset(def(), ctx());
    expect(primera.resultado.escrito).toBe(true);
    const antes = await foto(join(raiz, "toy"));
    avisos = ["algo raro"];
    const { resultado } = await ejecutarDataset(def(), ctx());
    expect(resultado).toMatchObject({
      estado: "requiere_revision",
      motivos: ["algo raro"],
      escrito: false,
    });
    expect(await foto(join(raiz, "toy"))).toEqual(antes);
  });

  it("un cambio marcado por revisar da requiere_revision y escribe", async () => {
    await ejecutarDataset(def(), ctx());
    entrada = [
      { id: "01", nombre: "Uno bis" },
      { id: "02", nombre: "Dos" },
    ];
    marcaRevision = true;
    const { resultado } = await ejecutarDataset(def(), ctx());
    expect(resultado.estado).toBe("requiere_revision");
    expect(resultado.cambios).toBe(1);
    expect(resultado.motivos).toEqual(["revisa esto"]);
    expect((await leerRegistros(def(), raiz))?.[0]?.nombre).toBe("Uno bis");
  });

  it("un cambio que revisar no marca queda actualizado", async () => {
    await ejecutarDataset(def(), ctx());
    entrada = [{ id: "01", nombre: "Uno" }];
    const { resultado } = await ejecutarDataset(def(), ctx());
    expect(resultado).toMatchObject({ estado: "actualizado", bajas: 1, motivos: [] });
  });

  it("avisos no vacios dan requiere_revision, en orden de motivos", async () => {
    avisos = ["algo raro"];
    marcaRevision = true;
    const primera = await ejecutarDataset(def(), ctx());
    expect(primera.resultado.estado).toBe("requiere_revision");
    expect(primera.resultado.motivos).toEqual(["snapshot inicial", "algo raro"]);
    entrada = [{ id: "03", nombre: "Tres" }];
    const { resultado } = await ejecutarDataset(def(), ctx());
    expect(resultado.motivos).toEqual(["revisa esto", "algo raro"]);
  });

  it("anteriorInicial se pasa a construir pero el estado es de snapshot inicial", async () => {
    const d = def();
    let visto: readonly Reg[] | null = null;
    d.construir = async (_f, anterior) => {
      visto = anterior;
      return { registros: entrada, avisos: [] };
    };
    const semilla = [{ id: "01", nombre: "Uno" }];
    const { resultado } = await ejecutarDataset(d, ctx(), { anteriorInicial: semilla });
    expect(visto).toEqual(semilla);
    expect(resultado.altas).toBe(2);
    expect(resultado.motivos).toContain("snapshot inicial");
  });

  it("construir recibe el anterior leido de disco", async () => {
    await ejecutarDataset(def(), ctx());
    const d = def();
    let visto: readonly Reg[] | null = null;
    d.construir = async (_f, anterior) => {
      visto = anterior;
      return { registros: entrada, avisos: [] };
    };
    await ejecutarDataset(d, ctx());
    expect(visto).toHaveLength(2);
  });

  it("seco no escribe", async () => {
    const { resultado } = await ejecutarDataset(def(), ctx(), { seco: true });
    expect(resultado.estado).toBe("actualizado");
    expect(resultado.escrito).toBe(false);
    await expect(stat(join(raiz, "toy"))).rejects.toThrow();
  });

  it("pasa a NFC lo que llega en NFD", async () => {
    entrada = [{ id: "01", nombre: "Michoacán" }];
    await ejecutarDataset(def(), ctx());
    const texto = await readFile(join(raiz, "toy", "reg.json"), "utf8");
    expect(texto).toContain("Michoacán");
    expect(texto).not.toContain("á");
  });

  it("errores no tocan data/", async () => {
    await ejecutarDataset(def(), ctx());
    const antes = await foto(join(raiz, "toy"));
    entrada = [{ id: "09", nombre: "Nueve" }];

    const lanza = def();
    lanza.construir = async () => {
      throw new ErrorDatos("fuente rota");
    };
    await expect(ejecutarDataset(lanza, ctx())).rejects.toThrow("fuente rota");

    entrada = [{ id: "", nombre: "x" }];
    const e = await ejecutarDataset(def(), ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.dataset).toBe("toy.reg");
    expect(e.message).toContain("id");
    expect(e.message).toContain("0");

    entrada = [{ id: "09", nombre: "Nueve" }];
    invariantesFalla = ["faltan estados"];
    const i = await ejecutarDataset(def(), ctx()).catch((x) => x);
    expect(i).toBeInstanceOf(ErrorDatos);
    expect(i.message).toContain("faltan estados");

    expect(await foto(join(raiz, "toy"))).toEqual(antes);
  });

  it("rechaza una construccion sin registros y no toca data/", async () => {
    await ejecutarDataset(def(), ctx());
    const antes = await foto(join(raiz, "toy"));
    entrada = [];
    const e = await ejecutarDataset(def(), ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.dataset).toBe("toy.reg");
    expect(e.message).toContain("construir no produjo registros");
    expect(await foto(join(raiz, "toy"))).toEqual(antes);
  });

  it("propaga ErrorHttp sin envolver", async () => {
    const d = def();
    d.capturar = async () => {
      throw new ErrorHttp("caido", "https://x.test", 500);
    };
    await expect(ejecutarDataset(d, ctx())).rejects.toBeInstanceOf(ErrorHttp);
  });

  it("clave duplicada lanza ErrorDatos con la clave", async () => {
    entrada = [
      { id: "01", nombre: "A" },
      { id: "01", nombre: "B" },
    ];
    const e = await ejecutarDataset(def(), ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("01");
  });

  it("exige al menos un crudo y rutas validas", async () => {
    crudos = [];
    await expect(ejecutarDataset(def(), ctx())).rejects.toBeInstanceOf(ErrorDatos);
    for (const mala of ["../x.json", "datos/x.json", "raw/a/b.json", "/raw/a.json"]) {
      crudos = [{ ...(mkCrudos()[0] as FuenteCapturada["crudos"][number]), file: mala }];
      await expect(ejecutarDataset(def(), ctx())).rejects.toBeInstanceOf(ErrorDatos);
    }
  });
});

describe("leerRegistros", () => {
  it("devuelve null si no existe", async () => {
    expect(await leerRegistros(def(), raiz)).toBeNull();
  });
  it("lanza ErrorDatos si el JSON esta corrupto o no cumple el esquema", async () => {
    await mkdir(join(raiz, "toy"), { recursive: true });
    await writeFile(join(raiz, "toy", "reg.json"), "{no json");
    await expect(leerRegistros(def(), raiz)).rejects.toBeInstanceOf(ErrorDatos);
    await writeFile(join(raiz, "toy", "reg.json"), '[{"id":1}]');
    await expect(leerRegistros(def(), raiz)).rejects.toBeInstanceOf(ErrorDatos);
  });
});
