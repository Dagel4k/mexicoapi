import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BASE_PROBLEMAS, leerPublico, pedir, pedirJson, SEGURIDAD, tipoDeMedio } from "./ayudas.js";

// biome-ignore lint/suspicious/noExplicitAny: los cuerpos JSON se inspeccionan de forma dinámica.
type Obj = Record<string, any>;

async function datos(ruta: string): Promise<Obj> {
  const { respuesta, cuerpo } = await pedirJson(ruta);
  expect(respuesta.status, ruta).toBe(200);
  expect(respuesta.headers.get("Content-Type"), ruta).toBe("application/json; charset=utf-8");
  return cuerpo as Obj;
}

function esperarSeguridad(respuesta: Response, contexto: string): void {
  for (const [nombre, valor] of Object.entries(SEGURIDAD)) {
    expect(respuesta.headers.get(nombre), `${contexto}: ${nombre}`).toBe(valor);
  }
}

describe("datos reales del build", () => {
  it("/ y /v1 devuelven el índice", async () => {
    const raiz = await datos("/");
    expect(raiz).toMatchObject({
      nombre: "MéxicoAPI",
      version: "v1",
      openapi: "/v1/openapi.json",
      status: "/v1/status",
      descargas: "/descargas/SHA256SUMS",
    });
    expect(await datos("/v1")).toEqual(raiz);
  });

  it("/v1/estados devuelve los 32 estados con su meta", async () => {
    const { data, meta } = await datos("/v1/estados");
    expect(data).toHaveLength(32);
    expect(data.map((e: Obj) => e.cve_ent)).toEqual(
      Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(meta.dataset).toBe("inegi.estados");
    expect(meta.sources.length).toBeGreaterThan(0);
  });

  it("/v1/estados/25 es Sinaloa", async () => {
    const { data } = await datos("/v1/estados/25");
    expect(data).toMatchObject({ cve_ent: "25", nombre: "Sinaloa", cvegeo: "25" });
  });

  it("/v1/estados/25/municipios trae solo municipios de Sinaloa, Culiacán incluido", async () => {
    const { data, meta } = await datos("/v1/estados/25/municipios");
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((m: Obj) => m.cve_ent === "25")).toBe(true);
    expect(data.map((m: Obj) => m.cvegeo)).toContain("25006");
    expect(meta.dataset).toBe("inegi.municipios");
  });

  it("/v1/municipios devuelve los 2,478 municipios", async () => {
    const { data, meta } = await datos("/v1/municipios");
    expect(data).toHaveLength(2478);
    expect(new Set(data.map((m: Obj) => m.cvegeo)).size).toBe(2478);
    expect(meta.dataset).toBe("inegi.municipios");
  });

  it("/v1/municipios/25006 es Culiacán", async () => {
    const { data } = await datos("/v1/municipios/25006");
    expect(data).toMatchObject({
      cvegeo: "25006",
      cve_ent: "25",
      cve_mun: "006",
      nombre: "Culiacán",
    });
  });

  it("/v1/bancos devuelve el catálogo completo del build", async () => {
    const { data, meta } = await datos("/v1/bancos");
    const enDisco = JSON.parse((await leerPublico("v1/bancos.json")).toString("utf8")) as Obj;
    expect(data.length).toBeGreaterThan(0);
    expect(data).toEqual(enDisco.data);
    expect(meta.dataset).toBe("bancos");
  });

  it("/v1/bancos/012 es BBVA", async () => {
    const { data } = await datos("/v1/bancos/012");
    expect(data.codigo).toBe("012");
    expect(data.nombre_corto).toMatch(/BBVA/);
  });

  it("/v1/clabe/{clabe} valida con el catálogo de bancos", async () => {
    const valida = await datos("/v1/clabe/002010077777777771");
    expect(valida.data).toMatchObject({ valido: true, errores: [] });
    expect(valida.data.detalle.banco.codigo).toBe("002");
    const malDigito = await datos("/v1/clabe/002010077777777770");
    expect(malDigito.data).toMatchObject({ valido: false, errores: ["digito_verificador"] });
  });

  it("/v1/dias-habiles salta el descanso obligatorio de febrero", async () => {
    // 2026-02-02 es el primer lunes de febrero (art. 74 LFT).
    const { data, meta } = await datos("/v1/dias-habiles?autoridad=lft&desde=2026-01-30&dias=1");
    expect(data).toMatchObject({ autoridad: "lft", desde: "2026-01-30", dias: 1 });
    expect(data.resultado).toBe("2026-02-03");
    expect(data.inhabiles_saltados.map((d: Obj) => d.fecha)).toEqual(["2026-02-02"]);
    expect(meta.dataset).toBe("dias-inhabiles.lft");
  });

  it("/v1/dias-inhabiles lista los días de descanso del año", async () => {
    const { data } = await datos("/v1/dias-inhabiles?autoridad=lft&anio=2026");
    const fechas = data.map((d: Obj) => d.fecha);
    expect(fechas).toEqual(expect.arrayContaining(["2026-01-01", "2026-09-16", "2026-12-25"]));
    expect(fechas.every((f: string) => f.startsWith("2026-"))).toBe(true);
  });

  it("/v1/status: sin binding de KV, todo dataset está en unknown", async () => {
    const { data } = await datos("/v1/status");
    const ids = data.map((d: Obj) => d.dataset);
    expect(ids).toEqual(["bancos", "inegi.estados", "inegi.municipios"]);
    for (const d of data) {
      expect(d, d.dataset).toMatchObject({
        status: "unknown",
        last_attempt: null,
        last_success: null,
      });
    }
    const registros = Object.fromEntries(data.map((d: Obj) => [d.dataset, d.records]));
    expect(registros["inegi.estados"]).toBe(32);
    expect(registros["inegi.municipios"]).toBe(2478);
  });

  it("/v1/openapi.json es el documento del build", async () => {
    const respuesta = await pedir("/v1/openapi.json");
    expect(respuesta.status).toBe(200);
    expect(await respuesta.text()).toBe((await leerPublico("v1/openapi.json")).toString("utf8"));
  });
});

describe("errores del Worker", () => {
  it.each([
    ["/v1/estados/33", "No existe el estado 33."],
    ["/v1/bancos/999", "No existe el banco 999."],
  ])("%s → 404 problem+json", async (ruta, detalle) => {
    const { respuesta, cuerpo } = await pedirJson(ruta);
    expect(respuesta.status).toBe(404);
    expect(respuesta.headers.get("Content-Type")).toBe("application/problem+json; charset=utf-8");
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    expect(cuerpo).toEqual({
      type: `${BASE_PROBLEMAS}no-encontrado`,
      title: "Recurso no encontrado",
      status: 404,
      detail: detalle,
      instance: ruta,
    });
  });

  it.each(["/v1/_internos/meta.json", "/v1/estados.json"])(
    "%s no se sirve como asset: 404 de ruta",
    async (ruta) => {
      const { respuesta, cuerpo } = await pedirJson(ruta);
      expect(respuesta.status).toBe(404);
      expect(tipoDeMedio(respuesta)).toBe("application/problem+json");
      expect(cuerpo).toMatchObject({ status: 404, detail: "No existe la ruta.", instance: ruta });
    },
  );

  it("un método que no es GET, HEAD ni OPTIONS → 405 con Allow", async () => {
    const respuesta = await pedir("/v1/estados", { method: "POST" });
    expect(respuesta.status).toBe(405);
    expect(respuesta.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(((await respuesta.json()) as Obj).type).toBe(`${BASE_PROBLEMAS}metodo-no-permitido`);
  });
});

describe("caché con ETag", () => {
  it.each(["/v1/estados", "/v1/estados/25", "/v1/municipios/25006", "/v1/bancos/012"])(
    "%s lleva ETag y responde 304 con If-None-Match",
    async (ruta) => {
      const primera = await pedir(ruta);
      await primera.arrayBuffer();
      const etag = primera.headers.get("ETag");
      expect(etag).toMatch(/^(?:W\/)?"[^"]+"$/);
      expect(primera.headers.get("Cache-Control")).toMatch(/^public, max-age=3600/);

      const condicional = await pedir(ruta, { headers: { "If-None-Match": etag as string } });
      expect(condicional.status).toBe(304);
      expect(await condicional.text()).toBe("");
      expect(condicional.headers.get("ETag")).toBe(etag);
      esperarSeguridad(condicional, `304 de ${ruta}`);

      const otra = await pedir(ruta, { headers: { "If-None-Match": '"otra"' } });
      expect(otra.status).toBe(200);
      await otra.arrayBuffer();
    },
  );
});

describe("HEAD", () => {
  it.each(["/v1/estados/25", "/v1/status", "/v1/estados/33"])(
    "HEAD %s responde como GET, sin cuerpo",
    async (ruta) => {
      const get = await pedir(ruta);
      await get.arrayBuffer();
      const head = await pedir(ruta, { method: "HEAD" });
      expect(head.status).toBe(get.status);
      expect(await head.text()).toBe("");
      for (const nombre of ["Content-Type", "Cache-Control", "ETag"]) {
        expect(head.headers.get(nombre), nombre).toBe(get.headers.get(nombre));
      }
      esperarSeguridad(head, `HEAD ${ruta}`);
    },
  );
});

describe("encabezados de seguridad", () => {
  it.each([
    ["GET", "/", 200],
    ["GET", "/v1/estados/25", 200],
    ["GET", "/v1/clabe/002010077777777771", 200],
    ["GET", "/v1/status", 200],
    ["GET", "/v1/estados?x=1", 400],
    ["GET", "/v1/estados/33", 404],
    ["GET", "/no-existe", 404],
    ["POST", "/v1/estados", 405],
    ["OPTIONS", "/v1/estados", 204],
    ["GET", "/v1/estados/", 308],
  ])("%s %s (%i) los lleva todos", async (metodo, ruta, estado) => {
    const respuesta = await pedir(ruta, { method: metodo });
    expect(respuesta.status).toBe(estado);
    esperarSeguridad(respuesta, `${metodo} ${ruta}`);
    await respuesta.arrayBuffer();
  });
});

describe("descargas", () => {
  it("/descargas/inegi-estados.csv: CSV en UTF-8 con CORS de _headers", async () => {
    const respuesta = await pedir("/descargas/inegi-estados.csv");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(respuesta.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(respuesta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(respuesta.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    const texto = await respuesta.text();
    // RFC 4180: líneas con CRLF.
    expect(texto.split("\r\n")[0]).toBe("cve_ent,nombre,abreviatura,cvegeo");
    expect(texto).toContain("\r\n25,Sinaloa,");
  });

  it("/descargas/mexicoapi.sqlite: application/vnd.sqlite3", async () => {
    const respuesta = await pedir("/descargas/mexicoapi.sqlite");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    expect(bytes.subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
  });

  it("SHA256SUMS coincide con los bytes servidos", async () => {
    const respuesta = await pedir("/descargas/SHA256SUMS");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const lineas = (await respuesta.text()).trimEnd().split("\n");
    expect(lineas.length).toBeGreaterThan(0);
    const archivos: string[] = [];
    for (const linea of lineas) {
      const partes = /^([0-9a-f]{64}) {2}(\S+)$/.exec(linea);
      expect(partes, linea).not.toBeNull();
      const [, suma, archivo] = partes as RegExpExecArray;
      const servido = await pedir(`/descargas/${archivo}`);
      expect(servido.status, archivo).toBe(200);
      const bytes = Buffer.from(await servido.arrayBuffer());
      expect(createHash("sha256").update(bytes).digest("hex"), archivo).toBe(suma);
      archivos.push(archivo as string);
    }
    expect(archivos).toEqual(expect.arrayContaining(["inegi-estados.csv", "mexicoapi.sqlite"]));
  });
});
