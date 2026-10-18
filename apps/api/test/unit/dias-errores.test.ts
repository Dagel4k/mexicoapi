import { CalendarioIncompletoError } from "@mexicoapi/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manejar } from "../../src/index.js";
import { crearAssets, entornoDe, peticion } from "./ayudas.js";

const nucleo = vi.hoisted(() => ({ error: null as unknown }));

vi.mock("@mexicoapi/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mexicoapi/core")>();
  return {
    ...original,
    sumarDiasHabiles: () => {
      throw nucleo.error;
    },
  };
});

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

const pedir = () =>
  manejar(
    peticion("/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=1"),
    entornoDe(crearAssets()),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/dias-habiles con un error del núcleo", () => {
  it("el 422 toma autoridad, fecha y cobertura del CalendarioIncompletoError", async () => {
    nucleo.error = new CalendarioIncompletoError("sat", "2031-02-03", {
      desde: "2030-01-01",
      hasta: "2031-01-31",
    });
    const respuesta = await pedir();
    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toEqual({
      type: `${TIPO}calendario-incompleto`,
      title: "Calendario incompleto",
      status: 422,
      detail: "El calendario de sat no cubre 2031-02-03; cubre del 2030-01-01 al 2031-01-31.",
      instance: "/v1/dias-habiles",
      autoridad: "sat",
      fecha: "2031-02-03",
      cobertura: { desde: "2030-01-01", hasta: "2031-01-31" },
    });
  });

  it.each([
    ["un TypeError", new TypeError("fallo interno del núcleo")],
    ["un RangeError que no es de fecha fuera de rango", new RangeError("fallo interno del núcleo")],
  ])("%s da 500 genérico: solo FechaFueraDeRangoError es 400", async (_, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    nucleo.error = error;
    const respuesta = await pedir();
    expect(respuesta.status).toBe(500);
    const texto = await respuesta.text();
    expect(JSON.parse(texto)).toEqual({
      type: `${TIPO}error-interno`,
      title: "Error interno",
      status: 500,
      detail: "Ocurrió un error interno.",
      instance: "/v1/dias-habiles",
    });
    expect(texto).not.toContain("fallo interno");
  });
});
