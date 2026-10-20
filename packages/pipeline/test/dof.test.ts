// El vigía del DOF lee el índice del SIDOF de un día y avisa cuando un título coincide con una de
// las capturas pendientes de data/curado/. No captura nada. El fixture es el índice real del
// 2025-12-17 (el día de la Sexta Resolución de Modificaciones a la RMF 2025), recortado a 10 notas.
import { describe, expect, it } from "vitest";
import { type Entorno, principal } from "../src/cli.js";
import {
  CAPTURAS_PENDIENTES,
  HOST_SIDOF,
  interpretarIndiceDof,
  type NotaDof,
  publicacionesPorCapturar,
  urlIndiceDof,
} from "../src/dof.js";
import { ErrorDatos } from "../src/errores.js";
import { crearCliente } from "../src/http.js";
import { leerFixture } from "./ayudas.js";

const FECHA = "2025-12-17";
const URL_INDICE = "https://sidof.segob.gob.mx/dof/sidof/notas/17-12-2025";
const texto = (s: string) => new TextEncoder().encode(s);
const fixture = () => leerFixture("sidof/notas-17-12-2025.json");

interface Indice {
  NotasMatutinas: Record<string, unknown>[];
  NotasVespertinas: Record<string, unknown>[];
  NotasExtraordinarias: Record<string, unknown>[];
  [otro: string]: unknown;
}

/** El fixture como objeto, para armar variantes. */
async function indice(): Promise<Indice> {
  return JSON.parse(new TextDecoder().decode(await fixture())) as Indice;
}

const enBytes = (i: unknown) => texto(JSON.stringify(i));
const nota = (codNota: number, titulo: string) => ({ codNota, titulo, fecha: "17-12-2025" });
const notas = (...titulos: string[]): NotaDof[] =>
  titulos.map((titulo, i) => ({ codigo: String(5_800_000 + i), titulo, edicion: "matutina" }));

describe("urlIndiceDof", () => {
  it("arma la URL del índice del día con la fecha DD-MM-AAAA", () => {
    expect(urlIndiceDof(FECHA)).toBe(URL_INDICE);
    expect(urlIndiceDof("2026-01-09")).toBe(
      "https://sidof.segob.gob.mx/dof/sidof/notas/09-01-2026",
    );
    expect(new URL(urlIndiceDof(FECHA)).host).toBe(HOST_SIDOF);
  });
});

describe("interpretarIndiceDof", () => {
  it("lee las notas con título de las tres ediciones y salta los encabezados sin título", async () => {
    const leidas = interpretarIndiceDof(await fixture(), FECHA);
    expect(leidas).toHaveLength(6);
    expect(leidas[0]).toEqual({
      codigo: "5776437",
      titulo:
        "Decreto por el que se reforman y adicionan diversas disposiciones de la Ley de Ascensos de la Armada de México.",
      edicion: "matutina",
    });
    expect(leidas.map((n) => n.codigo)).toEqual([
      "5776437",
      "5776445",
      "5776447",
      "5776456",
      "5776460",
      "5776489",
    ]);
  });

  it("toma también la edición vespertina y la extraordinaria, en ese orden", async () => {
    const i = await indice();
    i.NotasVespertinas = [nota(5800157, "Segunda Resolución de Modificaciones")];
    i.NotasExtraordinarias = [nota(5800300, "Edición extraordinaria")];
    const leidas = interpretarIndiceDof(enBytes(i), FECHA);
    expect(leidas.slice(-2)).toEqual([
      { codigo: "5800157", titulo: "Segunda Resolución de Modificaciones", edicion: "vespertina" },
      { codigo: "5800300", titulo: "Edición extraordinaria", edicion: "extraordinaria" },
    ]);
  });

  it("un día sin notas no tiene nada que revisar", async () => {
    const i = await indice();
    i.NotasMatutinas = [];
    expect(interpretarIndiceDof(enBytes(i), FECHA)).toEqual([]);
    // El SIDOF responde así a un rango sin publicaciones en la consulta de indicadores.
    expect(
      interpretarIndiceDof(texto('{"messageCode":404,"response":"NOT_FOUND"}'), FECHA),
    ).toEqual([]);
  });

  it("una nota repetida en dos ediciones cuenta una vez", async () => {
    const i = await indice();
    i.NotasVespertinas = [nota(5776445, "Otra vez la misma")];
    const leidas = interpretarIndiceDof(enBytes(i), FECHA);
    expect(leidas.filter((n) => n.codigo === "5776445")).toHaveLength(1);
  });

  it("una forma inesperada es un error que dice qué falló", async () => {
    const casos: [string, (i: Indice) => unknown, RegExp][] = [
      ["no es JSON", () => "{", /no es JSON válido/],
      ["arreglo", () => [], /no tiene la forma esperada: \(raíz\)/],
      ["messageCode", (i) => ({ ...i, messageCode: 500 }), /messageCode/],
      ["response", (i) => ({ ...i, response: "ERROR" }), /response/],
      ["sin vespertinas", ({ NotasVespertinas: _, ...resto }) => resto, /NotasVespertinas/],
      [
        "codNota no entero",
        (i) => ({ ...i, NotasMatutinas: [{ codNota: "5776445", titulo: "x" }] }),
        /NotasMatutinas\.0\.codNota/,
      ],
      [
        "titulo no texto",
        (i) => ({ ...i, NotasMatutinas: [{ codNota: 5776445, titulo: 7 }] }),
        /NotasMatutinas\.0\.titulo/,
      ],
      ["404 con otro cuerpo", () => ({ messageCode: 404, response: "OTRO" }), /messageCode/],
    ];
    for (const [nombre, armar, mensaje] of casos) {
      const valor = armar(await indice());
      const bytes = typeof valor === "string" ? texto(valor) : enBytes(valor);
      let error: unknown;
      try {
        interpretarIndiceDof(bytes, FECHA);
      } catch (e) {
        error = e;
      }
      expect(error, nombre).toBeInstanceOf(ErrorDatos);
      expect((error as ErrorDatos).message, nombre).toMatch(/índice del SIDOF del 2025-12-17/);
      expect((error as ErrorDatos).message, nombre).toMatch(mensaje);
    }
  });
});

describe("publicacionesPorCapturar", () => {
  it("en el índice real encuentra solo la Sexta Resolución de Modificaciones a la RMF 2025", async () => {
    const lista = publicacionesPorCapturar(interpretarIndiceDof(await fixture(), FECHA), FECHA);
    expect(lista).toEqual([
      {
        codigo: "5776445",
        titulo: "Publicación en el DOF: 5776445 (modificaciones-rmf)",
        publicacion:
          "Sexta Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2025 y anexos 1 y 1-A.",
        edicion: "matutina",
        fecha: FECHA,
        url: "https://sidof.segob.gob.mx/notas/docFuente/5776445",
        capturas: ["modificaciones-rmf", "rmf"],
        archivos: ["data/curado/dias-inhabiles-sat.yaml", "data/curado/isr-tarifas.yaml"],
      },
    ]);
  });

  it("reconoce cada captura pendiente con títulos como los que publica el DOF", () => {
    const titulos: [string, string[]][] = [
      [
        "Resolución Miscelánea Fiscal para 2027 y sus anexos 1, 1-A, 3, 7, 8, 11, 14, 15, 16, 16-A, 17, 23, 26, 27, 30, 31 y 32.",
        ["rmf"],
      ],
      [
        "Disposiciones de carácter general que señalan los días del año 2027 en que las entidades financieras sujetas a la supervisión de la Comisión Nacional Bancaria y de Valores, deberán cerrar sus puertas y suspender operaciones.",
        ["cnbv"],
      ],
      [
        "Resolución del H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos que fija los salarios mínimos generales y profesionales que habrán de regir a partir del 1 de enero de 2027.",
        ["salario-minimo"],
      ],
      ["Unidad de medida y actualización.", ["uma"]],
      ["Anexo 8 de la Resolución Miscelánea Fiscal para 2027.", ["rmf", "anexo-8"]],
    ];
    for (const [titulo, claves] of titulos) {
      const [p] = publicacionesPorCapturar(notas(titulo), FECHA);
      expect(p?.capturas, titulo).toEqual(claves);
    }
    // Cada captura pendiente tiene al menos un título de ejemplo.
    const vistas = new Set(titulos.flatMap(([, c]) => c));
    vistas.add("modificaciones-rmf");
    expect([...vistas].sort()).toEqual(CAPTURAS_PENDIENTES.map((c) => c.clave).sort());
  });

  it("no distingue mayúsculas, acentos ni espacios repetidos", () => {
    const lista = publicacionesPorCapturar(
      notas("UNIDAD DE MEDIDA Y ACTUALIZACION", "Comisión de los salarios   minimos"),
      FECHA,
    );
    expect(lista.map((p) => p.capturas)).toEqual([["uma"], ["salario-minimo"]]);
  });

  it("solo cuenta palabras completas: el Anexo 80 no es el Anexo 8", () => {
    expect(publicacionesPorCapturar(notas("Anexo 80 de otra cosa", "Anexo 8."), FECHA)).toEqual([
      expect.objectContaining({ codigo: "5800001", capturas: ["anexo-8"] }),
    ]);
    expect(publicacionesPorCapturar(notas("Los Anexo 8a"), FECHA)).toEqual([]);
  });

  it("el título del issue es estable y la publicación queda en una línea sin acentos graves", () => {
    const [p] = publicacionesPorCapturar(
      [
        {
          codigo: "5800157",
          titulo:
            "Segunda  Resolución de Modificaciones a la\nResolución Miscelánea Fiscal `para` 2026\u2028y Anexo 2.",
          edicion: "vespertina",
        },
      ],
      FECHA,
    );
    expect(p?.titulo).toBe("Publicación en el DOF: 5800157 (modificaciones-rmf)");
    expect(p?.publicacion).toBe(
      "Segunda Resolución de Modificaciones a la Resolución Miscelánea Fiscal 'para' 2026 y Anexo 2.",
    );
    expect(p?.edicion).toBe("vespertina");
  });

  it("recorta una publicación muy larga", () => {
    const [p] = publicacionesPorCapturar(
      notas(`Unidad de Medida y Actualización ${"x".repeat(2000)}`),
      FECHA,
    );
    expect(p?.publicacion).toHaveLength(500);
    expect(p?.publicacion.endsWith("…")).toBe(true);
  });
});

/** Entorno con un fetch falso para el SIDOF: robots.txt da 404 (todo permitido). */
function entornoDof(responder: (url: string) => Response | Promise<Response>, ahora?: Date) {
  const pedidas: string[] = [];
  const salida: string[] = [];
  const errores: string[] = [];
  const intervalos: number[] = [];
  const fetchFalso = (async (entrada: string) => {
    const url = String(entrada);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    pedidas.push(url);
    return responder(url);
  }) as unknown as typeof fetch;
  const entorno: Entorno = {
    crearCliente: (ms) => {
      intervalos.push(ms);
      return crearCliente({ fetch: fetchFalso, esperar: async () => {}, intervaloMinimoMs: 0 });
    },
    raizDatos: "no-se-usa",
    ahora: () => ahora ?? new Date("2025-12-17T19:00:00Z"),
    escribir: (t) => void salida.push(t),
    escribirError: (t) => void errores.push(t),
  };
  return {
    entorno,
    pedidas,
    intervalos,
    salida: () => salida.join(""),
    errores: () => errores.join(""),
  };
}

const conFixture = async () => {
  const bytes = await fixture();
  return (url: string) =>
    url === URL_INDICE ? new Response(bytes) : new Response("no", { status: 404 });
};

describe("comando dof", () => {
  it("con --json da la fecha, si revisó el índice y las publicaciones por capturar", async () => {
    const e = entornoDof(await conFixture());
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(e.pedidas).toEqual([URL_INDICE]);
    expect(e.intervalos).toEqual([1000]);
    const r = JSON.parse(e.salida());
    expect(r).toMatchObject({ fecha: FECHA, revisado: true, notas: 6 });
    expect(r.publicaciones.map((p: { codigo: string }) => p.codigo)).toEqual(["5776445"]);
    expect(e.errores()).toBe("");
  });

  it("por omisión lee el índice de la fecha de la Ciudad de México", async () => {
    // 03:00 UTC del 18 de diciembre: en la Ciudad de México todavía es el 17.
    const e = entornoDof(await conFixture(), new Date("2025-12-18T03:00:00Z"));
    expect(await principal(["dof", "--json"], e.entorno)).toBe(0);
    expect(e.pedidas).toEqual([URL_INDICE]);
  });

  it("en texto lista cada publicación con su enlace y los archivos que puede tocar", async () => {
    const e = entornoDof(await conFixture());
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe(
      [
        "DOF del 2025-12-17: 6 notas, 1 coincide con una captura pendiente:",
        "  5776445 (matutina) Sexta Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2025 y anexos 1 y 1-A.",
        "    https://sidof.segob.gob.mx/notas/docFuente/5776445",
        "    capturas: modificaciones-rmf, rmf; archivos: data/curado/dias-inhabiles-sat.yaml, data/curado/isr-tarifas.yaml",
        "",
      ].join("\n"),
    );
  });

  it("sin coincidencias lo dice", async () => {
    const i = await indice();
    i.NotasMatutinas = [nota(1, "Tipo de cambio para solventar obligaciones")];
    const e = entornoDof(() => new Response(JSON.stringify(i)));
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe(
      "DOF del 2025-12-17: 1 nota, ninguna coincide con una captura pendiente.\n",
    );
  });

  it("si el SIDOF no responde avisa y termina en 0, sin publicaciones", async () => {
    for (const responder of [
      () => new Response("", { status: 503 }),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const e = entornoDof(responder);
      expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
      expect(JSON.parse(e.salida())).toEqual({
        fecha: FECHA,
        revisado: false,
        notas: 0,
        publicaciones: [],
      });
      expect(e.errores()).toMatch(
        /^dof: el SIDOF no respondió al pedir el índice del 2025-12-17: /,
      );
      // Con los reintentos del cliente: cuatro intentos.
      expect(e.pedidas).toEqual(Array(4).fill(URL_INDICE));
    }
    const e = entornoDof(() => new Response("", { status: 503 }));
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe("No se revisó el DOF del 2025-12-17: el SIDOF no respondió.\n");
  });

  it("solo pide al SIDOF: una redirección a otro host no se sigue", async () => {
    const e = entornoDof(
      () => new Response("", { status: 302, headers: { location: "https://otro.example/x" } }),
    );
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(JSON.parse(e.salida()).revisado).toBe(false);
    expect(e.errores()).toMatch(/Host no permitido \(otro\.example\)/);
    expect(e.pedidas).toEqual([URL_INDICE]);
  });

  it("un índice con forma inesperada termina en 1", async () => {
    const e = entornoDof(() => new Response("<html>mantenimiento</html>"));
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(1);
    expect(e.salida()).toBe("");
    expect(e.errores()).toMatch(/^dof: el índice del SIDOF del 2025-12-17 no es JSON válido/);
  });

  it("un 404 sin publicaciones no tiene nada que avisar; otro 404 es un error", async () => {
    const vacio = entornoDof(
      () => new Response('{"messageCode":404,"response":"NOT_FOUND"}', { status: 404 }),
    );
    expect(await principal(["dof", "--fecha", FECHA, "--json"], vacio.entorno)).toBe(0);
    expect(JSON.parse(vacio.salida())).toMatchObject({ revisado: true, notas: 0 });
    const otro = entornoDof(() => new Response("no", { status: 404 }));
    expect(await principal(["dof", "--fecha", FECHA, "--json"], otro.entorno)).toBe(1);
  });

  it("un error que no es del SIDOF no se toma por una falta de respuesta", async () => {
    const e = entornoDof(await conFixture());
    e.entorno.crearCliente = () => ({
      obtener: () => Promise.reject(new Error("falla del cliente")),
    });
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(1);
    expect(e.errores()).toBe("dof: falla del cliente\n");
    expect(e.salida()).toBe("");
  });

  it("rechaza una fecha inválida y las opciones de otros comandos", async () => {
    const e = entornoDof(await conFixture());
    expect(await principal(["dof", "--fecha", "2025-02-30"], e.entorno)).toBe(1);
    expect(e.errores()).toContain("Fecha inválida: 2025-02-30");
    expect(await principal(["dof", "--seco"], e.entorno)).toBe(1);
    expect(await principal(["dof", "otro"], e.entorno)).toBe(1);
    expect(e.pedidas).toEqual([]);
  });
});
