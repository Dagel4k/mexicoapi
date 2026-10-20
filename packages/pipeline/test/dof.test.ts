// El vigía del DOF lee el índice del SIDOF del día y el del anterior, y avisa cuando un título
// coincide con una de las capturas pendientes de data/curado/. No captura nada. notas-17-12-2025.json
// es el índice real del 2025-12-17 (el día de la Sexta Resolución de Modificaciones a la RMF 2025),
// recortado a 10 notas. notas-ejemplo-vespertina.json no es una respuesta real: tiene la forma de
// la del 17 y notas inventadas (códigos 9000001 a 9000003), una de ellas vespertina; las pruebas lo
// sirven como el índice del 2025-12-16.
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
const ANTERIOR = "2025-12-16";
const URL_ANTERIOR = "https://sidof.segob.gob.mx/dof/sidof/notas/16-12-2025";
const fixture = () => leerFixture("sidof/notas-17-12-2025.json");
const fixtureAnterior = () => leerFixture("sidof/notas-ejemplo-vespertina.json");

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

  it("en el índice de ejemplo lee la nota vespertina y salta su encabezado", async () => {
    expect(interpretarIndiceDof(await fixtureAnterior(), ANTERIOR)).toEqual([
      {
        codigo: "9000001",
        titulo:
          "Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana.",
        edicion: "matutina",
      },
      {
        codigo: "9000003",
        titulo:
          "Quinta Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2025 (nota de ejemplo, no publicada).",
        edicion: "vespertina",
      },
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
      ["Anexo 8 de la Resolución Miscelánea Fiscal para 2027.", ["anexo-8"]],
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
      notas("UNIDAD DE MEDIDA Y ACTUALIZACION", "Comisión que fija los salarios   mí\u00adnimos"),
      FECHA,
    );
    expect(lista.map((p) => p.capturas)).toEqual([["uma"], ["salario-minimo"]]);
  });

  it("una nota de anexos de la RMF no es una captura de la RMF, pero el Anexo 8 sí", () => {
    const lista = publicacionesPorCapturar(
      notas(
        "  ANEXO 3 de la Resolución Miscelánea Fiscal para 2027.",
        "Anexo 1-A de la Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2027.",
        "Anexos 1 y 2 de la Resolución Miscelánea Fiscal para 2027.",
        "Anexo 8 de la Resolución Miscelánea Fiscal para 2027.",
      ),
      FECHA,
    );
    expect(lista.map((p) => p.capturas)).toEqual([["anexo-8"]]);
  });

  it("del salario mínimo solo avisa la resolución que lo fija", () => {
    const lista = publicacionesPorCapturar(
      notas(
        "Programa Institucional de la Comisión Nacional de los Salarios Mínimos 2025-2030.",
        "Aviso de la Comisión Nacional de los Salarios Mínimos sobre los salarios mínimos de 2026.",
        "Resolución del H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos que fija los salarios mínimos generales y profesionales que habrán de regir a partir del 1 de enero de 2026.",
      ),
      FECHA,
    );
    expect(lista.map((p) => p.capturas)).toEqual([["salario-minimo"]]);
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

type Respuesta = Response | (() => Response | Promise<Response>);

/**
 * El índice real del 17 y el de ejemplo del 16 (con una nota vespertina), salvo lo que se cambie;
 * cualquier otra URL da 404.
 */
async function sidof(cambios: Record<string, Respuesta> = {}) {
  const [delDia, anterior] = await Promise.all([fixture(), fixtureAnterior()]);
  const respuestas: Record<string, Respuesta> = {
    [URL_INDICE]: () => new Response(delDia),
    [URL_ANTERIOR]: () => new Response(anterior),
    ...cambios,
  };
  return (url: string) => {
    const r = respuestas[url];
    if (r === undefined) return new Response("no", { status: 404 });
    return typeof r === "function" ? r() : r.clone();
  };
}

const json = (e: ReturnType<typeof entornoDof>) => JSON.parse(e.salida());
const codigos = (r: { publicaciones: { codigo: string }[] }) =>
  r.publicaciones.map((p) => p.codigo);

describe("comando dof", () => {
  it("revisa el índice del día y el del anterior, y junta lo que encuentra en los dos", async () => {
    const e = entornoDof(await sidof());
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(e.pedidas).toEqual([URL_ANTERIOR, URL_INDICE]);
    expect(e.intervalos).toEqual([1000]);
    const r = json(e);
    expect(r.fecha).toBe(FECHA);
    expect(r.indices).toEqual([
      { fecha: ANTERIOR, estado: "revisado", notas: 2 },
      { fecha: FECHA, estado: "revisado", notas: 6 },
    ]);
    // La vespertina del día anterior, que salió después de la corrida de ese día, entra hoy.
    expect(codigos(r)).toEqual(["9000003", "5776445"]);
    expect(r.publicaciones[0]).toMatchObject({
      fecha: ANTERIOR,
      edicion: "vespertina",
      titulo: "Publicación en el DOF: 9000003 (modificaciones-rmf)",
    });
    expect(e.errores()).toBe("");
  });

  it("por omisión toma la fecha de la Ciudad de México y la del día anterior", async () => {
    // 03:00 UTC del 18 de diciembre: en la Ciudad de México todavía es el 17.
    const e = entornoDof(await sidof(), new Date("2025-12-18T03:00:00Z"));
    expect(await principal(["dof", "--json"], e.entorno)).toBe(0);
    expect(e.pedidas).toEqual([URL_ANTERIOR, URL_INDICE]);
  });

  it("una nota que sale en los dos índices cuenta una vez", async () => {
    const e = entornoDof(await sidof({ [URL_ANTERIOR]: new Response(await fixture()) }));
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(codigos(json(e))).toEqual(["5776445"]);
  });

  it("en texto dice qué índices revisó y lista cada publicación con su enlace", async () => {
    const e = entornoDof(await sidof());
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe(
      [
        "Índice del SIDOF del 2025-12-16: 2 notas.",
        "Índice del SIDOF del 2025-12-17: 6 notas.",
        "2 notas coinciden con una captura pendiente:",
        "  9000003 (2025-12-16, vespertina) Quinta Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2025 (nota de ejemplo, no publicada).",
        "    https://sidof.segob.gob.mx/notas/docFuente/9000003",
        "    capturas: modificaciones-rmf, rmf; archivos: data/curado/dias-inhabiles-sat.yaml, data/curado/isr-tarifas.yaml",
        "  5776445 (2025-12-17, matutina) Sexta Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2025 y anexos 1 y 1-A.",
        "    https://sidof.segob.gob.mx/notas/docFuente/5776445",
        "    capturas: modificaciones-rmf, rmf; archivos: data/curado/dias-inhabiles-sat.yaml, data/curado/isr-tarifas.yaml",
        "",
      ].join("\n"),
    );
  });

  it("sin coincidencias lo dice", async () => {
    const i = await indice();
    i.NotasMatutinas = [nota(1, "Tipo de cambio para solventar obligaciones")];
    const vacio = await indice();
    vacio.NotasMatutinas = [];
    const e = entornoDof(
      await sidof({
        [URL_INDICE]: new Response(JSON.stringify(i)),
        [URL_ANTERIOR]: new Response(JSON.stringify(vacio)),
      }),
    );
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe(
      [
        "Índice del SIDOF del 2025-12-16: 0 notas.",
        "Índice del SIDOF del 2025-12-17: 1 nota.",
        "Ninguna nota coincide con una captura pendiente.",
        "",
      ].join("\n"),
    );
  });

  it("si el SIDOF no responde uno de los días, avisa y el otro se revisa igual", async () => {
    for (const falla of [
      () => new Response("", { status: 503 }),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const e = entornoDof(await sidof({ [URL_ANTERIOR]: falla }));
      expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
      const r = json(e);
      expect(r.indices).toEqual([
        { fecha: ANTERIOR, estado: "sin_respuesta", notas: 0 },
        { fecha: FECHA, estado: "revisado", notas: 6 },
      ]);
      expect(codigos(r)).toEqual(["5776445"]);
      expect(e.errores()).toMatch(
        /^dof: el SIDOF no respondió al pedir el índice del 2025-12-16: /,
      );
      // Con los reintentos del cliente: cuatro intentos, y después el otro día.
      expect(e.pedidas).toEqual([...Array(4).fill(URL_ANTERIOR), URL_INDICE]);
    }
  });

  it("una respuesta con otra forma (HTML, no JSON, otros campos) solo avisa", async () => {
    const casos: [Respuesta, RegExp][] = [
      [new Response("<html>mantenimiento</html>"), /no es JSON válido/],
      [new Response("no", { status: 404 }), /no es JSON válido/],
      [
        new Response('{"messageCode":200,"response":"OK"}'),
        /no tiene la forma esperada: NotasMatutinas/,
      ],
    ];
    for (const [respuesta, detalle] of casos) {
      const e = entornoDof(await sidof({ [URL_INDICE]: respuesta }));
      expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
      const r = json(e);
      expect(r.indices).toEqual([
        { fecha: ANTERIOR, estado: "revisado", notas: 2 },
        { fecha: FECHA, estado: "otra_forma", notas: 0 },
      ]);
      expect(codigos(r)).toEqual(["9000003"]);
      expect(e.errores()).toMatch(
        /^dof: el SIDOF respondió con otra forma: el índice del SIDOF del 2025-12-17 /,
      );
      expect(e.errores()).toMatch(detalle);
    }
  });

  it("un 404 sin publicaciones es un día sin notas", async () => {
    const e = entornoDof(
      await sidof({
        [URL_INDICE]: new Response('{"messageCode":404,"response":"NOT_FOUND"}', { status: 404 }),
      }),
    );
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(json(e).indices[1]).toEqual({ fecha: FECHA, estado: "revisado", notas: 0 });
    expect(e.errores()).toBe("");
  });

  it("si no pudo leer ningún índice lo dice en texto", async () => {
    const e = entornoDof(
      await sidof({
        [URL_ANTERIOR]: () => new Response("", { status: 503 }),
        [URL_INDICE]: new Response("<html></html>"),
      }),
    );
    expect(await principal(["dof", "--fecha", FECHA], e.entorno)).toBe(0);
    expect(e.salida()).toBe(
      [
        "Índice del SIDOF del 2025-12-16: el SIDOF no respondió.",
        "Índice del SIDOF del 2025-12-17: el SIDOF respondió con otra forma.",
        "No se revisó ningún índice.",
        "",
      ].join("\n"),
    );
  });

  it("solo pide al SIDOF: una redirección a otro host no se sigue", async () => {
    const e = entornoDof(
      await sidof({
        [URL_INDICE]: new Response("", {
          status: 302,
          headers: { location: "https://otro.example/x" },
        }),
      }),
    );
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(0);
    expect(json(e).indices[1]).toEqual({ fecha: FECHA, estado: "sin_respuesta", notas: 0 });
    expect(e.errores()).toMatch(/Host no permitido \(otro\.example\)/);
    expect(e.pedidas).toEqual([URL_ANTERIOR, URL_INDICE]);
  });

  it("un error que no es del SIDOF termina en 1", async () => {
    const e = entornoDof(await sidof());
    e.entorno.crearCliente = () => ({
      obtener: () => Promise.reject(new Error("falla del cliente")),
    });
    expect(await principal(["dof", "--fecha", FECHA, "--json"], e.entorno)).toBe(1);
    expect(e.errores()).toBe("dof: falla del cliente\n");
    expect(e.salida()).toBe("");
  });

  it("rechaza una fecha inválida y las opciones de otros comandos", async () => {
    const e = entornoDof(await sidof());
    expect(await principal(["dof", "--fecha", "2025-02-30"], e.entorno)).toBe(1);
    expect(e.errores()).toContain("Fecha inválida: 2025-02-30");
    expect(await principal(["dof", "--seco"], e.entorno)).toBe(1);
    expect(await principal(["dof", "otro"], e.entorno)).toBe(1);
    expect(e.pedidas).toEqual([]);
  });
});
