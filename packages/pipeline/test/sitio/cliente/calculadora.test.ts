// La calculadora de /calculadora-dias-habiles/: arma la consulta a /v1/dias-habiles del mismo
// origen y muestra lo que responde, siempre con textContent.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consultarDiasHabiles,
  instalarCalculadora,
  nodosDelResultado,
  urlDiasHabiles,
} from "../../../src/sitio/cliente/sitio.js";

describe("urlDiasHabiles", () => {
  it("arma la URL en orden y sin tipo_plazo fuera del SAT", () => {
    expect(
      urlDiasHabiles({
        autoridad: "lft",
        tipoPlazo: "general",
        desde: "2026-12-18",
        dias: "3",
        permitirIncompleto: false,
      }),
    ).toBe("/v1/dias-habiles?autoridad=lft&desde=2026-12-18&dias=3");
  });

  it("con SAT manda tipo_plazo, y permitir_incompleto solo si se marca", () => {
    expect(
      urlDiasHabiles({
        autoridad: "sat",
        tipoPlazo: "declaraciones_pagos",
        desde: "2026-07-17",
        dias: "3",
        permitirIncompleto: true,
      }),
    ).toBe(
      "/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-07-17&dias=3&permitir_incompleto=true",
    );
  });

  it("codifica lo que escribe la persona", () => {
    const url = urlDiasHabiles({
      autoridad: "cnbv",
      tipoPlazo: "general",
      desde: "2026-01-01&x=1",
      dias: "3 #",
      permitirIncompleto: false,
    });
    expect(url).toBe("/v1/dias-habiles?autoridad=cnbv&desde=2026-01-01%26x%3D1&dias=3%20%23");
  });
});

const CUERPO = {
  data: {
    autoridad: "lft",
    desde: "2026-12-23",
    dias: 3,
    resultado: "2026-12-29",
    inhabiles_saltados: [{ fecha: "2026-12-25", motivo: "25 de diciembre", tipo: "descanso" }],
    advertencias: ["<b>x</b>"],
    avisos: [{ codigo: "lft-art-715", texto: "Solo descuenta sábados <img src=x onerror=1>" }],
  },
  meta: {
    dataset: "dias-inhabiles.lft",
    as_of: "2026-05-14",
    sources: [{ name: "Ley Federal del Trabajo", citation: "LFT, artículo 74." }],
  },
};

class Nodo {
  textContent: string | null = "";
  className = "";
  hijos: Array<Nodo | string> = [];
  constructor(readonly etiqueta: string) {}
  setAttribute() {}
  append(...hijos: Array<Nodo | string>) {
    this.hijos.push(...hijos);
  }
  replaceChildren(...hijos: Nodo[]) {
    this.hijos = hijos;
  }
  /** Todo el texto de los descendientes, en orden. */
  get texto(): string {
    return [this.textContent ?? "", ...this.hijos.map((h) => (typeof h === "string" ? h : h.texto))]
      .filter((t) => t !== "")
      .join(" | ");
  }
}

type Oyente = (e: { preventDefault(): void }) => void;
class Campo extends Nodo {
  value = "";
  checked = false;
  hidden = true;
  oyentes = new Map<string, Oyente>();
  constructor() {
    super("campo");
  }
  addEventListener(tipo: string, oyente: Oyente) {
    this.oyentes.set(tipo, oyente);
  }
}

function pagina() {
  const p = {
    documento: { createElement: (etiqueta: string) => new Nodo(etiqueta) },
    formulario: new Campo(),
    autoridad: new Campo(),
    campoTipo: new Campo(),
    tipoPlazo: new Campo(),
    desde: new Campo(),
    dias: new Campo(),
    incompleto: new Campo(),
    resultado: new Campo(),
  };
  p.autoridad.value = "lft";
  p.tipoPlazo.value = "general";
  p.desde.value = "2026-12-23";
  p.dias.value = "3";
  return p;
}

const enviar = async (p: ReturnType<typeof pagina>) => {
  p.formulario.oyentes.get("submit")?.({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 0));
};

describe("consultarDiasHabiles", () => {
  const params = {
    autoridad: "lft",
    tipoPlazo: "general",
    desde: "2026-12-23",
    dias: "3",
    permitirIncompleto: false,
  };

  it("pide la URL del mismo origen y devuelve el cuerpo", async () => {
    const pedidas: string[] = [];
    const r = await consultarDiasHabiles(async (url) => {
      pedidas.push(url);
      return new Response(JSON.stringify(CUERPO), { status: 200 });
    }, params);
    expect(pedidas).toEqual(["/v1/dias-habiles?autoridad=lft&desde=2026-12-23&dias=3"]);
    expect(r).toEqual({ tipo: "ok", cuerpo: CUERPO });
  });

  it("devuelve el detail de un problem+json", async () => {
    const r = await consultarDiasHabiles(
      async () =>
        new Response(JSON.stringify({ status: 422, detail: "El calendario no cubre 2101." }), {
          status: 422,
          headers: { "content-type": "application/problem+json" },
        }),
      params,
    );
    expect(r).toEqual({ tipo: "problema", mensaje: "El calendario no cubre 2101." });
  });

  it.each([
    ["no hay red", async () => Promise.reject(new TypeError("red")), /no hubo respuesta/],
    [
      "se agota el tiempo",
      async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })),
      /no respondió/,
    ],
    ["un 500 sin JSON", async () => new Response("<html>", { status: 500 }), /500/],
    ["un 200 que no es JSON", async () => new Response("<html>", { status: 200 }), /no es JSON/],
    ["un 200 sin la forma", async () => new Response("{}", { status: 200 }), /forma/],
  ])("si %s, da una falla legible", async (_, pedir, patron) => {
    const r = await consultarDiasHabiles(pedir, params);
    expect(r.tipo).toBe("falla");
    expect(r.tipo === "falla" ? r.mensaje : "").toMatch(patron);
  });
});

describe("instalarCalculadora", () => {
  it("muestra el formulario y el tipo de plazo solo con SAT", () => {
    const p = pagina();
    instalarCalculadora(p, async () => new Response("{}"));
    expect(p.formulario.hidden).toBe(false);
    expect(p.campoTipo.hidden).toBe(true);
    p.autoridad.value = "sat";
    p.autoridad.oyentes.get("change")?.({ preventDefault() {} });
    expect(p.campoTipo.hidden).toBe(false);
    p.autoridad.value = "cnbv";
    p.autoridad.oyentes.get("change")?.({ preventDefault() {} });
    expect(p.campoTipo.hidden).toBe(true);
  });

  it("pide la URL del formulario y muestra resultado, saltados, avisos y cita", async () => {
    const p = pagina();
    const pedidas: string[] = [];
    instalarCalculadora(p, async (url) => {
      pedidas.push(url);
      return new Response(JSON.stringify(CUERPO), { status: 200 });
    });
    await enviar(p);
    expect(pedidas).toEqual(["/v1/dias-habiles?autoridad=lft&desde=2026-12-23&dias=3"]);
    const texto = p.resultado.texto;
    expect(texto).toContain("2026-12-29");
    expect(texto).toContain("2026-12-25");
    expect(texto).toContain("25 de diciembre");
    expect(texto).toContain("Solo descuenta sábados <img src=x onerror=1>");
    expect(texto).toContain("LFT, artículo 74.");
    expect(p.resultado.className).toBe("ok");
  });

  it("dice cuando no se saltó ningún día", async () => {
    const p = pagina();
    const cuerpo = structuredClone(CUERPO);
    cuerpo.data.inhabiles_saltados = [];
    instalarCalculadora(p, async () => new Response(JSON.stringify(cuerpo)));
    await enviar(p);
    expect(p.resultado.texto).toMatch(/No se saltó ningún día de la lista/);
  });

  it("muestra el detail de un problema", async () => {
    const p = pagina();
    instalarCalculadora(
      p,
      async () =>
        new Response(JSON.stringify({ detail: "El parámetro dias debe ser un entero." }), {
          status: 400,
        }),
    );
    await enviar(p);
    expect(p.resultado.texto).toContain("El parámetro dias debe ser un entero.");
    expect(p.resultado.className).toBe("mal");
  });

  it("si falla la red, lo dice", async () => {
    const p = pagina();
    instalarCalculadora(p, async () => Promise.reject(new TypeError("red")));
    await enviar(p);
    expect(p.resultado.texto).toMatch(/no hubo respuesta de la API/);
    expect(p.resultado.className).toBe("mal");
  });

  it("sin fecha o sin días no consulta", async () => {
    const p = pagina();
    p.desde.value = "";
    let llamadas = 0;
    instalarCalculadora(p, async () => {
      llamadas++;
      return new Response("{}");
    });
    await enviar(p);
    expect(llamadas).toBe(0);
    expect(p.resultado.texto).toMatch(/fecha/);
  });
});

describe("nodosDelResultado", () => {
  const documento = { createElement: (etiqueta: string) => new Nodo(etiqueta) };
  const texto = (cuerpo: unknown) =>
    nodosDelResultado(documento, cuerpo)
      .map((n) => n.texto)
      .join(" | ");

  it("tolera una respuesta sin saltados, avisos ni fuentes", () => {
    const t = texto({ data: { resultado: "2026-12-29" } });
    expect(t).toContain("2026-12-29");
    expect(t).toMatch(/No se saltó ningún día/);
    expect(t).not.toMatch(/Avisos|Fuente/);
  });

  it("muestra un saltado sin tipo y una fuente sin cita con su nombre", () => {
    const t = texto({
      data: { resultado: "2026-12-29", inhabiles_saltados: [{ fecha: "2026-12-25", motivo: "M" }] },
      meta: { sources: [{ name: "Solo nombre" }] },
    });
    expect(t).toContain("2026-12-25: M");
    expect(t).not.toContain("(");
    expect(t).toContain("Solo nombre");
  });
});

describe("consultarDiasHabiles con problemas sin detail", () => {
  it("usa el motivo del estado HTTP", async () => {
    const r = await consultarDiasHabiles(
      async () => new Response(JSON.stringify({ title: "x" }), { status: 429 }),
      {
        autoridad: "lft",
        tipoPlazo: "",
        desde: "2026-01-01",
        dias: "1",
        permitirIncompleto: false,
      },
    );
    expect(r).toMatchObject({ tipo: "falla", mensaje: expect.stringMatching(/429/) });
  });
});

describe("al cargarse en /calculadora-dias-habiles/", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("muestra el formulario y consulta la API; en otra página no hace nada", async () => {
    const p = pagina();
    const porId: Record<string, unknown> = {
      "form-dias": p.formulario,
      "dias-autoridad": p.autoridad,
      "campo-tipo-plazo": p.campoTipo,
      "dias-tipo-plazo": p.tipoPlazo,
      "dias-desde": p.desde,
      "dias-dias": p.dias,
      "dias-incompleto": p.incompleto,
      "resultado-dias": p.resultado,
    };
    const pedidas: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      pedidas.push(url);
      return new Response(JSON.stringify(CUERPO), { status: 200 });
    });
    vi.stubGlobal("location", { origin: "null" });
    vi.stubGlobal("document", {
      querySelectorAll: () => [],
      getElementById: (id: string) => porId[id] ?? null,
      createElement: (etiqueta: string) => new Nodo(etiqueta),
    });
    vi.resetModules();
    await import("../../../src/sitio/cliente/sitio.js");
    expect(p.formulario.hidden).toBe(false);
    await enviar(p);
    expect(pedidas).toEqual(["/v1/dias-habiles?autoridad=lft&desde=2026-12-23&dias=3"]);

    pedidas.length = 0;
    vi.stubGlobal("document", { querySelectorAll: () => [], getElementById: () => null });
    vi.resetModules();
    await import("../../../src/sitio/cliente/sitio.js");
    expect(pedidas).toEqual([]);
  });
});
