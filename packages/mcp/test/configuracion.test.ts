import { URL_API } from "mexicoapi/cliente";
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
  // Antes, sin MEXICOAPI_BASE respondía solo con el paquete. Desde que la API pública está en
  // producción, es la base por omisión; sin red hay que pedirlo con MEXICOAPI_SIN_RED=1.
  it("sin MEXICOAPI_BASE consulta la API pública (URL_API)", async () => {
    for (const env of [{}, { MEXICOAPI_BASE: "" }, { MEXICOAPI_BASE: "   " }]) {
      const fetch = vi.fn(async () => respuestaApi({ fecha: "2026-10-01", valor: "8.800000" }));
      const { cliente, conApi, descripcion } = configurar(env, { fetch });
      expect(conApi).toBe(true);
      expect(descripcion).toBe("consulta la API pública de MéxicoAPI");
      expect((await cliente.udi("2026-10-01")).origen).toBe("api");
      expect(fetch).toHaveBeenCalledWith(`${URL_API}/v1/udis?fecha=2026-10-01`, expect.anything());
    }
  });

  it("con MEXICOAPI_SIN_RED=1 responde solo con el paquete, sin red, aunque haya MEXICOAPI_BASE", async () => {
    for (const env of [
      { MEXICOAPI_SIN_RED: "1" },
      { MEXICOAPI_SIN_RED: "1", MEXICOAPI_BASE: "https://api.example" },
    ]) {
      const fetch = vi.fn();
      const { cliente, conApi, descripcion } = configurar(env, { fetch });
      expect(conApi).toBe(false);
      expect(descripcion).toBe("datos del paquete, sin red");
      expect((await cliente.udi("2026-10-01")).origen).toBe("paquete");
      expect(fetch).not.toHaveBeenCalled();
    }
    // Solo 1 la apaga: otro valor no cambia nada.
    expect(configurar({ MEXICOAPI_SIN_RED: "0" }).conApi).toBe(true);
  });

  it("con MEXICOAPI_BASE consulta la API con el fetch dado", async () => {
    const fetch = vi.fn(async () => respuestaApi({ fecha: "2026-10-01", valor: "8.800000" }));
    const { cliente, conApi, descripcion } = configurar(
      { MEXICOAPI_BASE: "https://api.example/v1/" },
      { fetch },
    );
    expect(conApi).toBe(true);
    // Nunca dice la base: podría traer un token en la ruta.
    expect(descripcion).toBe("consulta la API de MEXICOAPI_BASE");
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
