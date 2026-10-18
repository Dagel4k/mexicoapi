import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Banco } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const duplicarFila = vi.hoisted(() => ({ valor: false }));
const quitarFila = vi.hoisted(() => ({ nombre: null as string | null }));
vi.mock("../../../src/datasets/bancos/participantes-pdf.js", async (importOriginal) => {
  const o =
    await importOriginal<typeof import("../../../src/datasets/bancos/participantes-pdf.js")>();
  return {
    ...o,
    interpretarParticipantesPdf: async (bytes: Uint8Array) => {
      const original = await o.interpretarParticipantesPdf(bytes);
      const r =
        quitarFila.nombre === null
          ? original
          : {
              ...original,
              filas: original.filas.filter((f) => f.nombre_corto !== quitarFila.nombre),
            };
      const primera = r.filas[0];
      if (!duplicarFila.valor || primera === undefined) return r;
      const copia = { ...primera, numero: 999, nombre_corto: primera.nombre_corto.toLowerCase() };
      return { ...r, filas: [...r.filas, copia] };
    },
  };
});

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
afterEach(async () => {
  quitarFila.nombre = null;
  await rm(raiz, { recursive: true, force: true });
});

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
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: HOY, hasta: null },
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

  const wal = (extra: Partial<Banco> = {}): Banco => ({
    codigo: "134",
    codigo_spei: "40134",
    nombre_corto: "WAL-MART",
    razon_social: "Walmart de México",
    sector: "BANCA MÚLTIPLE",
    tipo: "banca_multiple",
    participacion: "directa",
    activo: true,
    baja_detectada: null,
    historial: [
      { codigo_spei: "40134", nombre_corto: "WAL-MART", desde: "2012-01-03", hasta: null },
    ],
    ...extra,
  });

  it("cierra el periodo de un código que ya no viene y no repite la baja", async () => {
    const base = (await construir(null)).registros;
    const r = (await construir([...base, wal()])).registros;
    const baja = por(r, "134");
    expect(baja).toMatchObject({
      activo: false,
      baja_detectada: HOY,
      razon_social: "Walmart de México",
    });
    expect(baja.historial).toEqual([
      { codigo_spei: "40134", nombre_corto: "WAL-MART", desde: "2012-01-03", hasta: HOY },
    ]);
    expect(r).toHaveLength(98);
    expect(bancos.invariantes(r)).toEqual([]);

    const otra = (await construir([...base, baja], ctx("2026-10-18"))).registros;
    expect(por(otra, "134")).toEqual(baja);
  });

  it("reactiva un código ausente abriendo un periodo nuevo", async () => {
    const base = (await construir(null)).registros;
    const bbva = por(base, "012");
    const inactivo: Banco = {
      ...bbva,
      activo: false,
      baja_detectada: "2026-01-01",
      historial: [
        {
          codigo_spei: "40012",
          nombre_corto: "BBVA MEXICO",
          desde: "2025-01-01",
          hasta: "2026-01-01",
        },
      ],
    };
    const r = por((await construir([inactivo])).registros, "012");
    expect(r.activo).toBe(true);
    expect(r.baja_detectada).toBeNull();
    expect(r.historial).toEqual([
      {
        codigo_spei: "40012",
        nombre_corto: "BBVA MEXICO",
        desde: "2025-01-01",
        hasta: "2026-01-01",
      },
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: HOY, hasta: null },
    ]);
  });

  it("un cambio de nombre cierra y abre periodo", async () => {
    const base = (await construir(null)).registros;
    const otro: Banco = {
      ...por(base, "012"),
      nombre_corto: "BBVA",
      historial: [{ codigo_spei: "40012", nombre_corto: "BBVA", desde: "2025-01-01", hasta: null }],
    };
    const n = por((await construir([otro])).registros, "012");
    expect(n.historial).toEqual([
      { codigo_spei: "40012", nombre_corto: "BBVA", desde: "2025-01-01", hasta: HOY },
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: HOY, hasta: null },
    ]);
    expect(n.nombre_corto).toBe("BBVA MEXICO");
    expect(bancos.invariantes([n])).toEqual([]);
  });

  it("dos filas del PDF con el mismo nombre normalizado dan aviso", async () => {
    duplicarFila.valor = true;
    try {
      const { avisos } = await construir(null);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain("dos filas");
    } finally {
      duplicarFila.valor = false;
    }
  });

  it("un directo que sigue en el CEP pero sale del PDF pide revisión", async () => {
    const base = (await construir(null)).registros;
    expect(por(base, "012").participacion).toBe("directa");
    quitarFila.nombre = "BBVA MEXICO";
    const { registros } = await construir(base, ctx("2026-10-18"));
    expect(por(registros, "012")).toMatchObject({
      activo: true,
      participacion: "no_confirmada",
      razon_social: null,
    });
    const d = diferenciar(base, registros, (b) => b.codigo);
    expect(bancos.revisar(d, base)).toEqual({
      requiereRevision: true,
      motivos: ["sale del PDF de participantes: 012 BBVA MEXICO"],
    });
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
        desde: HOY,
        hasta: null,
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

  it("un participante directo que sigue activo y sale del PDF pide revisión", () => {
    const a = mk("012", { participacion: "directa", razon_social: "R", sector: "S" });
    const sin = { ...a, participacion: "no_confirmada" as const, razon_social: null, sector: null };
    expect(rev([a], [sin])).toEqual({
      requiereRevision: true,
      motivos: ["sale del PDF de participantes: 012 B012"],
    });
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
        historial: [{ ...(b.historial[0] as Banco["historial"][number]), hasta: "2020-01-01" }],
      },
      { ...b, nombre_corto: "OTRO" },
      {
        ...b,
        historial: [
          { codigo_spei: "40012", nombre_corto: "X", desde: "2020-01-01", hasta: null },
          { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: "2021-01-01", hasta: null },
        ],
      },
      {
        ...b,
        historial: [
          { codigo_spei: "40012", nombre_corto: "X", desde: "2021-01-01", hasta: "2022-01-01" },
          { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: "2020-01-01", hasta: null },
        ],
      },
      { ...b, activo: false, baja_detectada: "2020-01-01" },
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

describe("corridas diarias", () => {
  const ejecutar = (fecha: string) => ejecutarDataset(bancos, ctx(fecha));
  const bytes = async () => readFile(join(raiz, "bancos", "bancos.json"), "utf8");

  it("la misma fuente otro día no cambia nada", async () => {
    expect((await ejecutar("2026-10-17")).resultado.estado).toBe("actualizado");
    const antes = await bytes();
    const { resultado } = await ejecutar("2026-10-18");
    expect(resultado).toMatchObject({ estado: "sin_cambios", escrito: false });
    expect(await bytes()).toBe(antes);
  });

  it("un cambio de nombre es actualizado, sin revisión", async () => {
    await ejecutar("2026-10-17");
    cep = new TextEncoder().encode(
      JSON.stringify({
        instituciones: interpretarCep(cep).map((e) =>
          e[0] === "2001" ? [e[0], "BANXICO CENTRAL"] : e,
        ),
      }),
    );
    const { resultado } = await ejecutar("2026-10-18");
    expect(resultado).toMatchObject({ estado: "actualizado", cambios: 1, escrito: true });
    const r = JSON.parse(await bytes()) as Banco[];
    expect(por(r, "001").historial).toEqual([
      { codigo_spei: "2001", nombre_corto: "BANXICO", desde: HOY, hasta: "2026-10-18" },
      { codigo_spei: "2001", nombre_corto: "BANXICO CENTRAL", desde: "2026-10-18", hasta: null },
    ]);
  });

  it("desaparecer y volver pide revisión las dos veces", async () => {
    await ejecutar("2026-10-17");
    const completo = cep;
    cep = new TextEncoder().encode(
      JSON.stringify({ instituciones: interpretarCep(cep).filter((e) => e[0] !== "40012") }),
    );
    const baja = await ejecutar("2026-10-18");
    expect(baja.resultado.estado).toBe("requiere_revision");
    expect(baja.resultado.motivos).toContain("baja: 012 BBVA MEXICO");
    const r = JSON.parse(await bytes()) as Banco[];
    expect(por(r, "012")).toMatchObject({ activo: false, baja_detectada: "2026-10-18" });

    cep = completo;
    const vuelta = await ejecutar("2026-10-20");
    expect(vuelta.resultado.estado).toBe("requiere_revision");
    expect(vuelta.resultado.motivos).toContain("reactivación: 012 BBVA MEXICO");
    const v = JSON.parse(await bytes()) as Banco[];
    expect(por(v, "012").historial).toEqual([
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: HOY, hasta: "2026-10-18" },
      { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: "2026-10-20", hasta: null },
    ]);
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
