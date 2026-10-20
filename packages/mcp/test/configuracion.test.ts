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
  });

  // Antes solo "1" apagaba la red y cualquier otro valor ("true", "sí") la dejaba encendida sin
  // decir nada. Ahora acepta los valores verdaderos y falsos comunes y rechaza los demás.
  it("MEXICOAPI_SIN_RED acepta los valores verdaderos comunes, sin distinguir mayúsculas", () => {
    for (const valor of ["1", "true", "TRUE", "yes", "Yes", "si", "sí", "SÍ", "on", " 1 ", "On"]) {
      const fetch = vi.fn();
      expect(configurar({ MEXICOAPI_SIN_RED: valor }, { fetch }).conApi, valor).toBe(false);
    }
  });

  it("MEXICOAPI_SIN_RED con un valor falso o vacío deja la API", () => {
    for (const valor of ["0", "false", "FALSE", "no", "NO", "off", "", "  "]) {
      expect(configurar({ MEXICOAPI_SIN_RED: valor }).conApi, valor).toBe(true);
    }
    expect(configurar({}).conApi).toBe(true);
  });

  it("MEXICOAPI_SIN_RED con otro valor no arranca y no repite el valor", () => {
    for (const valor of ["2", "verdadero", "y", "tal-vez", "SECRETO-123", "1 0"]) {
      let error: unknown;
      try {
        configurar({ MEXICOAPI_SIN_RED: valor, MEXICOAPI_BASE: "https://api.example" });
      } catch (e) {
        error = e;
      }
      expect(error, valor).toBeInstanceOf(ErrorConfiguracion);
      const mensaje = (error as Error).message;
      expect(mensaje).toBe(
        "MEXICOAPI_SIN_RED no es válida: usa 1, true, yes, si u on para responder sin red, o 0, false, no, off o nada para consultar la API.",
      );
      expect(mensaje).not.toContain("SECRETO");
    }
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

  it("rechaza una base http:// fuera del equipo y pide https", () => {
    for (const base of ["http://api.example", "http://api.example/v1/TOKEN-SECRETO"]) {
      let error: unknown;
      try {
        configurar({ MEXICOAPI_BASE: base });
      } catch (e) {
        error = e;
      }
      expect(error, base).toBeInstanceOf(ErrorConfiguracion);
      const mensaje = (error as Error).message;
      expect(mensaje).toBe(
        "MEXICOAPI_BASE no es válida: base con http:// solo se acepta para localhost, 127.0.0.1 o [::1]; para otro host usa https://, como https://mexicoapi.example.workers.dev.",
      );
      expect(mensaje).not.toContain("TOKEN-SECRETO");
    }
  });

  it("acepta una base http:// en localhost, 127.0.0.1 o [::1]", async () => {
    for (const base of ["http://localhost:8787", "http://127.0.0.1:8787/", "http://[::1]:8787"]) {
      const fetch = vi.fn(async () => respuestaApi({ fecha: "2026-10-01", valor: "8.800000" }));
      const { cliente, conApi } = configurar({ MEXICOAPI_BASE: base }, { fetch });
      expect(conApi).toBe(true);
      expect((await cliente.udi("2026-10-01")).origen).toBe("api");
      expect(fetch).toHaveBeenCalledWith(
        `${base.replace(/\/$/, "")}/v1/udis?fecha=2026-10-01`,
        expect.anything(),
      );
    }
  });
});
