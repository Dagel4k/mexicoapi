import { beforeEach, describe, expect, it } from "vitest";
import { reiniciarCargas } from "../../src/cargas.js";
import { reiniciarMemoriaStatus } from "../../src/computados/status.js";
import { manejar } from "../../src/index.js";
import { CACHE_STATUS } from "../../src/respuestas.js";
import { crearAssets, entornoDe, peticion, SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

const meta = (dataset: string, as_of: string) => ({
  dataset,
  as_of,
  sources: [
    {
      name: "Fuente",
      url: "https://example.com/",
      license: "Licencia",
      license_url: "https://example.com/licencia",
      citation: "Cita.",
    },
  ],
  docs: `https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/${dataset}.md`,
});

// Fuera de orden a propósito: la respuesta va en orden alfabético por id.
const INTERNA = {
  datasets: {
    "inegi.municipios": {
      meta: meta("inegi.municipios", "2026-10-15"),
      records: 2478,
      data_sha256: "b".repeat(64),
      frescura_horas: 216,
    },
    bancos: {
      meta: meta("bancos", "2026-10-17"),
      records: 150,
      data_sha256: "a".repeat(64),
      frescura_horas: 72,
    },
    "inegi.estados": {
      meta: meta("inegi.estados", "2026-10-15"),
      records: 32,
      data_sha256: "c".repeat(64),
      frescura_horas: 216,
    },
  },
};

const ASSETS = { "/v1/_internos/meta.json": { cuerpo: JSON.stringify(INTERNA) } };

const AHORA = new Date("2026-10-17T12:00:00.000Z");
const HORA = 3_600_000;
const hace = (ms: number, desde = AHORA) => new Date(desde.getTime() - ms).toISOString();

/** KV falso: sirve un mapa `clave → valor` (null si no está) y registra cada lectura. */
function crearKv(valores: Readonly<Record<string, unknown>>, fallan: readonly string[] = []) {
  const lecturas: Array<{ clave: string; opciones: unknown }> = [];
  const get = async (clave: string, opciones: unknown) => {
    lecturas.push({ clave, opciones });
    if (fallan.includes(clave)) throw new Error("KV no responde: /ruta/interna");
    return Object.hasOwn(valores, clave) ? valores[clave] : null;
  };
  return { binding: { get } as unknown as KVNamespace, lecturas };
}

async function pedir(
  opciones: {
    kv?: KVNamespace;
    ahora?: Date | null;
    ruta?: string;
    init?: RequestInit;
    interna?: unknown;
  } = {},
) {
  const assets = crearAssets(
    opciones.interna === undefined
      ? ASSETS
      : { "/v1/_internos/meta.json": { cuerpo: JSON.stringify(opciones.interna) } },
  );
  const entorno = entornoDe(assets, opciones.kv === undefined ? {} : { ESTADO: opciones.kv });
  const { ahora = AHORA } = opciones;
  const respuesta = await manejar(
    peticion(opciones.ruta ?? "/v1/status", opciones.init),
    entorno,
    ahora === null ? {} : { ahora: () => ahora },
  );
  return { respuesta, assets };
}

interface EstadoDataset {
  dataset: string;
  status: string;
  last_attempt: string | null;
  last_success: string | null;
}

async function estados(respuesta: Response): Promise<Record<string, EstadoDataset>> {
  const { data } = (await respuesta.json()) as { data: EstadoDataset[] };
  return Object.fromEntries(data.map((d) => [d.dataset, d]));
}

const corrida = (last_success: string | null, last_attempt = hace(HORA)) => ({
  last_attempt,
  last_success,
  last_result: "sin_cambios",
});

beforeEach(() => {
  reiniciarCargas();
  reiniciarMemoriaStatus();
});

describe("GET /v1/status", () => {
  it("sin binding de KV, cada dataset es unknown y la respuesta no lleva meta", async () => {
    const { respuesta, assets } = await pedir();
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(respuesta.headers.get("cache-control")).toBe(CACHE_STATUS);
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    const texto = await respuesta.text();
    expect(Object.keys(JSON.parse(texto))).toEqual(["data"]);
    const { data } = JSON.parse(texto) as { data: Array<Record<string, unknown>> };
    for (const d of data) {
      expect(Object.keys(d)).toEqual([
        "dataset",
        "as_of",
        "records",
        "data_sha256",
        "status",
        "last_attempt",
        "last_success",
        "frescura_horas",
      ]);
    }
    expect(data).toEqual([
      {
        dataset: "bancos",
        as_of: "2026-10-17",
        records: 150,
        data_sha256: "a".repeat(64),
        status: "unknown",
        last_attempt: null,
        last_success: null,
        frescura_horas: 72,
      },
      {
        dataset: "inegi.estados",
        as_of: "2026-10-15",
        records: 32,
        data_sha256: "c".repeat(64),
        status: "unknown",
        last_attempt: null,
        last_success: null,
        frescura_horas: 216,
      },
      {
        dataset: "inegi.municipios",
        as_of: "2026-10-15",
        records: 2478,
        data_sha256: "b".repeat(64),
        status: "unknown",
        last_attempt: null,
        last_success: null,
        frescura_horas: 216,
      },
    ]);
    expect(assets.pedidas).toEqual(["/v1/_internos/meta.json"]);
  });

  it("las series traen su cobertura (solo desde y hasta); los demás datasets no", async () => {
    const udis = {
      meta: meta("udis", "2026-10-18"),
      records: 2490,
      data_sha256: "d".repeat(64),
      frescura_horas: 72,
      cobertura: { desde: "2020-01-01", hasta: "2026-10-25", otro: "no se copia" },
    };
    const { respuesta } = await pedir({
      interna: { datasets: { ...INTERNA.datasets, udis } },
    });
    const { data } = (await respuesta.json()) as { data: Array<Record<string, unknown>> };
    const serie = data.find((d) => d.dataset === "udis");
    expect(Object.keys(serie ?? {})).toEqual([
      "dataset",
      "as_of",
      "records",
      "data_sha256",
      "cobertura",
      "status",
      "last_attempt",
      "last_success",
      "frescura_horas",
    ]);
    expect(serie).toMatchObject({
      as_of: "2026-10-18",
      cobertura: { desde: "2020-01-01", hasta: "2026-10-25" },
    });
    expect(serie?.cobertura).toEqual({ desde: "2020-01-01", hasta: "2026-10-25" });
    for (const d of data.filter((x) => x.dataset !== "udis")) {
      expect(d, String(d.dataset)).not.toHaveProperty("cobertura");
    }
  });

  it("lee estado:<dataset> de KV como JSON con cacheTtl de 60 s", async () => {
    const kv = crearKv({});
    await pedir({ kv: kv.binding });
    expect(kv.lecturas).toEqual([
      { clave: "estado:bancos", opciones: { type: "json", cacheTtl: 60 } },
      { clave: "estado:inegi.estados", opciones: { type: "json", cacheTtl: 60 } },
      { clave: "estado:inegi.municipios", opciones: { type: "json", cacheTtl: 60 } },
    ]);
  });

  it("un éxito reciente es ok y copia last_attempt y last_success", async () => {
    const valor = corrida(hace(2 * HORA), hace(HORA));
    const kv = crearKv({ "estado:bancos": valor });
    const { respuesta } = await pedir({ kv: kv.binding });
    const { bancos, "inegi.estados": estados_ } = await estados(respuesta);
    expect(bancos).toMatchObject({
      status: "ok",
      last_attempt: valor.last_attempt,
      last_success: valor.last_success,
    });
    expect(estados_).toMatchObject({ status: "unknown", last_attempt: null, last_success: null });
  });

  it("acepta los cuatro resultados de corrida y fracciones de segundo", async () => {
    for (const last_result of ["sin_cambios", "actualizado", "requiere_revision", "error"]) {
      reiniciarMemoriaStatus();
      const valor = { last_attempt: "2026-10-17T11:00:00Z", last_success: hace(HORA), last_result };
      const { respuesta } = await pedir({ kv: crearKv({ "estado:bancos": valor }).binding });
      expect((await estados(respuesta)).bancos?.status, last_result).toBe("ok");
    }
  });

  it("es stale si el último éxito rebasa frescura_horas; justo en el límite sigue ok", async () => {
    const kv = crearKv({
      "estado:bancos": corrida(hace(72 * HORA)),
      "estado:inegi.estados": corrida(hace(216 * HORA + 1)),
      "estado:inegi.municipios": corrida(hace(10 * 24 * HORA)),
    });
    const { respuesta } = await pedir({ kv: kv.binding });
    const r = await estados(respuesta);
    expect(r.bancos?.status).toBe("ok");
    expect(r["inegi.estados"]?.status).toBe("stale");
    expect(r["inegi.municipios"]).toMatchObject({
      status: "stale",
      last_success: hace(10 * 24 * HORA),
    });
  });

  it("sin last_success es stale y conserva last_attempt", async () => {
    const valor = corrida(null);
    const { respuesta } = await pedir({ kv: crearKv({ "estado:bancos": valor }).binding });
    expect((await estados(respuesta)).bancos).toMatchObject({
      status: "stale",
      last_attempt: valor.last_attempt,
      last_success: null,
    });
  });

  const base = corrida(hace(HORA));
  for (const [caso, valor] of [
    ["texto", "ok"],
    ["número", 1],
    ["lista", [base]],
    ["sin last_attempt", { ...base, last_attempt: undefined }],
    ["last_attempt null", { ...base, last_attempt: null }],
    ["last_attempt solo fecha", { ...base, last_attempt: "2026-10-17" }],
    ["last_attempt con desfase", { ...base, last_attempt: "2026-10-17T06:00:00+00:00" }],
    ["last_attempt sin segundos", { ...base, last_attempt: "2026-10-17T06:00Z" }],
    ["last_attempt con fecha que no existe", { ...base, last_attempt: "2026-02-30T06:00:00Z" }],
    ["last_attempt con hora 24", { ...base, last_attempt: "2026-10-17T24:00:00Z" }],
    ["last_attempt en minúsculas", { ...base, last_attempt: "2026-10-17t06:00:00z" }],
    ["last_attempt número", { ...base, last_attempt: 1760680800000 }],
    ["sin last_success", { ...base, last_success: undefined }],
    ["last_success no instante", { ...base, last_success: "ayer" }],
    ["last_success número", { ...base, last_success: 0 }],
    ["sin last_result", { ...base, last_result: undefined }],
    ["last_result desconocido", { ...base, last_result: "ok" }],
    ["last_result no texto", { ...base, last_result: 1 }],
  ] as const) {
    it(`un valor con forma inesperada es unknown: ${caso}`, async () => {
      const { respuesta } = await pedir({ kv: crearKv({ "estado:bancos": valor }).binding });
      expect((await estados(respuesta)).bancos).toMatchObject({
        status: "unknown",
        last_attempt: null,
        last_success: null,
      });
    });
  }

  it("si KV lanza, ese dataset es unknown, los demás no, y la falla no se recuerda", async () => {
    const kv = crearKv(
      { "estado:bancos": corrida(hace(HORA)), "estado:inegi.estados": corrida(hace(HORA)) },
      ["estado:inegi.estados"],
    );
    const { respuesta } = await pedir({ kv: kv.binding });
    expect(respuesta.status).toBe(200);
    const texto = await respuesta.text();
    expect(texto).not.toContain("ruta/interna");
    const { data } = JSON.parse(texto) as { data: EstadoDataset[] };
    expect(data.map((d) => d.status)).toEqual(["ok", "unknown", "unknown"]);
    expect(data[1]).toMatchObject({ last_attempt: null, last_success: null });

    await pedir({ kv: kv.binding, ahora: new Date(AHORA.getTime() + 1000) });
    expect(kv.lecturas.map((l) => l.clave)).toEqual([
      "estado:bancos",
      "estado:inegi.estados",
      "estado:inegi.municipios",
      "estado:inegi.estados",
    ]);
  });

  it("si KV lanza en todos, la respuesta sigue siendo 200 con todo unknown", async () => {
    const kv = crearKv({}, ["estado:bancos", "estado:inegi.estados", "estado:inegi.municipios"]);
    const { respuesta } = await pedir({ kv: kv.binding });
    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()) as unknown).toMatchObject({
      data: [{ status: "unknown" }, { status: "unknown" }, { status: "unknown" }],
    });
  });

  it("recuerda cada lectura 60 s por isolate; el status se recalcula con la hora actual", async () => {
    // A las 12:00 el éxito tiene 71 h 59 min 30 s (ok); 60 s después ya rebasa las 72 h.
    const kv = crearKv({ "estado:bancos": corrida(hace(72 * HORA - 30_000)) });
    const en = (ms: number) => new Date(AHORA.getTime() + ms);

    const primera = await estados((await pedir({ kv: kv.binding })).respuesta);
    expect(primera.bancos?.status).toBe("ok");
    expect(kv.lecturas).toHaveLength(3);

    const segunda = await estados((await pedir({ kv: kv.binding, ahora: en(59_999) })).respuesta);
    expect(segunda.bancos?.status).toBe("stale");
    expect(kv.lecturas).toHaveLength(3);

    await pedir({ kv: kv.binding, ahora: en(60_000) });
    expect(kv.lecturas).toHaveLength(6);
  });

  it("reiniciarMemoriaStatus obliga a leer de nuevo", async () => {
    const kv = crearKv({});
    await pedir({ kv: kv.binding });
    reiniciarMemoriaStatus();
    await pedir({ kv: kv.binding });
    expect(kv.lecturas).toHaveLength(6);
  });

  it("sin opciones.ahora usa la hora del reloj", async () => {
    const valor = corrida(new Date().toISOString(), new Date().toISOString());
    const kv = crearKv({ "estado:bancos": valor });
    const { respuesta } = await pedir({ kv: kv.binding, ahora: null });
    expect((await estados(respuesta)).bancos?.status).toBe("ok");
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    const get = (await pedir()).respuesta;
    const { respuesta } = await pedir({ init: { method: "HEAD" } });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toBeNull();
    expect([...respuesta.headers]).toEqual([...get.headers]);
  });

  it("no acepta parámetros de query", async () => {
    const { respuesta, assets } = await pedir({ ruta: "/v1/status?dataset=bancos" });
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}parametro-desconocido`,
      parametro: "dataset",
    });
    expect(assets.pedidas).toEqual([]);
  });

  it("si el meta interno no carga, da 500 genérico", async () => {
    const assets = crearAssets({});
    const respuesta = await manejar(peticion("/v1/status"), entornoDe(assets), {
      ahora: () => AHORA,
    });
    expect(respuesta.status).toBe(500);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}error-interno`,
      detail: "Ocurrió un error interno.",
    });
  });
});
