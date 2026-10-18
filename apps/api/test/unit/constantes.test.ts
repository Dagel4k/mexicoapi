import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reiniciarCargas } from "../../src/cargas.js";
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
import { assetsCurados, DOCS, LISTA_UMA, META_UMA, RUTA_UMA, UMAS } from "./curados.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
const COBERTURA = { desde: "2024-02-01", hasta: "2027-01-31" };
// La UMA por fecha se calcula: su meta enlaza a la sección de la API, como las demás rutas calculadas.
const META_API = { ...META_UMA, docs: `${DOCS}/api/README.md#constantes` };

type Cambios = Parameters<typeof assetsCurados>[0];

async function pedir(ruta: string, cambios?: Cambios, init?: RequestInit) {
  const assets = crearAssets(assetsCurados(cambios));
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  return { respuesta, assets };
}

const uma = (fecha: string) => `/v1/constantes/uma?fecha=${fecha}`;
const deAnio = (anio: number) => UMAS.find((u) => u.anio === anio);

beforeEach(() => reiniciarCargas());
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/constantes/uma?fecha=", () => {
  it("responde la UMA vigente ese día con la meta del dataset, sin ETag", async () => {
    const { respuesta, assets } = await pedir(uma("2026-03-15"));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(respuesta.headers.get("etag")).toBeNull();
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    const texto = await respuesta.text();
    expect(Object.keys(JSON.parse(texto))).toEqual(["data", "meta"]);
    expect(JSON.parse(texto)).toEqual({ data: deAnio(2026), meta: META_API });
    expect(assets.pedidas).toEqual([RUTA_UMA]);
  });

  // Cada UMA rige del 1 de febrero de su año al 31 de enero del siguiente.
  it.each([
    ["2026-01-05", 2025],
    ["2026-01-31", 2025],
    ["2026-02-01", 2026],
    ["2026-12-31", 2026],
    ["2027-01-31", 2026],
    ["2025-01-31", 2024],
    ["2025-02-01", 2025],
    ["2024-02-01", 2024],
    ["2024-02-29", 2024],
  ] as const)("el %s rige la UMA de %i", async (fecha, anio) => {
    const { respuesta } = await pedir(uma(fecha));
    expect(respuesta.status).toBe(200);
    const { data } = (await respuesta.json()) as { data: { anio: number } };
    expect(data).toEqual(deAnio(anio));
  });

  /** Pide la ruta y comprueba un 404 con la fecha y la cobertura. */
  async function sinDato(fecha: string, tipo: string, title: string, detail: string) {
    const { respuesta } = await pedir(uma(fecha));
    expect(respuesta.status, fecha).toBe(404);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    const texto = await respuesta.text();
    expect(JSON.parse(texto), fecha).toEqual({
      type: `${TIPO}${tipo}`,
      title,
      status: 404,
      detail,
      instance: "/v1/constantes/uma",
      fecha,
      cobertura: COBERTURA,
    });
    // Nunca un valor de otra UMA en el 404.
    expect(texto).not.toMatch(/\d+\.\d{2}"/);
  }

  it.each(["2024-01-31", "2017-02-01", "0001-01-01"])(
    "%s, antes de la primera UMA cargada: 404 no-encontrado",
    async (fecha) => {
      await sinDato(
        fecha,
        "no-encontrado",
        "Recurso no encontrado",
        `Los datos empiezan con la UMA de 2024, vigente desde el 2024-02-01; no incluyen la UMA vigente el ${fecha}.`,
      );
    },
  );

  it.each(["2027-02-01", "2028-06-15", "9999-12-31"])(
    "%s, después de la vigencia de la última UMA cargada: 404 dato-no-disponible",
    async (fecha) => {
      await sinDato(
        fecha,
        "dato-no-disponible",
        "Dato todavía no disponible",
        `La UMA vigente el ${fecha} todavía no está cargada; la última cargada es la de 2026, vigente hasta el 2027-01-31.`,
      );
    },
  );

  it("la lista se lee una vez por isolate", async () => {
    const assets = crearAssets(assetsCurados());
    for (const fecha of ["2026-01-05", "2026-02-01", "2030-01-01", "2020-01-01"]) {
      await manejar(peticion(uma(fecha)), entornoDe(assets));
    }
    expect(assets.pedidas).toEqual([RUTA_UMA]);
  });

  it("sin fecha, con una que no existe o con otro parámetro: 400 sin tocar ASSETS", async () => {
    for (const [ruta, esperado] of [
      [
        "/v1/constantes/uma",
        {
          type: `${TIPO}parametro-faltante`,
          detail: "Falta el parámetro fecha.",
          parametro: "fecha",
        },
      ],
      [
        uma("2026-02-30"),
        {
          type: `${TIPO}parametro-invalido`,
          detail:
            "La fecha que se consulta (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
          parametro: "fecha",
        },
      ],
      [uma("2026-2-1"), { type: `${TIPO}parametro-invalido`, parametro: "fecha" }],
      [uma("0000-02-01"), { type: `${TIPO}parametro-invalido`, parametro: "fecha" }],
      [`${uma("2026-02-01")}&fecha=2026-02-02`, { type: `${TIPO}parametro-invalido` }],
      ["/v1/constantes/uma?anio=2026", { type: `${TIPO}parametro-desconocido`, parametro: "anio" }],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toMatchObject(esperado);
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("una lista que falta o no tiene forma da 500 y la falla no se recuerda", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const cambios of [
      { [RUTA_UMA]: undefined },
      { [RUTA_UMA]: { ...LISTA_UMA, data: [UMAS[0], UMAS[2]] } },
    ]) {
      reiniciarCargas();
      const { respuesta } = await pedir(uma("2026-02-01"), cambios);
      expect(respuesta.status).toBe(500);
      expect(await respuesta.json()).toMatchObject({ detail: "Ocurrió un error interno." });
    }
    expect(consola.mock.calls.map((c) => String(c[0]))).toEqual([
      "mexicoapi: error interno: Error en /v1/constantes/uma",
      "mexicoapi: error interno: Error en /v1/constantes/uma",
    ]);
    const { respuesta } = await pedir(uma("2026-02-01"));
    expect(respuesta.status).toBe(200);
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    for (const ruta of [uma("2026-02-01"), uma("2027-02-01")]) {
      const get = (await pedir(ruta)).respuesta;
      const { respuesta } = await pedir(ruta, undefined, { method: "HEAD" });
      expect(respuesta.status, ruta).toBe(get.status);
      expect(respuesta.body, ruta).toBeNull();
      expect([...respuesta.headers], ruta).toEqual([...get.headers]);
    }
  });
});

describe("shards de constantes", () => {
  const INDICE = "/v1/_internos/constantes.json";
  const ANIOS = {
    "constantes/salario-minimo": [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    "constantes/uma": [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    "isr/tarifa/anual": [2025, 2026],
    "isr/tarifa/mensual": [2026],
  };
  const SHARDS: Record<string, AssetFalso> = {
    "/v1/constantes/uma/2026.json": { cuerpo: '{"data":{"anio":2026}}', etag: '"uma"' },
    "/v1/constantes/salario-minimo/2026.json": { cuerpo: '{"data":[]}', etag: '"sm"' },
    "/v1/isr/tarifa/mensual/2026.json": { cuerpo: '{"data":{"periodo":"mensual"}}', etag: '"m"' },
    "/v1/isr/tarifa/anual/2025.json": { cuerpo: '{"data":{"periodo":"anual"}}', etag: '"a"' },
    [INDICE]: { cuerpo: JSON.stringify(ANIOS) },
  };

  async function pedirShard(ruta: string, init?: RequestInit, mapa = SHARDS) {
    const assets = crearAssets(mapa);
    const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
    return { respuesta, assets };
  }

  it.each([
    ["/v1/constantes/uma/2026", "/v1/constantes/uma/2026.json"],
    ["/v1/constantes/salario-minimo/2026", "/v1/constantes/salario-minimo/2026.json"],
    ["/v1/isr/tarifa/mensual/2026", "/v1/isr/tarifa/mensual/2026.json"],
    ["/v1/isr/tarifa/anual/2025", "/v1/isr/tarifa/anual/2025.json"],
  ] as const)("%s sirve %s tal cual, con ETag y 304, sin leer el índice", async (ruta, asset) => {
    const { respuesta, assets } = await pedirShard(ruta);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(respuesta.headers.get("etag")).toBe(SHARDS[asset]?.etag);
    expect(await respuesta.text()).toBe(SHARDS[asset]?.cuerpo);
    expect(assets.pedidas).toEqual([asset]);
    const condicional = await pedirShard(ruta, {
      headers: { "If-None-Match": SHARDS[asset]?.etag as string },
    });
    expect(condicional.respuesta.status).toBe(304);
  });

  /** Pide la ruta y comprueba el 404 del tipo esperado. */
  async function sinAnio(ruta: string, tipo: string, detalle: string, mapa = SHARDS) {
    const { respuesta, assets } = await pedirShard(ruta, undefined, mapa);
    expect(respuesta.status, ruta).toBe(404);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(await respuesta.json(), ruta).toEqual({
      type: `${TIPO}${tipo}`,
      title: tipo === "no-encontrado" ? "Recurso no encontrado" : "Dato todavía no disponible",
      status: 404,
      detail: detalle,
      instance: ruta,
    });
    return assets;
  }

  it.each([
    [
      "/v1/constantes/uma/2016",
      "No existe la UMA de 2016 en los datos; los años cargados van de 2017 a 2026.",
    ],
    [
      "/v1/constantes/uma/0001",
      "No existe la UMA de 0001 en los datos; los años cargados van de 2017 a 2026.",
    ],
    [
      "/v1/constantes/salario-minimo/2018",
      "No existe el salario mínimo de 2018 en los datos; los años cargados van de 2019 a 2026.",
    ],
    [
      "/v1/isr/tarifa/mensual/2025",
      "No existe la tarifa mensual de ISR de 2025 en los datos; el único año cargado es 2026.",
    ],
    [
      "/v1/isr/tarifa/anual/2024",
      "No existe la tarifa anual de ISR de 2024 en los datos; los años cargados van de 2025 a 2026.",
    ],
  ])("%s, antes del primer año cargado: 404 no-encontrado", async (ruta, detalle) => {
    const assets = await sinAnio(ruta, "no-encontrado", detalle);
    expect(assets.pedidas).toEqual([`${ruta}.json`, INDICE]);
  });

  it.each([
    [
      "/v1/constantes/uma/2027",
      "Todavía no se carga la UMA de 2027; los años cargados van de 2017 a 2026.",
    ],
    [
      "/v1/constantes/salario-minimo/2027",
      "Todavía no se carga el salario mínimo de 2027; los años cargados van de 2019 a 2026.",
    ],
    [
      "/v1/isr/tarifa/mensual/2027",
      "Todavía no se carga la tarifa mensual de ISR de 2027; el único año cargado es 2026.",
    ],
    [
      "/v1/isr/tarifa/anual/9999",
      "Todavía no se carga la tarifa anual de ISR de 9999; los años cargados van de 2025 a 2026.",
    ],
  ])("%s, después del último año cargado: 404 dato-no-disponible", async (ruta, detalle) => {
    await sinAnio(ruta, "dato-no-disponible", detalle);
  });

  it("un año que falta entre los cargados es no-encontrado", async () => {
    const conHueco = {
      ...SHARDS,
      [INDICE]: { cuerpo: JSON.stringify({ ...ANIOS, "constantes/uma": [2017, 2019] }) },
    };
    await sinAnio(
      "/v1/constantes/uma/2018",
      "no-encontrado",
      "No existe la UMA de 2018 en los datos; los años cargados van de 2017 a 2019.",
      conHueco,
    );
  });

  it("el índice se lee una vez por isolate, solo cuando falta un shard", async () => {
    const assets = crearAssets(SHARDS);
    for (const ruta of [
      "/v1/constantes/uma/2026",
      "/v1/constantes/uma/2027",
      "/v1/constantes/uma/2016",
    ]) {
      await manejar(peticion(ruta), entornoDe(assets));
    }
    expect(assets.pedidas).toEqual([
      "/v1/constantes/uma/2026.json",
      "/v1/constantes/uma/2027.json",
      INDICE,
      "/v1/constantes/uma/2016.json",
    ]);
  });

  const indice = (anios: object): AssetFalso => ({ cuerpo: JSON.stringify(anios) });
  it.each([
    ["sin índice", { [INDICE]: undefined }],
    ["un índice sin la carpeta", { [INDICE]: indice({ "constantes/uma": [2026] }) }],
    // El índice dice que el año está, pero su shard no: el build no cuadra.
    [
      "un índice que lista el año",
      { [INDICE]: indice({ ...ANIOS, "isr/tarifa/mensual": [2025, 2026] }) },
    ],
  ])("con %s, un shard que falta da 500 genérico", async (_, cambios) => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const mapa = Object.fromEntries(
      Object.entries({ ...SHARDS, ...cambios }).filter(
        (par): par is [string, AssetFalso] => par[1] !== undefined,
      ),
    );
    const { respuesta } = await pedirShard("/v1/isr/tarifa/mensual/2025", undefined, mapa);
    expect(respuesta.status).toBe(500);
    expect(consola.mock.calls.map((c) => String(c[0]))).toEqual([
      "mexicoapi: error interno: Error en /v1/isr/tarifa/{periodo}/{anio}",
    ]);
  });

  it.each([
    ["/v1/constantes/uma/26", "anio"],
    ["/v1/constantes/uma/0000", "anio"],
    ["/v1/constantes/uma/20266", "anio"],
    ["/v1/constantes/uma/2026.json", "anio"],
    ["/v1/constantes/salario-minimo/dos", "anio"],
    ["/v1/isr/tarifa/trimestral/2026", "periodo"],
    ["/v1/isr/tarifa/Mensual/2026", "periodo"],
    ["/v1/isr/tarifa/mensual/26", "anio"],
    ["/v1/isr/tarifa/semanal/26", "periodo"],
  ])("%s: 400 en %s sin tocar ASSETS", async (ruta, parametro) => {
    const { respuesta, assets } = await pedirShard(ruta);
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({
      type: `${TIPO}parametro-invalido`,
      title: "Parámetro inválido",
      status: 400,
      detail:
        parametro === "anio"
          ? "El año (anio) debe tener 4 dígitos, de 0001 a 9999."
          : "El periodo de la tarifa debe ser mensual o anual.",
      instance: ruta,
      parametro,
    });
    expect(assets.pedidas).toEqual([]);
  });

  it.each(["/v1/constantes", "/v1/constantes/salario-minimo", "/v1/isr/tarifa/mensual", "/v1/isr"])(
    "%s no es una ruta: 404",
    async (ruta) => {
      const { respuesta, assets } = await pedirShard(ruta);
      expect(respuesta.status).toBe(404);
      expect(await respuesta.json()).toMatchObject({ detail: "No existe la ruta." });
      expect(assets.pedidas).toEqual([]);
    },
  );
});
