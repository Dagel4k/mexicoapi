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
import { PRUEBA_LENTA } from "../../ayudas.js";

const duplicarFila = vi.hoisted(() => ({ valor: false }));
const quitarFila = vi.hoisted(() => ({ nombre: null as string | null }));
vi.mock("../../../src/datasets/bancos/participantes-pdf.js", async (importOriginal) => {
  const o =
    await importOriginal<typeof import("../../../src/datasets/bancos/participantes-pdf.js")>();
  const { createHash } = await import("node:crypto");
  // Interpretar el PDF tarda segundos: se hace una vez por contenido y cada llamada recibe su copia.
  const leidos = new Map<string, ReturnType<typeof o.interpretarParticipantesPdf>>();
  const interpretar = async (bytes: Uint8Array) => {
    const clave = createHash("sha256").update(bytes).digest("hex");
    let leido = leidos.get(clave);
    if (leido === undefined) {
      leido = o.interpretarParticipantesPdf(bytes);
      leidos.set(clave, leido);
      // Un error no se guarda: la siguiente llamada lo vuelve a intentar.
      leido.catch(() => leidos.delete(clave));
    }
    return structuredClone(await leido);
  };
  return {
    ...o,
    interpretarParticipantesPdf: async (bytes: Uint8Array) => {
      const original = await interpretar(bytes);
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

describe("construir", { timeout: PRUEBA_LENTA }, () => {
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

  it("si el CEP no es válido falla sin pedir la página ni el PDF", async () => {
    cep = new TextEncoder().encode("<html><body>Acceso denegado</body></html>");
    await expect(bancos.capturar(ctx())).rejects.toThrow(ErrorDatos);
    expect(pedidos.filter((u) => !u.endsWith("robots.txt"))).toEqual([urlCep(HOY)]);
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
    // Conserva la última razón social y el último sector; ya no participa.
    expect(baja).toMatchObject({
      activo: false,
      baja_detectada: HOY,
      razon_social: "Walmart de México",
      sector: "BANCA MÚLTIPLE",
      participacion: "no_confirmada",
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
      participacion: "no_confirmada",
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
    expect(r.participacion).toBe("directa");
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
    expect(await bancos.revisar(d, base, ctx())).toEqual({
      requiereRevision: true,
      motivos: ["sale del PDF de participantes: 012 BBVA MEXICO"],
    });
  });

  const renombrarEnCep = (cambios: Record<string, string>) => {
    cep = new TextEncoder().encode(
      JSON.stringify({
        instituciones: interpretarCep(cep).map((e) => [e[0], cambios[e[0]] ?? e[1]]),
      }),
    );
  };

  it("un renombre del CEP antes que el PDF empareja con el nombre anterior", async () => {
    const base = (await construir(null)).registros;
    renombrarEnCep({ "40012": "BBVA" });
    const { registros, avisos } = await construir(base, ctx("2026-10-18"));
    expect(avisos).toEqual([]);
    expect(por(registros, "012")).toMatchObject({
      nombre_corto: "BBVA",
      razon_social:
        "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
      sector: "BANCA MÚLTIPLE",
      participacion: "directa",
    });
    const d = diferenciar(base, registros, (b) => b.codigo);
    expect(d.cambios).toHaveLength(1);
    // Un renombre se empareja bien, pero pide revisión como cualquier cambio de nombre.
    expect(await bancos.revisar(d, base, ctx())).toEqual({
      requiereRevision: true,
      motivos: ["cambio en historial, nombre_corto: 012 BBVA"],
    });
  });

  it("no empareja por el nombre anterior si hoy es el nombre de otro código", async () => {
    const base = (await construir(null)).registros;
    // 012 cambia de nombre y 014 toma el nombre que tenía 012.
    renombrarEnCep({ "40012": "BBVA", "40014": "BBVA MEXICO" });
    const { registros } = await construir(base, ctx("2026-10-18"));
    expect(por(registros, "014")).toMatchObject({
      nombre_corto: "BBVA MEXICO",
      participacion: "directa",
    });
    expect(por(registros, "012")).toMatchObject({
      nombre_corto: "BBVA",
      razon_social: null,
      participacion: "no_confirmada",
    });
  });

  it("sigue emparejando con el nombre anterior el segundo día de un renombre", async () => {
    const base = (await construir(null)).registros;
    renombrarEnCep({ "40012": "BBVA" });
    const dia1 = (await construir(base, ctx("2026-10-18"))).registros;
    const dia2 = (await construir(dia1, ctx("2026-10-19"))).registros;
    expect(por(dia2, "012")).toMatchObject({
      nombre_corto: "BBVA",
      razon_social:
        "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
      sector: "BANCA MÚLTIPLE",
      participacion: "directa",
    });
    const d = diferenciar(dia1, dia2, (b) => b.codigo);
    expect(await bancos.revisar(d, dia1, ctx())).toEqual({ requiereRevision: false, motivos: [] });
  });

  it("empareja con un nombre de hace varios periodos", async () => {
    const base = (await construir(null)).registros;
    renombrarEnCep({ "40012": "D" });
    const previo: Banco = {
      ...por(base, "012"),
      nombre_corto: "C",
      historial: [
        {
          codigo_spei: "40012",
          nombre_corto: "BBVA MEXICO",
          desde: "2020-01-01",
          hasta: "2023-01-01",
        },
        { codigo_spei: "40012", nombre_corto: "B", desde: "2023-01-01", hasta: "2025-01-01" },
        { codigo_spei: "40012", nombre_corto: "C", desde: "2025-01-01", hasta: null },
      ],
    };
    const { registros } = await construir([previo], ctx("2026-10-18"));
    expect(por(registros, "012")).toMatchObject({
      nombre_corto: "D",
      razon_social:
        "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
      participacion: "directa",
    });
  });

  it("no usa un nombre anterior que comparten dos códigos", async () => {
    const base = (await construir(null)).registros;
    renombrarEnCep({ "40012": "NUEVO 12", "40014": "NUEVO 14" });
    const conViejo = (codigo: string, nuevo: string): Banco => ({
      ...por(base, codigo),
      nombre_corto: nuevo,
      historial: [
        {
          codigo_spei: `40${codigo}`,
          nombre_corto: "BBVA MEXICO",
          desde: "2020-01-01",
          hasta: "2025-01-01",
        },
        { codigo_spei: `40${codigo}`, nombre_corto: nuevo, desde: "2025-01-01", hasta: null },
      ],
    });
    const { registros, avisos } = await construir(
      [conViejo("012", "NUEVO 12"), conViejo("014", "NUEVO 14")],
      ctx("2026-10-18"),
    );
    for (const c of ["012", "014"]) {
      expect(por(registros, c)).toMatchObject({
        razon_social: null,
        participacion: "no_confirmada",
      });
    }
    expect(avisos).toContain("en el PDF y no en el CEP: BBVA MEXICO");
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
      ctx(),
    );

  it("un alta pide revisión", async () => {
    expect(await rev([mk("001")], [mk("001"), mk("002")])).toEqual({
      requiereRevision: true,
      motivos: ["alta: 002 B002"],
    });
  });

  it("un cambio de nombre, razón social, código SPEI o historial pide revisión", async () => {
    const a = mk("001", { razon_social: "Banco Uno, S.A." });
    const periodo = a.historial[0] as Banco["historial"][number];
    const casos: [Banco, string][] = [
      [{ ...a, nombre_corto: "BANCO FALSO" }, "cambio en nombre_corto: 001 BANCO FALSO"],
      [{ ...a, razon_social: "Falso, S.A." }, "cambio en razon_social: 001 B001"],
      [{ ...a, codigo_spei: "90001" }, "cambio en codigo_spei: 001 B001"],
      [{ ...a, historial: [{ ...periodo, desde: "2010-01-01" }] }, "cambio en historial: 001 B001"],
      [
        {
          ...a,
          nombre_corto: "B001 NUEVO",
          historial: [
            { ...periodo, hasta: "2026-10-17" },
            { ...periodo, nombre_corto: "B001 NUEVO", desde: "2026-10-18" },
          ],
        },
        "cambio en historial, nombre_corto: 001 B001 NUEVO",
      ],
    ];
    for (const [despues, motivo] of casos) {
      expect(await rev([a], [despues])).toEqual({ requiereRevision: true, motivos: [motivo] });
    }
  });

  it("2 cambios en otros campos no, 4 sí", async () => {
    const a = ["001", "002", "003", "004"].map((c) => mk(c));
    const otro = (b: Banco) => ({ ...b, sector: "BANCA MÚLTIPLE" });
    expect(
      (await rev(a, [otro(a[0] as Banco), otro(a[1] as Banco), ...a.slice(2)])).requiereRevision,
    ).toBe(false);
    const r = await rev(a, a.map(otro));
    expect(r.requiereRevision).toBe(true);
    expect(r.motivos).toEqual(["más de 3 cambios (4)"]);
  });

  it("un participante directo que sigue activo y sale del PDF pide revisión", async () => {
    const a = mk("012", { participacion: "directa", razon_social: "R", sector: "S" });
    const sin = { ...a, participacion: "no_confirmada" as const, razon_social: null, sector: null };
    expect(await rev([a], [sin])).toEqual({
      requiereRevision: true,
      motivos: ["sale del PDF de participantes: 012 B012"],
    });
  });

  it("baja y reactivación piden revisión; eliminar también", async () => {
    const a = mk("001");
    const baja = { ...a, activo: false, baja_detectada: HOY };
    expect((await rev([a], [baja])).motivos).toEqual(["baja: 001 B001"]);
    expect((await rev([baja], [a])).motivos).toEqual(["reactivación: 001 B001"]);
    expect((await rev([a], [mk("002")])).motivos).toEqual(["alta: 002 B002", "baja: 001 B001"]);
  });
});

describe("invariantes", { timeout: PRUEBA_LENTA }, () => {
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

  it("los periodos del historial no se traslapan", async () => {
    const b = por((await construir(null)).registros, "012");
    const traslapado: Banco = {
      ...b,
      historial: [
        { codigo_spei: "40012", nombre_corto: "A", desde: "2020-01-01", hasta: "2023-01-01" },
        { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: "2021-01-01", hasta: null },
      ],
    };
    expect(bancos.invariantes([traslapado])).toEqual([
      "012: periodo traslapado con el anterior desde 2021-01-01",
    ]);
    const contiguo: Banco = {
      ...b,
      historial: [
        { codigo_spei: "40012", nombre_corto: "A", desde: "2020-01-01", hasta: "2021-01-01" },
        { codigo_spei: "40012", nombre_corto: "BBVA MEXICO", desde: "2021-01-01", hasta: null },
      ],
    };
    expect(bancos.invariantes([contiguo])).toEqual([]);
  });

  it("un registro inactivo tiene participacion no_confirmada", async () => {
    const b = por((await construir(null)).registros, "012");
    const periodo = b.historial[0] as Banco["historial"][number];
    const inactivo: Banco = {
      ...b,
      activo: false,
      baja_detectada: "2026-10-18",
      historial: [{ ...periodo, hasta: "2026-10-18" }],
    };
    expect(bancos.invariantes([inactivo])).toEqual([
      "012: un registro inactivo debe tener participacion no_confirmada",
    ]);
    expect(bancos.invariantes([{ ...inactivo, participacion: "no_confirmada" }])).toEqual([]);
  });
});

describe("registrosDesdeHistorico", { timeout: PRUEBA_LENTA }, () => {
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

describe("corridas diarias", { timeout: PRUEBA_LENTA }, () => {
  const ejecutar = (fecha: string) => ejecutarDataset(bancos, ctx(fecha));
  const bytes = async () => readFile(join(raiz, "bancos", "bancos.json"), "utf8");

  it("la misma fuente otro día no cambia nada", async () => {
    expect((await ejecutar("2026-10-17")).resultado.estado).toBe("actualizado");
    const antes = await bytes();
    const { resultado } = await ejecutar("2026-10-18");
    expect(resultado).toMatchObject({ estado: "sin_cambios", escrito: false });
    expect(await bytes()).toBe(antes);
  });

  it("un cambio de nombre se escribe y pide revisión", async () => {
    await ejecutar("2026-10-17");
    cep = new TextEncoder().encode(
      JSON.stringify({
        instituciones: interpretarCep(cep).map((e) =>
          e[0] === "2001" ? [e[0], "BANXICO CENTRAL"] : e,
        ),
      }),
    );
    const { resultado } = await ejecutar("2026-10-18");
    expect(resultado).toMatchObject({
      estado: "requiere_revision",
      cambios: 1,
      escrito: true,
      motivos: ["cambio en historial, nombre_corto: 001 BANXICO CENTRAL"],
    });
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
    expect(por(r, "012")).toMatchObject({
      activo: false,
      baja_detectada: "2026-10-18",
      razon_social:
        "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
      sector: "BANCA MÚLTIPLE",
      participacion: "no_confirmada",
    });

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

describe("crudo histórico y corrida completa", { timeout: PRUEBA_LENTA }, () => {
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
    // Es una compilación de MéxicoAPI: su url es la plantilla de la consulta mensual al CEP, que
    // explica de dónde sale cada parte (docs/datos/bancos.md), no una URL que la descargue.
    expect(archivos[1].url).toBe(
      "https://www.banxico.org.mx/cep/instituciones.do?fecha=DD-MM-AAAA",
    );
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
