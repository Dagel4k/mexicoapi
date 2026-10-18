import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diaDeLaSemana, sumarDias, type TipoCambioFix, type Udi } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANIO_INICIAL,
  interpretarSidof,
  tipoCambioFix,
  udis,
  urlSidof,
} from "../../src/datasets/sidof.js";
import { diferenciar } from "../../src/diferencias.js";
import { ErrorDatos } from "../../src/errores.js";
import { crearCliente, ErrorHttp } from "../../src/http.js";
import {
  type Contexto,
  type CrudoCapturado,
  ejecutarDataset,
  type FuenteCapturada,
} from "../../src/marco.js";
import { DATASETS } from "../../src/registro.js";
import { FRESCURA_HORAS } from "../../src/sitio/meta.js";
import { verificarDatos } from "../../src/verificar.js";
import { leerFixture } from "../ayudas.js";

type Tipo = 158 | 159;
type Indicador = Record<string, unknown>;
interface Respuesta {
  messageCode?: unknown;
  response?: unknown;
  ListaIndicadores: Indicador[];
  TotalIndicadores?: unknown;
}

const HOY = "2026-10-18";
const ANIOS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const LICENCIA =
  "Publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente";
const URL_LICENCIA = "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html";

const texto = (s: string) => new TextEncoder().encode(s);
const fixture = (nombre: string) => leerFixture(`sidof/${nombre}`);
const en = (r: Respuesta, i: number) => r.ListaIndicadores[i] as Indicador;
const archivo = (tipo: Tipo, anio: number) => `raw/sidof-${tipo}-${anio}.json`;

/** Copia de un fixture con `cambio` aplicado. */
async function variante(nombre: string, cambio: (r: Respuesta) => void): Promise<Uint8Array> {
  const r = JSON.parse(new TextDecoder().decode(await fixture(nombre))) as Respuesta;
  cambio(r);
  return texto(JSON.stringify(r));
}

/** Respuesta con la forma del SIDOF para estos registros (fechas en ISO). */
function respuesta(tipo: Tipo, registros: readonly { fecha: string; valor: string }[]): Uint8Array {
  const lista = registros.map((r, i) => ({
    codIndicador: i + 1,
    codTipoIndicador: tipo,
    fecha: r.fecha.split("-").reverse().join("-"),
    valor: r.valor,
  }));
  return texto(
    JSON.stringify({
      messageCode: 200,
      response: "OK",
      ListaIndicadores: lista,
      TotalIndicadores: lista.length,
    }),
  );
}

/** UDIS diarias de 2020 a 2025 que suben de a poco hasta empalmar con el fixture real de 2026. */
function udisSinteticas(): Map<number, { fecha: string; valor: string }[]> {
  const porAnio = new Map<number, { fecha: string; valor: string }[]>();
  // Millonésimas; 2025-12-31 queda en 8.665000, junto al 8.666288 real de 2026-01-01.
  let micro = 6_474_000;
  for (let f = "2020-01-01"; f < "2026-01-01"; f = sumarDias(f, 1), micro += 1000) {
    const anio = Number(f.slice(0, 4));
    const lista = porAnio.get(anio) ?? [];
    porAnio.set(anio, lista);
    lista.push({
      fecha: f,
      valor: `${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`,
    });
  }
  return porAnio;
}

/** FIX de 2021 a 2025 de lunes a viernes, que baja de a poco entre los fixtures reales. */
function fixSinteticos(): Map<number, { fecha: string; valor: string }[]> {
  const porAnio = new Map<number, { fecha: string; valor: string }[]>();
  // Diezmilésimas; empieza junto al 19.9352 real de 2020-12-31 y termina cerca del 18.0012 real
  // de 2026-01-02.
  let diez = 199_000;
  for (let f = "2021-01-01"; f < "2026-01-01"; f = sumarDias(f, 1)) {
    const dia = diaDeLaSemana(f);
    if (dia === 0 || dia === 6) continue;
    const anio = Number(f.slice(0, 4));
    const lista = porAnio.get(anio) ?? [];
    porAnio.set(anio, lista);
    lista.push({
      fecha: f,
      valor: `${Math.trunc(diez / 1e4)}.${String(diez % 1e4).padStart(4, "0")}`,
    });
    diez -= 15;
  }
  return porAnio;
}

const FIX_SINTETICO = fixSinteticos();
/** Publicaciones sintéticas del FIX de 2021 a 2025. */
const N_FIX = [...FIX_SINTETICO.values()].reduce((n, l) => n + l.length, 0);

let raiz: string;
let pedidas: string[];
let fuenteFalsa: Map<string, Uint8Array>;
/** Respuestas no exitosas por URL; tienen prioridad sobre `fuenteFalsa`. */
let erroresFalsos: Map<string, { estado: number; cuerpo: string }>;

/** Lo que responde el SIDOF cuando el rango pedido no tiene publicaciones. */
const NOT_FOUND = '{"messageCode":404,"response":"NOT_FOUND"}';
const sinDatos = (url: string) => erroresFalsos.set(url, { estado: 404, cuerpo: NOT_FOUND });

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "sidof-"));
  pedidas = [];
  fuenteFalsa = new Map();
  erroresFalsos = new Map();
  const sinteticas = udisSinteticas();
  for (const anio of ANIOS) {
    fuenteFalsa.set(urlSidof(158, anio), respuesta(158, FIX_SINTETICO.get(anio) ?? []));
    fuenteFalsa.set(urlSidof(159, anio), respuesta(159, sinteticas.get(anio) ?? []));
  }
  fuenteFalsa.set(urlSidof(158, 2020), await fixture("158-2020.json"));
  fuenteFalsa.set(urlSidof(158, 2026), await fixture("158-2026.json"));
  fuenteFalsa.set(urlSidof(159, 2026), await fixture("159-2026.json"));
  // Como el SIDOF real: el año siguiente todavía no tiene publicaciones.
  sinDatos(urlSidof(158, 2027));
  sinDatos(urlSidof(159, 2027));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function ctx(fecha = HOY): Contexto {
  let t = 0;
  const fetchFalso: typeof fetch = async (entrada) => {
    const url = String(entrada);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    pedidas.push(url);
    const error = erroresFalsos.get(url);
    if (error !== undefined) {
      return new Response(error.cuerpo, {
        status: error.estado,
        headers: { "content-type": "application/json" },
      });
    }
    const cuerpo = fuenteFalsa.get(url);
    return cuerpo === undefined ? new Response("no", { status: 404 }) : new Response(cuerpo);
  };
  const cliente = crearCliente({
    fetch: fetchFalso,
    esperar: async () => {},
    intervaloMinimoMs: 0,
    ahora: () => {
      t += 1000;
      return Date.UTC(2026, 9, 18, 19, 30) + t;
    },
  });
  return { cliente, fecha, raizDatos: raiz };
}

/** Escribe en disco el crudo de esos años, con lo que hoy sirve la fuente falsa. */
async function crudosEnDisco(directorio: string, tipo: Tipo, anios: readonly number[]) {
  await mkdir(join(raiz, directorio, "raw"), { recursive: true });
  for (const anio of anios) {
    await writeFile(
      join(raiz, directorio, archivo(tipo, anio)),
      fuenteFalsa.get(urlSidof(tipo, anio)) as Uint8Array,
    );
  }
}

const fuenteCon = (crudos: CrudoCapturado[]): FuenteCapturada => ({
  name: "n",
  url: "https://sidof.segob.gob.mx/",
  license: "l",
  license_url: "https://l.test",
  citation: "c",
  published_at: null,
  crudos,
});

const crudoDe = (tipo: Tipo, anio: number): CrudoCapturado => ({
  file: archivo(tipo, anio),
  url: urlSidof(tipo, anio),
  bytes: fuenteFalsa.get(urlSidof(tipo, anio)) as Uint8Array,
  obtenido_en: "2026-10-18T19:30:00.000Z",
});

async function serieFix(nombre: string): Promise<TipoCambioFix[]> {
  const anio = Number(nombre.slice(4, 8));
  return interpretarSidof(await fixture(nombre), 158, anio, 4).map((r) => ({
    fecha_publicacion: r.fecha,
    valor: r.valor,
  }));
}

async function serieUdis(): Promise<Udi[]> {
  return interpretarSidof(await fixture("159-2026.json"), 159, 2026, 6);
}

/** Error que lanza `fn`; la prueba falla si no lanza o si lanza otra cosa que ErrorDatos. */
function errorDe(fn: () => unknown): ErrorDatos {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDatos);
    return e as ErrorDatos;
  }
  throw new Error("se esperaba un ErrorDatos y no se lanzó nada");
}

describe("urlSidof", () => {
  it("pide el año completo del tipo", () => {
    expect(urlSidof(158, 2020)).toBe(
      "https://sidof.segob.gob.mx/dof/sidof/indicadores/158/01-01-2020/31-12-2020",
    );
    expect(urlSidof(159, 2026)).toBe(
      "https://sidof.segob.gob.mx/dof/sidof/indicadores/159/01-01-2026/31-12-2026",
    );
  });
});

describe("interpretarSidof", () => {
  it("lee el FIX de 2020 completo, con fechas ISO y 4 decimales", async () => {
    const r = interpretarSidof(await fixture("158-2020.json"), 158, 2020, 4);
    expect(r).toHaveLength(252);
    expect(r[0]).toEqual({ fecha: "2020-01-02", valor: "18.8642" });
    expect(r.at(-1)).toEqual({ fecha: "2020-12-31", valor: "19.9352" });
    for (const x of r) expect(x.valor).toMatch(/^\d+\.\d{4}$/);
  });

  it("lee el FIX de 2026 hasta la última publicación", async () => {
    const r = interpretarSidof(await fixture("158-2026.json"), 158, 2026, 4);
    expect(r).toHaveLength(200);
    expect(r[0]).toEqual({ fecha: "2026-01-02", valor: "18.0012" });
    expect(r.at(-1)).toEqual({ fecha: "2026-10-16", valor: "18.4250" });
  });

  it("lee las UDIS de 2026, publicadas por adelantado, y quita los espacios de la fuente", async () => {
    const r = interpretarSidof(await fixture("159-2026.json"), 159, 2026, 6);
    expect(r).toHaveLength(298);
    expect(r[0]).toEqual({ fecha: "2026-01-01", valor: "8.666288" });
    expect(r.at(-1)).toEqual({ fecha: "2026-10-25", valor: "8.861350" });
    // El SIDOF publica "8.673506 " (espacio al final) el 2026-01-09 y " 8.830830" (espacio al
    // inicio) el 2026-06-09.
    expect(r.find((x) => x.fecha === "2026-01-09")).toEqual({
      fecha: "2026-01-09",
      valor: "8.673506",
    });
    expect(r.find((x) => x.fecha === "2026-06-09")).toEqual({
      fecha: "2026-06-09",
      valor: "8.830830",
    });
    for (const x of r) expect(x.valor).toMatch(/^\d+\.\d{6}$/);
  });

  it("guarda la UDI sin los espacios de alrededor y rechaza cualquier otro blanco", async () => {
    // El índice 8 del fixture es el 2026-01-09.
    const con = (valor: string) =>
      variante("159-2026.json", (r) => {
        en(r, 8).valor = valor;
      });
    const r = interpretarSidof(await con("  8.673506  "), 159, 2026, 6);
    expect(r[8]).toEqual({ fecha: "2026-01-09", valor: "8.673506" });
    for (const malo of [
      "8.673506\t",
      "\t8.673506",
      "8.673 506",
      "8 .673506",
      "8.673506\n",
      "\u00a08.673506",
      " 8.67350 ",
    ]) {
      const bytes = await con(malo);
      expect(() => interpretarSidof(bytes, 159, 2026, 6), JSON.stringify(malo)).toThrow(
        `valor inesperado el 2026-01-09: ${JSON.stringify(malo)}`,
      );
    }
  });

  it("acepta un año sin publicaciones", () => {
    expect(interpretarSidof(respuesta(158, []), 158, 2027, 4)).toEqual([]);
  });

  const casos: [string, (r: Respuesta) => void, string][] = [
    [
      "messageCode distinto de 200",
      (r) => {
        r.messageCode = 500;
      },
      "messageCode 500",
    ],
    [
      "messageCode como texto",
      (r) => {
        r.messageCode = "200";
      },
      'messageCode "200"',
    ],
    [
      "sin messageCode",
      (r) => {
        Reflect.deleteProperty(r, "messageCode");
      },
      "messageCode",
    ],
    [
      "response distinto de OK",
      (r) => {
        r.response = "ERROR";
      },
      'response "ERROR"',
    ],
    [
      "sin ListaIndicadores",
      (r) => {
        Reflect.deleteProperty(r, "ListaIndicadores");
      },
      "forma esperada: ListaIndicadores",
    ],
    [
      "TotalIndicadores que no cuadra",
      (r) => {
        r.TotalIndicadores = 251;
      },
      "TotalIndicadores 251",
    ],
    [
      "TotalIndicadores como texto",
      (r) => {
        r.TotalIndicadores = "252";
      },
      "forma esperada: TotalIndicadores",
    ],
    [
      "un indicador de otro tipo",
      (r) => {
        en(r, 10).codTipoIndicador = 159;
      },
      "codTipoIndicador 159",
    ],
    [
      "un indicador sin fecha",
      (r) => {
        Reflect.deleteProperty(en(r, 3), "fecha");
      },
      "forma esperada: ListaIndicadores.3.fecha",
    ],
    [
      "una fecha en formato ISO",
      (r) => {
        en(r, 0).fecha = "2020-01-02";
      },
      'fecha inválida: "2020-01-02"',
    ],
    [
      "una fecha que no existe",
      (r) => {
        en(r, 0).fecha = "30-02-2020";
      },
      'fecha inválida: "30-02-2020"',
    ],
    [
      "una fecha con espacios",
      (r) => {
        en(r, 0).fecha = " 02-01-2020";
      },
      "fecha inválida",
    ],
    [
      "una fecha de otro año",
      (r) => {
        en(r, 5).fecha = "02-01-2021";
      },
      "02-01-2021, que no es de 2020",
    ],
    [
      "un valor con 3 decimales",
      (r) => {
        en(r, 0).valor = "18.864";
      },
      'valor inesperado el 2020-01-02: "18.864"',
    ],
    [
      "un valor con 5 decimales",
      (r) => {
        en(r, 0).valor = "18.86420";
      },
      '"18.86420" (se esperan 4 decimales)',
    ],
    [
      "un valor sin decimales",
      (r) => {
        en(r, 0).valor = "18";
      },
      "valor inesperado",
    ],
    [
      "un valor con coma decimal",
      (r) => {
        en(r, 0).valor = "18,8642";
      },
      "valor inesperado",
    ],
    [
      "un valor vacío",
      (r) => {
        en(r, 0).valor = "";
      },
      "valor inesperado",
    ],
    [
      "un valor negativo",
      (r) => {
        en(r, 0).valor = "-18.8642";
      },
      "valor inesperado",
    ],
    [
      "un valor con un espacio en medio",
      (r) => {
        en(r, 0).valor = "18.86 42";
      },
      "valor inesperado",
    ],
    [
      "un valor con tabulador",
      (r) => {
        en(r, 0).valor = "\t18.8642";
      },
      "valor inesperado",
    ],
    [
      "un valor numérico",
      (r) => {
        en(r, 0).valor = 18.8642;
      },
      "forma esperada: ListaIndicadores.0.valor",
    ],
    [
      "una fecha repetida",
      (r) => {
        en(r, 1).fecha = en(r, 0).fecha;
      },
      "fecha 2020-01-02 repetida",
    ],
  ];

  it.each(casos)("rechaza %s con ErrorDatos", async (_, cambio, mensaje) => {
    const bytes = await variante("158-2020.json", cambio);
    const e = errorDe(() => interpretarSidof(bytes, 158, 2020, 4));
    expect(e.dataset).toBe("tipo-cambio.fix");
    expect(e.message).toContain("SIDOF (tipo 158, 2020)");
    expect(e.message).toContain(mensaje);
  });

  it("rechaza HTML, bytes que no son UTF-8 y JSON que no es un objeto", () => {
    const casosCrudos: [Uint8Array, string][] = [
      [texto("<html><body>Mantenimiento</body></html>"), "no es JSON válido"],
      [new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]), "no es JSON válido"],
      [texto(""), "no es JSON válido"],
      [texto("[]"), "forma esperada: (raíz)"],
      [texto("null"), "forma esperada: (raíz)"],
      [texto('"OK"'), "forma esperada: (raíz)"],
    ];
    for (const [bytes, mensaje] of casosCrudos) {
      expect(() => interpretarSidof(bytes, 159, 2026, 6)).toThrow(ErrorDatos);
      expect(() => interpretarSidof(bytes, 159, 2026, 6)).toThrow(mensaje);
    }
    expect(errorDe(() => interpretarSidof(texto("<html>"), 159, 2026, 6)).dataset).toBe("udis");
  });

  it("rechaza decimales de más o de menos según el tipo", async () => {
    expect(() => interpretarSidof(texto("x"), 158, 2026, 4)).toThrow(ErrorDatos);
    const fix = await fixture("158-2026.json");
    const udi = await fixture("159-2026.json");
    expect(() => interpretarSidof(udi, 159, 2026, 4)).toThrow("se esperan 4 decimales");
    expect(() => interpretarSidof(fix, 158, 2026, 6)).toThrow("se esperan 6 decimales");
    // El tipo pedido tiene que coincidir con el de la respuesta.
    expect(() => interpretarSidof(udi, 158, 2026, 6)).toThrow("codTipoIndicador 159");
  });

  it("rechaza el año completo si se lee con otro año", async () => {
    const bytes = await fixture("158-2026.json");
    expect(() => interpretarSidof(bytes, 158, 2025, 4)).toThrow("que no es de 2025");
  });
});

describe("registro", () => {
  it("registra los dos datasets con su directorio, archivo y frescura", () => {
    expect(ANIO_INICIAL).toBe(2020);
    expect(DATASETS.get("tipo-cambio.fix")).toBe(tipoCambioFix);
    expect(DATASETS.get("udis")).toBe(udis);
    expect(tipoCambioFix).toMatchObject({ directorio: "tipo-cambio-fix", archivo: "fix.json" });
    expect(udis).toMatchObject({ directorio: "udis", archivo: "udis.json" });
    expect(FRESCURA_HORAS["tipo-cambio.fix"]).toBe(72);
    expect(FRESCURA_HORAS.udis).toBe(72);
  });

  it("los esquemas exigen la fecha ISO y los decimales exactos, como strings", () => {
    expect(tipoCambioFix.clave({ fecha_publicacion: "2026-10-16", valor: "18.4250" })).toBe(
      "2026-10-16",
    );
    expect(udis.clave({ fecha: "2026-10-16", valor: "8.861350" })).toBe("2026-10-16");
    const fix = tipoCambioFix.esquema;
    expect(fix.safeParse({ fecha_publicacion: "2026-10-16", valor: "18.4250" }).success).toBe(true);
    for (const valor of ["18.425", "18.42500", 18.425, "18,4250"]) {
      expect(fix.safeParse({ fecha_publicacion: "2026-10-16", valor }).success).toBe(false);
    }
    expect(fix.safeParse({ fecha_publicacion: "16-10-2026", valor: "18.4250" }).success).toBe(
      false,
    );
    const udi = udis.esquema;
    expect(udi.safeParse({ fecha: "2026-10-16", valor: "8.861350" }).success).toBe(true);
    for (const valor of ["8.86135", "8.8613500", 8.86135]) {
      expect(udi.safeParse({ fecha: "2026-10-16", valor }).success).toBe(false);
    }
  });
});

describe("capturar", () => {
  const urls = (tipo: Tipo, anios: readonly number[]) => anios.map((a) => urlSidof(tipo, a));

  it("sin crudos en disco pide cada año desde 2020 hasta el de la corrida, en orden", async () => {
    const fuentes = await tipoCambioFix.capturar(ctx());
    expect(pedidas).toEqual(urls(158, ANIOS));
    expect(fuentes).toHaveLength(1);
    const [f] = fuentes;
    expect(f?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(158, a)));
    expect(f?.crudos.map((c) => c.url)).toEqual(urls(158, ANIOS));
    expect(f?.crudos[0]?.bytes).toEqual(await fixture("158-2020.json"));
    expect(f?.crudos[6]?.bytes).toEqual(await fixture("158-2026.json"));
    expect(f).toMatchObject({
      url: "https://sidof.segob.gob.mx/",
      license: LICENCIA,
      license_url: URL_LICENCIA,
      published_at: null,
    });
    expect(f?.name).toContain("FIX");
    expect(f?.citation).toContain("Banco de México");
  });

  it("toma del disco los años anteriores que ya tiene y pide el año en curso y los que faltan", async () => {
    await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2022, 2023, 2024, 2025]);
    const [f] = await tipoCambioFix.capturar(ctx());
    expect(pedidas).toEqual(urls(158, [2021, 2026]));
    expect(f?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(158, a)));
    expect(f?.crudos[0]?.bytes).toEqual(await fixture("158-2020.json"));
    // Los del disco llevan la hora de la petición del año en curso.
    const actual = f?.crudos[6]?.obtenido_en;
    expect(actual).toMatch(/^2026-10-18T19:30:\d{2}\.000Z$/);
    expect(f?.crudos[0]?.obtenido_en).toBe(actual);
    expect(f?.crudos[1]?.obtenido_en).not.toBe(actual);
  });

  it("en enero también pide el año anterior y, en diciembre, udis pide el siguiente", async () => {
    await crudosEnDisco("tipo-cambio-fix", 158, ANIOS);
    await crudosEnDisco("udis", 159, ANIOS);
    const casos: [string, number[], number[]][] = [
      // fecha, años que pide el FIX, años que pide udis
      ["2026-01-01", [2025, 2026], [2025, 2026]],
      ["2026-01-31", [2025, 2026], [2025, 2026]],
      ["2026-02-01", [2026], [2026]],
      ["2026-11-30", [2026], [2026]],
      ["2026-12-01", [2026], [2026, 2027]],
      ["2026-12-20", [2026], [2026, 2027]],
      ["2026-12-31", [2026], [2026, 2027]],
      ["2027-01-20", [2026, 2027], [2026, 2027]],
      ["2027-02-01", [2027], [2027]],
    ];
    for (const [fecha, delFix, deUdis] of casos) {
      pedidas = [];
      await tipoCambioFix.capturar(ctx(fecha));
      expect(pedidas, `fix ${fecha}`).toEqual(urls(158, delFix));
      pedidas = [];
      await udis.capturar(ctx(fecha));
      expect(pedidas, `udis ${fecha}`).toEqual(urls(159, deUdis));
    }
  });

  it("en diciembre guarda las UDIS de enero ya publicadas, o nada si el SIDOF da 404 NOT_FOUND", async () => {
    await crudosEnDisco("udis", 159, [2020, 2021, 2022, 2023, 2024, 2025]);
    const sinEnero = await udis.capturar(ctx("2026-12-20"));
    expect(sinEnero[0]?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(159, a)));

    erroresFalsos.delete(urlSidof(159, 2027));
    const enero = Array.from({ length: 10 }, (_, i) => ({
      fecha: `2027-01-${String(i + 1).padStart(2, "0")}`,
      valor: `8.9${String(i).padStart(5, "0")}`,
    }));
    fuenteFalsa.set(urlSidof(159, 2027), respuesta(159, enero));
    const conEnero = await udis.capturar(ctx("2026-12-26"));
    expect(conEnero[0]?.crudos.map((c) => c.file)).toEqual(
      [...ANIOS, 2027].map((a) => archivo(159, a)),
    );
    const { registros } = await udis.construir(conEnero, null, ctx("2026-12-26"));
    expect(registros.at(-1)).toEqual({ fecha: "2027-01-10", valor: "8.900009" });

    // Un 404 con otro cuerpo para el año siguiente sigue siendo un error.
    erroresFalsos.set(urlSidof(159, 2027), { estado: 404, cuerpo: "<html>404</html>" });
    const e = await udis.capturar(ctx("2026-12-26")).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("404 para 2027");
  });

  it("un año cerrado sin publicaciones es un error, aunque el SIDOF responda 200", async () => {
    fuenteFalsa.set(urlSidof(158, 2021), respuesta(158, []));
    const cerrado = await tipoCambioFix.capturar(ctx()).catch((x) => x);
    expect(cerrado).toBeInstanceOf(ErrorDatos);
    expect(cerrado.message).toContain("no trae publicaciones de 2021");
    expect(pedidas).toEqual(urls(158, [2020, 2021]));

    // El año anterior que se vuelve a pedir en enero, también.
    await crudosEnDisco("udis", 159, [2020, 2021, 2022, 2023, 2024, 2025]);
    fuenteFalsa.set(urlSidof(159, 2025), respuesta(159, []));
    const enero = await udis.capturar(ctx("2026-01-20")).catch((x) => x);
    expect(enero).toBeInstanceOf(ErrorDatos);
    expect(enero.message).toContain("no trae publicaciones de 2025");

    // El año en curso puede venir vacío: si antes tenía registros, `revisar` lo marca como bajas.
    fuenteFalsa.set(urlSidof(158, 2026), respuesta(158, []));
    await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2021, 2022, 2023, 2024, 2025]);
    const [f] = await tipoCambioFix.capturar(ctx());
    expect(f?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(158, a)));
  });

  it("udis pide el tipo 159 y lee su propio directorio", async () => {
    await crudosEnDisco("udis", 159, [2020, 2021, 2022, 2023, 2024, 2025]);
    // Los crudos del FIX no le sirven a udis.
    await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2021, 2022, 2023, 2024, 2025]);
    const [f] = await udis.capturar(ctx());
    expect(pedidas).toEqual(urls(159, [2026]));
    expect(f?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(159, a)));
    expect(f?.crudos[6]?.bytes).toEqual(await fixture("159-2026.json"));
    expect(f?.name).toContain("UDIS");
    expect(f).toMatchObject({ license: LICENCIA, license_url: URL_LICENCIA });
  });

  it("se detiene en la primera respuesta inesperada, sin pedir más años", async () => {
    fuenteFalsa.set(urlSidof(158, 2021), texto("<html>Mantenimiento</html>"));
    const e = await tipoCambioFix.capturar(ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("SIDOF (tipo 158, 2021)");
    expect(pedidas).toEqual(urls(158, [2020, 2021]));
  });

  it("un crudo en disco que no se puede leer detiene la captura", async () => {
    await mkdir(join(raiz, "tipo-cambio-fix", archivo(158, 2020)), { recursive: true });
    await expect(tipoCambioFix.capturar(ctx())).rejects.toThrow();
    expect(pedidas).toEqual([]);
  });

  it("un 404 NOT_FOUND del año en curso es un año sin publicaciones y no deja crudo", async () => {
    await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2021, 2022, 2023, 2024, 2025]);
    sinDatos(urlSidof(158, 2027));
    const [f] = await tipoCambioFix.capturar(ctx("2027-01-02"));
    expect(pedidas).toEqual(urls(158, [2026, 2027]));
    expect(f?.crudos.map((c) => c.file)).toEqual(ANIOS.map((a) => archivo(158, a)));
    expect(f?.crudos[6]?.bytes).toEqual(await fixture("158-2026.json"));
    // Los del disco llevan la hora de la petición del año en curso, aunque haya dado 404.
    const del2026 = f?.crudos[6]?.obtenido_en as string;
    const delDisco = new Set(f?.crudos.slice(0, 6).map((c) => c.obtenido_en));
    expect(delDisco.size).toBe(1);
    const hora = [...delDisco][0] as string;
    expect(hora).toMatch(/^2026-10-18T19:30:\d{2}\.000Z$/);
    expect(hora > del2026).toBe(true);
  });

  it("un 404 con otro cuerpo es un error de datos", async () => {
    for (const cuerpo of [
      '{"messageCode":404,"response":"ERROR"}',
      '{"messageCode":404,"response":"NOT_FOUND","detalle":"x"}',
      '{"messageCode":"404","response":"NOT_FOUND"}',
      '{"messageCode":200,"response":"OK","ListaIndicadores":[],"TotalIndicadores":0}',
      '[{"messageCode":404,"response":"NOT_FOUND"}]',
      "null",
      "<html>404</html>",
      "",
    ]) {
      erroresFalsos.set(urlSidof(158, 2026), { estado: 404, cuerpo });
      await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2021, 2022, 2023, 2024, 2025]);
      const e = await tipoCambioFix.capturar(ctx()).catch((x) => x);
      expect(e, cuerpo).toBeInstanceOf(ErrorDatos);
      expect(e.message).toContain("404");
      expect(e.message).toContain("2026");
    }
  });

  it("un 404 NOT_FOUND de un año que ya debe tener datos es un error", async () => {
    // Un año cerrado que falta en disco.
    sinDatos(urlSidof(158, 2021));
    const pasado = await tipoCambioFix.capturar(ctx()).catch((x) => x);
    expect(pasado).toBeInstanceOf(ErrorDatos);
    expect(pasado.message).toContain("2021");
    expect(pedidas).toEqual(urls(158, [2020, 2021]));
    // El año anterior que se vuelve a pedir en enero.
    await crudosEnDisco("tipo-cambio-fix", 158, [2020, 2021, 2022, 2023, 2024, 2025]);
    sinDatos(urlSidof(158, 2026));
    const enero = await tipoCambioFix.capturar(ctx("2027-01-05")).catch((x) => x);
    expect(enero).toBeInstanceOf(ErrorDatos);
    expect(enero.message).toContain("2026");
  });

  it("otros estados de error siguen siendo ErrorHttp", async () => {
    erroresFalsos.set(urlSidof(158, 2020), { estado: 410, cuerpo: NOT_FOUND });
    const e = await tipoCambioFix.capturar(ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect(e.estado).toBe(410);
  });

  it("una corrida anterior a 2020 es un error", async () => {
    await expect(tipoCambioFix.capturar(ctx("2019-12-31"))).rejects.toThrow(ErrorDatos);
    expect(pedidas).toEqual([]);
  });
});

describe("construir", () => {
  it("el año en curso puede no tener crudo; los cerrados no", async () => {
    const crudos = [2020, 2021, 2022, 2023, 2024, 2025].map((a) => crudoDe(158, a));
    const { registros } = await tipoCambioFix.construir([fuenteCon(crudos)], null, ctx());
    expect(registros).toHaveLength(252 + N_FIX);
    expect(registros.at(-1)?.fecha_publicacion).toBe("2025-12-31");
    const sin2025 = crudos.slice(0, -1);
    await expect(tipoCambioFix.construir([fuenteCon(sin2025)], null, ctx())).rejects.toThrow(
      "raw/sidof-158-2025.json",
    );
  });

  it("une los años del FIX en orden de fecha", async () => {
    const crudos = [...ANIOS].reverse().map((a) => crudoDe(158, a));
    const { registros, avisos } = await tipoCambioFix.construir([fuenteCon(crudos)], null, ctx());
    expect(avisos).toEqual([]);
    expect(registros).toHaveLength(252 + N_FIX + 200);
    expect(registros[0]).toEqual({ fecha_publicacion: "2020-01-02", valor: "18.8642" });
    expect(registros[251]).toEqual({ fecha_publicacion: "2020-12-31", valor: "19.9352" });
    expect(registros[252]).toEqual({ fecha_publicacion: "2021-01-01", valor: "19.9000" });
    expect(registros[252 + N_FIX]).toEqual({ fecha_publicacion: "2026-01-02", valor: "18.0012" });
    expect(registros.at(-1)).toEqual({ fecha_publicacion: "2026-10-16", valor: "18.4250" });
    const fechas = registros.map((r) => r.fecha_publicacion);
    expect(fechas).toEqual([...fechas].sort());
    expect(tipoCambioFix.invariantes(registros)).toEqual([]);
  });

  it("une las UDIS en una serie diaria de 2020-01-01 al último valor publicado", async () => {
    const crudos = ANIOS.map((a) => crudoDe(159, a));
    const { registros } = await udis.construir([fuenteCon(crudos)], null, ctx());
    expect(registros[0]?.fecha).toBe("2020-01-01");
    expect(registros.at(-1)).toEqual({ fecha: "2026-10-25", valor: "8.861350" });
    expect(registros).toHaveLength(2192 + 298);
    expect(udis.invariantes(registros)).toEqual([]);
  });

  it("falla si falta el crudo de un año o sobra uno", async () => {
    const sinUno = ANIOS.filter((a) => a !== 2023).map((a) => crudoDe(158, a));
    const falta = await tipoCambioFix.construir([fuenteCon(sinUno)], null, ctx()).catch((x) => x);
    expect(falta).toBeInstanceOf(ErrorDatos);
    expect(falta.message).toContain("raw/sidof-158-2023.json");

    const conOtro = [...ANIOS.map((a) => crudoDe(158, a)), crudoDe(159, 2026)];
    const sobra = await tipoCambioFix.construir([fuenteCon(conOtro)], null, ctx()).catch((x) => x);
    expect(sobra).toBeInstanceOf(ErrorDatos);
    expect(sobra.message).toContain("raw/sidof-159-2026.json");

    // Un año de más respecto de la fecha de la corrida también sobra.
    const futuro = await tipoCambioFix
      .construir([fuenteCon(ANIOS.map((a) => crudoDe(158, a)))], null, ctx("2025-06-01"))
      .catch((x) => x);
    expect(futuro).toBeInstanceOf(ErrorDatos);
    expect(futuro.message).toContain("raw/sidof-158-2026.json");
  });

  it("un año cerrado sin publicaciones falla; el año en curso y el siguiente pueden venir vacíos", async () => {
    const crudos = ANIOS.map((a) => crudoDe(158, a));
    crudos[1] = { ...(crudos[1] as CrudoCapturado), bytes: respuesta(158, []) };
    const e = await tipoCambioFix.construir([fuenteCon(crudos)], null, ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("raw/sidof-158-2021.json no trae publicaciones de 2021");

    const vacio2026 = ANIOS.map((a) =>
      a === 2026 ? { ...crudoDe(158, a), bytes: respuesta(158, []) } : crudoDe(158, a),
    );
    const { registros } = await tipoCambioFix.construir([fuenteCon(vacio2026)], null, ctx());
    expect(registros).toHaveLength(252 + N_FIX);

    const conSiguiente = [
      ...ANIOS.map((a) => crudoDe(159, a)),
      { ...crudoDe(159, 2027), bytes: respuesta(159, []) },
    ];
    const diciembre = await udis.construir([fuenteCon(conSiguiente)], null, ctx("2026-12-20"));
    expect(diciembre.registros.at(-1)?.fecha).toBe("2026-10-25");
  });

  it("el año siguiente solo entra en diciembre y solo en udis", async () => {
    const conSiguiente = [
      ...ANIOS.map((a) => crudoDe(158, a)),
      { ...crudoDe(158, 2027), bytes: respuesta(158, []) },
    ];
    const fix = await tipoCambioFix
      .construir([fuenteCon(conSiguiente)], null, ctx("2026-12-20"))
      .catch((x) => x);
    expect(fix).toBeInstanceOf(ErrorDatos);
    expect(fix.message).toContain("Crudos inesperados: raw/sidof-158-2027.json");
    const deUdis = [
      ...ANIOS.map((a) => crudoDe(159, a)),
      { ...crudoDe(159, 2027), bytes: respuesta(159, []) },
    ];
    const noviembre = await udis
      .construir([fuenteCon(deUdis)], null, ctx("2026-11-30"))
      .catch((x) => x);
    expect(noviembre).toBeInstanceOf(ErrorDatos);
    expect(noviembre.message).toContain("Crudos inesperados: raw/sidof-159-2027.json");
  });

  it("un crudo inválido en cualquier año falla con ErrorDatos", async () => {
    const crudos = ANIOS.map((a) => crudoDe(158, a));
    crudos[3] = { ...(crudos[3] as CrudoCapturado), bytes: texto('{"messageCode":404}') };
    const e = await tipoCambioFix.construir([fuenteCon(crudos)], null, ctx()).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDatos);
    expect(e.message).toContain("SIDOF (tipo 158, 2023)");
  });
});

describe("invariantes", () => {
  it("la serie real del FIX, con fines de semana y feriados sin publicación, los cumple", async () => {
    const r = [...(await serieFix("158-2020.json")), ...(await serieFix("158-2026.json"))];
    expect(tipoCambioFix.invariantes(r)).toEqual([]);
  });

  it("detectan fechas repetidas, inválidas, anteriores a 2020 y valores no positivos", async () => {
    const r = await serieFix("158-2026.json");
    const primero = r[0] as TipoCambioFix;
    const repetida = tipoCambioFix.invariantes([...r, { ...primero }]);
    expect(repetida).toEqual(["fechas repetidas: 2026-01-02"]);
    const vieja = tipoCambioFix.invariantes([
      { fecha_publicacion: "2019-12-31", valor: "18.9000" },
      ...r,
    ]);
    expect(vieja).toEqual(["la primera fecha (2019-12-31) es anterior a 2020-01-01"]);
    const cero = tipoCambioFix.invariantes(
      r.map((x, i) => (i === 1 ? { ...x, valor: "0.0000" } : x)),
    );
    expect(cero).toEqual(["valores que no son mayores que cero: 2026-01-05 (0.0000)"]);
    const negativo = tipoCambioFix.invariantes(
      r.map((x, i) => (i === 1 ? { ...x, valor: "-1.0000" } : x)),
    );
    expect(negativo).toEqual(["valores que no son mayores que cero: 2026-01-05 (-1.0000)"]);
    const invalida = tipoCambioFix.invariantes([
      ...r,
      { fecha_publicacion: "2026-02-30", valor: "18.0000" },
    ]);
    expect(invalida).toEqual(["fechas inválidas: 2026-02-30"]);
  });

  it("en UDIS la serie es diaria: un día que falta es un hueco", async () => {
    const r = await serieUdis();
    expect(udis.invariantes(r)).toEqual([]);
    const sin = r.filter((x) => x.fecha !== "2026-05-10" && x.fecha !== "2026-08-01");
    expect(udis.invariantes(sin)).toEqual([
      "huecos en la serie diaria: entre 2026-05-09 y 2026-05-11, entre 2026-07-31 y 2026-08-02",
    ]);
    // Una fecha repetida no cuenta como hueco, y una inválida no rompe la revisión.
    const primera = r[0] as Udi;
    expect(udis.invariantes([...r, { ...primera }])).toEqual(["fechas repetidas: 2026-01-01"]);
    expect(udis.invariantes([...r, { fecha: "2026-13-01", valor: "9.000000" }])).toEqual([
      "fechas inválidas: 2026-13-01",
    ]);
  });

  it("en el FIX los días sin publicación no son huecos", async () => {
    const r = await serieFix("158-2026.json");
    expect(tipoCambioFix.invariantes(r.filter((_, i) => i % 2 === 0))).toEqual([]);
  });
});

describe("revisar", () => {
  const fix = (fecha_publicacion: string, valor: string): TipoCambioFix => ({
    fecha_publicacion,
    valor,
  });
  const udi = (fecha: string, valor: string): Udi => ({ fecha, valor });
  const revisarFix = (antes: TipoCambioFix[], despues: TipoCambioFix[]) =>
    tipoCambioFix.revisar(diferenciar(antes, despues, tipoCambioFix.clave), antes);
  const revisarUdis = (antes: Udi[], despues: Udi[]) =>
    udis.revisar(diferenciar(antes, despues, udis.clave), antes);

  it("la publicación de cada día no pide revisión", async () => {
    const r = await serieFix("158-2026.json");
    expect(revisarFix(r.slice(0, -1), r)).toEqual({ requiereRevision: false, motivos: [] });
    const u = await serieUdis();
    // El día 10 y el 25 de cada mes se publican de golpe unos 15 días por adelantado.
    expect(revisarUdis(u.slice(0, -16), u)).toEqual({ requiereRevision: false, motivos: [] });
  });

  it("un valor ya publicado que cambia o desaparece pide revisión y lo dice", async () => {
    const r = await serieFix("158-2026.json");
    const cambiado = r.map((x) =>
      x.fecha_publicacion === "2026-10-16" ? { ...x, valor: "18.4251" } : x,
    );
    expect(revisarFix(r, cambiado)).toEqual({
      requiereRevision: true,
      motivos: ["cambió el valor de 2026-10-16: 18.4250 → 18.4251"],
    });
    expect(revisarFix(r, r.slice(0, -1))).toEqual({
      requiereRevision: true,
      motivos: ["desapareció 2026-10-16"],
    });
    const u = await serieUdis();
    const otra = u.filter((x) => x.fecha !== "2026-10-25");
    const conCambio = otra.map((x) => (x.fecha === "2026-03-01" ? { ...x, valor: "8.000000" } : x));
    const rev = revisarUdis(u, conCambio);
    expect(rev.requiereRevision).toBe(true);
    expect(rev.motivos).toEqual([
      `cambió el valor de 2026-03-01: ${u.find((x) => x.fecha === "2026-03-01")?.valor} → 8.000000`,
      "desapareció 2026-10-25",
    ]);
  });

  it("más de 31 altas en el FIX o más de 45 en UDIS piden revisión", async () => {
    const r = await serieFix("158-2026.json");
    expect(revisarFix(r.slice(0, -31), r)).toEqual({ requiereRevision: false, motivos: [] });
    expect(revisarFix(r.slice(0, -32), r)).toEqual({
      requiereRevision: true,
      motivos: ["32 altas, más de 31: arranque o hueco recuperado"],
    });
    const u = await serieUdis();
    expect(revisarUdis(u.slice(0, -45), u)).toEqual({ requiereRevision: false, motivos: [] });
    expect(revisarUdis(u.slice(0, -46), u)).toEqual({
      requiereRevision: true,
      motivos: ["46 altas, más de 45: arranque o hueco recuperado"],
    });
  });

  it("un FIX nuevo que se aleja más de 5 % de la publicación anterior pide revisión", () => {
    const antes = [fix("2026-10-09", "19.0000"), fix("2026-10-15", "20.0000")];
    const con = (valor: string) => revisarFix(antes, [...antes, fix("2026-10-16", valor)]);
    expect(con("21.0000")).toEqual({ requiereRevision: false, motivos: [] });
    expect(con("19.0000")).toEqual({ requiereRevision: false, motivos: [] });
    expect(con("21.0001")).toEqual({
      requiereRevision: true,
      motivos: [
        "el FIX de 2026-10-16 (21.0001) se aleja más de 5 % de la publicación anterior (2026-10-15: 20.0000)",
      ],
    });
    expect(con("18.9999").motivos).toEqual([
      "el FIX de 2026-10-16 (18.9999) se aleja más de 5 % de la publicación anterior (2026-10-15: 20.0000)",
    ]);
    // La publicación anterior puede ser de varios días antes (fin de semana o feriado).
    const viernes = [fix("2026-10-09", "19.0000")];
    const lunes = revisarFix(viernes, [...viernes, fix("2026-10-12", "21.0000")]);
    expect(lunes.motivos).toEqual([
      "el FIX de 2026-10-12 (21.0000) se aleja más de 5 % de la publicación anterior (2026-10-09: 19.0000)",
    ]);
  });

  it("el FIX nuevo se compara con la publicación anterior aunque también sea nueva", () => {
    const antes = [fix("2026-10-14", "20.0000")];
    const exacto = [...antes, fix("2026-10-15", "21.0000"), fix("2026-10-16", "22.0500")];
    expect(revisarFix(antes, exacto)).toEqual({ requiereRevision: false, motivos: [] });
    const fuera = [...antes, fix("2026-10-15", "21.0000"), fix("2026-10-16", "22.0501")];
    expect(revisarFix(antes, fuera).motivos).toEqual([
      "el FIX de 2026-10-16 (22.0501) se aleja más de 5 % de la publicación anterior (2026-10-15: 21.0000)",
    ]);
    // Sin publicación anterior no hay con qué comparar: solo cuenta como relleno.
    expect(revisarFix(antes, [fix("2026-10-13", "30.0000"), ...antes])).toEqual({
      requiereRevision: true,
      motivos: ["alta dentro de la serie ya publicada: 2026-10-13 30.0000"],
    });
  });

  it("un alta antes de la última fecha ya publicada es un relleno y pide revisión", () => {
    // La API pudo haber respondido antes que ese día no hubo publicación, o otro FIX para una
    // operación.
    const antes = [fix("2026-10-14", "18.4000"), fix("2026-10-16", "18.4250")];
    const relleno = [antes[0] as TipoCambioFix, fix("2026-10-15", "18.4100"), ...antes.slice(1)];
    expect(revisarFix(antes, relleno)).toEqual({
      requiereRevision: true,
      motivos: ["alta dentro de la serie ya publicada: 2026-10-15 18.4100"],
    });
    const u = [udi("2026-10-14", "8.000000"), udi("2026-10-16", "8.000100")];
    expect(revisarUdis(u, [u[0] as Udi, udi("2026-10-15", "8.000050"), ...u.slice(1)])).toEqual({
      requiereRevision: true,
      motivos: ["alta dentro de la serie ya publicada: 2026-10-15 8.000050"],
    });
  });

  it("un FIX nuevo en sábado o domingo pide revisión; una UDI no", () => {
    const antes = [fix("2026-10-16", "18.4250")];
    expect(revisarFix(antes, [...antes, fix("2026-10-17", "18.4300")])).toEqual({
      requiereRevision: true,
      motivos: ["FIX publicado en fin de semana: 2026-10-17"],
    });
    expect(
      revisarFix(antes, [...antes, fix("2026-10-18", "18.4300"), fix("2026-10-19", "18.4400")]),
    ).toEqual({
      requiereRevision: true,
      motivos: ["FIX publicado en fin de semana: 2026-10-18"],
    });
    const u = [udi("2026-10-16", "8.000000")];
    const finDeSemana = [...u, udi("2026-10-17", "8.000100"), udi("2026-10-18", "8.000200")];
    expect(revisarUdis(u, finDeSemana)).toEqual({ requiereRevision: false, motivos: [] });
  });

  it("las altas al final de la serie, entre semana, no son relleno ni fin de semana", () => {
    const antes = [fix("2026-10-15", "18.4888"), fix("2026-10-16", "18.4250")];
    const semana = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
    const despues = [...antes, ...semana.map((f) => fix(f, "18.4300"))];
    expect(revisarFix(antes, despues)).toEqual({ requiereRevision: false, motivos: [] });
    // Un relleno en fin de semana da los dos motivos.
    expect(revisarFix(antes, [fix("2026-10-11", "18.4300"), ...antes]).motivos).toEqual([
      "alta dentro de la serie ya publicada: 2026-10-11 18.4300",
      "FIX publicado en fin de semana: 2026-10-11",
    ]);
  });

  it("una UDI nueva que se aleja más de 0.5 % del día anterior pide revisión", () => {
    const antes = [udi("2026-10-14", "7.990000"), udi("2026-10-15", "8.000000")];
    const con = (valor: string) => revisarUdis(antes, [...antes, udi("2026-10-16", valor)]);
    expect(con("8.040000")).toEqual({ requiereRevision: false, motivos: [] });
    expect(con("7.960000")).toEqual({ requiereRevision: false, motivos: [] });
    expect(con("8.040001")).toEqual({
      requiereRevision: true,
      motivos: [
        "la UDI de 2026-10-16 (8.040001) se aleja más de 0.5 % del día anterior (2026-10-15: 8.000000)",
      ],
    });
    expect(con("7.959999").motivos).toEqual([
      "la UDI de 2026-10-16 (7.959999) se aleja más de 0.5 % del día anterior (2026-10-15: 8.000000)",
    ]);
  });

  it("los umbrales se comparan sin redondeo de punto flotante", () => {
    // En punto flotante (0.315 - 0.3) / 0.3 da 0.05000000000000004 y pediría revisión.
    const antes = [fix("2026-10-15", "0.3000")];
    expect(revisarFix(antes, [...antes, fix("2026-10-16", "0.3150")]).requiereRevision).toBe(false);
    expect(revisarFix(antes, [...antes, fix("2026-10-16", "0.3151")]).requiereRevision).toBe(true);
    // Más allá de 2^53 en millonésimas, donde un number ya no distingue un dígito.
    const grandes = [udi("2026-10-15", "9007199254.740993")];
    const conGrande = (valor: string) =>
      revisarUdis(grandes, [...grandes, udi("2026-10-16", valor)]).requiereRevision;
    expect(conGrande("9052235251.014697")).toBe(false);
    expect(conGrande("9052235251.014698")).toBe(true);
  });
});

describe("corrida completa", () => {
  const dirFix = () => join(raiz, "tipo-cambio-fix");
  const leerDir = async (dir: string) => {
    const nombres = (await readdir(dir, { recursive: true })).sort();
    const mapa = new Map<string, string>();
    for (const n of nombres) {
      const contenido = await readFile(join(dir, n)).catch(() => null);
      if (contenido !== null) mapa.set(n, contenido.toString("base64"));
    }
    return mapa;
  };

  it("fix: escribe la serie con su manifiesto y sus crudos, y verifica", async () => {
    const { resultado } = await ejecutarDataset(tipoCambioFix, ctx());
    expect(resultado).toMatchObject({
      dataset: "tipo-cambio.fix",
      estado: "actualizado",
      registros: 252 + N_FIX + 200,
      motivos: ["snapshot inicial"],
      escrito: true,
    });
    const datos = JSON.parse(await readFile(join(dirFix(), "fix.json"), "utf8"));
    expect(datos[0]).toEqual({ fecha_publicacion: "2020-01-02", valor: "18.8642" });
    const m = JSON.parse(await readFile(join(dirFix(), "manifest.json"), "utf8"));
    expect(m).toMatchObject({
      dataset: "tipo-cambio.fix",
      data_file: "fix.json",
      records: 252 + N_FIX + 200,
    });
    expect(m.sources).toHaveLength(1);
    expect(m.sources[0].raw.map((x: { file: string }) => x.file)).toEqual(
      ANIOS.map((a) => archivo(158, a)),
    );
    expect(m.sources[0].raw[0].url).toBe(urlSidof(158, 2020));
    expect(await readFile(join(dirFix(), archivo(158, 2026)))).toEqual(
      Buffer.from(await fixture("158-2026.json")),
    );
    expect(await verificarDatos(raiz)).toEqual([]);

    // La siguiente corrida toma del disco los años cerrados y solo pide el año en curso.
    pedidas = [];
    const otra = await ejecutarDataset(tipoCambioFix, ctx("2026-10-19"));
    expect(pedidas).toEqual([urlSidof(158, 2026)]);
    expect(otra.resultado.estado).toBe("sin_cambios");
  });

  it("udis: escribe la serie diaria completa y verifica", async () => {
    const { resultado } = await ejecutarDataset(udis, ctx());
    expect(resultado).toMatchObject({
      dataset: "udis",
      estado: "actualizado",
      registros: 2192 + 298,
    });
    const datos = JSON.parse(await readFile(join(raiz, "udis", "udis.json"), "utf8"));
    expect(datos.find((x: Udi) => x.fecha === "2026-01-09")).toEqual({
      fecha: "2026-01-09",
      valor: "8.673506",
    });
    expect(datos.find((x: Udi) => x.fecha === "2026-06-09")).toEqual({
      fecha: "2026-06-09",
      valor: "8.830830",
    });
    // El crudo se guarda tal cual lo publica la fuente, con los espacios.
    const crudo = await readFile(join(raiz, "udis", archivo(159, 2026)));
    expect(crudo).toEqual(Buffer.from(await fixture("159-2026.json")));
    expect(crudo.toString("utf8")).toContain('"valor":"8.673506 "');
    expect(crudo.toString("utf8")).toContain('"valor":" 8.830830"');
    expect(await verificarDatos(raiz)).toEqual([]);
  });

  it("el año nuevo sin publicaciones no rompe la corrida ni deja crudo vacío", async () => {
    await ejecutarDataset(tipoCambioFix, ctx("2026-12-31"));
    sinDatos(urlSidof(158, 2027));
    pedidas = [];
    const enero = await ejecutarDataset(tipoCambioFix, ctx("2027-01-02"));
    expect(pedidas).toEqual([urlSidof(158, 2026), urlSidof(158, 2027)]);
    expect(enero.resultado.estado).toBe("sin_cambios");

    erroresFalsos.delete(urlSidof(158, 2027));
    fuenteFalsa.set(
      urlSidof(158, 2027),
      respuesta(158, [{ fecha: "2027-01-04", valor: "18.5000" }]),
    );
    const lunes = await ejecutarDataset(tipoCambioFix, ctx("2027-01-04"));
    expect(lunes.resultado).toMatchObject({ estado: "actualizado", altas: 1, motivos: [] });
    const m = JSON.parse(await readFile(join(dirFix(), "manifest.json"), "utf8"));
    expect(m.sources[0].raw.map((x: { file: string }) => x.file)).toEqual(
      [...ANIOS, 2027].map((a) => archivo(158, a)),
    );
    expect(await verificarDatos(raiz)).toEqual([]);
  });

  it("si a media corrida el año en curso da 404 NOT_FOUND, lo publicado no se pierde en silencio", async () => {
    for (const [def, tipo, publicadas] of [
      [tipoCambioFix, 158, 200],
      [udis, 159, 298],
    ] as const) {
      await ejecutarDataset<TipoCambioFix | Udi>(def, ctx());
      sinDatos(urlSidof(tipo, 2026));
      const { resultado } = await ejecutarDataset<TipoCambioFix | Udi>(def, ctx("2026-10-19"));
      expect(resultado).toMatchObject({
        estado: "requiere_revision",
        altas: 0,
        bajas: publicadas,
        cambios: 0,
      });
      expect(resultado.motivos).toHaveLength(publicadas);
      for (const motivo of resultado.motivos)
        expect(motivo).toMatch(/^desapareció 2026-\d{2}-\d{2}$/);
      expect(resultado.motivos).toContain(
        tipo === 158 ? "desapareció 2026-01-02" : "desapareció 2026-01-01",
      );
      expect(resultado.motivos).toContain(
        tipo === 158 ? "desapareció 2026-10-16" : "desapareció 2026-10-25",
      );
    }
  });

  it("un valor publicado que cambia en la fuente pide revisión con el motivo", async () => {
    await ejecutarDataset(tipoCambioFix, ctx());
    fuenteFalsa.set(
      urlSidof(158, 2026),
      await variante("158-2026.json", (r) => {
        const ultimo = r.ListaIndicadores.at(-1) as Indicador;
        ultimo.valor = "18.4251";
      }),
    );
    const { resultado } = await ejecutarDataset(tipoCambioFix, ctx("2026-10-19"));
    expect(resultado).toMatchObject({
      estado: "requiere_revision",
      cambios: 1,
      motivos: ["cambió el valor de 2026-10-16: 18.4250 → 18.4251"],
    });
  });

  it("una publicación que desaparece de la fuente pide revisión con el motivo", async () => {
    await ejecutarDataset(tipoCambioFix, ctx());
    fuenteFalsa.set(
      urlSidof(158, 2026),
      await variante("158-2026.json", (r) => {
        r.ListaIndicadores.pop();
        r.TotalIndicadores = r.ListaIndicadores.length;
      }),
    );
    const { resultado } = await ejecutarDataset(tipoCambioFix, ctx("2026-10-19"));
    expect(resultado).toMatchObject({
      estado: "requiere_revision",
      bajas: 1,
      motivos: ["desapareció 2026-10-16"],
    });
  });

  it("un crudo dañado en disco hace fallar la corrida sin tocar el directorio", async () => {
    await ejecutarDataset(tipoCambioFix, ctx());
    const ruta = join(dirFix(), archivo(158, 2021));
    const danados: [string, Uint8Array][] = [
      ["HTML", texto("<html><body>Error</body></html>")],
      ["un crudo de UDIS con nombre de FIX", fuenteFalsa.get(urlSidof(159, 2021)) as Uint8Array],
      ["el crudo de 2020 con nombre de 2021", await fixture("158-2020.json")],
      ["un año cerrado vacío", respuesta(158, [])],
    ];
    for (const [caso, bytes] of danados) {
      await writeFile(ruta, bytes);
      const antes = await leerDir(dirFix());
      pedidas = [];
      const e = await ejecutarDataset(tipoCambioFix, ctx("2026-10-19")).catch((x) => x);
      expect(e, caso).toBeInstanceOf(ErrorDatos);
      expect(e.message, caso).toContain("2021");
      // El crudo de 2021 se leyó del disco, no se pidió.
      expect(pedidas, caso).toEqual([urlSidof(158, 2026)]);
      expect(await leerDir(dirFix()), caso).toEqual(antes);
    }
  });

  it("una respuesta con forma inesperada hace fallar la corrida sin escribir", async () => {
    await ejecutarDataset(tipoCambioFix, ctx());
    const antes = await leerDir(dirFix());
    const variantes: Uint8Array[] = [
      texto("<!DOCTYPE html><html><body>Servicio no disponible</body></html>"),
      await variante("158-2026.json", (r) => {
        r.messageCode = 500;
      }),
      await variante("158-2026.json", (r) => {
        en(r, 0).valor = "18.00120";
      }),
      await variante("158-2026.json", (r) => {
        en(r, 0).valor = "18.001";
      }),
      await variante("158-2026.json", (r) => {
        en(r, 0).fecha = "31-12-2025";
      }),
      await variante("158-2026.json", (r) => {
        en(r, 1).fecha = en(r, 0).fecha;
      }),
      await variante("158-2026.json", (r) => {
        r.TotalIndicadores = 201;
      }),
    ];
    for (const cuerpo of variantes) {
      fuenteFalsa.set(urlSidof(158, 2026), cuerpo);
      await expect(ejecutarDataset(tipoCambioFix, ctx("2026-10-19"))).rejects.toBeInstanceOf(
        ErrorDatos,
      );
      expect(await leerDir(dirFix())).toEqual(antes);
    }
  });

  it("sin los directorios de fix y udis los datos siguen verificando", async () => {
    expect(await verificarDatos(raiz)).toEqual([]);
    await ejecutarDataset(tipoCambioFix, ctx());
    expect(await readdir(raiz)).toEqual(["tipo-cambio-fix"]);
    expect(await verificarDatos(raiz)).toEqual([]);
  });
});
