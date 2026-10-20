import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entorno } from "../../src/entorno.js";
import worker, { manejar, sinBarrasFinales } from "../../src/index.js";
import * as respuestas from "../../src/respuestas.js";
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
  sitio: "/",
  llms: "/llms.txt",
};

async function pedir(ruta: string, init?: RequestInit, extra: Partial<Entorno> = {}) {
  const assets = crearAssets();
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets, extra));
  return { respuesta, assets };
}

describe("índice", () => {
  it("/v1 describe la API", async () => {
    const { respuesta, assets } = await pedir("/v1");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    expect(await respuesta.json()).toEqual(INDICE);
    expect(assets.pedidas).toEqual([]);
  });

  // La raíz es la página de inicio del sitio: la sirven los assets sin pasar por el Worker.
  it("/ no es una ruta del Worker", async () => {
    const { respuesta } = await pedir("/");
    expect(respuesta.status).toBe(404);
    expect(((await respuesta.json()) as { type: string }).type).toMatch(/#no-encontrado$/);
  });

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

describe("http", () => {
  const HTTPS_REQUERIDO = {
    type: `${TIPO}https-requerido`,
    title: "Se requiere HTTPS",
    status: 403,
    detail: "La API solo acepta HTTPS; repite la petición con https:// y la misma ruta.",
  };

  /** Pide `url` completa (con su esquema) y cuenta las llamadas al límite de peticiones. */
  async function pedirUrl(url: string, init?: RequestInit) {
    const assets = crearAssets();
    const claves: string[] = [];
    const LIMITE = {
      limit: async ({ key }: { key: string }) => {
        claves.push(key);
        return { success: true };
      },
    } as RateLimit;
    const respuesta = await manejar(new Request(url, init), entornoDe(assets, { LIMITE }));
    return { respuesta, assets, claves };
  }

  it("una petición a /v1 por http da 403 https-requerido, sin redirigir", async () => {
    for (const ruta of ["/v1", "/v1/estados/25", "/v1/no-existe", "/v1/udis?fecha=x"]) {
      const { respuesta, assets } = await pedirUrl(`http://mexicoapi.dagel4k.workers.dev${ruta}`);
      expect(respuesta.status, ruta).toBe(403);
      expect(respuesta.headers.get("location"), ruta).toBeNull();
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe("no-store");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json(), ruta).toEqual({
        ...HTTPS_REQUERIDO,
        instance: new URL(ruta, "http://x").pathname,
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("gana a la 308 de la barra final y a cualquier método: HEAD sin cuerpo, OPTIONS y POST", async () => {
    const base = "http://api.test";
    const conBarra = await pedirUrl(`${base}/v1/estados/`);
    expect(conBarra.respuesta.status).toBe(403);
    expect(conBarra.respuesta.headers.get("location")).toBeNull();
    for (const method of ["HEAD", "OPTIONS", "POST", "DELETE"]) {
      const { respuesta } = await pedirUrl(`${base}/v1/estados`, { method });
      expect(respuesta.status, method).toBe(403);
      expect(respuesta.headers.get("allow"), method).toBeNull();
      expect(respuesta.headers.get("access-control-allow-methods"), method).toBeNull();
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      if (method === "HEAD") expect(respuesta.body).toBeNull();
      else expect(await respuesta.json(), method).toMatchObject(HTTPS_REQUERIDO);
    }
  });

  it("se responde antes del límite de peticiones: no lo consulta", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
      const { respuesta, claves } = await pedirUrl("http://api.test/v1/estados", { method });
      expect(respuesta.status, method).toBe(403);
      expect(claves, method).toEqual([]);
    }
  });

  it("los hosts locales aceptan http: wrangler dev y las pruebas de integración", async () => {
    for (const origen of [
      "http://localhost:8787",
      "http://localhost",
      "http://127.0.0.1:51234",
      "http://[::1]:8787",
    ]) {
      const { respuesta, claves } = await pedirUrl(`${origen}/v1`);
      expect(respuesta.status, origen).toBe(200);
      expect(claves, origen).toEqual(["ip:desconocida"]);
    }
  });

  it("otro host, aunque se parezca a uno local, no", async () => {
    for (const origen of [
      "http://localhost.example",
      "http://127.0.0.2",
      "http://0.0.0.0:8787",
      "http://[::2]",
      "http://api.test:443",
    ]) {
      const { respuesta } = await pedirUrl(`${origen}/v1`);
      expect(respuesta.status, origen).toBe(403);
    }
  });

  it("por https responde igual que siempre", async () => {
    const { respuesta, claves } = await pedirUrl("https://mexicoapi.dagel4k.workers.dev/v1");
    expect(respuesta.status).toBe(200);
    expect(claves).toEqual(["ip:desconocida"]);
  });
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

  it("una racha de 10 mil / antes de otro carácter redirige a la ruta sin la barra final", async () => {
    const racha = "/".repeat(10_000);
    const { respuesta } = await pedir(`/v1${racha}x/`);
    expect(respuesta.status).toBe(308);
    expect(respuesta.headers.get("location")).toBe(`/v1${racha}x`);
    for (const ruta of [`${racha}/`, `/${racha}evil.example/`]) {
      const otra = (await pedir(ruta)).respuesta;
      expect(otra.status).toBe(404);
      expect(otra.headers.get("location")).toBeNull();
    }
  });

  it("sinBarrasFinales lee cada carácter del final una sola vez, aunque haya otra racha antes", () => {
    // Con /\/+$/ el motor prueba desde cada / de la primera racha (cuadrático); aquí se cuentan
    // las lecturas: las 10 mil / del final más la x que corta.
    const racha = "/".repeat(10_000);
    const real = `/v1${racha}x${racha}`;
    let lecturas = 0;
    const espia = {
      length: real.length,
      charCodeAt: (i: number) => {
        lecturas += 1;
        return real.charCodeAt(i);
      },
      slice: (desde: number, hasta?: number) => real.slice(desde, hasta),
    } as unknown as string;
    expect(sinBarrasFinales(espia)).toBe(`/v1${racha}x`);
    expect(lecturas).toBe(10_001);
    expect(sinBarrasFinales("/")).toBe("");
    expect(sinBarrasFinales("/v1")).toBe("/v1");
    expect(sinBarrasFinales("")).toBe("");
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

  // Los patrones aceptan solo 0-9: un dígito de ancho completo o árabe-índico en la query se
  // decodifica y no cumple la regla.
  it("un dígito que no es ASCII en la query da 400 y nombra el parámetro", async () => {
    for (const [ruta, parametro] of [
      ["/v1/dias-inhabiles?autoridad=lft&anio=２０２６", "anio"],
      ["/v1/dias-inhabiles?autoridad=lft&anio=٢٠٢٦", "anio"],
      ["/v1/dias-habiles?autoridad=lft&desde=2026-01-05&dias=１０", "dias"],
      ["/v1/dias-habiles?autoridad=lft&desde=２０２６-01-05&dias=10", "desde"],
      ["/v1/udis?fecha=2026-01-0５", "fecha"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toMatchObject({
        type: `${TIPO}parametro-invalido`,
        parametro,
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
      ["/v1?a", "a"],
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

  it("un nombre desconocido con un carácter de control va entre comillas y escapado en el detail", async () => {
    const { respuesta } = await pedir("/v1/udis?fecha=2026-01-05&fecha%00=1");
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({
      type: `${TIPO}parametro-desconocido`,
      title: "Parámetro desconocido",
      status: 400,
      detail: 'Esta ruta no acepta el parámetro "fecha\\u0000".',
      instance: "/v1/udis",
      parametro: "fecha\u0000",
    });
  });

  it("una query con segmentos vacíos da 400 sin tocar ASSETS", async () => {
    for (const ruta of ["/v1/estados?&", "/v1/estados?&&", "/v1?a=1&&b=2", "/v1?=1"]) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toEqual({
        type: `${TIPO}parametro-invalido`,
        title: "Parámetro inválido",
        status: 400,
        detail: "La query tiene un parámetro sin nombre.",
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
    expect(respuesta.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}demasiadas-peticiones`,
      status: 429,
    });
    expect(claves).toEqual(["ip:203.0.113.7"]);
    expect(assets.pedidas).toEqual([]);
  });

  it("también limita los métodos no permitidos", async () => {
    const { binding } = limite(async () => ({ success: false }));
    for (const method of ["POST", "DELETE"]) {
      const { respuesta } = await pedir("/v1", { method }, { LIMITE: binding });
      expect(respuesta.status).toBe(429);
    }
  });

  // Un preflight que no es 2xx falla como error CORS: el navegador no deja ver el 429 ni su
  // Retry-After. Responderlo no toca datos, así que no gasta del límite.
  it("OPTIONS responde 204 sin consultar el límite, aunque esté agotado", async () => {
    const { binding, claves } = limite(async () => ({ success: false }));
    for (const ruta of ["/v1/estados", "/v1/no-existe", "/v1/estados/"]) {
      const { respuesta } = await pedir(
        ruta,
        { method: "OPTIONS", headers: { "CF-Connecting-IP": "203.0.113.7" } },
        { LIMITE: binding },
      );
      expect(respuesta.status, ruta).toBe(204);
      expect(respuesta.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    }
    expect(claves).toEqual([]);
  });

  it("deja pasar si el límite lo permite; sin IP usa una clave fija", async () => {
    const { binding, claves } = limite(async () => ({ success: true }));
    const { respuesta } = await pedir("/v1", {}, { LIMITE: binding });
    expect(respuesta.status).toBe(200);
    expect(claves).toEqual(["ip:desconocida"]);
  });

  it("las IPv6 de un mismo /64 comparten clave; las IPv4 van completas", async () => {
    const { binding, claves } = limite(async () => ({ success: true }));
    for (const ip of [
      "2001:db8:1:2::5",
      "2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd",
      "203.0.113.7",
    ]) {
      await pedir("/v1", { headers: { "CF-Connecting-IP": ip } }, { LIMITE: binding });
    }
    expect(claves).toEqual(["ip:2001:db8:1:2::/64", "ip:2001:db8:1:2::/64", "ip:203.0.113.7"]);
  });

  it("si el binding lanza, deja pasar y lo registra en una línea", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { binding } = limite(async () => {
      throw new TypeError("sin servicio: /ruta/interna");
    });
    const { respuesta } = await pedir("/v1", {}, { LIMITE: binding });
    expect(respuesta.status).toBe(200);
    expect(aviso.mock.calls).toEqual([
      ["mexicoapi: aviso: el límite de peticiones falló (TypeError); la petición pasa sin límite"],
    ]);
    aviso.mockRestore();
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

describe("registro de errores internos", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const espiar = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("deja una línea con el nombre del error y la plantilla, sin URL, query, IP ni mensaje", async () => {
    const consola = espiar();
    const assets = crearAssets({}, { fallar: true });
    const respuesta = await manejar(
      peticion("/v1/estados/25", { headers: { "CF-Connecting-IP": "203.0.113.7" } }),
      entornoDe(assets),
    );
    expect(respuesta.status).toBe(500);
    expect(consola.mock.calls).toEqual([
      ["mexicoapi: error interno: Error en /v1/estados/{cve_ent}"],
    ]);
    const linea = String(consola.mock.calls[0]?.[0]);
    for (const dato of ["25", "203.0.113.7", "ruta/interna", "binding", "api.test"]) {
      expect(linea).not.toContain(dato);
    }
  });

  it("un nombre de error raro o algo que no es Error se registra como desconocido", async () => {
    const consola = espiar();
    const raro = new Error("x");
    raro.name = "Error con /v1/estados/25?x=1";
    for (const lanzado of [raro, "texto", 42]) {
      const binding = { fetch: () => Promise.reject(lanzado) } as unknown as Fetcher;
      const respuesta = await manejar(peticion("/v1/bancos/012"), { ASSETS: binding });
      expect(respuesta.status).toBe(500);
    }
    expect(consola.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [
        "mexicoapi: error interno: desconocido en /v1/bancos/{codigo}",
      ]),
    );
  });

  it("una falla al quitar el cuerpo de un HEAD sale como 500 sin cuerpo", async () => {
    const consola = espiar();
    vi.spyOn(respuestas, "sinCuerpo").mockRejectedValue(new TypeError("cuerpo bloqueado"));
    for (const [ruta, plantilla] of [
      ["/v1", "/v1"],
      ["/v1/no-existe", "(sin ruta)"],
    ] as const) {
      const respuesta = await manejar(peticion(ruta, { method: "HEAD" }), entornoDe(crearAssets()));
      expect(respuesta.status, ruta).toBe(500);
      expect(respuesta.body, ruta).toBeNull();
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe("no-store");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(consola).toHaveBeenLastCalledWith(
        `mexicoapi: error interno: TypeError en ${plantilla}`,
      );
    }
  });

  it("una respuesta normal no registra nada", async () => {
    const consola = espiar();
    await pedir("/v1/no-existe");
    await pedir("/v1", { method: "HEAD" });
    expect(consola).not.toHaveBeenCalled();
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
