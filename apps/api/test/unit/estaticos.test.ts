import { afterEach, describe, expect, it, vi } from "vitest";
import { manejar } from "../../src/index.js";
import { CACHE_DATOS } from "../../src/respuestas.js";
import {
  type AssetFalso,
  crearAssets,
  entornoDe,
  peticion,
  SEGURIDAD_ESPERADA,
  seguridadDe,
} from "./ayudas.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

const META = '"meta":{"dataset":"x","as_of":"2026-10-17","sources":[],"docs":"d"}';

/** Ruta pública → asset que la sirve. */
const RUTAS_SHARD: ReadonlyArray<readonly [string, string]> = [
  ["/v1/estados", "/v1/estados.json"],
  ["/v1/estados/25", "/v1/estados/25.json"],
  ["/v1/estados/25/municipios", "/v1/estados/25/municipios.json"],
  ["/v1/municipios", "/v1/municipios.json"],
  ["/v1/municipios/25006", "/v1/municipios/25006.json"],
  ["/v1/bancos", "/v1/bancos.json"],
  ["/v1/bancos/012", "/v1/bancos/012.json"],
  ["/v1/openapi.json", "/v1/openapi.json"],
];

const SHARDS: Record<string, AssetFalso> = Object.fromEntries(
  RUTAS_SHARD.map(([, asset], i) => [
    asset,
    { cuerpo: `{"data":{"n":${i},"ñ":"é"},${META}}`, etag: `"etag-${i}"` },
  ]),
);

async function pedir(ruta: string, init?: RequestInit, mapa = SHARDS) {
  const assets = crearAssets(mapa);
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  return { respuesta, assets };
}

describe("shards", () => {
  for (const [ruta, asset] of RUTAS_SHARD) {
    it(`${ruta} sirve ${asset} tal cual`, async () => {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
      expect(respuesta.headers.get("etag")).toBe(SHARDS[asset]?.etag);
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.text()).toBe(SHARDS[asset]?.cuerpo);
      expect(assets.pedidas).toEqual([asset]);
    });
  }

  it("no copia otros encabezados del asset", async () => {
    const { respuesta } = await pedir("/v1/estados");
    expect([...respuesta.headers.keys()].sort()).toEqual(
      [
        "access-control-allow-origin",
        "access-control-expose-headers",
        "cache-control",
        "content-security-policy",
        "content-type",
        "cross-origin-resource-policy",
        "etag",
        "referrer-policy",
        "x-content-type-options",
      ].sort(),
    );
  });

  it("un asset sin ETag se sirve sin ETag", async () => {
    const { respuesta } = await pedir("/v1/estados", undefined, {
      "/v1/estados.json": { cuerpo: "{}" },
    });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("etag")).toBeNull();
  });
});

describe("recurso inexistente", () => {
  for (const [ruta, asset, detalle] of [
    ["/v1/estados/33", "/v1/estados/33.json", "No existe el estado 33."],
    ["/v1/estados/00/municipios", "/v1/estados/00/municipios.json", "No existe el estado 00."],
    ["/v1/municipios/25999", "/v1/municipios/25999.json", "No existe el municipio 25999."],
    ["/v1/bancos/999", "/v1/bancos/999.json", "No existe el banco 999."],
  ] as const) {
    it(`${ruta} da el 404 del Worker y cancela el cuerpo del asset`, async () => {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status).toBe(404);
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(respuesta.headers.get("cache-control")).toBe("no-store");
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(await respuesta.json()).toEqual({
        type: `${TIPO}no-encontrado`,
        title: "Recurso no encontrado",
        status: 404,
        detail: detalle,
        instance: ruta,
      });
      expect(assets.pedidas).toEqual([asset]);
      expect(assets.canceladas).toEqual([asset]);
    });
  }

  it("las listas y el documento OpenAPI nombran el recurso", async () => {
    for (const [ruta, detalle] of [
      ["/v1/estados", "No existe la lista de estados."],
      ["/v1/municipios", "No existe la lista de municipios."],
      ["/v1/bancos", "No existe la lista de bancos."],
      ["/v1/openapi.json", "No existe el documento OpenAPI."],
    ] as const) {
      const { respuesta } = await pedir(ruta, undefined, {});
      expect(respuesta.status, ruta).toBe(404);
      expect(await respuesta.json(), ruta).toMatchObject({ detail: detalle });
    }
  });
});

describe("estado inesperado del asset", () => {
  for (const status of [500, 503, 403, 206]) {
    it(`${status} da 500 genérico, cancela el cuerpo y lo registra en una línea`, async () => {
      const registro = vi.spyOn(console, "error").mockImplementation(() => {});
      const { respuesta, assets } = await pedir("/v1/estados", undefined, {
        "/v1/estados.json": { cuerpo: "detalle interno", etag: '"x"', status },
      });
      expect(respuesta.status).toBe(500);
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      const texto = await respuesta.text();
      expect(JSON.parse(texto)).toMatchObject({
        type: `${TIPO}error-interno`,
        detail: "Ocurrió un error interno.",
      });
      expect(texto).not.toContain("detalle interno");
      expect(assets.canceladas).toEqual(["/v1/estados.json"]);
      expect(registro.mock.calls).toEqual([
        [`mexicoapi: error interno: el asset respondió ${status} en /v1/estados`],
      ]);
    });
  }

  it("un 304 del asset, sin cuerpo, también da 500", async () => {
    const { respuesta } = await pedir("/v1/estados", undefined, {
      "/v1/estados.json": { cuerpo: "", etag: '"x"', status: 304 },
    });
    expect(respuesta.status).toBe(500);
  });
});

describe("peticiones condicionales", () => {
  const condicional = (valor: string, mapa = SHARDS, method = "GET") =>
    pedir("/v1/estados/25", { method, headers: { "If-None-Match": valor } }, mapa);

  for (const valor of [
    '"etag-1"',
    'W/"etag-1"',
    '"otro", "etag-1"',
    '"otro",W/"etag-1"',
    ' "otro" ,  "etag-1" ',
    "*",
  ]) {
    it(`If-None-Match ${valor} da 304 sin cuerpo y cancela el asset`, async () => {
      const { respuesta, assets } = await condicional(valor);
      expect(respuesta.status).toBe(304);
      expect(respuesta.body).toBeNull();
      expect(respuesta.headers.get("etag")).toBe('"etag-1"');
      expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
      expect(respuesta.headers.get("content-type")).toBeNull();
      expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
      expect(assets.pedidas).toEqual(["/v1/estados/25.json"]);
      expect(assets.canceladas).toEqual(["/v1/estados/25.json"]);
    });
  }

  for (const valor of [
    '"otro"',
    '"etag-10"',
    "etag-1",
    '"ETAG-1"',
    '""',
    "",
    // Mal formados: no coinciden aunque contengan la etiqueta o *.
    'w/"etag-1"',
    '"etag-1',
    '"x" "etag-1"',
    '"etag-1",',
    '*, "etag-1"',
    '"otro", *',
  ]) {
    it(`If-None-Match ${JSON.stringify(valor)} no coincide y sirve el shard`, async () => {
      const { respuesta, assets } = await condicional(valor);
      expect(respuesta.status).toBe(200);
      expect(await respuesta.text()).toBe(SHARDS["/v1/estados/25.json"]?.cuerpo);
      expect(assets.canceladas).toEqual([]);
    });
  }

  it("la comparación es débil también si el asset da un ETag débil", async () => {
    const mapa = { "/v1/estados/25.json": { cuerpo: "{}", etag: 'W/"abc"' } };
    expect((await condicional('"abc"', mapa)).respuesta.status).toBe(304);
    expect((await condicional('W/"abc"', mapa)).respuesta.status).toBe(304);
  });

  it("una coma dentro de un ETag no parte la etiqueta", async () => {
    const mapa = { "/v1/estados/25.json": { cuerpo: "{}", etag: '"a,b"' } };
    expect((await condicional('"a,b"', mapa)).respuesta.status).toBe(304);
    expect((await condicional('"a"', mapa)).respuesta.status).toBe(200);
    expect((await condicional('"x", "a,b"', mapa)).respuesta.status).toBe(304);
  });

  it("sin ETag en el asset solo * coincide", async () => {
    const mapa = { "/v1/estados/25.json": { cuerpo: "{}" } };
    expect((await condicional('"x"', mapa)).respuesta.status).toBe(200);
    const { respuesta } = await condicional("*", mapa);
    expect(respuesta.status).toBe(304);
    expect(respuesta.headers.get("etag")).toBeNull();
  });

  it("con HEAD también da 304", async () => {
    const { respuesta, assets } = await condicional('"etag-1"', SHARDS, "HEAD");
    expect(respuesta.status).toBe(304);
    expect(respuesta.body).toBeNull();
    expect(assets.canceladas).toEqual(["/v1/estados/25.json"]);
  });

  it("un recurso inexistente sigue siendo 404 aunque traiga *", async () => {
    const { respuesta } = await pedir("/v1/estados/33", { headers: { "If-None-Match": "*" } });
    expect(respuesta.status).toBe(404);
  });
});

describe("HEAD", () => {
  it("da los mismos encabezados que GET, sin cuerpo, y cancela el asset", async () => {
    const get = (await pedir("/v1/bancos/012")).respuesta;
    const { respuesta, assets } = await pedir("/v1/bancos/012", { method: "HEAD" });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toBeNull();
    expect([...respuesta.headers]).toEqual([...get.headers]);
    expect(assets.canceladas).toEqual(["/v1/bancos/012.json"]);
  });
});
