import { URL_API } from "@mexicoapi/core/problemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actualizarEstado,
  consultarEstado,
  ErrorEstado,
  ESPERA_MS,
  filasDeEstado,
  hoyEnMexico,
  instalarEstado,
  NOMBRES_STATUS,
  nombresDeDatasets,
  rellenarOrigen,
  resaltarHoy,
} from "../../../src/sitio/cliente/sitio.js";
import { paginaEstado } from "../../../src/sitio/paginas/estado.js";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";

/** `GET /v1/status` tal como lo devuelve el Worker local (sin KV), con el build de `data/`. */
const RESPUESTA_WORKER = {
  data: [
    {
      dataset: "bancos",
      as_of: "2026-10-17",
      records: 150,
      data_sha256: "7c7e54a5e189179fbc56642971cde180b17e73670e519e15b9a232d803cd99bc",
      status: "unknown",
      last_attempt: null,
      last_success: null,
      frescura_horas: 72,
    },
    {
      dataset: "inegi.estados",
      as_of: "2026-10-17",
      records: 32,
      data_sha256: "6a21ed92ea0d892dd37db6b0b724db2bf681febe86eda7f662d87dcc1127d942",
      status: "unknown",
      last_attempt: null,
      last_success: null,
      frescura_horas: 216,
    },
    {
      dataset: "inegi.municipios",
      as_of: "2026-10-17",
      records: 2478,
      data_sha256: "b4801a8ccc5345da84306e6be54e595d147a127f92509a81b7b1161c8c545503",
      status: "unknown",
      last_attempt: null,
      last_success: null,
      frescura_horas: 216,
    },
    {
      dataset: "tipo-cambio.fix",
      as_of: "2026-10-18",
      records: 1710,
      data_sha256: "ed5d51c0b2ecc8cda7ca984a3cae9fbe6f5d9daf989b7cf76863aa7c5b840f13",
      cobertura: { desde: "2020-01-02", hasta: "2026-10-16" },
      status: "unknown",
      last_attempt: null,
      last_success: null,
      frescura_horas: 72,
    },
    {
      dataset: "udis",
      as_of: "2026-10-18",
      records: 2490,
      data_sha256: "7492ef4e5eaef083fb99deb9bb9069a37624a6c3fca8c81285e11471c629d6b4",
      cobertura: { desde: "2020-01-01", hasta: "2026-10-25" },
      status: "unknown",
      last_attempt: null,
      last_success: null,
      frescura_horas: 72,
    },
  ],
};

const AHORA = new Date("2026-10-18T18:00:00.000Z");
const HORA = 3_600_000;
const hace = (ms: number): string => new Date(AHORA.getTime() - ms).toISOString();

/** Una fila de `/v1/status` con lo mínimo; `cambios` la ajusta. */
const fila = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  dataset: "udis",
  as_of: "2026-10-18",
  records: 10,
  data_sha256: "a".repeat(64),
  status: "ok",
  last_attempt: hace(6 * HORA),
  last_success: hace(6 * HORA),
  frescura_horas: 72,
  ...cambios,
});

const sinExito = { ultimoExito: "Ninguna registrada", hace: "", instante: null };

describe("filasDeEstado", () => {
  it("con la respuesta del Worker local, cada dataset sale Sin registro", () => {
    expect(filasDeEstado(RESPUESTA_WORKER, AHORA)).toEqual([
      {
        dataset: "bancos",
        status: "unknown",
        estado: "Sin registro",
        datos: "2026-10-17",
        ...sinExito,
        plazo: "72 h",
        cobertura: "No aplica",
        ultimoDato: null,
      },
      {
        dataset: "inegi.estados",
        status: "unknown",
        estado: "Sin registro",
        datos: "2026-10-17",
        ...sinExito,
        plazo: "216 h",
        cobertura: "No aplica",
        ultimoDato: null,
      },
      {
        dataset: "inegi.municipios",
        status: "unknown",
        estado: "Sin registro",
        datos: "2026-10-17",
        ...sinExito,
        plazo: "216 h",
        cobertura: "No aplica",
        ultimoDato: null,
      },
      {
        dataset: "tipo-cambio.fix",
        status: "unknown",
        estado: "Sin registro",
        datos: "2026-10-18",
        ...sinExito,
        plazo: "72 h",
        cobertura: "2020-01-02 – 2026-10-16",
        ultimoDato: "2026-10-16",
      },
      {
        dataset: "udis",
        status: "unknown",
        estado: "Sin registro",
        datos: "2026-10-18",
        ...sinExito,
        plazo: "72 h",
        cobertura: "2020-01-01 – 2026-10-25",
        ultimoDato: "2026-10-25",
      },
    ]);
  });

  it("dice cada estado en palabras, con el último éxito en hora de la Ciudad de México", () => {
    const cuerpo = {
      data: [
        fila({ dataset: "bancos", status: "ok", last_success: "2026-10-18T12:00:00.000Z" }),
        fila({ dataset: "udis", status: "stale", last_success: null, frescura_horas: 24 }),
        fila({ dataset: "nuevo", status: "unknown", last_attempt: null, last_success: null }),
      ],
    };
    const filas = filasDeEstado(cuerpo, AHORA);
    expect(filas.map((f) => f.estado)).toEqual(["Al día", "Desactualizado", "Sin registro"]);
    expect(filas[0]).toEqual({
      dataset: "bancos",
      status: "ok",
      estado: "Al día",
      datos: "2026-10-18",
      ultimoExito: "18 oct 2026, 6:00 a.m.",
      hace: "hace 6 h",
      instante: "2026-10-18T12:00:00.000Z",
      plazo: "72 h",
      cobertura: "No aplica",
      ultimoDato: null,
    });
    expect(filas[1]).toMatchObject({ ...sinExito, plazo: "24 h" });
    expect(NOMBRES_STATUS).toEqual({
      ok: "Al día",
      stale: "Desactualizado",
      unknown: "Sin registro",
    });
  });

  // La API calcula el estado con su reloj y lo guarda hasta un minuto: la página lo muestra tal cual.
  it("el estado viene del servidor: no se recalcula con las horas que pasaron", () => {
    const ultimo = hace(26 * HORA);
    const [rancio, cacheado] = filasDeEstado(
      {
        data: [
          fila({ status: "stale", last_success: ultimo, frescura_horas: 24 }),
          fila({ status: "ok", last_success: ultimo, frescura_horas: 24 }),
        ],
      },
      AHORA,
    );
    expect(rancio).toMatchObject({ estado: "Desactualizado", hace: "hace 26 h", plazo: "24 h" });
    expect(cacheado).toMatchObject({ estado: "Al día", hace: "hace 26 h" });
  });

  it("cuenta horas completas y no da horas negativas si el reloj del equipo va atrás", () => {
    const horas = (ms: number): string =>
      filasDeEstado({ data: [fila({ last_success: hace(ms) })] }, AHORA)[0]?.hace ?? "";
    expect(horas(59 * 60_000)).toBe("hace menos de 1 h");
    expect(horas(HORA)).toBe("hace 1 h");
    expect(horas(26 * HORA - 1)).toBe("hace 25 h");
    expect(horas(-2 * HORA)).toBe("hace menos de 1 h");
  });

  // El formateador se crea al cargar el módulo: por eso se vuelve a cargar con cada zona.
  it("no depende de la zona horaria del equipo, ni al cargarse ni al formatear", async () => {
    const cuerpo = {
      data: [
        fila({ last_success: "2026-10-18T05:59:00.000Z" }),
        // Con horario de verano, que la Ciudad de México tuvo hasta 2022.
        fila({ last_success: "2021-07-01T12:00:00.000Z" }),
      ],
    };
    const original = process.env.TZ;
    const resultados: string[] = [];
    try {
      for (const zona of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = zona;
        vi.resetModules();
        const modulo = await import("../../../src/sitio/cliente/sitio.js");
        resultados.push(JSON.stringify(modulo.filasDeEstado(cuerpo, AHORA)));
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
      vi.resetModules();
    }
    expect(new Set(resultados).size).toBe(1);
    const filas = JSON.parse(resultados[0] as string) as { ultimoExito: string; hace: string }[];
    expect(filas.map((f) => [f.ultimoExito, f.hace])).toEqual([
      ["17 oct 2026, 11:59 p.m.", "hace 12 h"],
      ["1 jul 2021, 7:00 a.m.", "hace 46446 h"],
    ]);
  });

  it("acepta campos que todavía no conoce y una lista vacía", () => {
    const [f] = filasDeEstado(
      { data: [fila({ nuevo: { x: 1 }, last_attempt: 7 })], extra: 1 },
      AHORA,
    );
    expect(f?.estado).toBe("Al día");
    expect(filasDeEstado({ data: [] }, AHORA)).toEqual([]);
  });

  it.each([
    ["null", null, "(no es un objeto)."],
    ["un texto", "<html>", "(no es un objeto)."],
    ["una lista", [], "(no es un objeto)."],
    ["sin data", {}, "(data no es una lista)."],
    ["data objeto", { data: {} }, "(data no es una lista)."],
    ["fila null", { data: [null] }, "data[0] no es un objeto"],
    ["dataset número", { data: [fila({ dataset: 3 })] }, "data[0].dataset no es un texto"],
    ["dataset vacío", { data: [fila({ dataset: "" })] }, "data[0].dataset no es un texto"],
    ["as_of con otro formato", { data: [fila({ as_of: "18/10/2026" })] }, "data[0].as_of"],
    ["status desconocido", { data: [fila(), fila({ status: "rancio" })] }, "data[1].status"],
    ["sin status", { data: [fila({ status: undefined })] }, "data[0].status"],
    [
      "last_success sin zona",
      { data: [fila({ last_success: "2026-10-18T12:00:00" })] },
      "data[0].last_success",
    ],
    ["last_success texto", { data: [fila({ last_success: "ayer" })] }, "data[0].last_success"],
    ["sin last_success", { data: [fila({ last_success: undefined })] }, "data[0].last_success"],
    ["frescura texto", { data: [fila({ frescura_horas: "72" })] }, "data[0].frescura_horas"],
    ["frescura cero", { data: [fila({ frescura_horas: 0 })] }, "data[0].frescura_horas"],
    ["cobertura null", { data: [fila({ cobertura: null })] }, "data[0].cobertura"],
    [
      "cobertura incompleta",
      { data: [fila({ cobertura: { desde: "2020-01-01" } })] },
      "data[0].cobertura",
    ],
  ])("una forma inesperada (%s) lanza un error en español", (_, cuerpo, donde) => {
    const intento = (): unknown => filasDeEstado(cuerpo, AHORA);
    expect(intento).toThrow(ErrorEstado);
    expect(intento).toThrow(/^la respuesta no tiene la forma esperada \([^:()]+\)\.$/);
    expect(intento).toThrow(donde);
  });
});

describe("rellenarOrigen", () => {
  it("pone el origen como texto de cada [data-origen]", () => {
    const elementos = [{ textContent: URL_API }, { textContent: null as string | null }];
    const selectores: string[] = [];
    const raiz = {
      querySelectorAll(selector: string) {
        selectores.push(selector);
        return elementos;
      },
    };
    rellenarOrigen(raiz, "https://mexicoapi.example");
    expect(selectores).toEqual(["[data-origen]"]);
    expect(elementos.map((e) => e.textContent)).toEqual([
      "https://mexicoapi.example",
      "https://mexicoapi.example",
    ]);
    rellenarOrigen({ querySelectorAll: () => [] }, "https://otro.example");
  });
});

describe("hoyEnMexico", () => {
  it("es el día de la Ciudad de México, no el de UTC", () => {
    // 21:00 del 19 en la Ciudad de México ya es el 20 en UTC.
    expect(hoyEnMexico(new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-19");
    expect(hoyEnMexico(new Date("2026-10-20T06:00:00Z"))).toBe("2026-10-20");
  });
});

describe("resaltarHoy", () => {
  const fila = (fecha: string | undefined) => {
    const atributos: Record<string, string> = {};
    return {
      dataset: { fecha },
      className: "",
      atributos,
      setAttribute(nombre: string, valor: string) {
        atributos[nombre] = valor;
      },
    };
  };

  it("marca solo la fila de hoy y busca las que traen data-fecha", () => {
    const filas = [fila("2026-10-18"), fila("2026-10-19"), fila("2026-10-20"), fila(undefined)];
    const selectores: string[] = [];
    resaltarHoy(
      {
        querySelectorAll(selector: string) {
          selectores.push(selector);
          return filas;
        },
      },
      "2026-10-19",
    );
    expect(selectores).toEqual(["tr[data-fecha]"]);
    expect(filas.map((f) => f.className)).toEqual(["", "hoy", "", ""]);
    expect(filas.map((f) => f.atributos)).toEqual([{}, { "aria-current": "date" }, {}, {}]);
  });

  it("sin la fecha de hoy en la tabla no marca nada", () => {
    const filas = [fila("2026-10-18")];
    resaltarHoy({ querySelectorAll: () => filas }, "2027-01-01");
    expect(filas[0]?.className).toBe("");
  });

  it("el estilo resalta la fila marcada", () => {
    expect(ESTILO).toMatch(/tr.hoy th/);
  });
});

describe("nombresDeDatasets", () => {
  it("lee el mapa de nombres que el HTML trae en data-nombres", () => {
    expect([...nombresDeDatasets('{"udis":"UDIS","bancos":"Bancos"}')]).toEqual([
      ["udis", "UDIS"],
      ["bancos", "Bancos"],
    ]);
  });

  it.each([
    ["sin atributo", undefined],
    ["JSON roto", "{"],
    ["una lista", '["udis"]'],
    ["null", "null"],
  ])("sin un mapa válido (%s) no hay nombres y se muestra el id", (_, texto) => {
    expect(nombresDeDatasets(texto).size).toBe(0);
  });

  it("ignora los nombres que no son texto", () => {
    expect([...nombresDeDatasets('{"udis":3,"bancos":"Bancos"}')]).toEqual([["bancos", "Bancos"]]);
  });
});

/** Respuesta de `fetch` hecha a mano. */
const responder = (cuerpo: string, status = 200, encabezados: Record<string, string> = {}) =>
  new Response(cuerpo, { status, headers: { "content-type": "application/json", ...encabezados } });

interface Pedida {
  url: string;
  init: RequestInit;
}

/** `fetch` falso: registra cada petición y responde con `respuesta`. */
function pedirCon(respuesta: (init: RequestInit) => Promise<Response>) {
  const pedidas: Pedida[] = [];
  const pedir = (url: string, init: RequestInit): Promise<Response> => {
    pedidas.push({ url, init });
    return respuesta(init);
  };
  return { pedir, pedidas };
}

/** Rechaza como `fetch` cuando su señal se corta. */
const hastaQueSeCorte = (init: RequestInit): Promise<Response> =>
  new Promise((_, rechazar) => {
    init.signal?.addEventListener("abort", () => rechazar(init.signal?.reason));
  });

async function motivo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorEstado);
    return (error as Error).message;
  }
  throw new Error("no falló");
}

describe("consultarEstado", () => {
  it("pide /v1/status en JSON con un límite de 10 s y devuelve el cuerpo", async () => {
    const { pedir, pedidas } = pedirCon(async () => responder(JSON.stringify(RESPUESTA_WORKER)));
    expect(await consultarEstado(pedir)).toEqual(RESPUESTA_WORKER);
    expect(ESPERA_MS).toBe(10_000);
    expect(pedidas).toHaveLength(1);
    const [{ url, init }] = pedidas as [Pedida];
    expect(url).toBe("/v1/status");
    expect(init.headers).toEqual({ accept: "application/json" });
    // Actualizar dice "Consultado el <ahora>": la caché del navegador se revalida (con ETag).
    expect(init.cache).toBe("no-cache");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it.each([
    [
      responder("{}", 429, { "retry-after": "30" }),
      "la API respondió 429 (demasiadas consultas seguidas); espera 30 s y vuelve a intentar.",
    ],
    [
      responder("{}", 429),
      "la API respondió 429 (demasiadas consultas seguidas); espera un momento y vuelve a intentar.",
    ],
    [responder("{}", 500), "la API respondió 500 (falla del servidor); intenta más tarde."],
    [responder("{}", 503), "la API respondió 503 (falla del servidor); intenta más tarde."],
    [responder("{}", 404), "la API respondió 404."],
    [responder("<!doctype html><p>Hola</p>", 200), "la respuesta no es JSON."],
  ])("una respuesta que no sirve se explica (%#)", async (respuesta, esperado) => {
    const { pedir } = pedirCon(async () => respuesta);
    expect(await motivo(consultarEstado(pedir))).toBe(esperado);
  });

  it("sin red, lo dice", async () => {
    const { pedir } = pedirCon(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await motivo(consultarEstado(pedir))).toBe(
      "no hubo respuesta de la API; revisa tu conexión.",
    );
  });

  it("un tiempo agotado se explica con los segundos de espera", async () => {
    const { pedir } = pedirCon(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });
    expect(await motivo(consultarEstado(pedir))).toBe("la API no respondió en 10 s.");
  });

  // Navegadores y fetch más viejos rechazan con AbortError aunque la señal sea de tiempo.
  it("un AbortError también es tiempo agotado, no falta de conexión", async () => {
    const { pedir } = pedirCon(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    expect(await motivo(consultarEstado(pedir))).toBe("la API no respondió en 10 s.");
  });

  it("la señal corta la petición cuando se acaba la espera", async () => {
    const { pedir } = pedirCon(hastaQueSeCorte);
    expect(await motivo(consultarEstado(pedir, 20))).toBe("la API no respondió en 0.02 s.");
  });

  // La señal también corta la lectura del cuerpo: eso es tiempo agotado, no JSON roto.
  it("si se acaba la espera a media respuesta, es tiempo agotado", async () => {
    const { pedir } = pedirCon(async (init) => {
      const cuerpo = new ReadableStream<Uint8Array>({
        start(controlador) {
          controlador.enqueue(new TextEncoder().encode('{"data":['));
          init.signal?.addEventListener("abort", () => controlador.error(init.signal?.reason));
        },
      });
      return new Response(cuerpo, { status: 200 });
    });
    expect(await motivo(consultarEstado(pedir, 20))).toBe("la API no respondió en 0.02 s.");
  });
});

/** Un elemento del DOM hecho a mano: guarda hijos, atributos y texto. */
class Nodo {
  textContent: string | null = null;
  className = "";
  hidden: boolean | "until-found" = false;
  readonly atributos = new Map<string, string>();
  readonly hijos: Array<Nodo | string> = [];
  readonly oyentes: Array<() => void> = [];
  constructor(readonly etiqueta: string) {}
  setAttribute(nombre: string, valor: string): void {
    this.atributos.set(nombre, valor);
  }
  append(...hijos: Array<Nodo | string>): void {
    this.hijos.push(...hijos);
  }
  replaceChildren(...hijos: Nodo[]): void {
    this.hijos.splice(0, this.hijos.length, ...hijos);
  }
  addEventListener(_tipo: "click", oyente: () => void): void {
    this.oyentes.push(oyente);
  }
  // Nada entra como HTML.
  set innerHTML(_html: string) {
    throw new Error("innerHTML no se usa");
  }
  /** El texto visible, como lo leería una persona. */
  texto(): string {
    return (
      this.textContent ?? this.hijos.map((h) => (typeof h === "string" ? h : h.texto())).join("")
    );
  }
  /** Este nodo y todos sus descendientes. */
  todos(): Nodo[] {
    return [this, ...this.hijos.flatMap((h) => (typeof h === "string" ? [] : h.todos()))];
  }
}

const NOMBRES = new Map([
  ["bancos", "Bancos y participantes del SPEI"],
  ["udis", "UDIS"],
]);

function crearPagina(opciones: { fallarAlCrear?: boolean } = {}) {
  const creados: Nodo[] = [];
  const pagina = {
    documento: {
      createElement(etiqueta: string): Nodo {
        if (opciones.fallarAlCrear === true) throw new Error("falla del DOM");
        const nodo = new Nodo(etiqueta);
        creados.push(nodo);
        return nodo;
      },
    },
    marco: new Nodo("div"),
    cuerpo: new Nodo("tbody"),
    mensaje: new Nodo("p"),
    boton: new Nodo("button"),
    nombres: NOMBRES,
  };
  pagina.marco.hidden = true;
  pagina.boton.hidden = true;
  return { pagina, creados };
}

const filasDe = (cuerpo: Nodo): Nodo[] => cuerpo.hijos.filter((h): h is Nodo => h instanceof Nodo);

/** El texto de cada celda de cada renglón. */
const celdas = (cuerpo: Nodo): string[][] =>
  filasDe(cuerpo).map((tr) => filasDe(tr).map((celda) => celda.texto()));

const VARIADA = {
  data: [
    fila({ dataset: "bancos", status: "ok", last_success: "2026-10-18T12:00:00.000Z" }),
    fila({
      dataset: "udis",
      status: "stale",
      last_success: hace(80 * HORA),
      cobertura: { desde: "1995-04-04", hasta: "2026-10-25" },
    }),
    fila({ dataset: "<b>nuevo</b>", status: "unknown", last_attempt: null, last_success: null }),
  ],
};

const reloj = (): Date => AHORA;

describe("actualizarEstado", () => {
  it("pinta un renglón por dataset y dice cuándo se consultó", async () => {
    const { pagina } = crearPagina();
    const { pedir } = pedirCon(async () => responder(JSON.stringify(VARIADA)));
    await actualizarEstado(pagina, pedir, reloj);

    expect(pagina.marco.hidden).toBe(false);
    expect(pagina.mensaje.textContent).toBe(
      "Consultado el 18 oct 2026, 12:00 p.m., hora de la Ciudad de México.",
    );
    expect(pagina.mensaje.className).toBe("mensaje");
    expect(celdas(pagina.cuerpo)).toEqual([
      [
        "Bancos y participantes del SPEIbancos",
        "Al día",
        "2026-10-18",
        "18 oct 2026, 6:00 a.m.hace 6 h",
        "72 h",
        "No aplica",
      ],
      [
        "UDISudis",
        "Desactualizado",
        "2026-10-18último dato 2026-10-25",
        "15 oct 2026, 4:00 a.m.hace 80 h",
        "72 h",
        "1995-04-04 – 2026-10-25",
      ],
      // Un dataset que el catálogo no conoce sale con su id, como texto.
      ["<b>nuevo</b>", "Sin registro", "2026-10-18", "Ninguna registrada", "72 h", "No aplica"],
    ]);
  });

  it("marca cada celda para la tabla: encabezado de renglón, fechas y clases que existen", async () => {
    const { pagina } = crearPagina();
    const { pedir } = pedirCon(async () => responder(JSON.stringify(VARIADA)));
    await actualizarEstado(pagina, pedir, reloj);

    const [bancos, , nuevo] = filasDe(pagina.cuerpo) as [Nodo, Nodo, Nodo];
    expect(bancos.etiqueta).toBe("tr");
    const [encabezado, estado, datos, exito, plazo] = filasDe(bancos) as Nodo[];
    expect(encabezado?.etiqueta).toBe("th");
    expect(encabezado?.atributos.get("scope")).toBe("row");
    expect(filasDe(encabezado as Nodo).map((n) => [n.className, n.texto()])).toEqual([
      ["id", "bancos"],
    ]);
    expect(filasDe(estado as Nodo).map((n) => [n.className, n.texto()])).toEqual([
      ["estado estado-ok", "Al día"],
    ]);
    const [fecha] = filasDe(datos as Nodo);
    expect([fecha?.etiqueta, fecha?.atributos.get("datetime")]).toEqual(["time", "2026-10-18"]);
    const [cuando, cuanto] = filasDe(exito as Nodo);
    expect([cuando?.etiqueta, cuando?.atributos.get("datetime")]).toEqual([
      "time",
      "2026-10-18T12:00:00.000Z",
    ]);
    expect(cuanto?.className).toBe("detalle");
    expect(plazo?.className).toBe("num");
    expect(filasDe(nuevo)[0]?.hijos).toEqual(["<b>nuevo</b>"]);

    // En modo tarjeta (display: block) WebKit quita la semántica de tabla: los roles la fijan.
    for (const tr of filasDe(pagina.cuerpo)) {
      expect(tr.atributos.get("role")).toBe("row");
      const [th, ...tds] = filasDe(tr);
      expect(th?.atributos.get("role")).toBe("rowheader");
      expect(tds).toHaveLength(5);
      for (const td of tds) expect([td.etiqueta, td.atributos.get("role")]).toEqual(["td", "cell"]);
    }

    const clases = new Set(
      filasDe(pagina.cuerpo)
        .flatMap((tr) => tr.todos())
        .flatMap((n) => n.className.split(" "))
        .filter((c) => c !== ""),
    );
    expect([...clases].sort()).toEqual(
      [
        "detalle",
        "estado",
        "estado-ok",
        "estado-stale",
        "estado-unknown",
        "id",
        "junto",
        "num",
      ].sort(),
    );
    for (const clase of [...clases, "mensaje", "aviso"]) {
      expect(ESTILO, clase).toMatch(new RegExp(`\\.${clase}\\b`));
    }
  });

  // Debajo de 640 px la tabla es de tarjetas: cada celda lleva el nombre de su columna, que es el
  // de la cabecera de /estado/.
  it("cada celda lleva la etiqueta de su columna y las series, su último dato", async () => {
    const { pagina } = crearPagina();
    const { pedir } = pedirCon(async () => responder(JSON.stringify(VARIADA)));
    await actualizarEstado(pagina, pedir, reloj);
    const cabecera = [...paginaEstado().matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)]
      .map((m) => m[1])
      .slice(1);
    for (const tr of filasDe(pagina.cuerpo)) {
      const [encabezado, ...resto] = filasDe(tr);
      expect(encabezado?.atributos.has("data-etiqueta")).toBe(false);
      expect(resto.map((td) => td.atributos.get("data-etiqueta"))).toEqual(cabecera);
    }
    const [bancos, udis] = filasDe(pagina.cuerpo) as [Nodo, Nodo];
    const datosDe = (tr: Nodo) => filasDe(tr)[2] as Nodo;
    expect(filasDe(datosDe(bancos))).toHaveLength(1);
    const [fecha, ultimo] = filasDe(datosDe(udis));
    expect(fecha?.atributos.get("datetime")).toBe("2026-10-18");
    expect(ultimo?.className).toBe("detalle");
    expect(ultimo?.hijos[0]).toBe("último dato ");
    const [tiempo] = filasDe(ultimo as Nodo);
    expect([tiempo?.etiqueta, tiempo?.atributos.get("datetime"), tiempo?.texto()]).toEqual([
      "time",
      "2026-10-25",
      "2026-10-25",
    ]);
  });

  it("mientras consulta lo dice, y al terminar ya no", async () => {
    const { pagina } = crearPagina();
    let responderYa: (r: Response) => void = () => {};
    const { pedir } = pedirCon(
      () =>
        new Promise<Response>((resolver) => {
          responderYa = resolver;
        }),
    );
    const enCurso = actualizarEstado(pagina, pedir, reloj);
    expect(pagina.mensaje.textContent).toBe("Consultando el estado…");
    responderYa(responder(JSON.stringify(RESPUESTA_WORKER)));
    await enCurso;
    expect(pagina.mensaje.textContent).toMatch(/^Consultado el /);
    expect(filasDe(pagina.cuerpo)).toHaveLength(5);
  });

  it.each([
    [
      "429",
      async () => responder("{}", 429, { "retry-after": "60" }),
      "No se pudo consultar el estado: la API respondió 429 (demasiadas consultas seguidas); espera 60 s y vuelve a intentar.",
    ],
    [
      "500",
      async () => responder("{}", 500),
      "No se pudo consultar el estado: la API respondió 500 (falla del servidor); intenta más tarde.",
    ],
    [
      "HTML",
      async () => responder("<!doctype html>", 200, { "content-type": "text/html" }),
      "No se pudo consultar el estado: la respuesta no es JSON.",
    ],
    [
      "otra forma",
      async () => responder('{"datos":[]}'),
      "No se pudo consultar el estado: la respuesta no tiene la forma esperada (data no es una lista).",
    ],
    [
      "sin red",
      async () => {
        throw new TypeError("Failed to fetch");
      },
      "No se pudo consultar el estado: no hubo respuesta de la API; revisa tu conexión.",
    ],
    [
      "tiempo",
      async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      },
      "No se pudo consultar el estado: la API no respondió en 10 s.",
    ],
  ])(
    "si falla (%s), lo explica, quita la tabla y no se queda consultando",
    async (_, respuesta, esperado) => {
      const { pagina } = crearPagina();
      let primera = true;
      const { pedir } = pedirCon(async () => {
        if (!primera) return respuesta();
        primera = false;
        return responder(JSON.stringify(VARIADA));
      });
      await actualizarEstado(pagina, pedir, reloj);
      expect(filasDe(pagina.cuerpo)).toHaveLength(3);

      await actualizarEstado(pagina, pedir, reloj);
      expect(pagina.mensaje.textContent).toBe(esperado);
      expect(pagina.mensaje.className).toBe("mensaje aviso");
      expect(pagina.marco.hidden).toBe(true);
      expect(filasDe(pagina.cuerpo)).toEqual([]);
    },
  );

  it("una falla de la página misma también termina con un mensaje", async () => {
    const { pagina } = crearPagina({ fallarAlCrear: true });
    const { pedir } = pedirCon(async () => responder(JSON.stringify(VARIADA)));
    await actualizarEstado(pagina, pedir, reloj);
    expect(pagina.mensaje.textContent).toBe(
      "No se pudo consultar el estado: falla inesperada de la página.",
    );
    expect(pagina.marco.hidden).toBe(true);
  });

  it("si la API no trae datasets, lo dice y no muestra una tabla vacía", async () => {
    const { pagina } = crearPagina();
    const { pedir } = pedirCon(async () => responder('{"data":[]}'));
    await actualizarEstado(pagina, pedir, reloj);
    expect(pagina.mensaje.textContent).toBe("La API no reporta datasets automáticos.");
    expect(pagina.marco.hidden).toBe(true);
  });
});

describe("instalarEstado", () => {
  it("muestra el botón Actualizar, consulta al cargar y otra vez con cada clic", async () => {
    const { pagina } = crearPagina();
    const { pedir, pedidas } = pedirCon(async () => responder(JSON.stringify(RESPUESTA_WORKER)));
    await instalarEstado(pagina, pedir, reloj);
    expect(pagina.boton.hidden).toBe(false);
    expect(pedidas).toHaveLength(1);
    expect(pagina.boton.oyentes).toHaveLength(1);

    pagina.boton.oyentes[0]?.();
    await vi.waitFor(() => expect(pedidas).toHaveLength(2));
    await vi.waitFor(() => expect(pagina.mensaje.textContent).toMatch(/^Consultado el /));
  });

  it("un clic mientras consulta no pide otra vez", async () => {
    const { pagina } = crearPagina();
    let responderYa: (r: Response) => void = () => {};
    const { pedir, pedidas } = pedirCon(
      () =>
        new Promise<Response>((resolver) => {
          responderYa = resolver;
        }),
    );
    const primera = instalarEstado(pagina, pedir, reloj);
    pagina.boton.oyentes[0]?.();
    pagina.boton.oyentes[0]?.();
    expect(pedidas).toHaveLength(1);
    responderYa(responder(JSON.stringify(RESPUESTA_WORKER)));
    await primera;
    pagina.boton.oyentes[0]?.();
    expect(pedidas).toHaveLength(2);
  });
});

/** Un `document` hecho a mano con la página de estado, o sin ella. */
function documentoFalso(conEstado: boolean) {
  const ejemplos = [new Nodo("span"), new Nodo("span")];
  // Lo que trae el HTML generado: la API pública (ver paginas/inicio.ts).
  for (const e of ejemplos) e.textContent = URL_API;
  const { pagina } = crearPagina();
  const cuerpo = Object.assign(pagina.cuerpo, {
    dataset: { nombres: JSON.stringify(Object.fromEntries(NOMBRES)) },
  });
  const porId: Record<string, Nodo> = conEstado
    ? {
        "marco-estado": pagina.marco,
        "filas-estado": cuerpo,
        "mensaje-estado": pagina.mensaje,
        "actualizar-estado": pagina.boton,
      }
    : {};
  const documento = {
    querySelectorAll: (selector: string) => (selector === "[data-origen]" ? ejemplos : []),
    getElementById: (id: string) => porId[id] ?? null,
    createElement: (etiqueta: string) => new Nodo(etiqueta),
  };
  return { documento, ejemplos, pagina };
}

describe("al cargarse en el navegador", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function cargar(origen: string, conEstado: boolean) {
    const falso = documentoFalso(conEstado);
    const { pedir, pedidas } = pedirCon(async () => responder(JSON.stringify(VARIADA)));
    vi.stubGlobal("document", falso.documento);
    vi.stubGlobal("location", { origin: origen });
    vi.stubGlobal("fetch", pedir);
    vi.resetModules();
    await import("../../../src/sitio/cliente/sitio.js");
    return { ...falso, pedidas };
  }

  it("cambia la API pública por el origen y en /estado/ pinta la tabla", async () => {
    const { ejemplos, pagina, pedidas } = await cargar("https://mexicoapi.example", true);
    expect(ejemplos.map((e) => e.textContent)).toEqual([
      "https://mexicoapi.example",
      "https://mexicoapi.example",
    ]);
    await vi.waitFor(() => expect(pagina.mensaje.textContent).toMatch(/^Consultado el /));
    expect(pedidas.map((p) => p.url)).toEqual(["/v1/status"]);
    expect(pagina.boton.hidden).toBe(false);
    // Los nombres salen del data-nombres del HTML.
    expect(celdas(pagina.cuerpo).map((c) => c[0])).toEqual([
      "Bancos y participantes del SPEIbancos",
      "UDISudis",
      "<b>nuevo</b>",
    ]);
  });

  it("en otra página solo cambia el origen y no consulta nada", async () => {
    const { ejemplos, pedidas } = await cargar("http://127.0.0.1:8787", false);
    expect(ejemplos[0]?.textContent).toBe("http://127.0.0.1:8787");
    expect(pedidas).toEqual([]);
  });

  // Abierta desde un archivo, location.origin es "null": el ejemplo se queda como estaba.
  it("sin un origen http deja el ejemplo como está", async () => {
    const { ejemplos } = await cargar("null", false);
    expect(ejemplos[0]?.textContent).toBe(URL_API);
  });

  it("sin document (en Node) no hace nada al importarse", async () => {
    const { pedir, pedidas } = pedirCon(async () => responder("{}"));
    vi.stubGlobal("fetch", pedir);
    vi.resetModules();
    await import("../../../src/sitio/cliente/sitio.js");
    expect(pedidas).toEqual([]);
  });
});
