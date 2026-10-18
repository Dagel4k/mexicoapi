import { describe, expect, it } from "vitest";
import worker, { manejar } from "../../src/index.js";
import { crearAssets, entornoDe, peticion, SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";

describe("manejar", () => {
  it("una ruta desconocida da 404 problem+json sin tocar ASSETS", async () => {
    const assets = crearAssets();
    const r = await manejar(peticion("/v1/no-existe"), entornoDe(assets));
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
    expect(await r.json()).toMatchObject({ status: 404, instance: "/v1/no-existe" });
    expect(assets.pedidas).toEqual([]);
  });

  it("el export por omisión delega en manejar", async () => {
    const assets = crearAssets();
    const r = await worker.fetch(
      peticion("/v1/no-existe") as Parameters<typeof worker.fetch>[0],
      entornoDe(assets),
    );
    expect(r.status).toBe(404);
  });
});
