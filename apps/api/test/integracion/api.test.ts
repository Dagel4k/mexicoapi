import { createHash } from "node:crypto";
import { AVISO_LFT_715, diaDeLaSemana, sumarDias } from "@mexicoapi/core";
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
  it("/v1 devuelve el índice", async () => {
    expect(await datos("/v1")).toMatchObject({
      nombre: "MéxicoAPI",
      version: "v1",
      openapi: "/v1/openapi.json",
      status: "/v1/status",
      descargas: "/descargas/SHA256SUMS",
    });
  });

  it("/ es la página de inicio del build", async () => {
    const respuesta = await pedir("/");
    expect(respuesta.status).toBe(200);
    expect(tipoDeMedio(respuesta)).toBe("text/html");
    expect(await respuesta.text()).toContain("<h1>MéxicoAPI</h1>");
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
    // Nuevo: toda respuesta lft avisa que no tiene las suspensiones de labores (art. 715).
    expect(data.advertencias).toEqual([AVISO_LFT_715]);
  });

  it("/v1/dias-habiles lft no descuenta el Viernes Santo y lo advierte", async () => {
    const { data } = await datos("/v1/dias-habiles?autoridad=lft&desde=2026-03-31&dias=3");
    expect(data.resultado).toBe("2026-04-03");
    expect(data.advertencias).toEqual([AVISO_LFT_715]);
  });

  it("/v1/dias-inhabiles lista los días de descanso del año", async () => {
    const cuerpo = await datos("/v1/dias-inhabiles?autoridad=lft&anio=2026");
    const fechas = cuerpo.data.map((d: Obj) => d.fecha);
    expect(fechas).toEqual(expect.arrayContaining(["2026-01-01", "2026-09-16", "2026-12-25"]));
    expect(fechas.every((f: string) => f.startsWith("2026-"))).toBe(true);
    // Nuevo: la lista de la LFT lleva el mismo aviso fijo.
    expect(cuerpo.advertencias).toEqual([AVISO_LFT_715]);
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

  describe("feriados bancarios de la CNBV", () => {
    interface ShardCnbv {
      plazos: { general: { cobertura: { desde: string; hasta: string } } };
      dias: { fecha: string }[];
    }
    /** El calendario de la CNBV que lee el Worker. */
    const leerCnbv = async () =>
      JSON.parse(
        (await leerPublico("v1/_internos/calendarios/cnbv.json")).toString("utf8"),
      ) as ShardCnbv;
    const finDeSemana = (fecha: string) => [0, 6].includes(diaDeLaSemana(fecha));

    it("ningún feriado bancario entre semana ya cargado tiene FIX: el supuesto de la certeza", async () => {
      const { dias } = await leerCnbv();
      const entreSemana = dias
        .map((d) => d.fecha)
        .filter((f) => f <= ultimoFix.fecha_publicacion && !finDeSemana(f));
      expect(entreSemana.length).toBeGreaterThan(0);
      expect(entreSemana.filter((f) => fixDe(f) !== undefined)).toEqual([]);
    });

    it("lunes 17 de noviembre de 2025: sin publicación, y la operación del martes usa el viernes 14", async () => {
      await sinDato(
        "/v1/tipo-cambio/fix?publicado=2025-11-17",
        "no-encontrado",
        "2025-11-17",
        coberturaFix,
      );
      const { data } = await datos("/v1/tipo-cambio/fix?operacion=2025-11-18");
      expect(data).toMatchObject({ fecha_operacion: "2025-11-18", ...fixDe("2025-11-14") });
    });

    // Después del último dato solo pueden faltar fines de semana y días de descanso de la CNBV
    // dentro de su cobertura. La respuesta esperada depende de hasta dónde llegue la serie el día
    // de la prueba: antes del feriado da dato-no-disponible; la mañana después, ya responde.
    it.each([
      ["publicado", "2026-11-02"],
      ["operacion", "2026-11-03"],
      ["publicado", "2026-11-16"],
      ["operacion", "2026-11-17"],
    ])("%s=%s: responde lo que permite el calendario con lo cargado", async (modo, fecha) => {
      const { plazos, dias } = await leerCnbv();
      const { desde, hasta } = plazos.general.cobertura;
      const descanso = new Set(dias.map((d) => d.fecha));
      const sinPublicacion = (f: string) =>
        finDeSemana(f) || (f >= desde && f <= hasta && descanso.has(f));
      const fin = modo === "publicado" ? fecha : sumarDias(fecha, -1);
      let cierta = true;
      for (let f = sumarDias(ultimoFix.fecha_publicacion, 1); f <= fin; f = sumarDias(f, 1)) {
        if (!sinPublicacion(f)) cierta = false;
      }
      const ruta = `/v1/tipo-cambio/fix?${modo}=${fecha}`;
      if (!cierta) {
        const cuerpo = await sinDato(ruta, "dato-no-disponible", fecha, coberturaFix);
        expect(JSON.stringify(cuerpo)).not.toContain(ultimoFix.valor);
      } else if (modo === "publicado") {
        await sinDato(ruta, "no-encontrado", fecha, coberturaFix);
      } else {
        const { data } = await datos(ruta);
        const aplica = FIX.filter((r) => r.fecha_publicacion < fecha).at(-1);
        expect(data).toMatchObject({ fecha_operacion: fecha, ...aplica });
      }
    });
  });

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
    ["GET", "/v1", 200],
    ["GET", "/v1/estados/25", 200],
    ["GET", "/v1/clabe/002010077777777771", 200],
    ["GET", "/v1/status", 200],
    ["GET", "/v1/tipo-cambio/fix/ultimo", 200],
    ["GET", "/v1/estados?x=1", 400],
    ["GET", "/v1/tipo-cambio/fix?publicado=2099-01-02", 404],
    ["GET", "/v1/estados/33", 404],
    ["GET", "/v1/no-existe", 404],
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

interface DiaReal {
  fecha: string;
  autoridad: string;
  motivo: string;
  tipo: string;
  fuente: Obj;
}

const DIAS_SAT = await datosDe<DiaReal>("dias-inhabiles-sat");
const DIAS_CNBV = await datosDe<DiaReal>("dias-inhabiles-cnbv");
const UMAS = await datosDe<Obj>("constantes-uma");
const SALARIOS = await datosDe<Obj>("constantes-salario-minimo");
const TARIFAS = await datosDe<Obj>("isr-tarifas");

/** Un día del dataset como lo responde la API: sin `autoridad`. */
const comoApi = ({ autoridad: _, ...dia }: DiaReal) => dia;

const INTERNA = JSON.parse((await leerPublico("v1/_internos/meta.json")).toString("utf8")) as {
  curados: Record<string, { meta: Obj }>;
};

const DOCS_API = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md";

async function calendarioIncompleto(ruta: string, esperado: Obj): Promise<Obj> {
  const { respuesta, cuerpo } = await pedirJson(ruta);
  expect(respuesta.status, ruta).toBe(422);
  expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
  expect(cuerpo).toMatchObject({ type: `${BASE_PROBLEMAS}calendario-incompleto`, ...esperado });
  return cuerpo as Obj;
}

interface Rango {
  desde: string;
  hasta: string;
}

/**
 * La cobertura de cada plazo, del calendario que usa el Worker. Las pruebas la toman de aquí y no
 * fijan la de hoy: siguen valiendo cuando se capture un periodo de vacaciones o un año nuevo.
 */
async function coberturas(autoridad: string): Promise<Record<string, Rango>> {
  const ruta = `v1/_internos/calendarios/${autoridad}.json`;
  const { plazos } = JSON.parse((await leerPublico(ruta)).toString("utf8")) as {
    plazos: Record<string, { cobertura: Rango }>;
  };
  return Object.fromEntries(Object.entries(plazos).map(([tipo, p]) => [tipo, p.cobertura]));
}

const COBERTURA_SAT = await coberturas("sat");
const COBERTURA_CNBV = await coberturas("cnbv");

const despues = (r: Rango): string => sumarDias(r.hasta, 1);
const rango = (r: Rango): string => `del ${r.desde} al ${r.hasta}`;
const anioDe = (fecha: string): string => fecha.slice(0, 4);
const esFinDeSemana = (fecha: string): boolean => [0, 6].includes(diaDeLaSemana(fecha));

/** El primer día después de `desde` que no es fin de semana ni un día publicado. */
function siguienteHabil(desde: string, publicados: readonly DiaReal[]): string {
  const fechas = new Set(publicados.map((d) => d.fecha));
  let fecha = sumarDias(desde, 1);
  while (esFinDeSemana(fecha) || fechas.has(fecha)) fecha = sumarDias(fecha, 1);
  return fecha;
}

/** Días de calendario del fin de una cobertura al de otra. */
const diasEntre = (a: Rango, b: Rango): number =>
  (Date.parse(b.hasta) - Date.parse(a.hasta)) / 86_400_000;

/** El aviso del núcleo por cada año, de después de la cobertura hasta `resultado`. */
function avisosDelNucleo(cobertura: Rango, resultado: string): string[] {
  const avisos: string[] = [];
  for (let anio = Number(anioDe(despues(cobertura))); anio <= Number(anioDe(resultado)); anio++) {
    avisos.push(`Calendario incompleto: SAT ${anio}; solo se descontaron fines de semana.`);
  }
  return avisos;
}

/** Los años que la cobertura incluye completos. */
function aniosCompletos({ desde, hasta }: Rango): string[] {
  const anios: string[] = [];
  for (let anio = Number(anioDe(desde)); anio <= Number(anioDe(hasta)); anio++) {
    if (`${anio}-01-01` >= desde && `${anio}-12-31` <= hasta) anios.push(String(anio));
  }
  return anios;
}

describe("calendarios de la CNBV y el SAT con los datos reales", () => {
  const sat = (tipo: string, desde: string, dias: number, extra = "") =>
    `/v1/dias-habiles?autoridad=sat&tipo_plazo=${tipo}&desde=${desde}&dias=${dias}${extra}`;
  const primerPeriodo = DIAS_SAT.filter((d) => d.fecha >= "2026-07-20" && d.fecha <= "2026-07-31");
  const general = COBERTURA_SAT.general as Rango;
  const declaraciones = COBERTURA_SAT.declaraciones_pagos as Rango;
  const bancaria = COBERTURA_CNBV.general as Rango;
  // Mientras falte un periodo de vacaciones, general termina antes que declaraciones_pagos.
  const hueco = general.hasta < declaraciones.hasta;

  it("los datos tienen los casos que se prueban", () => {
    expect(primerPeriodo.map((d) => d.fecha)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-07-${20 + i}`),
    );
    expect(primerPeriodo.every((d) => d.tipo === "vacaciones")).toBe(true);
    expect(DIAS_SAT.find((d) => d.fecha === "2026-12-25")?.tipo).toBe("descanso");
    expect(Object.keys(COBERTURA_SAT)).toEqual(["general", "declaraciones_pagos"]);
    expect(Object.keys(COBERTURA_CNBV)).toEqual(["general"]);
    // general cuenta todos los tipos de día: ninguna vacación publicada queda fuera de su cobertura.
    expect(DIAS_SAT.some((d) => d.tipo === "vacaciones" && d.fecha > general.hasta)).toBe(false);
    expect(DIAS_CNBV.map((d) => d.fecha)).toEqual(
      expect.arrayContaining(["2025-12-12", "2026-11-02"]),
    );
  });

  it("la descarga de coberturas trae las de los calendarios que usa el Worker", async () => {
    const descarga = JSON.parse(
      (await leerPublico("descargas/dias-inhabiles-coberturas.json")).toString("utf8"),
    );
    expect(descarga).toEqual(
      [
        ["cnbv", COBERTURA_CNBV],
        ["sat", COBERTURA_SAT],
      ].flatMap(([autoridad, plazos]) =>
        Object.entries(plazos as Record<string, Rango>).map(([tipo_plazo, r]) => ({
          autoridad,
          tipo_plazo,
          ...r,
        })),
      ),
    );
  });

  it("un plazo que cruza el 20 al 31 de julio: general salta las vacaciones, declaraciones_pagos no", async () => {
    const general = await datos(sat("general", "2026-07-15", 10));
    expect(general.data).toMatchObject({
      autoridad: "sat",
      resultado: "2026-08-12",
      advertencias: [],
    });
    expect(general.data.inhabiles_saltados).toEqual(primerPeriodo.map(comoApi));
    expect(general.meta).toEqual({
      ...INTERNA.curados["dias-inhabiles.sat"]?.meta,
      docs: `${DOCS_API}#dias-habiles`,
    });
    const declaraciones = await datos(sat("declaraciones_pagos", "2026-07-15", 10));
    expect(declaraciones.data).toMatchObject({
      resultado: "2026-07-29",
      inhabiles_saltados: [],
      advertencias: [],
    });
    expect((await datos(sat("general", "2026-07-17", 1))).data.resultado).toBe("2026-08-03");
    expect((await datos(sat("declaraciones_pagos", "2026-07-17", 1))).data.resultado).toBe(
      "2026-07-20",
    );
  });

  it("un día después de la cobertura de general: 422 con autoridad, fecha y cobertura, y el detalle dice por qué", async () => {
    const cuerpo = await calendarioIncompleto(sat("general", general.hasta, 1), {
      autoridad: "sat",
      fecha: despues(general),
      cobertura: general,
    });
    const base = `El calendario del SAT para tipo_plazo=general no cubre ${despues(general)}; cubre ${rango(general)}`;
    expect(cuerpo.detail).toBe(
      hueco
        ? `${base} porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre ${rango(declaraciones)}.`
        : `${base}.`,
    );
  });

  it.runIf(hueco)(
    "general con permitir_incompleto=true calcula con lo publicado después de su cobertura",
    async () => {
      const aviso = `Calendario incompleto: SAT con tipo_plazo=general cubre ${rango(general)}; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.`;
      const permitir = (desde: string, dias: number) =>
        sat("general", desde, dias, "&permitir_incompleto=true");
      const cruce = await datos(permitir(general.hasta, 1));
      expect(cruce.data).toMatchObject({
        resultado: siguienteHabil(general.hasta, DIAS_SAT),
        advertencias: [aviso],
      });
      // Un día publicado después de la cobertura de general (el 25 de diciembre de 2026) se
      // salta con su cita y el resultado es hábil.
      const publicado = DIAS_SAT.find(
        (d) => d.fecha > general.hasta && d.fecha <= declaraciones.hasta,
      ) as DiaReal;
      expect(publicado).toBeDefined();
      const vispera = sumarDias(publicado.fecha, -1);
      const salto = await datos(permitir(vispera, 1));
      expect(salto.data).toMatchObject({
        resultado: siguienteHabil(vispera, DIAS_SAT),
        advertencias: [aviso],
      });
      expect(salto.data.inhabiles_saltados).toEqual(
        DIAS_SAT.filter((d) => d.fecha > vispera && d.fecha < salto.data.resultado).map(comoApi),
      );
      expect(salto.data.inhabiles_saltados).toContainEqual(comoApi(publicado));
      // Contar más días hábiles que días hay en el hueco pasa la cobertura más amplia: se suma
      // el aviso del núcleo, uno por año.
      const largo = await datos(permitir(general.hasta, diasEntre(general, declaraciones) + 1));
      expect(largo.data.resultado > declaraciones.hasta).toBe(true);
      expect(largo.data.advertencias).toEqual([
        aviso,
        ...avisosDelNucleo(declaraciones, largo.data.resultado),
      ]);
    },
  );

  it("con permitir_incompleto=true, después de la cobertura más amplia solo descuenta fines de semana", async () => {
    const { data } = await datos(
      sat("declaraciones_pagos", declaraciones.hasta, 5, "&permitir_incompleto=true"),
    );
    expect(data.inhabiles_saltados).toEqual([]);
    expect(esFinDeSemana(data.resultado)).toBe(false);
    expect(data.advertencias).toEqual(avisosDelNucleo(declaraciones, data.resultado));
  });

  it("declaraciones_pagos salta el 25 de diciembre y da 422 al día siguiente de su cobertura", async () => {
    const { data } = await datos(sat("declaraciones_pagos", "2026-12-24", 1));
    expect(data.resultado).toBe("2026-12-28");
    expect(data.inhabiles_saltados.map((d: Obj) => d.fecha)).toEqual(["2026-12-25"]);
    await calendarioIncompleto(sat("declaraciones_pagos", declaraciones.hasta, 1), {
      autoridad: "sat",
      fecha: despues(declaraciones),
      cobertura: declaraciones,
    });
  });

  it("la CNBV salta sus días de 2025 y 2026 y da 422 al día siguiente de su cobertura", async () => {
    const cnbv = (desde: string) => `/v1/dias-habiles?autoridad=cnbv&desde=${desde}&dias=1`;
    const noviembre = await datos(cnbv("2026-10-30"));
    expect(noviembre.data.resultado).toBe("2026-11-03");
    expect(noviembre.meta.dataset).toBe("dias-inhabiles.cnbv");
    expect((await datos(cnbv("2025-12-11"))).data.resultado).toBe("2025-12-15");
    await calendarioIncompleto(cnbv(bancaria.hasta), {
      autoridad: "cnbv",
      fecha: despues(bancaria),
      cobertura: bancaria,
    });
  });

  it("con sat, sin tipo_plazo: 400 parametro-faltante", async () => {
    const { respuesta, cuerpo } = await pedirJson(
      "/v1/dias-habiles?autoridad=sat&desde=2026-07-15&dias=10",
    );
    expect(respuesta.status).toBe(400);
    expect(cuerpo).toMatchObject({
      type: `${BASE_PROBLEMAS}parametro-faltante`,
      parametro: "tipo_plazo",
    });
  });

  it("dias-inhabiles del SAT: la lista publicada de cada año, con la advertencia si faltan vacaciones", async () => {
    const anios = aniosCompletos(declaraciones);
    expect(anios).toContain("2026");
    for (const anio of anios) {
      const cuerpo = await datos(`/v1/dias-inhabiles?autoridad=sat&anio=${anio}`);
      expect(cuerpo.data).toEqual(
        DIAS_SAT.filter((d) => d.fecha.startsWith(`${anio}-`)).map(comoApi),
      );
      const completo = `${anio}-01-01` >= general.desde && `${anio}-12-31` <= general.hasta;
      expect(cuerpo.advertencias, anio).toEqual(
        completo
          ? []
          : [
              `Los días de tipo vacaciones del SAT solo están completos ${rango(general)}; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de ${anio} está completa.`,
            ],
      );
      expect(cuerpo.meta.docs).toBe(`${DOCS_API}#dias-inhabiles`);
    }
    await calendarioIncompleto(
      `/v1/dias-inhabiles?autoridad=sat&anio=${anioDe(despues(declaraciones))}`,
      { autoridad: "sat", fecha: despues(declaraciones), cobertura: declaraciones },
    );
  });

  it("dias-inhabiles de la CNBV: cada año completo, sin advertencias", async () => {
    const anios = aniosCompletos(bancaria);
    expect(anios).toEqual(expect.arrayContaining(["2025", "2026"]));
    for (const anio of anios) {
      const cuerpo = await datos(`/v1/dias-inhabiles?autoridad=cnbv&anio=${anio}`);
      expect(cuerpo.data).toEqual(
        DIAS_CNBV.filter((d) => d.fecha.startsWith(`${anio}-`)).map(comoApi),
      );
      expect(cuerpo.advertencias).toEqual([]);
    }
    await calendarioIncompleto(
      `/v1/dias-inhabiles?autoridad=cnbv&anio=${anioDe(despues(bancaria))}`,
      { autoridad: "cnbv", fecha: despues(bancaria), cobertura: bancaria },
    );
  });
});

describe("constantes con los datos reales", () => {
  const umaDe = (anio: number) => UMAS.find((u) => u.anio === anio);
  const ultima = UMAS.at(-1) as Obj;

  it("la UMA vigente en enero es la del año anterior", async () => {
    for (const [fecha, anio] of [
      ["2026-01-31", 2025],
      ["2026-02-01", 2026],
      ["2018-01-15", 2017],
      ["2017-02-01", 2017],
    ] as const) {
      const { data, meta } = await datos(`/v1/constantes/uma?fecha=${fecha}`);
      expect(data, fecha).toEqual(umaDe(anio));
      expect(meta.dataset).toBe("constantes.uma");
    }
  });

  it("antes de la primera UMA y después de la vigencia de la última: 404 con la cobertura", async () => {
    const cobertura = { desde: "2017-02-01", hasta: `${ultima.anio + 1}-01-31` };
    for (const [fecha, tipo] of [
      ["2017-01-31", "no-encontrado"],
      [`${ultima.anio + 1}-02-01`, "dato-no-disponible"],
    ] as const) {
      const { respuesta, cuerpo } = await pedirJson(`/v1/constantes/uma?fecha=${fecha}`);
      expect(respuesta.status, fecha).toBe(404);
      expect(cuerpo).toMatchObject({ type: `${BASE_PROBLEMAS}${tipo}`, fecha, cobertura });
    }
  });

  it("/v1/constantes/uma/{anio}: cada UMA del dataset", async () => {
    for (const uma of UMAS) {
      const { data, meta } = await datos(`/v1/constantes/uma/${uma.anio}`);
      expect(data).toEqual(uma);
      expect(meta.dataset).toBe("constantes.uma");
    }
  });

  it("/v1/constantes/salario-minimo/{anio}: las dos zonas de cada año", async () => {
    const anios = [...new Set(SALARIOS.map((s) => s.anio as number))];
    expect(anios.length).toBeGreaterThan(0);
    for (const anio of anios) {
      const { data } = await datos(`/v1/constantes/salario-minimo/${anio}`);
      expect(data).toEqual(SALARIOS.filter((s) => s.anio === anio));
      expect(data.map((s: Obj) => s.zona)).toEqual(["general", "zlfn"]);
    }
  });

  it("/v1/isr/tarifa/{periodo}/{anio}: cada tarifa del dataset", async () => {
    for (const tarifa of TARIFAS) {
      const { data, meta } = await datos(`/v1/isr/tarifa/${tarifa.periodo}/${tarifa.anio}`);
      expect(data).toEqual(tarifa);
      expect(data.tramos.at(-1).limite_superior).toBeNull();
      expect(meta.dataset).toBe("isr.tarifas");
    }
  });

  it("un año antes de los datos es no-encontrado; uno después del último cargado, dato-no-disponible", async () => {
    const cargados = (anios: number[]) => {
      const [primero, ultimo] = [Math.min(...anios), Math.max(...anios)];
      return primero === ultimo
        ? `el único año cargado es ${primero}`
        : `los años cargados van de ${primero} a ${ultimo}`;
    };
    const casos: Array<[string, number[], string]> = [
      ["/v1/constantes/uma", UMAS.map((u) => u.anio as number), "la UMA"],
      ["/v1/constantes/salario-minimo", SALARIOS.map((s) => s.anio as number), "el salario mínimo"],
      [
        "/v1/isr/tarifa/mensual",
        TARIFAS.filter((t) => t.periodo === "mensual").map((t) => t.anio as number),
        "la tarifa mensual de ISR",
      ],
    ];
    for (const [ruta, anios, nombre] of casos) {
      const antes = Math.min(...anios) - 1;
      const despues = Math.max(...anios) + 1;
      for (const [anio, tipo, detalle] of [
        [
          antes,
          "no-encontrado",
          `No existe ${nombre} de ${antes} en los datos; ${cargados(anios)}.`,
        ],
        [
          despues,
          "dato-no-disponible",
          `Todavía no se carga ${nombre} de ${despues}; ${cargados(anios)}.`,
        ],
      ] as const) {
        const { respuesta, cuerpo } = await pedirJson(`${ruta}/${anio}`);
        expect(respuesta.status, `${ruta}/${anio}`).toBe(404);
        expect(cuerpo).toMatchObject({ type: `${BASE_PROBLEMAS}${tipo}`, detail: detalle });
      }
    }
  });
});
