import { MexicoApiError } from "mexicoapi/cliente";
import { describe, expect, it } from "vitest";
import { compilarEsquema, type EsquemaJson } from "../src/esquema.js";
import { ErrorHerramienta, type Herramienta } from "../src/herramientas.js";
import {
  AVISO_SIN_API,
  aUnaLinea,
  conSalidaDeApiRevisada,
  consultar,
  DATOS_CON_OTRA_FORMA,
  esquemaSalida,
  type Origen,
  procedencia,
  resultado,
  unicas,
} from "../src/respuesta.js";

const META = {
  dataset: "prueba",
  as_of: "2026-10-17",
  sources: [
    { name: "Fuente A", url: "https://a.example", license: "", license_url: "", citation: "" },
    { name: "Fuente B", url: "https://b.example", license: "", license_url: "", citation: "" },
  ],
  docs: "https://docs.example",
};

const vivo = () => new AbortController().signal;

describe("procedencia", () => {
  it("toma as_of y las fuentes del meta, sin repetir", () => {
    const sources = [...META.sources, META.sources[0]];
    const p = procedencia({ meta: { ...META, sources } as never, origen: "api" });
    expect(p).toEqual({
      as_of: "2026-10-17",
      fuente: { nombre: "Fuente A", url: "https://a.example" },
      fuentes: [
        { nombre: "Fuente A", url: "https://a.example" },
        { nombre: "Fuente B", url: "https://b.example" },
      ],
      origen: "api",
      advertencias: [],
      avisos: [],
    });
  });

  it("conserva el código de los avisos del cliente y de la herramienta, por su texto", () => {
    const p = procedencia(
      {
        meta: META,
        origen: "api",
        advertencias: ["de la API", "sin código"],
        avisos: [{ codigo: "lista-incompleta", texto: "de la API" }],
      },
      {
        advertencias: ["del cálculo", "de la API"],
        avisos: [{ codigo: "prorroga-art-12", texto: "del cálculo" }],
      },
    );
    expect(p.advertencias).toEqual(["de la API", "sin código", "del cálculo"]);
    expect(p.avisos).toEqual([
      { codigo: "lista-incompleta", texto: "de la API" },
      { codigo: "otro", texto: "sin código" },
      { codigo: "prorroga-art-12", texto: "del cálculo" },
    ]);
  });

  it("prefiere las fuentes del registro y junta las advertencias sin repetir", () => {
    const p = procedencia(
      { meta: META, origen: "paquete", advertencias: ["vieja", "vieja"] },
      {
        fuentes: [{ nombre: "DOF", url: "https://dof.example" }],
        advertencias: ["calculo", "vieja"],
        sinApi: true,
      },
    );
    expect(p.fuentes).toEqual([{ nombre: "DOF", url: "https://dof.example" }]);
    expect(p.advertencias).toEqual([AVISO_SIN_API, "vieja", "calculo"]);
  });

  it("solo avisa que no hay API cuando el dato salió del paquete", () => {
    expect(procedencia({ meta: META, origen: "api" }, { sinApi: true }).advertencias).toEqual([]);
    expect(procedencia({ meta: META, origen: "paquete" }, { fuentes: [] }).fuentes).toHaveLength(2);
  });

  it("resiste un meta de la API sin fuentes legibles ni fecha válida", () => {
    const raro = { dataset: "x", as_of: "ayer", sources: [null, { name: 1 }], docs: "" };
    const p = procedencia({ meta: raro as never, origen: "api" });
    expect(p.as_of).toBeNull();
    expect(p.fuente.nombre).toBe("API de MéxicoAPI");
    const sinLista = procedencia({ meta: { as_of: 7 } as never, origen: "api" });
    expect(sinLista.fuentes).toHaveLength(1);
    expect(sinLista.as_of).toBeNull();
  });
});

describe("resultado", () => {
  it("arma el texto con el pie de procedencia y structuredContent con datos y extra", () => {
    const p = procedencia({ meta: META, origen: "paquete", advertencias: ["Ojo:\nesto"] });
    const r = resultado(["Línea 1"], { n: 1 }, p, { extra: { total: 1 } });
    expect(r.content[0]?.text).toBe(
      [
        "Línea 1",
        "Fuente: Fuente A (https://a.example)",
        "Otra fuente: Fuente B (https://b.example)",
        "as_of (corte de los datos): 2026-10-17",
        "Origen: datos del paquete mexicoapi",
        "Advertencia: Ojo: esto",
      ].join("\n"),
    );
    // avisos: las mismas advertencias con su código, después de advertencias.
    expect(r.structuredContent).toEqual({
      datos: { n: 1 },
      total: 1,
      ...p,
      avisos: [{ codigo: "otro", texto: "Ojo:\nesto" }],
    });
    expect(Object.keys(r.structuredContent ?? {}).slice(-2)).toEqual(["advertencias", "avisos"]);
  });

  it("da en avisos el código estable de cada advertencia, en el mismo orden", () => {
    const p = procedencia(
      { meta: META, origen: "paquete", advertencias: ["Un aviso sin código."] },
      { sinApi: true },
    );
    const r = resultado([], null, p);
    expect(r.structuredContent?.avisos).toEqual([
      { codigo: "datos-del-paquete", texto: AVISO_SIN_API },
      { codigo: "otro", texto: "Un aviso sin código." },
    ]);
    // El texto no cambia: las advertencias, una por línea.
    expect(r.content[0]?.text).not.toContain("datos-del-paquete");
  });

  it("dice por qué no hay fecha", () => {
    const p = { ...procedencia({ meta: META, origen: "paquete" }), as_of: null };
    expect(resultado([], null, p).content[0]?.text).toContain(
      "as_of (corte de los datos): sin fecha",
    );
    expect(resultado([], null, p, { sinFecha: "no aplica" }).content[0]?.text).toContain(
      "as_of (corte de los datos): no aplica",
    );
  });
});

describe("esquemaSalida", () => {
  it("exige datos, los campos propios y la procedencia, sin campos de más", () => {
    const validar = compilarEsquema(
      esquemaSalida(
        { type: "integer" },
        { origenes: ["paquete"], extra: { total: { type: "integer" } } },
      ),
    );
    const bien = {
      datos: 1,
      total: 1,
      ...procedencia({ meta: META, origen: "paquete" }),
      avisos: [],
    };
    expect(validar(bien)).toEqual([]);
    const conAviso = { ...bien, advertencias: ["x"], avisos: [{ codigo: "otro", texto: "x" }] };
    expect(validar(conAviso)).toEqual([]);
    // El código es un texto abierto en kebab-case: uno nuevo pasa, uno con otra forma no.
    expect(validar({ ...conAviso, avisos: [{ codigo: "nuevo-codigo", texto: "x" }] })).toEqual([]);
    expect(validar({ ...conAviso, avisos: [{ codigo: "Nuevo código", texto: "x" }] })).toHaveLength(
      1,
    );
    expect(validar({ ...conAviso, avisos: [{ codigo: "otro" }] })).toHaveLength(1);
    const { avisos: _a, ...sinAvisos } = bien;
    expect(validar(sinAvisos)).toEqual(['falta "avisos"']);
    expect(validar({ ...bien, origen: "api" })).toHaveLength(1);
    expect(validar({ ...bien, as_of: null })).toHaveLength(1);
    expect(validar({ ...bien, otro: 1 })).toHaveLength(1);
    const { total: _, ...sinTotal } = bien;
    expect(validar(sinTotal)).toEqual(['falta "total"']);
  });

  it("avisos es un esquema corto: código abierto con patrón, sin la lista del catálogo", () => {
    const { properties } = esquemaSalida({ type: "null" }, { origenes: ["paquete"] });
    const avisos = (properties as Record<string, EsquemaJson>).avisos as EsquemaJson;
    const texto = JSON.stringify(avisos);
    expect(texto).not.toContain("enum");
    expect(texto).toContain('"pattern":"^[a-z0-9]+(-[a-z0-9]+)*$"');
    // Se repite en cada herramienta: tools/list no debe crecer de más.
    expect(texto.length).toBeLessThan(400);
    // Dice lo mínimo para usarlo: la paridad con advertencias y qué hacer con un código nuevo.
    expect(avisos.description).toContain("avisos[i].texto es advertencias[i]");
    expect(avisos.description).toContain("otro");
  });

  /** La descripción de una propiedad del esquema de salida. */
  const descripcion = (origenes: readonly Origen[], propiedad: string): unknown =>
    (esquemaSalida({ type: "null" }, { origenes }).properties as Record<string, EsquemaJson>)[
      propiedad
    ]?.description;

  it("describe as_of como el corte del dataset, no como la fecha del valor", () => {
    const texto = descripcion(["paquete"], "as_of");
    expect(texto).toMatch(/^Fecha de corte del dataset/);
    expect(texto).toMatch(/No es la fecha del valor/);
  });

  it("describe cada origen posible de la herramienta", () => {
    const describir = (origenes: readonly Origen[]) => descripcion(origenes, "origen");
    expect(describir(["api", "paquete"])).toBe(
      "api: la API de MéxicoAPI; paquete: los datos y las reglas del paquete mexicoapi, sin red.",
    );
    expect(describir(["cache_local"])).toBe(
      "cache_local: el catálogo de Correos de México que el usuario descargó en este equipo.",
    );
  });

  it("acepta as_of null si se pide", () => {
    const validar = compilarEsquema(
      esquemaSalida({ type: "null" }, { origenes: ["paquete"], asOfNulo: true }),
    );
    const p = procedencia({ meta: META, origen: "paquete" });
    expect(validar({ datos: null, ...p, avisos: [], as_of: null })).toEqual([]);
    expect(validar({ datos: null, ...p, avisos: [], as_of: "2026-02-30" })).toHaveLength(1);
  });
});

describe("consultar", () => {
  it("pasa el detalle de un problema de la API o del paquete a ErrorHerramienta", async () => {
    const problema = new MexicoApiError(
      { type: "about:blank", title: "No", status: 404, detail: "No existe el banco 999." },
      { url: "/v1/bancos/999", origen: "paquete" },
    );
    const error = await consultar(vivo(), () => Promise.reject(problema)).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorHerramienta);
    // Sin tipo de problema en el type (about:blank), el prefijo es error-interno.
    expect(error.message).toBe("[error-interno] No existe el banco 999.");
  });

  it("usa el detalle en una línea, o el mensaje si el detalle está vacío", async () => {
    const problema = (detail: string) =>
      new MexicoApiError(
        { type: "about:blank", title: "Falla", status: 404, detail },
        { url: "/v1/udis", origen: "api" },
      );
    const fallar = (detail: string) =>
      consultar(vivo(), () => Promise.reject(problema(detail))).catch((e) => e);
    const varias = await fallar("uno\ndos");
    expect(varias.message).toBe("[error-interno] uno dos");
    const vacio = await fallar(" \n");
    expect(vacio).toBeInstanceOf(ErrorHerramienta);
    expect(vacio.message).toBe("[error-interno] 404 Falla:");
  });

  it("antepone el tipo de problema de la API, para distinguirlo sin leer el texto", async () => {
    const URL = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
    const problema = (tipo: string, status: number) =>
      new MexicoApiError(
        { type: `${URL}${tipo}`, title: "T", status, detail: "Detalle." },
        { url: "/v1/udis", origen: "api" },
      );
    const fallar = (e: MexicoApiError) =>
      consultar(vivo(), () => Promise.reject(e)).catch((x) => x as Error);
    expect((await fallar(problema("dato-no-disponible", 404))).message).toBe(
      "[dato-no-disponible] Detalle.",
    );
    expect((await fallar(problema("no-encontrado", 404))).message).toBe("[no-encontrado] Detalle.");
    // Un tipo con otra forma no se copia al texto: todo error lleva uno, así que error-interno.
    expect((await fallar(problema("raro tipo]", 404))).message).toBe("[error-interno] Detalle.");
  });

  // Con los argumentos ya validados, un TypeError o RangeError es un defecto: va por la ruta del
  // error interno (sin detalles para el modelo y con registro), no como error que el modelo corrige.
  it("deja pasar TypeError y RangeError tal cual", async () => {
    for (const falla of [new TypeError("uso"), new RangeError("rango")]) {
      await expect(consultar(vivo(), () => Promise.reject(falla))).rejects.toBe(falla);
    }
  });

  it("deja pasar los demás errores y cualquiera si la llamada se canceló", async () => {
    const otro = new Error("interno");
    await expect(consultar(vivo(), () => Promise.reject(otro))).rejects.toBe(otro);
    const control = new AbortController();
    control.abort();
    const uso = new TypeError("uso");
    await expect(consultar(control.signal, () => Promise.reject(uso))).rejects.toBe(uso);
    const respuesta = { origen: "paquete" as const, data: 5 };
    await expect(consultar(vivo(), async () => respuesta)).resolves.toBe(respuesta);
  });

  it("revisa los datos solo si vienen de la API", async () => {
    const revisar = compilarEsquema({ type: "string", pattern: "^[0-9]+$" });
    const api = (data: unknown) => async () => ({ origen: "api" as const, data });
    const error = await consultar(vivo(), api("x"), revisar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorHerramienta);
    expect(error.message).toBe(DATOS_CON_OTRA_FORMA);
    await expect(consultar(vivo(), api("12"), revisar)).resolves.toEqual({
      origen: "api",
      data: "12",
    });
    const paquete = { origen: "paquete" as const, data: "x" };
    await expect(consultar(vivo(), async () => paquete, revisar)).resolves.toBe(paquete);
    await expect(consultar(vivo(), api("x"))).resolves.toEqual({ origen: "api", data: "x" });
  });
});

describe("conSalidaDeApiRevisada", () => {
  const base = (structuredContent: Record<string, unknown>, isError?: boolean): Herramienta => ({
    name: "h",
    title: "H",
    description: "Prueba.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { n: { type: "integer" }, origen: { type: "string" } },
      required: ["n"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async ejecutar() {
      return {
        content: [{ type: "text", text: "listo" }],
        structuredContent,
        ...(isError === undefined ? {} : { isError }),
      };
    },
  });
  const correr = (h: Herramienta) => conSalidaDeApiRevisada(h).ejecutar({}, { signal: vivo() });

  it("con origen api y otra forma da DATOS_CON_OTRA_FORMA", async () => {
    expect(await correr(base({ n: "uno", origen: "api" }))).toEqual({
      content: [{ type: "text", text: DATOS_CON_OTRA_FORMA }],
      isError: true,
    });
  });

  it("deja igual lo que cumple, lo del paquete y los errores de la herramienta", async () => {
    for (const h of [
      base({ n: 1, origen: "api" }),
      base({ n: "uno", origen: "paquete" }),
      base({ n: "uno", origen: "api" }, true),
    ]) {
      expect(await correr(h)).toEqual(await h.ejecutar({}, { signal: vivo() }));
    }
  });

  it("una herramienta sin outputSchema queda igual", () => {
    const { outputSchema: _, ...sinEsquema } = base({ n: 1 });
    expect(conSalidaDeApiRevisada(sinEsquema)).toBe(sinEsquema);
  });
});

describe("ayudas de texto", () => {
  it("aUnaLinea quita saltos y controles", () => {
    expect(aUnaLinea(" a\r\nb c\u0007d ")).toBe("a b c d");
  });

  it("unicas quita las fuentes repetidas", () => {
    const a = { nombre: "A", url: "u" };
    expect(unicas([a, { ...a }, { nombre: "A", url: "v" }])).toHaveLength(2);
  });
});
