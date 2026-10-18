import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Banco } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bancos,
  crearBancos,
  registrosDesdeHistorico,
} from "../../../src/datasets/bancos/bancos.js";
import { interpretarCep, urlCep } from "../../../src/datasets/bancos/cep.js";
import type { Observacion } from "../../../src/datasets/bancos/historial.js";
import { diferenciar } from "../../../src/diferencias.js";
import { ErrorDatos } from "../../../src/errores.js";
import { crearCliente } from "../../../src/http.js";
import { type Contexto, ejecutarDataset } from "../../../src/marco.js";

const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bancos");
const URL_INFO = "https://www.banxico.org.mx/servicios/spei_-informacion-banco-mex.html";
const URL_PDF = "https://www.banxico.org.mx/servicios/d/{C24C7DBC-9ABF-6F41-DA38-561CEB1401B3}.pdf";
const HOY = "2026-10-17";

const leer = async (n: string) => new Uint8Array(await readFile(join(dirFixtures, n)));
const obs = async (fecha: string, n: string): Promise<Observacion> => ({
  fecha,
  entradas: interpretarCep(await leer(n)),
});

let raiz: string;
let cep: Uint8Array;
let html: Uint8Array;
let pdf: Uint8Array;
let pedidos: string[];

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "bancos-"));
  [cep, html, pdf] = await Promise.all([
    leer("cep-2026-10-17.json"),
    leer("spei-informacion.html"),
    leer("participantes-spei-2026-09-23.pdf"),
  ]);
  pedidos = [];
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

function ctx(fecha = HOY): Contexto {
  const fetchFalso: typeof fetch = async (entrada) => {
    const url = String(entrada);
    pedidos.push(url);
    const ok = (b: Uint8Array) => new Response(b, { status: 200 });
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    if (url === urlCep(fecha)) return ok(cep);
    if (url === URL_INFO) return ok(html);
    if (decodeURI(url) === URL_PDF) return ok(pdf);
    return new Response("no", { status: 404 });
  };
  const cliente = crearCliente({
    fetch: fetchFalso,
    esperar: async () => {},
    intervaloMinimoMs: 0,
  });
  return { cliente, fecha, raizDatos: raiz };
}

async function construir(
  anterior: readonly Banco[] | null,
  c = ctx(),
  def = bancos,
): Promise<{ registros: Banco[]; avisos: string[] }> {
  const fuentes = await def.capturar(c);
  return def.construir(fuentes, anterior, c);
}

const por = (r: readonly Banco[], codigo: string) => r.find((b) => b.codigo === codigo) as Banco;

describe("construir", () => {
  it("une el CEP y el PDF", async () => {
    const { registros, avisos } = await construir(null);
    expect(registros).toHaveLength(97);
    expect(registros.filter((b) => b.participacion === "directa")).toHaveLength(94);
    expect(avisos).toEqual([]);
    expect(bancos.invariantes(registros)).toEqual([]);

    const bbva = por(registros, "012");
    expect(bbva.nombre_corto).toBe("BBVA MEXICO");
    expect(bbva.razon_social).toBe(
      "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
    );
    expect(bbva.sector).toBe("BANCA MÚLTIPLE");
    expect(bbva.tipo).toBe("banca_multiple");
    expect(bbva.historial).toEqual([
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", visto_desde: HOY, visto_hasta: HOY },
    ]);

    const banxico = por(registros, "001");
    expect(banxico.tipo).toBe("banco_central");
    expect(banxico.participacion).toBe("no_confirmada");
    expect(banxico.razon_social).toBeNull();
    for (const c of ["901", "903"]) expect(por(registros, c).participacion).toBe("no_confirmada");
    // Nombre del CEP, no del PDF
    expect(por(registros, "721").nombre_corto).toBe("albo");
  });

  it("pide el CEP, la página y el PDF, y declara los crudos", async () => {
    const fuentes = await bancos.capturar(ctx());
    expect(pedidos.filter((u) => !u.endsWith("robots.txt"))).toEqual([
      urlCep(HOY),
      URL_INFO,
      expect.stringContaining("C24C7DBC"),
    ]);
    expect(fuentes.map((f) => f.crudos.map((c) => c.file))).toEqual([
      ["raw/cep-instituciones.json"],
      ["raw/participantes-spei.pdf"],
    ]);
    expect(fuentes[1]?.published_at).toBe("2026-09-23");
    expect(fuentes[1]?.url).toBe(URL_PDF);
  });

  it("conserva con baja un código que ya no viene y respeta la baja previa", async () => {
    const base = (await construir(null)).registros;
    const wal: Banco = {
      codigo: "134",
      codigo_spei: "40134",
      nombre_corto: "WAL-MART",
      razon_social: null,
      sector: null,
      tipo: "banca_multiple",
      participacion: "no_confirmada",
      activo: true,
      baja_detectada: null,
      historial: [
        {
          codigo_spei: "40134",
          nombre_corto: "WAL-MART",
          visto_desde: "2012-01-03",
          visto_hasta: "2019-01-02",
        },
      ],
    };
    const r = (await construir([...base, wal])).registros;
    expect(por(r, "134")).toMatchObject({ activo: false, baja_detectada: HOY });
    expect(r).toHaveLength(98);

    const r2 = (await construir([...base, { ...wal, activo: false, baja_detectada: "2020-05-05" }]))
      .registros;
    expect(por(r2, "134")).toMatchObject({ activo: false, baja_detectada: "2020-05-05" });
  });

  it("reactiva un código inactivo y abre periodo si cambia el nombre", async () => {
    const base = (await construir(null)).registros;
    const previo = por(base, "012");
    const inactivo: Banco = {
      ...previo,
      activo: false,
      baja_detectada: "2026-01-01",
      historial: [
        {
          codigo_spei: "40012",
          nombre_corto: "BBVA MEXICO",
          visto_desde: "2025-01-01",
          visto_hasta: "2025-12-31",
        },
      ],
    };
    const r = por((await construir([inactivo])).registros, "012");
    expect(r.activo).toBe(true);
    expect(r.baja_detectada).toBeNull();
    expect(r.historial).toHaveLength(1);
    expect(r.historial[0]?.visto_hasta).toBe(HOY);

    const otro: Banco = {
      ...previo,
      nombre_corto: "BBVA",
      historial: [
        {
          codigo_spei: "40012",
          nombre_corto: "BBVA",
          visto_desde: "2025-01-01",
          visto_hasta: "2026-10-01",
        },
      ],
    };
    const n = por((await construir([otro])).registros, "012");
    expect(n.historial).toHaveLength(2);
    expect(n.nombre_corto).toBe("BBVA MEXICO");
    expect(bancos.invariantes([n])).toEqual([]);
  });

  it("avisa de una fila del PDF sin entrada en el CEP", async () => {
    cep = new TextEncoder().encode(
      JSON.stringify({ instituciones: interpretarCep(cep).filter((e) => e[0] !== "40012") }),
    );
    const { registros, avisos } = await construir(null);
    expect(registros).toHaveLength(96);
    expect(avisos).toEqual(["en el PDF y no en el CEP: BBVA MEXICO"]);
  });

  it("falla con dos entradas del mismo código de 3 dígitos", async () => {
    cep = new TextEncoder().encode(
      JSON.stringify({ instituciones: [...interpretarCep(cep), ["90012", "OTRO"]] }),
    );
    await expect(construir(null)).rejects.toThrow(ErrorDatos);
  });

  it("falla con una familia de códigos desconocida", async () => {
    cep = new TextEncoder().encode(
      JSON.stringify({ instituciones: [...interpretarCep(cep), ["50999", "NUEVO"]] }),
    );
    await expect(construir(null)).rejects.toThrow("código SPEI inesperado: 50999");
  });

  it("falla si la fecha es anterior al historial", async () => {
    const base = (await construir(null)).registros;
    await expect(construir(base, ctx("2026-10-10"))).rejects.toThrow(ErrorDatos);
  });

  it("falla si falta un crudo", async () => {
    await expect(bancos.construir([], null, ctx())).rejects.toThrow(ErrorDatos);
  });
});

describe("revisar", () => {
  const mk = (codigo: string, extra: Partial<Banco> = {}): Banco => ({
    codigo,
    codigo_spei: `40${codigo}`,
    nombre_corto: `B${codigo}`,
    razon_social: null,
    sector: null,
    tipo: "banca_multiple",
    participacion: "no_confirmada",
    activo: true,
    baja_detectada: null,
    historial: [
      {
        codigo_spei: `40${codigo}`,
        nombre_corto: `B${codigo}`,
        visto_desde: HOY,
        visto_hasta: HOY,
      },
    ],
    ...extra,
  });
  const rev = (antes: Banco[], despues: Banco[]) =>
    bancos.revisar(
      diferenciar(antes, despues, (b) => b.codigo),
      antes,
    );

  it("un alta pide revisión", () => {
    expect(rev([mk("001")], [mk("001"), mk("002")])).toEqual({
      requiereRevision: true,
      motivos: ["alta: 002 B002"],
    });
  });

  it("2 cambios de nombre no, 4 sí", () => {
    const a = ["001", "002", "003", "004"].map((c) => mk(c));
    const ren = (b: Banco) => ({ ...b, nombre_corto: `${b.nombre_corto}X` });
    expect(rev(a, [ren(a[0] as Banco), ren(a[1] as Banco), ...a.slice(2)]).requiereRevision).toBe(
      false,
    );
    const r = rev(a, a.map(ren));
    expect(r.requiereRevision).toBe(true);
    expect(r.motivos).toEqual(["más de 3 cambios (4)"]);
  });

  it("baja y reactivación piden revisión; eliminar también", () => {
    const a = mk("001");
    const baja = { ...a, activo: false, baja_detectada: HOY };
    expect(rev([a], [baja]).motivos).toEqual(["baja: 001 B001"]);
    expect(rev([baja], [a]).motivos).toEqual(["reactivación: 001 B001"]);
    expect(rev([a], [mk("002")]).motivos).toEqual(["alta: 002 B002", "baja: 001 B001"]);
  });
});

describe("invariantes", () => {
  it("detecta incoherencias", async () => {
    const b = por((await construir(null)).registros, "012");
    const malos: Banco[] = [
      { ...b, codigo_spei: "40013" },
      { ...b, historial: [] },
      { ...b, activo: false },
      { ...b, baja_detectada: HOY },
      {
        ...b,
        historial: [
          { ...(b.historial[0] as Banco["historial"][number]), visto_hasta: "2020-01-01" },
        ],
      },
      { ...b, nombre_corto: "OTRO" },
      {
        ...b,
        historial: [
          {
            codigo_spei: "40012",
            nombre_corto: "BBVA MEXICO",
            visto_desde: "2026-10-17",
            visto_hasta: "2026-10-17",
          },
          {
            codigo_spei: "40012",
            nombre_corto: "X",
            visto_desde: "2020-01-01",
            visto_hasta: "2020-01-01",
          },
        ],
      },
    ];
    for (const m of malos) expect(bancos.invariantes([m]).length).toBeGreaterThan(0);
  });
});

describe("registrosDesdeHistorico", () => {
  it("reconstruye registros de 2012, 2019 y 2026", async () => {
    const o = [
      await obs("2012-01-03", "cep-2012-01-03.json"),
      await obs("2019-01-02", "cep-2019-01-02.json"),
      await obs(HOY, "cep-2026-10-17.json"),
    ];
    const r = registrosDesdeHistorico(o);
    expect(por(r, "134")).toMatchObject({ activo: false, baja_detectada: "2019-01-02" });
    expect(por(r, "102")).toMatchObject({
      activo: false,
      baja_detectada: HOY,
      nombre_corto: "ACCENDO BANCO",
    });
    expect(por(r, "012")).toMatchObject({
      activo: true,
      nombre_corto: "BBVA MEXICO",
      baja_detectada: null,
    });
    expect(por(r, "638")).toMatchObject({ activo: true, codigo_spei: "40638" });
    expect(por(r, "012")).toMatchObject({
      razon_social: null,
      sector: null,
      participacion: "no_confirmada",
    });
    expect(bancos.invariantes(r)).toEqual([]);
  });
});

describe("crudo histórico y corrida completa", () => {
  it("con historico lo declara y la corrida lo escribe", async () => {
    const o = [
      await obs("2019-01-02", "cep-2019-01-02.json"),
      await obs(HOY, "cep-2026-10-17.json"),
    ];
    const def = crearBancos({ historico: o });
    const { resultado } = await ejecutarDataset(def, ctx(), {
      anteriorInicial: registrosDesdeHistorico(o),
    });
    expect(resultado.estado).toBe("actualizado");
    const manifiesto = JSON.parse(await readFile(join(raiz, "bancos", "manifest.json"), "utf8"));
    const archivos = manifiesto.sources.flatMap(
      (s: { raw: { file: string; url: string }[] }) => s.raw,
    );
    expect(archivos.map((a: { file: string }) => a.file)).toEqual([
      "raw/cep-instituciones.json",
      "raw/cep-historico.json",
      "raw/participantes-spei.pdf",
    ]);
    expect(archivos[1].url).toBe("https://www.banxico.org.mx/cep/instituciones.do");
    expect(await readFile(join(raiz, "bancos", "raw", "cep-historico.json"), "utf8")).toContain(
      "2019-01-02",
    );
  });

  it("sin historico vuelve a declarar el del disco; sin disco no lo declara", async () => {
    const sin = await bancos.capturar(ctx());
    expect(sin[0]?.crudos).toHaveLength(1);

    await mkdir(join(raiz, "bancos", "raw"), { recursive: true });
    await writeFile(join(raiz, "bancos", "raw", "cep-historico.json"), "[]\n");
    const con = await bancos.capturar(ctx());
    const h = con[0]?.crudos[1];
    expect(h?.file).toBe("raw/cep-historico.json");
    expect(new TextDecoder().decode(h?.bytes)).toBe("[]\n");
  });

  it("segunda corrida igual no cambia nada", async () => {
    await ejecutarDataset(bancos, ctx());
    const { resultado } = await ejecutarDataset(bancos, ctx());
    expect(resultado.estado).toBe("sin_cambios");
  });
});
