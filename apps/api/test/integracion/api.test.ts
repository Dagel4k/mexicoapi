import { createHash } from "node:crypto";
import { describe, expect, inject, it } from "vitest";
import { probarHumo } from "../../scripts/humo.ts";
import {
  BASE_PROBLEMAS,
  datosDe,
  leerPublico,
  pedir,
  pedirCruda,
  pedirJson,
  registrosDe,
  SEGURIDAD,
  tipoDeMedio,
} from "./ayudas.js";

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

  it("/v1/municipios devuelve todos los municipios del manifiesto, sin claves repetidas", async () => {
    const { data, meta } = await datos("/v1/municipios");
    const registros = await registrosDe("inegi-municipios");
    expect(data).toHaveLength(registros);
    expect(new Set(data.map((m: Obj) => m.cvegeo)).size).toBe(registros);
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
    const registros = await registrosDe("bancos");
    expect(data).toHaveLength(registros);
    expect(new Set(data.map((b: Obj) => b.codigo)).size).toBe(registros);
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

  it("/v1/status: los datasets del meta interno; sin binding de KV, todos en unknown", async () => {
    const { data } = await datos("/v1/status");
    const interna = JSON.parse((await leerPublico("v1/_internos/meta.json")).toString("utf8")) as {
      datasets: Record<string, Obj>;
    };
    const ids = data.map((d: Obj) => d.dataset);
    expect(ids).toEqual(Object.keys(interna.datasets).sort());
    for (const d of data) {
      expect(d, d.dataset).toMatchObject({
        status: "unknown",
        last_attempt: null,
        last_success: null,
      });
    }
    // Solo las series traen cobertura, la misma del meta interno.
    const coberturas = Object.fromEntries(
      data.filter((d: Obj) => d.cobertura !== undefined).map((d: Obj) => [d.dataset, d.cobertura]),
    );
    expect(coberturas).toEqual({
      "tipo-cambio.fix": interna.datasets["tipo-cambio.fix"]?.cobertura,
      udis: interna.datasets.udis?.cobertura,
    });
    const registros = Object.fromEntries(data.map((d: Obj) => [d.dataset, d.records]));
    expect(registros).toEqual({
      bancos: await registrosDe("bancos"),
      "inegi.estados": 32,
      "inegi.municipios": await registrosDe("inegi-municipios"),
      "tipo-cambio.fix": await registrosDe("tipo-cambio-fix"),
      udis: await registrosDe("udis"),
    });
  });

  it("/v1/openapi.json es el documento del build", async () => {
    const respuesta = await pedir("/v1/openapi.json");
    expect(respuesta.status).toBe(200);
    expect(await respuesta.text()).toBe((await leerPublico("v1/openapi.json")).toString("utf8"));
  });
});

interface Fix {
  fecha_publicacion: string;
  valor: string;
}

interface Udi {
  fecha: string;
  valor: string;
}

const FIX = await datosDe<Fix>("tipo-cambio-fix");
const UDIS = await datosDe<Udi>("udis");

describe("tipo de cambio FIX y UDIS con los datos reales", () => {
  const fixDe = (fecha: string) => FIX.find((r) => r.fecha_publicacion === fecha);
  const ultimoFix = FIX.at(-1) as Fix;
  const ultimaUdi = UDIS.at(-1) as Udi;
  const coberturaFix = { desde: FIX[0]?.fecha_publicacion, hasta: ultimoFix.fecha_publicacion };
  const coberturaUdis = { desde: UDIS[0]?.fecha, hasta: ultimaUdi.fecha };

  /** Un 404 de serie: tipo, fecha pedida, cobertura de la serie y sin caché. */
  async function sinDato(ruta: string, tipo: string, fecha: string, cobertura: Obj) {
    const { respuesta, cuerpo } = await pedirJson(ruta);
    expect(respuesta.status, ruta).toBe(404);
    expect(respuesta.headers.get("Cache-Control"), ruta).toBe("no-store");
    expect(cuerpo, ruta).toMatchObject({ type: `${BASE_PROBLEMAS}${tipo}`, fecha, cobertura });
    return cuerpo as Obj;
  }

  it("los datos tienen los casos que se prueban", () => {
    expect(coberturaFix.desde).toBe("2020-01-02");
    expect(coberturaUdis.desde).toBe("2020-01-01");
    for (const fecha of ["2020-12-31", "2021-01-04", "2026-10-16"]) {
      expect(fixDe(fecha), fecha).toBeDefined();
    }
    // 2021-01-01 fue feriado bancario y luego fin de semana.
    for (const fecha of ["2021-01-01", "2021-01-02", "2021-01-03", "2026-10-10"]) {
      expect(fixDe(fecha), fecha).toBeUndefined();
    }
  });

  it("publicado: el FIX del día, con la meta del dataset y sin ETag", async () => {
    const respuesta = await pedir("/v1/tipo-cambio/fix?publicado=2026-10-16");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toMatch(/^public, max-age=3600/);
    expect(respuesta.headers.get("ETag")).toBeNull();
    const { data, meta } = (await respuesta.json()) as Obj;
    expect(data).toEqual(fixDe("2026-10-16"));
    expect(meta.dataset).toBe("tipo-cambio.fix");
    expect(meta.docs).toMatch(/\/api\/README\.md#tipo-de-cambio-fix$/);
    expect(meta.sources[0].license_url).toBe(
      "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
    );
  });

  it("operacion en lunes: el FIX del viernes anterior, con el CFF art. 20", async () => {
    const { data } = await datos("/v1/tipo-cambio/fix?operacion=2026-10-19");
    expect(data).toMatchObject({ fecha_operacion: "2026-10-19", ...fixDe("2026-10-16") });
    expect(data.fundamento.nombre).toMatch(/artículo 20/);
  });

  it.each(["2021-01-01", "2021-01-02", "2021-01-04"])(
    "operacion %s: cruza el cambio de año y usa la última publicación de diciembre",
    async (fecha) => {
      const { data } = await datos(`/v1/tipo-cambio/fix?operacion=${fecha}`);
      expect(data).toMatchObject({ fecha_operacion: fecha, ...fixDe("2020-12-31") });
    },
  );

  it("/v1/status: la cobertura de cada serie va de su primera a su última fecha", async () => {
    const { data } = await datos("/v1/status");
    const de = (id: string) => data.find((d: Obj) => d.dataset === id)?.cobertura;
    expect(de("tipo-cambio.fix")).toEqual(coberturaFix);
    expect(de("udis")).toEqual(coberturaUdis);
  });

  it("ultimo: la última publicación de la serie, con caché de 5 minutos y sin stale", async () => {
    const respuesta = await pedir("/v1/tipo-cambio/fix/ultimo");
    expect(respuesta.headers.get("Cache-Control")).toBe("public, max-age=300");
    await respuesta.arrayBuffer();
    const { data, meta } = await datos("/v1/tipo-cambio/fix/ultimo");
    expect(data).toEqual(ultimoFix);
    expect(meta.dataset).toBe("tipo-cambio.fix");
  });

  it.each(["2021-01-01", "2020-02-29", ultimaUdi.fecha])("udis %s: el valor del día", async (f) => {
    const { data, meta } = await datos(`/v1/udis?fecha=${f}`);
    expect(data).toEqual(UDIS.find((r) => r.fecha === f));
    expect(meta.dataset).toBe("udis");
    expect(meta.docs).toMatch(/\/api\/README\.md#udis$/);
  });

  it.each([
    ["/v1/tipo-cambio/fix?publicado=2026-10-10", "2026-10-10"],
    ["/v1/tipo-cambio/fix?publicado=2021-01-01", "2021-01-01"],
    ["/v1/tipo-cambio/fix?publicado=2019-12-31", "2019-12-31"],
    ["/v1/tipo-cambio/fix?operacion=2020-01-02", "2020-01-02"],
  ])("%s: 404 no-encontrado definitivo", async (ruta, fecha) => {
    await sinDato(ruta, "no-encontrado", fecha, coberturaFix);
  });

  it.each([
    ["/v1/tipo-cambio/fix?publicado=2099-01-02", "2099-01-02"],
    ["/v1/tipo-cambio/fix?operacion=2099-01-06", "2099-01-06"],
  ])("%s: 404 dato-no-disponible con el último dato cargado", async (ruta, fecha) => {
    const cuerpo = await sinDato(ruta, "dato-no-disponible", fecha, coberturaFix);
    expect(cuerpo.detail).toContain(ultimoFix.fecha_publicacion);
    expect(JSON.stringify(cuerpo)).not.toContain(ultimoFix.valor);
  });

  it("udis: 404 no-encontrado antes de la serie y dato-no-disponible después", async () => {
    await sinDato("/v1/udis?fecha=2019-12-31", "no-encontrado", "2019-12-31", coberturaUdis);
    const cuerpo = await sinDato(
      "/v1/udis?fecha=2099-01-01",
      "dato-no-disponible",
      "2099-01-01",
      coberturaUdis,
    );
    expect(cuerpo.detail).toContain(ultimaUdi.fecha);
  });

  it.each([
    ["/v1/tipo-cambio/fix", "parametro-faltante"],
    ["/v1/tipo-cambio/fix?publicado=2026-10-16&operacion=2026-10-19", "parametro-invalido"],
    ["/v1/tipo-cambio/fix?publicado=2026-02-30", "parametro-invalido"],
    ["/v1/udis", "parametro-faltante"],
  ])("%s: 400 %s", async (ruta, tipo) => {
    const { respuesta, cuerpo } = await pedirJson(ruta);
    expect(respuesta.status).toBe(400);
    expect(cuerpo).toMatchObject({ type: `${BASE_PROBLEMAS}${tipo}` });
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

  it.each(["/%76%31/_internos/meta.json", "//v1/_internos/meta.json"])(
    "%s no llega al meta interno: termina en 404 del Worker",
    async (ruta) => {
      const respuesta = await pedirCruda(ruta);
      expect(respuesta.status).toBe(404);
      expect(tipoDeMedio(respuesta)).toBe("application/problem+json");
      const cuerpo = (await respuesta.json()) as Obj;
      expect(cuerpo).toMatchObject({ status: 404, detail: "No existe la ruta." });
      expect(cuerpo).not.toHaveProperty("datasets");
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
  it.each([
    "/v1/estados/25",
    "/v1/status",
    "/v1/estados/33",
    "/v1/tipo-cambio/fix?operacion=2026-10-19",
    "/v1/udis?fecha=2099-01-01",
  ])("HEAD %s responde como GET, sin cuerpo", async (ruta) => {
    const get = await pedir(ruta);
    await get.arrayBuffer();
    const head = await pedir(ruta, { method: "HEAD" });
    expect(head.status).toBe(get.status);
    expect(await head.text()).toBe("");
    for (const nombre of ["Content-Type", "Cache-Control", "ETag"]) {
      expect(head.headers.get(nombre), nombre).toBe(get.headers.get(nombre));
    }
    esperarSeguridad(head, `HEAD ${ruta}`);
  });
});

describe("encabezados de seguridad", () => {
  it.each([
    ["GET", "/", 200],
    ["GET", "/v1/estados/25", 200],
    ["GET", "/v1/clabe/002010077777777771", 200],
    ["GET", "/v1/status", 200],
    ["GET", "/v1/tipo-cambio/fix/ultimo", 200],
    ["GET", "/v1/estados?x=1", 400],
    ["GET", "/v1/tipo-cambio/fix?publicado=2099-01-02", 404],
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

describe("prueba de humo", () => {
  it("pasa contra el Worker local", async () => {
    const resultado = await probarHumo(inject("urlApi"));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.ok).toBe(true);
  });
});
