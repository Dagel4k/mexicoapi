import { describe, expect, it, vi } from "vitest";
import { configurar, ErrorConfiguracion } from "../src/configuracion.js";

const respuestaApi = (data: unknown) => ({
  status: 200,
  headers: { get: () => null },
  text: async () =>
    JSON.stringify({
      data,
      meta: { dataset: "udis", as_of: "2026-10-19", sources: [], docs: "" },
    }),
});

describe("configurar", () => {
  it("sin MEXICOAPI_BASE responde solo con el paquete, sin red", async () => {
    for (const env of [{}, { MEXICOAPI_BASE: "" }, { MEXICOAPI_BASE: "   " }]) {
      const { cliente, conApi } = configurar(env);
      expect(conApi).toBe(false);
      const r = await cliente.udi("2026-10-01");
      expect(r.origen).toBe("paquete");
    }
  });

  it("con MEXICOAPI_BASE consulta la API con el fetch dado", async () => {
    const fetch = vi.fn(async () => respuestaApi({ fecha: "2026-10-01", valor: "8.800000" }));
    const { cliente, conApi } = configurar(
      { MEXICOAPI_BASE: "https://api.example/v1/" },
      { fetch },
    );
    expect(conApi).toBe(true);
    const r = await cliente.udi("2026-10-01");
    expect(r.origen).toBe("api");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/v1/udis?fecha=2026-10-01",
      expect.anything(),
    );
  });

  it("guarda en caché las respuestas de la API", async () => {
    const fetch = vi.fn(async () => respuestaApi({ fecha: "2026-10-01", valor: "8.800000" }));
    const { cliente } = configurar({ MEXICOAPI_BASE: "https://api.example" }, { fetch });
    await cliente.udi("2026-10-01");
    await cliente.udi("2026-10-01");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rechaza una base inválida sin repetirla", () => {
    for (const base of [
      "ftp://api.example",
      "https://usuario:CLAVE-SECRETA@api.example",
      "https://api.example/?token=CLAVE-SECRETA",
      "no es url",
    ]) {
      let error: unknown;
      try {
        configurar({ MEXICOAPI_BASE: base });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorConfiguracion);
      const mensaje = (error as Error).message;
      expect(mensaje).toMatch(/^MEXICOAPI_BASE no es válida: /);
      expect(mensaje).not.toContain("CLAVE-SECRETA");
      expect(mensaje).not.toContain(base);
    }
  });
});
