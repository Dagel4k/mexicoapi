// Una respuesta 200 de la API que no tiene la forma esperada (otra versión de la API, un proxy que
// responde otra cosa) da un error claro de la herramienta, nunca un -32603 opaco ni un dato mal
// armado. Los datos del paquete no pasan por aquí: los revisa el protocolo con el outputSchema.
import { describe, expect, it } from "vitest";
import { DATOS_CON_OTRA_FORMA } from "../src/respuesta.js";
import {
  apiOk,
  contenido,
  esError,
  herramientasConApi,
  META_API,
  servidor,
} from "./ayudas-herramientas.js";

const FIX_BIEN = { fecha_publicacion: "2026-10-19", valor: "18.5000" };

describe("una respuesta de la API con otra forma", () => {
  it.each([
    ["tipo_de_cambio_fix", { publicado: "2026-10-19" }, { valor: 18.5 }],
    ["tipo_de_cambio_fix", { publicado: "2026-10-19" }, { ...FIX_BIEN, valor: "dieciocho" }],
    ["tipo_de_cambio_fix", {}, { ...FIX_BIEN, fundamento: { nombre: "CFF" } }],
    ["udis", { fecha: "2026-10-01" }, { fecha: "2026-10-01", valor: "8,836029" }],
    ["udis", { fecha: "2026-10-01" }, "8.836029"],
    ["dias_inhabiles", { autoridad: "lft", anio: 2026 }, { dias: [] }],
    ["dias_inhabiles", { autoridad: "lft", anio: 2026 }, [{ fecha: "2026-11-16", motivo: "x" }]],
    [
      "sumar_dias_habiles",
      { autoridad: "lft", desde: "2026-07-17", dias: 3 },
      { resultado: "2026-07-22" },
    ],
    ["constantes", { tipo: "uma", anio: 2026 }, { anio: 2026, diaria: "117.31" }],
    [
      "constantes",
      { tipo: "salario_minimo", anio: 2026 },
      [{ anio: 2026, zona: "general", diario: 315.04 }],
    ],
    ["constantes", { tipo: "isr", periodo: "mensual", anio: 2026 }, { anio: 2026, tramos: "x" }],
  ])("%s %j con data %j es un error claro", async (nombre, args, data) => {
    const { herramientas } = herramientasConApi(() => apiOk(data));
    esError(await (await servidor(herramientas))(nombre, args), DATOS_CON_OTRA_FORMA);
  });

  it.each([
    ["una fuente que no es http(s)", { sources: [{ name: "Fuente", url: "javascript:alert(1)" }] }],
    ["un as_of que no es fecha", { as_of: "ayer" }],
  ])("un meta con %s también", async (_caso, cambio) => {
    const { herramientas } = herramientasConApi(() =>
      apiOk(FIX_BIEN, { meta: { ...META_API, ...cambio } }),
    );
    const llamar = await servidor(herramientas);
    esError(await llamar("tipo_de_cambio_fix", { publicado: "2026-10-19" }), DATOS_CON_OTRA_FORMA);
  });

  it("una respuesta con la forma esperada sigue pasando", async () => {
    const { herramientas } = herramientasConApi(() => apiOk(FIX_BIEN));
    const r = await (await servidor(herramientas))("tipo_de_cambio_fix", {
      publicado: "2026-10-19",
    });
    expect(contenido(r)).toMatchObject({ datos: FIX_BIEN, origen: "api" });
  });
});
