import { FUENTE_CFF_20 } from "@mexicoapi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reiniciarCargas } from "../../src/cargas.js";
import { manejar } from "../../src/index.js";
import { CACHE_DATOS, CACHE_ULTIMO } from "../../src/respuestas.js";
import {
  type AssetFalso,
  crearAssets,
  entornoDe,
  peticion,
  SEGURIDAD_ESPERADA,
  seguridadDe,
} from "./ayudas.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
const DOCS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs";

const FUENTE = {
  name: "Diario Oficial de la Federación (SIDOF)",
  url: "https://sidof.segob.gob.mx/",
  license: "Publicación oficial en el DOF",
  license_url: "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
  citation: "Banco de México. Diario Oficial de la Federación.",
};

const metaDe = (dataset: string, archivo: string) => ({
  dataset,
  as_of: "2026-10-18",
  sources: [FUENTE],
  docs: `${DOCS}/datos/${archivo}.md`,
});

const META_FIX = metaDe("tipo-cambio.fix", "tipo-cambio-fix");
const META_UDIS = metaDe("udis", "udis");
const META_FIX_API = { ...META_FIX, docs: `${DOCS}/api/README.md#tipo-de-cambio-fix` };
const META_UDIS_API = { ...META_UDIS, docs: `${DOCS}/api/README.md#udis` };

interface Rango {
  desde: string;
  hasta: string;
}

// La serie termina el viernes 2026-10-16; las UDIS se publican por adelantado.
const COBERTURA_FIX: Rango = { desde: "2020-01-02", hasta: "2026-10-16" };
const COBERTURA_UDIS: Rango = { desde: "2020-01-01", hasta: "2026-10-25" };

/** Con `fix` null, el dataset del FIX no trae cobertura. */
const interna = (fix: Rango | null = COBERTURA_FIX, udis: Rango = COBERTURA_UDIS) => ({
  datasets: {
    "tipo-cambio.fix": {
      meta: META_FIX,
      records: 8,
      data_sha256: "a".repeat(64),
      frescura_horas: 72,
      ...(fix === null ? {} : { cobertura: fix }),
    },
    udis: {
      meta: META_UDIS,
      records: 6,
      data_sha256: "b".repeat(64),
      frescura_horas: 72,
      cobertura: udis,
    },
  },
});

const fix = (fecha_publicacion: string, valor: string) => ({ fecha_publicacion, valor });
const udi = (fecha: string, valor: string) => ({ fecha, valor });
const shard = (desde: string, hasta: string, datos: unknown[]) => ({
  tramo: { desde, hasta },
  datos,
});

// Tramos de un año completo (recortados a la cobertura), con unos cuantos registros: el 1 de
// enero de 2021 fue viernes y feriado bancario, sin publicación.
type Shards = Record<string, ReturnType<typeof shard>>;
const FIX: Shards = {
  "2020": shard("2020-01-02", "2020-12-31", [
    fix("2020-01-02", "18.8642"),
    fix("2020-12-30", "19.9487"),
    fix("2020-12-31", "19.9352"),
  ]),
  "2021": shard("2021-01-01", "2021-12-31", [
    fix("2021-01-04", "19.9087"),
    fix("2021-01-05", "19.8457"),
  ]),
  "2026": shard("2026-01-01", "2026-10-16", [
    fix("2026-01-02", "18.0012"),
    fix("2026-10-15", "18.4888"),
    fix("2026-10-16", "18.4250"),
  ]),
};
const UDIS: Shards = {
  "2020": shard("2020-01-01", "2020-12-31", [
    udi("2020-01-01", "6.400419"),
    udi("2020-12-31", "6.605597"),
  ]),
  "2021": shard("2021-01-01", "2021-12-31", [udi("2021-01-01", "6.606023")]),
  "2026": shard("2026-01-01", "2026-10-25", [
    udi("2026-10-24", "8.860921"),
    udi("2026-10-25", "8.861350"),
  ]),
};

const RUTA_META = "/v1/_internos/meta.json";
const rutaFix = (anio: string) => `/v1/_internos/fix/${anio}.json`;
const rutaUdis = (anio: string) => `/v1/_internos/udis/${anio}.json`;

interface Datos {
  interna?: unknown;
  fix?: Shards;
  udis?: Shards;
  /** Rutas que responden con este estado en lugar de su cuerpo. */
  estados?: Record<string, number>;
}

function mapaDe({ interna: i = interna(), fix: f = FIX, udis: u = UDIS, estados = {} }: Datos) {
  const mapa: Record<string, AssetFalso> = { [RUTA_META]: { cuerpo: JSON.stringify(i) } };
  for (const [anio, s] of Object.entries(f)) mapa[rutaFix(anio)] = { cuerpo: JSON.stringify(s) };
  for (const [anio, s] of Object.entries(u)) mapa[rutaUdis(anio)] = { cuerpo: JSON.stringify(s) };
  for (const [ruta, status] of Object.entries(estados)) {
    mapa[ruta] = { ...(mapa[ruta] as AssetFalso), status };
  }
  return mapa;
}

async function pedir(ruta: string, datos: Datos = {}, init?: RequestInit) {
  const assets = crearAssets(mapaDe(datos));
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  return { respuesta, assets };
}

/** Pide la ruta y devuelve el cuerpo; comprueba los encabezados de una respuesta de datos. */
async function datos(ruta: string, d: Datos = {}, cache = CACHE_DATOS) {
  const { respuesta, assets } = await pedir(ruta, d);
  expect(respuesta.status, ruta).toBe(200);
  expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(respuesta.headers.get("cache-control")).toBe(cache);
  expect(respuesta.headers.get("etag")).toBeNull();
  expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
  const texto = await respuesta.text();
  expect(Object.keys(JSON.parse(texto))).toEqual(["data", "meta"]);
  return { cuerpo: JSON.parse(texto), pedidas: assets.pedidas };
}

/** Pide la ruta y comprueba un 404 de serie: sin caché, con la fecha y la cobertura. */
async function sinDato(
  ruta: string,
  tipo: "no-encontrado" | "dato-no-disponible",
  detalle: string,
  cobertura: Rango,
  d: Datos = {},
) {
  const { respuesta, assets } = await pedir(ruta, d);
  expect(respuesta.status, ruta).toBe(404);
  expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  expect(respuesta.headers.get("cache-control")).toBe("no-store");
  const texto = await respuesta.text();
  const url = new URL(ruta, "https://api.test");
  const [fecha] = [...url.searchParams.values()];
  expect(JSON.parse(texto), ruta).toEqual({
    type: `${TIPO}${tipo}`,
    title: tipo === "no-encontrado" ? "Recurso no encontrado" : "Dato todavía no disponible",
    status: 404,
    detail: detalle,
    instance: url.pathname,
    fecha,
    cobertura,
  });
  return { texto, pedidas: assets.pedidas };
}

/** Pide la ruta y comprueba un 500 genérico; devuelve lo que se registró. */
async function errorInterno(ruta: string, d: Datos = {}) {
  const consola = vi.spyOn(console, "error").mockImplementation(() => {});
  consola.mockClear();
  const { respuesta, assets } = await pedir(ruta, d);
  expect(respuesta.status, ruta).toBe(500);
  const texto = await respuesta.text();
  expect(JSON.parse(texto)).toEqual({
    type: `${TIPO}error-interno`,
    title: "Error interno",
    status: 500,
    detail: "Ocurrió un error interno.",
    instance: new URL(ruta, "https://api.test").pathname,
  });
  // Nunca un valor de la serie en un error.
  expect(texto).not.toMatch(/\d+\.\d{4}/);
  return { lineas: consola.mock.calls.map((c) => String(c[0])), pedidas: assets.pedidas };
}

/** Pide la ruta y comprueba un 400 sin tocar ASSETS. */
async function invalido(ruta: string, esperado: Record<string, unknown>) {
  const { respuesta, assets } = await pedir(ruta);
  expect(respuesta.status, ruta).toBe(400);
  expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  const cuerpo = await respuesta.json();
  expect(cuerpo, ruta).toEqual({
    status: 400,
    instance: new URL(ruta, "https://api.test").pathname,
    ...esperado,
  });
  expect(assets.pedidas, ruta).toEqual([]);
}

beforeEach(() => reiniciarCargas());
afterEach(() => {
  vi.restoreAllMocks();
});

const fixPublicado = (fecha: string) => `/v1/tipo-cambio/fix?publicado=${fecha}`;
const fixOperacion = (fecha: string) => `/v1/tipo-cambio/fix?operacion=${fecha}`;
const udis = (fecha: string) => `/v1/udis?fecha=${fecha}`;

const NO_DISPONIBLE_FIX = (fecha: string) =>
  `El FIX del ${fecha} todavía no está cargado; la última publicación cargada es del 2026-10-16.`;
const NO_DISPONIBLE_OPERACION = (fecha: string, hasta = "2026-10-16") =>
  `Todavía no está cargado el FIX que aplica a una operación del ${fecha}; la última publicación cargada es del ${hasta}.`;

describe("GET /v1/tipo-cambio/fix?publicado=", () => {
  it("responde el FIX publicado ese día con la meta del dataset", async () => {
    const { cuerpo, pedidas } = await datos(fixPublicado("2026-10-16"));
    expect(cuerpo).toEqual({
      data: { fecha_publicacion: "2026-10-16", valor: "18.4250" },
      meta: META_FIX_API,
    });
    expect(pedidas).toEqual([RUTA_META, rutaFix("2026")]);
  });

  it.each([
    ["un sábado", "2026-10-10"],
    ["un domingo", "2026-10-11"],
    ["un feriado bancario", "2021-01-01"],
  ])("en %s dentro de la serie: 404 no-encontrado definitivo", async (_, fecha) => {
    await sinDato(
      fixPublicado(fecha),
      "no-encontrado",
      `No hubo publicación del FIX en el DOF el ${fecha}.`,
      COBERTURA_FIX,
    );
  });

  it.each(["2019-12-31", "2020-01-01", "0001-01-01"])(
    "%s, antes del inicio de la serie: 404 no-encontrado; solo carga el primer año",
    async (fecha) => {
      const { pedidas } = await sinDato(
        fixPublicado(fecha),
        "no-encontrado",
        `La serie empieza el 2020-01-02; no incluye el ${fecha}.`,
        COBERTURA_FIX,
      );
      expect(pedidas).toEqual([RUTA_META, rutaFix("2020")]);
    },
  );

  it.each(["2026-10-17", "2026-10-18"])(
    "%s, fin de semana justo después del último dato (viernes): 404 no-encontrado definitivo",
    async (fecha) => {
      const { texto } = await sinDato(
        fixPublicado(fecha),
        "no-encontrado",
        `No hubo publicación del FIX en el DOF el ${fecha}.`,
        COBERTURA_FIX,
      );
      expect(texto).not.toContain("18.4250");
    },
  );

  it.each(["2026-10-19", "2026-10-24", "2027-01-04", "9999-12-31"])(
    "%s, después del último dato: 404 dato-no-disponible sin cargar años fuera de la cobertura",
    async (fecha) => {
      const { texto, pedidas } = await sinDato(
        fixPublicado(fecha),
        "dato-no-disponible",
        NO_DISPONIBLE_FIX(fecha),
        COBERTURA_FIX,
      );
      expect(texto).not.toContain("18.4250");
      expect(pedidas).toEqual([RUTA_META, rutaFix("2026")]);
    },
  );
});

describe("GET /v1/tipo-cambio/fix?operacion=", () => {
  const operacion = (fecha_operacion: string, fecha_publicacion: string, valor: string) => ({
    data: { fecha_operacion, fecha_publicacion, valor, fundamento: FUENTE_CFF_20 },
    meta: META_FIX_API,
  });

  it("una operación en lunes usa el FIX del viernes anterior, con su fundamento", async () => {
    const { cuerpo, pedidas } = await datos(fixOperacion("2026-10-19"));
    expect(cuerpo).toEqual(operacion("2026-10-19", "2026-10-16", "18.4250"));
    expect(cuerpo.data.fundamento.nombre).toBe(
      "Código Fiscal de la Federación, artículo 20, tercer párrafo",
    );
    expect(pedidas).toEqual([RUTA_META, rutaFix("2026")]);
  });

  it.each(["2026-10-17", "2026-10-18"])(
    "%s, en fin de semana, también usa el FIX del viernes",
    async (fecha) => {
      const { cuerpo } = await datos(fixOperacion(fecha));
      expect(cuerpo).toEqual(operacion(fecha, "2026-10-16", "18.4250"));
    },
  );

  it("una operación el día de una publicación usa la del día anterior, no la del mismo día", async () => {
    const { cuerpo } = await datos(fixOperacion("2026-10-16"));
    expect(cuerpo).toEqual(operacion("2026-10-16", "2026-10-15", "18.4888"));
  });

  it.each(["2026-10-20", "2026-10-21", "2027-01-05"])(
    "%s, cuya víspera todavía no se carga: 404 dato-no-disponible, nunca un valor viejo",
    async (fecha) => {
      const { texto, pedidas } = await sinDato(
        fixOperacion(fecha),
        "dato-no-disponible",
        NO_DISPONIBLE_OPERACION(fecha),
        COBERTURA_FIX,
      );
      expect(texto).not.toContain("18.4250");
      expect(pedidas).toEqual([RUTA_META, rutaFix("2026")]);
    },
  );

  it("mañana antes de la corrida: sin el FIX de hoy cargado, una operación del sábado no responde el del jueves", async () => {
    // Datos hasta el jueves 2026-10-15: el FIX del viernes 16 todavía no se carga.
    const hastaJueves = {
      interna: interna({ desde: "2020-01-02", hasta: "2026-10-15" }),
      fix: {
        ...FIX,
        "2026": shard("2026-01-01", "2026-10-15", [
          fix("2026-01-02", "18.0012"),
          fix("2026-10-15", "18.4888"),
        ]),
      },
    };
    for (const fecha of ["2026-10-17", "2026-10-19"]) {
      const { texto } = await sinDato(
        fixOperacion(fecha),
        "dato-no-disponible",
        NO_DISPONIBLE_OPERACION(fecha, "2026-10-15"),
        { desde: "2020-01-02", hasta: "2026-10-15" },
        hastaJueves,
      );
      expect(texto).not.toContain("18.4888");
    }
    const { cuerpo } = await datos(fixOperacion("2026-10-16"), hastaJueves);
    expect(cuerpo).toEqual(operacion("2026-10-16", "2026-10-15", "18.4888"));
  });

  it.each(["2020-01-02", "2020-01-01", "2019-06-03", "0001-01-01"])(
    "%s, sin publicación anterior en la serie: 404 no-encontrado; solo carga el primer año",
    async (fecha) => {
      const { pedidas } = await sinDato(
        fixOperacion(fecha),
        "no-encontrado",
        `La serie empieza el 2020-01-02; no incluye la publicación que aplica a una operación del ${fecha}.`,
        COBERTURA_FIX,
      );
      expect(pedidas).toEqual([RUTA_META, rutaFix("2020")]);
    },
  );

  it("el día siguiente al inicio de la serie usa su primera publicación", async () => {
    const { cuerpo } = await datos(fixOperacion("2020-01-03"));
    expect(cuerpo).toEqual(operacion("2020-01-03", "2020-01-02", "18.8642"));
  });

  describe("cambio de año", () => {
    it.each(["2021-01-04", "2021-01-02"])(
      "%s, sin publicación del año antes de la fecha: carga el año anterior y usa la de diciembre",
      async (fecha) => {
        const { cuerpo, pedidas } = await datos(fixOperacion(fecha));
        expect(cuerpo).toEqual(operacion(fecha, "2020-12-31", "19.9352"));
        expect(pedidas).toEqual([RUTA_META, rutaFix("2021"), rutaFix("2020")]);
      },
    );

    it("el 1 de enero, la víspera es del año anterior y basta ese año", async () => {
      const { cuerpo, pedidas } = await datos(fixOperacion("2021-01-01"));
      expect(cuerpo).toEqual(operacion("2021-01-01", "2020-12-31", "19.9352"));
      expect(pedidas).toEqual([RUTA_META, rutaFix("2020")]);
    });

    it("con una publicación del año antes de la fecha, no carga el anterior", async () => {
      const { cuerpo, pedidas } = await datos(fixOperacion("2021-01-05"));
      expect(cuerpo).toEqual(operacion("2021-01-05", "2021-01-04", "19.9087"));
      expect(pedidas).toEqual([RUTA_META, rutaFix("2021")]);
    });

    it("un año sin publicaciones se salta hasta la última anterior", async () => {
      const conAnioVacio = {
        interna: interna({ desde: "2020-01-02", hasta: "2022-01-04" }),
        fix: {
          "2020": FIX["2020"] as ReturnType<typeof shard>,
          "2021": shard("2021-01-01", "2021-12-31", []),
          "2022": shard("2022-01-01", "2022-01-04", [
            fix("2022-01-03", "20.5000"),
            fix("2022-01-04", "20.6000"),
          ]),
        },
      };
      const { cuerpo, pedidas } = await datos(fixOperacion("2022-01-03"), conAnioVacio);
      expect(cuerpo).toEqual(operacion("2022-01-03", "2020-12-31", "19.9352"));
      expect(pedidas).toEqual([RUTA_META, rutaFix("2022"), rutaFix("2021"), rutaFix("2020")]);
    });

    it("tramos de años que no son contiguos dan 500, nunca un valor", async () => {
      const conHueco = {
        fix: {
          ...FIX,
          "2020": shard("2020-01-02", "2020-12-30", [
            fix("2020-01-02", "18.8642"),
            fix("2020-12-30", "19.9487"),
          ]),
        },
      };
      const { lineas, pedidas } = await errorInterno(fixOperacion("2021-01-04"), conHueco);
      expect(lineas).toEqual(["mexicoapi: error interno: Error en /v1/tipo-cambio/fix"]);
      expect(pedidas).toEqual([RUTA_META, rutaFix("2021"), rutaFix("2020")]);
    });

    it("si el primer año no empieza con la serie, no pide años fuera de la cobertura: 500", async () => {
      const malInicio = {
        fix: {
          ...FIX,
          "2020": shard("2020-01-06", "2020-12-31", [fix("2020-01-06", "18.7000")]),
        },
      };
      const { pedidas } = await errorInterno(fixOperacion("2020-01-06"), malInicio);
      expect(pedidas).toEqual([RUTA_META, rutaFix("2020")]);
    });
  });
});

describe("GET /v1/tipo-cambio/fix: parámetros", () => {
  it("sin publicado ni operacion: 400 parametro-faltante", async () => {
    await invalido("/v1/tipo-cambio/fix", {
      type: `${TIPO}parametro-faltante`,
      title: "Falta un parámetro obligatorio",
      detail: "Indica publicado u operacion.",
    });
  });

  it("con publicado y operacion: 400 parametro-invalido", async () => {
    await invalido("/v1/tipo-cambio/fix?publicado=2026-10-16&operacion=2026-10-19", {
      type: `${TIPO}parametro-invalido`,
      title: "Parámetro inválido",
      detail: "Indica solo uno de publicado u operacion.",
    });
  });

  it.each([
    ["publicado", "2026-02-30"],
    ["publicado", "2026-1-05"],
    ["publicado", "20261016"],
    ["publicado", "0000-01-01"],
    ["operacion", "2026-13-01"],
    ["operacion", "hoy"],
  ])("%s=%s no es una fecha real: 400 sobre el parámetro", async (parametro, valor) => {
    const detalle =
      parametro === "publicado"
        ? "La fecha de publicación (publicado) debe ser una fecha válida con formato AAAA-MM-DD."
        : "La fecha de la operación (operacion) debe ser una fecha válida con formato AAAA-MM-DD.";
    await invalido(`/v1/tipo-cambio/fix?${parametro}=${valor}`, {
      type: `${TIPO}parametro-invalido`,
      title: "Parámetro inválido",
      detail: detalle,
      parametro,
    });
  });

  it("vacío, repetido o desconocido: 400 sin tocar ASSETS", async () => {
    for (const [ruta, tipo, parametro] of [
      ["/v1/tipo-cambio/fix?publicado=", "parametro-invalido", "publicado"],
      [
        "/v1/tipo-cambio/fix?operacion=2026-10-19&operacion=2026-10-20",
        "parametro-invalido",
        "operacion",
      ],
      ["/v1/tipo-cambio/fix?fecha=2026-10-16", "parametro-desconocido", "fecha"],
    ] as const) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(await respuesta.json(), ruta).toMatchObject({ type: `${TIPO}${tipo}`, parametro });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });
});

describe("GET /v1/tipo-cambio/fix/ultimo", () => {
  it("responde la última publicación de la serie, con un caché corto y sin stale", async () => {
    const { cuerpo, pedidas } = await datos("/v1/tipo-cambio/fix/ultimo", {}, CACHE_ULTIMO);
    expect(cuerpo).toEqual({
      data: { fecha_publicacion: "2026-10-16", valor: "18.4250" },
      meta: META_FIX_API,
    });
    expect(pedidas).toEqual([RUTA_META, rutaFix("2026")]);
  });

  it("si el shard del último año no trae la última fecha de la cobertura: 500", async () => {
    const sinUltimo = {
      fix: { ...FIX, "2026": shard("2026-01-01", "2026-10-16", [fix("2026-10-15", "18.4888")]) },
    };
    const { lineas } = await errorInterno("/v1/tipo-cambio/fix/ultimo", sinUltimo);
    expect(lineas).toEqual(["mexicoapi: error interno: Error en /v1/tipo-cambio/fix/ultimo"]);
  });

  it("no acepta parámetros de query", async () => {
    const { respuesta, assets } = await pedir("/v1/tipo-cambio/fix/ultimo?fecha=2026-10-16");
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}parametro-desconocido`,
      parametro: "fecha",
    });
    expect(assets.pedidas).toEqual([]);
  });
});

describe("GET /v1/udis", () => {
  it("responde el valor del día con la meta del dataset", async () => {
    const { cuerpo, pedidas } = await datos(udis("2026-10-25"));
    expect(cuerpo).toEqual({
      data: { fecha: "2026-10-25", valor: "8.861350" },
      meta: META_UDIS_API,
    });
    expect(pedidas).toEqual([RUTA_META, rutaUdis("2026")]);
  });

  it.each([
    ["2021-01-01", "6.606023", "2021"],
    ["2020-12-31", "6.605597", "2020"],
  ])("%s carga solo su año", async (fecha, valor, anio) => {
    const { cuerpo, pedidas } = await datos(udis(fecha));
    expect(cuerpo.data).toEqual({ fecha, valor });
    expect(pedidas).toEqual([RUTA_META, rutaUdis(anio)]);
  });

  it.each(["2019-12-31", "0001-01-01"])(
    "%s, antes del inicio de la serie: 404 no-encontrado",
    async (fecha) => {
      const { pedidas } = await sinDato(
        udis(fecha),
        "no-encontrado",
        `La serie empieza el 2020-01-01; no incluye el ${fecha}.`,
        COBERTURA_UDIS,
      );
      expect(pedidas).toEqual([RUTA_META, rutaUdis("2020")]);
    },
  );

  it("un día que falta dentro de la serie: 404 no-encontrado", async () => {
    await sinDato(
      udis("2020-06-01"),
      "no-encontrado",
      "No hay valor de la UDI para el 2020-06-01.",
      COBERTURA_UDIS,
    );
  });

  it.each(["2026-10-26", "2027-01-01"])(
    "%s, después del último dato: 404 dato-no-disponible sin cargar años fuera de la cobertura",
    async (fecha) => {
      const { texto, pedidas } = await sinDato(
        udis(fecha),
        "dato-no-disponible",
        `El valor de la UDI del ${fecha} todavía no está cargado; el último cargado es del 2026-10-25.`,
        COBERTURA_UDIS,
      );
      expect(texto).not.toContain("8.861350");
      expect(pedidas).toEqual([RUTA_META, rutaUdis("2026")]);
    },
  );

  it("sin fecha, o con una que no existe: 400 sin tocar ASSETS", async () => {
    await invalido("/v1/udis", {
      type: `${TIPO}parametro-faltante`,
      title: "Falta un parámetro obligatorio",
      detail: "Falta el parámetro fecha.",
      parametro: "fecha",
    });
    await invalido(udis("2026-02-29"), {
      type: `${TIPO}parametro-invalido`,
      title: "Parámetro inválido",
      detail: "La fecha del valor (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
      parametro: "fecha",
    });
  });
});

describe("carga de las series", () => {
  it("cada año se lee una vez por isolate, para cualquier ruta de la serie", async () => {
    const assets = crearAssets(mapaDe({}));
    for (const ruta of [
      fixPublicado("2026-10-16"),
      fixOperacion("2026-10-19"),
      "/v1/tipo-cambio/fix/ultimo",
      fixPublicado("2027-01-04"),
    ]) {
      await manejar(peticion(ruta), entornoDe(assets));
    }
    expect(assets.pedidas).toEqual([RUTA_META, rutaFix("2026")]);
  });

  it("una falla al leer un año da 500 y no se recuerda", async () => {
    const fallido = await errorInterno(fixPublicado("2026-10-16"), {
      estados: { [rutaFix("2026")]: 503 },
    });
    expect(fallido.lineas).toEqual(["mexicoapi: error interno: Error en /v1/tipo-cambio/fix"]);
    const { cuerpo } = await datos(fixPublicado("2026-10-16"));
    expect(cuerpo.data.valor).toBe("18.4250");
  });

  it("un año de la cobertura sin shard da 500, no 404", async () => {
    const { pedidas } = await errorInterno(fixPublicado("2023-05-02"));
    expect(pedidas).toEqual([RUTA_META, rutaFix("2023")]);
  });

  it.each([
    ["sin el dataset", { datasets: {} }],
    ["sin la cobertura", interna(null)],
  ])("%s en el meta interno: 500 genérico sin pedir shards", async (_, i) => {
    for (const ruta of [fixPublicado("2026-10-16"), "/v1/tipo-cambio/fix/ultimo"]) {
      reiniciarCargas();
      const { pedidas } = await errorInterno(ruta, { interna: i });
      expect(pedidas).toEqual([RUTA_META]);
    }
  });

  it("un tramo que no alcanza es SerieIncompletaError: 500 que solo registra el nombre", async () => {
    // El shard de 2026 dice cubrir hasta el 15 aunque la cobertura llega al 16.
    const corto = {
      fix: { ...FIX, "2026": shard("2026-01-01", "2026-10-15", [fix("2026-10-15", "18.4888")]) },
      udis: { ...UDIS, "2026": shard("2026-01-01", "2026-10-24", [udi("2026-10-24", "8.860921")]) },
    };
    for (const [ruta, plantilla] of [
      [fixPublicado("2026-10-16"), "/v1/tipo-cambio/fix"],
      [fixOperacion("2026-10-19"), "/v1/tipo-cambio/fix"],
      [udis("2026-10-25"), "/v1/udis"],
    ] as const) {
      reiniciarCargas();
      const { lineas } = await errorInterno(ruta, corto);
      expect(lineas).toEqual([`mexicoapi: error interno: SerieIncompletaError en ${plantilla}`]);
    }
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    for (const ruta of [
      fixPublicado("2026-10-16"),
      fixOperacion("2026-10-20"),
      "/v1/tipo-cambio/fix/ultimo",
      udis("2026-10-25"),
    ]) {
      const get = (await pedir(ruta)).respuesta;
      const { respuesta } = await pedir(ruta, {}, { method: "HEAD" });
      expect(respuesta.status, ruta).toBe(get.status);
      expect(respuesta.body, ruta).toBeNull();
      expect([...respuesta.headers], ruta).toEqual([...get.headers]);
    }
  });
});
