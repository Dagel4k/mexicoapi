import { MexicoApiError } from "mexicoapi/cliente";
import { describe, expect, it } from "vitest";
import { compilarEsquema, type EsquemaJson } from "../src/esquema.js";
import { ErrorHerramienta } from "../src/herramientas.js";
import {
  AVISO_SIN_API,
  consultar,
  enLinea,
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
    });
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
    expect(r.structuredContent).toEqual({ datos: { n: 1 }, total: 1, ...p });
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
    const bien = { datos: 1, total: 1, ...procedencia({ meta: META, origen: "paquete" }) };
    expect(validar(bien)).toEqual([]);
    expect(validar({ ...bien, origen: "api" })).toHaveLength(1);
    expect(validar({ ...bien, as_of: null })).toHaveLength(1);
    expect(validar({ ...bien, otro: 1 })).toHaveLength(1);
    const { total: _, ...sinTotal } = bien;
    expect(validar(sinTotal)).toEqual(['falta "total"']);
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
    expect(validar({ datos: null, ...p, as_of: null })).toEqual([]);
    expect(validar({ datos: null, ...p, as_of: "2026-02-30" })).toHaveLength(1);
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
    expect(error.message).toBe("No existe el banco 999.");
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
    expect(varias.message).toBe("uno dos");
    const vacio = await fallar(" \n");
    expect(vacio).toBeInstanceOf(ErrorHerramienta);
    expect(vacio.message).toBe("404 Falla:");
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
    await expect(consultar(vivo(), async () => 5)).resolves.toBe(5);
  });
});

describe("ayudas de texto", () => {
  it("enLinea quita saltos y controles", () => {
    expect(enLinea(" a\r\nb c\u0007d ")).toBe("a b c d");
  });

  it("unicas quita las fuentes repetidas", () => {
    const a = { nombre: "A", url: "u" };
    expect(unicas([a, { ...a }, { nombre: "A", url: "v" }])).toHaveLength(2);
  });
});
