import { describe, expect, it } from "vitest";
import type { Entorno } from "../../src/entorno.js";
import worker, { manejar } from "../../src/index.js";
import { CACHE_DATOS } from "../../src/respuestas.js";
import { crearAssets, entornoDe, peticion, SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

const INDICE = {
  nombre: "MéxicoAPI",
  version: "v1",
  documentacion: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md",
  openapi: "/v1/openapi.json",
  status: "/v1/status",
  descargas: "/descargas/SHA256SUMS",
};

async function pedir(ruta: string, init?: RequestInit, extra: Partial<Entorno> = {}) {
  const assets = crearAssets();
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets, extra));
  return { respuesta, assets };
}

describe("índice", () => {
  for (const ruta of ["/", "/v1"]) {
    it(`${ruta} describe la API`, async () => {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json()).toEqual(INDICE);
      expect(assets.pedidas).toEqual([]);
    });
  }

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    const get = (await pedir("/v1")).respuesta;
    const { respuesta } = await pedir("/v1", { method: "HEAD" });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toBeNull();
    expect([...respuesta.headers]).toEqual([...get.headers]);
  });
});

describe("métodos", () => {
  it("OPTIONS responde 204 con CORS, en cualquier ruta", async () => {
    for (const ruta of ["/v1/estados", "/v1/no-existe"]) {
      const { respuesta, assets } = await pedir(ruta, { method: "OPTIONS" });
      expect(respuesta.status).toBe(204);
      expect(respuesta.body).toBeNull();
      expect(respuesta.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
      expect(respuesta.headers.get("access-control-allow-headers")).toBe("If-None-Match");
      expect(respuesta.headers.get("access-control-max-age")).toBe("86400");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(assets.pedidas).toEqual([]);
    }
  });

  for (const metodo of ["POST", "PUT", "DELETE", "PATCH", "TRACE-X"]) {
    it(`${metodo} da 405 con Allow`, async () => {
      const { respuesta, assets } = await pedir("/v1/estados", { method: metodo });
      expect(respuesta.status).toBe(405);
      expect(respuesta.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe("no-store");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json()).toEqual({
        type: `${TIPO}metodo-no-permitido`,
        title: "Método no permitido",
        status: 405,
        detail: "Solo se permiten GET, HEAD y OPTIONS.",
        instance: "/v1/estados",
      });
      expect(assets.pedidas).toEqual([]);
    });
  }
});

describe("barra final", () => {
  it("redirige con 308 a la ruta sin barra y conserva la query", async () => {
    for (const [ruta, destino] of [
      ["/v1/", "/v1"],
      ["/v1/estados/25/", "/v1/estados/25"],
      ["/v1/estados/25/?x=1&y=2", "/v1/estados/25?x=1&y=2"],
      ["/v1/estados//", "/v1/estados"],
      ["/no-existe/", "/no-existe"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(308);
      expect(respuesta.headers.get("location"), ruta).toBe(destino);
      expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
      expect(respuesta.body).toBeNull();
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(assets.pedidas).toEqual([]);
    }
  });

  it("HEAD también redirige", async () => {
    const { respuesta } = await pedir("/v1/estados/", { method: "HEAD" });
    expect(respuesta.status).toBe(308);
    expect(respuesta.headers.get("location")).toBe("/v1/estados");
  });

  it("nunca redirige a otro origen", async () => {
    for (const ruta of ["//evil.example/", "//evil.example//", "//", "///"]) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(404);
      expect(respuesta.headers.get("location"), ruta).toBeNull();
      expect(assets.pedidas).toEqual([]);
    }
  });
});

describe("rutas hostiles", () => {
  it("dan 404 problem+json sin tocar ASSETS", async () => {
    for (const ruta of [
      "/v1/estados/%32%35",
      "/v1/estados/２５",
      "/V1/estados",
      "/v1/estados/25/municipios/extra",
      "/v1/estados/%2e%2e%2f",
      "/v1/estados/%2e%2e%2fbancos",
      "/v1/estados/%00",
      "/v1/estados/25%2fmunicipios",
      "/v1/estados.json",
      "/v1/_internos/meta.json",
      "/v1/openapi",
      "/descargas/../v1/_internos/meta.json",
    ]) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(404);
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json(), ruta).toMatchObject({
        type: `${TIPO}no-encontrado`,
        status: 404,
        detail: "No existe la ruta.",
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("un valor con la estructura de una ruta conocida da 400 y nombra el parámetro", async () => {
    for (const [ruta, parametro] of [
      ["/v1/estados/2a", "cve_ent"],
      ["/v1/estados/250", "cve_ent"],
      ["/v1/estados/25.json", "cve_ent"],
      ["/v1/estados/2;5", "cve_ent"],
      ["/v1/estados/25.json/municipios", "cve_ent"],
      ["/v1/estados/2a/municipios", "cve_ent"],
      ["/v1/municipios/2500", "cvegeo"],
      ["/v1/municipios/25006.json", "cvegeo"],
      ["/v1/bancos/12", "codigo"],
      ["/v1/bancos/0012", "codigo"],
      ["/v1/bancos/01a", "codigo"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json(), ruta).toMatchObject({
        type: `${TIPO}parametro-invalido`,
        status: 400,
        parametro,
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("los detalles de parámetro inválido dicen el formato", async () => {
    const detalle = async (ruta: string) =>
      ((await (await pedir(ruta)).respuesta.json()) as { detail: string }).detail;
    expect(await detalle("/v1/estados/2a")).toBe(
      "La clave de estado (cve_ent) debe tener 2 dígitos.",
    );
    expect(await detalle("/v1/municipios/2")).toBe(
      "La clave de municipio (cvegeo) debe tener 5 dígitos.",
    );
    expect(await detalle("/v1/bancos/2")).toBe("El código de banco debe tener 3 dígitos.");
  });
});

describe("query", () => {
  it("cualquier parámetro en una ruta sin parámetros es desconocido", async () => {
    for (const [ruta, parametro] of [
      ["/v1/estados?x=1", "x"],
      ["/v1/estados?x=1&x=2", "x"],
      ["/v1/estados?x=", "x"],
      ["/v1/estados/25?_=123", "_"],
      ["/?a", "a"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toMatchObject({
        type: `${TIPO}parametro-desconocido`,
        parametro,
        instance: ruta.slice(0, ruta.indexOf("?")),
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("un ? sin parámetros no cuenta", async () => {
    const { respuesta } = await pedir("/v1?");
    expect(respuesta.status).toBe(200);
  });
});

describe("límite de peticiones", () => {
  function limite(resultado: () => Promise<{ success: boolean }>) {
    const claves: string[] = [];
    const binding = {
      limit: (opciones: { key: string }) => {
        claves.push(opciones.key);
        return resultado();
      },
    } as RateLimit;
    return { binding, claves };
  }

  it("rechaza con 429 y Retry-After antes de enrutar", async () => {
    const { binding, claves } = limite(async () => ({ success: false }));
    const { respuesta, assets } = await pedir(
      "/v1/estados/25",
      { headers: { "CF-Connecting-IP": "203.0.113.7" } },
      { LIMITE: binding },
    );
    expect(respuesta.status).toBe(429);
    expect(respuesta.headers.get("retry-after")).toBe("60");
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}demasiadas-peticiones`,
      status: 429,
    });
    expect(claves).toEqual(["ip:203.0.113.7"]);
    expect(assets.pedidas).toEqual([]);
  });

  it("también limita OPTIONS y métodos no permitidos", async () => {
    const { binding } = limite(async () => ({ success: false }));
    for (const method of ["OPTIONS", "POST"]) {
      const { respuesta } = await pedir("/v1", { method }, { LIMITE: binding });
      expect(respuesta.status).toBe(429);
    }
  });

  it("deja pasar si el límite lo permite; sin IP usa una clave fija", async () => {
    const { binding, claves } = limite(async () => ({ success: true }));
    const { respuesta } = await pedir("/v1", {}, { LIMITE: binding });
    expect(respuesta.status).toBe(200);
    expect(claves).toEqual(["ip:desconocida"]);
  });

  it("si el binding lanza, deja pasar", async () => {
    const { binding } = limite(async () => {
      throw new Error("sin servicio");
    });
    const { respuesta } = await pedir("/v1", {}, { LIMITE: binding });
    expect(respuesta.status).toBe(200);
  });
});

describe("errores no previstos", () => {
  it("responden 500 genérico sin detalles internos", async () => {
    const assets = crearAssets({}, { fallar: true });
    const respuesta = await manejar(peticion("/v1/estados"), entornoDe(assets));
    expect(respuesta.status).toBe(500);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    const texto = await respuesta.text();
    expect(JSON.parse(texto)).toEqual({
      type: `${TIPO}error-interno`,
      title: "Error interno",
      status: 500,
      detail: "Ocurrió un error interno.",
      instance: "/v1/estados",
    });
    expect(texto).not.toMatch(/ruta\/interna|binding|Error:|at /);
  });

  it("con HEAD, sin cuerpo", async () => {
    const assets = crearAssets({}, { fallar: true });
    const respuesta = await manejar(peticion("/v1/estados", { method: "HEAD" }), entornoDe(assets));
    expect(respuesta.status).toBe(500);
    expect(respuesta.body).toBeNull();
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
  });
});

describe("export por omisión", () => {
  it("delega en manejar", async () => {
    const assets = crearAssets();
    const r = await worker.fetch(
      peticion("/v1/no-existe") as Parameters<typeof worker.fetch>[0],
      entornoDe(assets),
    );
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ instance: "/v1/no-existe" });
  });
});
