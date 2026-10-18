import { describe, expect, it, vi } from "vitest";
import { manejar } from "../../src/index.js";
import { crearAssets, entornoDe, peticion } from "./ayudas.js";

vi.mock("@mexicoapi/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mexicoapi/core")>();
  return {
    ...original,
    sumarDiasHabiles: () => {
      throw new TypeError("fallo interno del núcleo");
    },
  };
});

describe("GET /v1/dias-habiles con un error inesperado del núcleo", () => {
  it("da 500 genérico: solo el RangeError de un resultado fuera de rango es 400", async () => {
    const respuesta = await manejar(
      peticion("/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=1"),
      entornoDe(crearAssets()),
    );
    expect(respuesta.status).toBe(500);
    const texto = await respuesta.text();
    expect(JSON.parse(texto)).toEqual({
      type: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#error-interno",
      title: "Error interno",
      status: 500,
      detail: "Ocurrió un error interno.",
      instance: "/v1/dias-habiles",
    });
    expect(texto).not.toContain("fallo interno");
  });
});
