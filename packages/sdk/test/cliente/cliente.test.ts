import { inspect } from "node:util";
import { problemaDeError } from "@mexicoapi/core/rutas";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as cliente from "../../src/cliente/index.js";
import {
  type Cliente,
  crearCliente,
  type EstadoDataset,
  type FetchCompatible,
  type FixOperacion,
  MexicoApiError,
  type OpcionesComunes,
  type OpcionesConsulta,
  type Respuesta,
  type RespuestaSinMeta,
  URL_API,
} from "../../src/cliente/index.js";
import * as calendarios from "../../src/datos/calendarios.js";
import * as constantes from "../../src/datos/constantes.js";
import * as fix from "../../src/datos/fix.js";
import * as datos from "../../src/datos/index.js";
import * as udis from "../../src/datos/udis.js";
import type { Estado, ResultadoDiasHabiles, TipoCambioFix, Udi } from "../../src/index.js";
import * as mexicoapi from "../../src/index.js";
import { esperarCongelado } from "../datos/comun.js";
import {
  BASE,
  colgada,
  errorInterno,
  fetchFalso,
  json,
  META,
  PROBLEMAS,
  problema,
  rechazo,
  datos as respuestaDatos,
} from "./ayudas.js";
import { AVISO_LFT, mover, probarClienteSinRed } from "./comun.js";
import { probarCuradosSinRed } from "./curados.js";

const CLABE = "002010077777777771";
const SINALOA = { cve_ent: "25", nombre: "Sinaloa", abreviatura: "Sin.", cvegeo: "25" };
const FIX_API = { fecha_publicacion: "2026-10-16", valor: "18.4250" };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Cliente con base y el fetch falso. */
const conFetch = (fetch: FetchCompatible, opciones: OpcionesComunes & { offline?: boolean } = {}) =>
  crearCliente({ base: BASE, fetch, ...opciones });

/** Si la promesa ya se resolvió o rechazó, sin esperarla. */
function seguir(promesa: Promise<unknown>): { listo: boolean; error?: unknown } {
  const estado: { listo: boolean; error?: unknown } = { listo: false };
  promesa.then(
    () => {
      estado.listo = true;
    },
    (error: unknown) => {
      estado.listo = true;
      estado.error = error;
    },
  );
  return estado;
}

/** Avanza el reloj falso y deja correr lo que quedó pendiente (setImmediate no es falso). */
async function avanzar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise((resolver) => setImmediate(resolver));
}

function relojFalso(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // Sin variación: las esperas son exactamente la mitad de su tope (125, 250, 500 ms...).
  vi.spyOn(Math, "random").mockReturnValue(0);
}

describe("sin red desde src", () => {
  probarClienteSinRed(async () => ({ cliente, datos, fix, udis, mexicoapi }));
});

describe("calendarios y constantes sin red desde src", () => {
  probarCuradosSinRed(async () => ({ cliente, calendarios, constantes, mexicoapi }));
});

describe("consulta a la API", () => {
  it("pide la ruta con sus valores y su query a la base, solo con Accept", async () => {
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos(SINALOA),
      respuestaDatos({}),
      respuestaDatos({}),
      respuestaDatos({}),
    );
    const api = crearCliente({ base: `${BASE}/v1/`, fetch });
    await api.estado("25", { fuente: "api" });
    await api.diasHabiles({ desde: "2026-11-13", dias: 3 });
    await api.diasHabiles({ desde: "2026-11-13", dias: 3, permitirIncompleto: true });
    await api.fixPublicado("2026-10-16&x=1");
    expect(llamadas.map((l) => l.url)).toEqual([
      `${BASE}/v1/estados/25`,
      `${BASE}/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=3`,
      `${BASE}/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=3&permitir_incompleto=true`,
      `${BASE}/v1/tipo-cambio/fix?publicado=2026-10-16%26x%3D1`,
    ]);
    for (const { init } of llamadas) {
      expect(init.headers).toEqual({ Accept: "application/json" });
      expect(init.signal.aborted).toBe(false);
    }
  });

  it("acepta la base como URL, con ruta y sin barra final", async () => {
    const { fetch, llamadas } = fetchFalso(respuestaDatos([]), respuestaDatos([]));
    await crearCliente({ base: new URL("http://127.0.0.1:8787/api/"), fetch }).bancos({
      fuente: "api",
    });
    await crearCliente({ base: "https://API.ejemplo.mx/V1", fetch }).bancos({ fuente: "api" });
    expect(llamadas.map((l) => l.url)).toEqual([
      "http://127.0.0.1:8787/api/v1/bancos",
      "https://API.ejemplo.mx/v1/bancos",
    ]);
  });

  it("revisa y limpia una base con miles de barras en tiempo lineal", async () => {
    const { fetch, llamadas } = fetchFalso(respuestaDatos([]));
    const barras = "/".repeat(10_000);
    let inicio = performance.now();
    const api = crearCliente({ base: `http://127.0.0.1:8787${barras}x${barras}`, fetch });
    expect(performance.now() - inicio).toBeLessThan(50);
    await api.bancos({ fuente: "api" });
    expect(llamadas[0]?.url).toBe(`http://127.0.0.1:8787${barras}x/v1/bancos`);
    inicio = performance.now();
    expect(() => crearCliente({ base: `http://127.0.0.1${barras}x${barras}?`, fetch })).toThrow(
      TypeError,
    );
    expect(() => crearCliente({ base: `http://${"a".repeat(10_000)}@` })).toThrow(TypeError);
    expect(performance.now() - inicio).toBeLessThan(50);
  });

  it("rechaza una base con usuario o contraseña sin repetirlos en el error", () => {
    for (const base of [
      "https://usuario:secreto@api.ejemplo.mx",
      "https://secreto@api.ejemplo.mx/v1/",
      new URL("https://usuario:secreto@api.ejemplo.mx/"),
    ]) {
      const error = (() => {
        try {
          crearCliente({ base });
        } catch (e) {
          return e as Error;
        }
        throw new Error("no lanzó");
      })();
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(
        "base no lleva usuario ni contraseña (usuario:clave@); pasa solo el origen de la API, como https://mexicoapi.example.workers.dev.",
      );
    }
    // Una @ en la ruta no es una credencial.
    expect(() =>
      crearCliente({ base: "https://api.ejemplo.mx/@equipo", offline: true }),
    ).not.toThrow();
  });

  it("usa el fetch global si no recibe uno, llamado sin this", async () => {
    const global = vi.fn(function (this: unknown, _url: string) {
      expect(this).toBeUndefined();
      return Promise.resolve(respuestaDatos([]));
    });
    vi.stubGlobal("fetch", global);
    try {
      await crearCliente({ base: BASE }).estados({ fuente: "api" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(global).toHaveBeenCalledTimes(1);
    expect(global.mock.calls[0]?.[0]).toBe(`${BASE}/v1/estados`);
  });

  it("devuelve data y meta de la API, congelados, con origen api y sin advertencias", async () => {
    const { fetch } = fetchFalso(respuestaDatos([SINALOA]));
    const r = await conFetch(fetch).estados({ fuente: "api" });
    expect(r).toEqual({ data: [SINALOA], meta: META, origen: "api", advertencias: [] });
    esperarCongelado(r, "respuesta");
  });

  it("pasa las advertencias de primer nivel de la API (días inhábiles)", async () => {
    const aviso =
      "Los días de tipo vacaciones del SAT solo están completos hasta el 30 de noviembre.";
    const { fetch } = fetchFalso(
      json({ data: [], advertencias: [aviso], meta: META }),
      json({ data: [], advertencias: [1, "otro"], meta: META }),
      json({ data: [], advertencias: "no es lista", meta: META }),
    );
    const api = conFetch(fetch);
    const r = await api.diasInhabiles({ autoridad: "sat", anio: 2026 });
    expect(r.advertencias).toEqual([aviso]);
    esperarCongelado(r, "respuesta");
    expect((await api.diasInhabiles({ autoridad: "sat", anio: 2026 })).advertencias).toEqual([
      "otro",
    ]);
    expect((await api.diasInhabiles({ autoridad: "sat", anio: 2026 })).advertencias).toEqual([]);
  });

  it("/v1/status responde sin meta", async () => {
    const estado = { dataset: "udis", status: "ok" };
    const { fetch } = fetchFalso(json({ data: [estado] }));
    const r = await conFetch(fetch).status();
    expect(r).toEqual({ data: [estado], origen: "api", advertencias: [] });
    expect("meta" in r).toBe(false);
  });

  it("lanza MexicoApiError con el problem+json y las claves públicas", async () => {
    const { fetch, llamadas } = fetchFalso(
      problema("no-encontrado", 404, "Recurso no encontrado", "No existe el estado 33.", {
        instance: "/v1/estados/33",
        extra: { a: 1 },
      }),
    );
    const error = (await rechazo(
      conFetch(fetch).estado("33", { fuente: "api" }),
    )) as MexicoApiError;
    expect(error).toBeInstanceOf(MexicoApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MexicoApiError");
    expect(error.status).toBe(404);
    expect(error.type).toBe(`${PROBLEMAS}no-encontrado`);
    expect(error.tipo).toBe("no-encontrado");
    expect(error.title).toBe("Recurso no encontrado");
    expect(error.detail).toBe("No existe el estado 33.");
    expect(error.message).toBe("404 Recurso no encontrado: No existe el estado 33.");
    expect(error.url).toBe(`${BASE}/v1/estados/33`);
    expect(error.origen).toBe("api");
    expect(error.problema).toEqual({
      type: `${PROBLEMAS}no-encontrado`,
      title: "Recurso no encontrado",
      status: 404,
      detail: "No existe el estado 33.",
      instance: "/v1/estados/33",
      extra: { a: 1 },
    });
    esperarCongelado(error.problema, "problema");
    expect(inspect(error)).toContain("estados/33");
    expect(llamadas).toHaveLength(1);
  });

  it("nunca deja la CLABE en el error, su mensaje, su causa ni su url", async () => {
    const caido = new TypeError(
      `error sending request for url (${BASE}/v1/clabe/${CLABE}): connection refused`,
    );
    const { fetch } = fetchFalso(
      () => errorInterno(),
      caido,
      () =>
        problema("error-interno", 500, "Error interno", `Falló ${CLABE}.`, {
          instance: `/v1/clabe/${CLABE}`,
        }),
    );
    const api = conFetch(fetch, { reintentos: 0 });
    const errores = [
      await rechazo(api.clabe(CLABE, { fuente: "api" })),
      await rechazo(api.clabe(CLABE, { fuente: "api" })),
      await rechazo(api.clabe(CLABE, { fuente: "api" })),
    ] as MexicoApiError[];
    for (const error of errores) {
      expect(error).toBeInstanceOf(MexicoApiError);
      expect(error.url).toBe(`${BASE}/v1/clabe/{clabe}`);
      expect(inspect(error, { depth: 10 })).not.toContain(CLABE);
      expect(JSON.stringify(error.problema)).not.toContain(CLABE);
      expect(String(error.stack)).not.toContain(CLABE);
    }
    const red = errores[1] as MexicoApiError;
    expect(red.status).toBe(0);
    expect((red.cause as Error).message).toBe(
      `error sending request for url (${BASE}/v1/clabe/{clabe}): connection refused`,
    );
    expect((red.cause as Error).name).toBe("TypeError");
    expect((errores[2] as MexicoApiError).problema.instance).toBe("/v1/clabe/{clabe}");
    expect((errores[2] as MexicoApiError).detail).toBe("Falló {clabe}.");
  });

  it("oculta la ruta en toda la cadena de causas y en las extensiones del problema", async () => {
    const anidada = new TypeError("fetch failed", {
      cause: Object.assign(new Error(`proxy: GET ${BASE}/v1/clabe/${CLABE} rechazada`), {
        code: `E_${CLABE}`,
        cause: new Error(`socket para /v1/clabe/${CLABE}`, { cause: `texto ${CLABE}` }),
      }),
    });
    const { fetch } = fetchFalso(anidada, () =>
      problema("error-interno", 500, "Error interno", "Ocurrió un error interno.", {
        instance: `/v1/clabe/${CLABE}`,
        ruta: `/v1/clabe/${CLABE}`,
        detalles: [{ valor: CLABE, n: 1 }, CLABE, 3],
      }),
    );
    const api = conFetch(fetch, { reintentos: 0 });
    const red = (await rechazo(api.clabe(CLABE, { fuente: "api" }))) as MexicoApiError;
    const caido = (await rechazo(api.clabe(CLABE, { fuente: "api" }))) as MexicoApiError;
    for (const error of [red, caido]) {
      expect(inspect(error, { depth: 10 })).not.toContain(CLABE);
    }
    const primera = red.cause as Error & { code?: string };
    const segunda = primera.cause as Error & { code?: string };
    expect(segunda.message).toBe(`proxy: GET ${BASE}/v1/clabe/{clabe} rechazada`);
    expect(segunda.code).toBe("E_{clabe}");
    expect((segunda.cause as Error).message).toBe("socket para /v1/clabe/{clabe}");
    expect(((segunda.cause as Error).cause as Error).message).toBe("texto {clabe}");
    expect(caido.problema).toEqual({
      type: `${PROBLEMAS}error-interno`,
      title: "Error interno",
      status: 500,
      detail: "Ocurrió un error interno.",
      instance: "/v1/clabe/{clabe}",
      ruta: "/v1/clabe/{clabe}",
      detalles: [{ valor: "{clabe}", n: 1 }, "{clabe}", 3],
    });
  });

  it("corta una cadena de causas circular", async () => {
    const circular = new Error("uno") as Error & { cause?: unknown };
    circular.cause = circular;
    const { fetch } = fetchFalso(circular);
    const error = (await rechazo(
      conFetch(fetch, { reintentos: 0 }).estados({ fuente: "api" }),
    )) as MexicoApiError;
    let profundidad = 0;
    for (let c: unknown = error.cause; c instanceof Error; c = c.cause) profundidad++;
    expect(profundidad).toBeLessThanOrEqual(6);
  });

  it("una respuesta de error sin problem+json da about:blank con el estado HTTP", async () => {
    const html = new Response("<h1>Bad gateway</h1>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
    const { fetch } = fetchFalso(html, json({ error: "no" }, 404));
    const api = conFetch(fetch, { reintentos: 0 });
    const caido = (await rechazo(api.estados({ fuente: "api" }))) as MexicoApiError;
    expect(caido.status).toBe(502);
    expect(caido.type).toBe("about:blank");
    expect(caido.tipo).toBeUndefined();
    expect(caido.title).toBe("Respuesta inesperada de la API");
    expect(caido.detail).toBe("La API respondió 502 sin problem+json.");
    expect(caido.problema).toEqual({
      type: "about:blank",
      title: "Respuesta inesperada de la API",
      status: 502,
      detail: "La API respondió 502 sin problem+json.",
    });
    const otro = (await rechazo(api.estados({ fuente: "api" }))) as MexicoApiError;
    expect(otro.status).toBe(404);
    expect(otro.type).toBe("about:blank");
  });

  it("un problem+json sin detail da un detail vacío", async () => {
    const { fetch } = fetchFalso(
      json({ type: `${PROBLEMAS}no-encontrado`, title: "Recurso no encontrado" }, 404),
    );
    const error = (await rechazo(
      conFetch(fetch).estado("25", { fuente: "api" }),
    )) as MexicoApiError;
    expect(error.detail).toBe("");
    expect(error.problema.status).toBe(404);
    expect(error.message).toBe("404 Recurso no encontrado: ");
  });

  it("oculta solo los valores sensibles y muestra las claves de catálogo", async () => {
    const { fetch } = fetchFalso(
      problema(
        "no-encontrado",
        404,
        "Recurso no encontrado",
        `No hay ${CLABE} en 002 (${encodeURIComponent(CLABE)}).`,
        { instance: `/v1/x/${CLABE}/002` },
      ),
    );
    const consultar = conFetch(fetch).consultar as unknown as (
      ruta: string,
      parametros: Record<string, unknown>,
    ) => Promise<unknown>;
    const error = (await rechazo(
      consultar("/v1/x/{clabe}/{codigo}", { clabe: CLABE, codigo: "002" }),
    )) as MexicoApiError;
    expect(error.detail).toBe("No hay {clabe} en 002 ({clabe}).");
    expect(error.problema.instance).toBe("/v1/x/{clabe}/002");
    expect(error.url).toBe(`${BASE}/v1/x/{clabe}/002`);
    expect(`${error.message} ${JSON.stringify(error.problema)} ${error.url}`).not.toContain(CLABE);
  });

  it("si fetch lanza algo que no es Error, la causa lo lleva como texto y sin la ruta", async () => {
    const { fetch } = fetchFalso(() => Promise.reject(`sin red para /v1/clabe/${CLABE}`));
    const error = (await rechazo(
      conFetch(fetch, { reintentos: 0 }).clabe(CLABE, { fuente: "api" }),
    )) as MexicoApiError;
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).name).toBe("Error");
    expect((error.cause as Error).message).toBe("sin red para /v1/clabe/{clabe}");
    expect("cause" in (error.cause as Error)).toBe(false);
  });

  it("un 200 que no es JSON con data y meta es una respuesta inesperada", async () => {
    const { fetch } = fetchFalso(
      new Response("<html>portal</html>", { status: 200 }),
      json({ data: [] }),
      json({ meta: META }),
      json([1, 2]),
    );
    const api = conFetch(fetch);
    for (let i = 0; i < 4; i++) {
      const error = (await rechazo(api.estados({ fuente: "api" }))) as MexicoApiError;
      expect(error.status).toBe(200);
      expect(error.detail).toBe("La respuesta no trae JSON con data.");
    }
  });

  it("una ruta que el cliente no conoce va a la API, con meta solo si llega", async () => {
    const { fetch, llamadas } = fetchFalso(
      json({ data: { valor: "117.31" } }),
      json({ data: 1, meta: META }),
    );
    const api = conFetch(fetch);
    const consultar = api.consultar as unknown as (
      ruta: string,
      parametros?: Record<string, unknown>,
    ) => Promise<RespuestaSinMeta<unknown>>;
    expect(await consultar("/v1/isr/subsidio/{anio}", { anio: 2026 })).toEqual({
      data: { valor: "117.31" },
      origen: "api",
      advertencias: [],
    });
    expect(await consultar("/v1/otra")).toEqual({
      data: 1,
      meta: META,
      origen: "api",
      advertencias: [],
    });
    expect(llamadas.map((l) => l.url)).toEqual([`${BASE}/v1/isr/subsidio/2026`, `${BASE}/v1/otra`]);
    await expect(
      crearCliente({ offline: true }).consultar("/v1/otra" as "/v1/status"),
    ).rejects.toThrow("El paquete no trae /v1/otra");
  });
});

describe("reintentos", () => {
  it("reintenta un 5xx con espera exponencial y responde cuando la API se recupera", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      errorInterno(),
      new Response("", { status: 503 }),
      respuestaDatos([SINALOA]),
    );
    const consulta = conFetch(fetch).estados({ fuente: "api" });
    await avanzar(0);
    expect(llamadas).toHaveLength(1);
    await avanzar(124);
    expect(llamadas).toHaveLength(1);
    await avanzar(1);
    expect(llamadas).toHaveLength(2);
    await avanzar(249);
    expect(llamadas).toHaveLength(2);
    await avanzar(1);
    expect(llamadas).toHaveLength(3);
    expect((await consulta).data).toEqual([SINALOA]);
  });

  it("se rinde después de `reintentos` y lanza el último error", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(errorInterno(), errorInterno(), errorInterno());
    const consulta = conFetch(fetch).estados({ fuente: "api" });
    const estado = seguir(consulta);
    await avanzar(125 + 250);
    expect(llamadas).toHaveLength(3);
    await avanzar(0);
    expect(estado.listo).toBe(true);
    expect((estado.error as MexicoApiError).status).toBe(500);
    expect((estado.error as MexicoApiError).tipo).toBe("error-interno");
  });

  it("la espera crece al doble y varía hasta su tope", async () => {
    relojFalso();
    vi.mocked(Math.random).mockReturnValue(0.999);
    const { fetch, llamadas } = fetchFalso(
      errorInterno(),
      errorInterno(),
      errorInterno(),
      respuestaDatos([]),
    );
    const consulta = conFetch(fetch, { reintentos: 3 }).estados({ fuente: "api" });
    // Con la variación casi al máximo: 249, 499 y 999 ms.
    await avanzar(248);
    expect(llamadas).toHaveLength(1);
    await avanzar(1);
    expect(llamadas).toHaveLength(2);
    await avanzar(498);
    expect(llamadas).toHaveLength(2);
    await avanzar(1);
    expect(llamadas).toHaveLength(3);
    await avanzar(999);
    expect(llamadas).toHaveLength(4);
    await consulta;
  });

  it("con reintentos: 0 hace un solo intento", async () => {
    const { fetch, llamadas } = fetchFalso(errorInterno());
    const error = (await rechazo(
      conFetch(fetch, { reintentos: 0 }).estados({ fuente: "api" }),
    )) as MexicoApiError;
    expect(error.status).toBe(500);
    expect(llamadas).toHaveLength(1);
  });

  it("no reintenta los problemas definitivos de la API (4xx)", async () => {
    const { fetch, llamadas } = fetchFalso(
      problema("parametro-invalido", 400, "Parámetro inválido", "Mal."),
      problema("dato-no-disponible", 404, "Dato todavía no disponible", "Aún no."),
      problema("calendario-incompleto", 422, "Calendario incompleto", "No cubre."),
    );
    const api = conFetch(fetch);
    await rechazo(api.diasHabiles({ desde: "2026-11-13", dias: 3 }, { fuente: "api" }));
    await rechazo(api.udi("2026-10-20", { fuente: "api" }));
    await rechazo(api.diasInhabiles({ anio: 2026 }, { fuente: "api" }));
    expect(llamadas).toHaveLength(3);
  });

  it("reintenta un fallo de red y, si sigue, lanza status 0 con la causa", async () => {
    relojFalso();
    const caido = new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    const { fetch, llamadas } = fetchFalso(caido, caido, caido, caido, respuestaDatos([]));
    const api = conFetch(fetch);
    const primera = seguir(api.estados({ fuente: "api" }));
    await avanzar(125 + 250);
    expect(llamadas).toHaveLength(3);
    expect(primera.listo).toBe(true);
    const error = primera.error as MexicoApiError;
    expect(error.status).toBe(0);
    expect(error.type).toBe("about:blank");
    expect(error.title).toBe("Sin respuesta de la API");
    expect(error.detail).toBe("No se pudo conectar con la API.");
    expect(error.message).toBe("Sin respuesta de la API: No se pudo conectar con la API.");
    expect((error.cause as Error).message).toBe("fetch failed");
    expect(((error.cause as Error).cause as Error).message).toBe("ECONNREFUSED");

    const segunda = api.estados({ fuente: "api" });
    await avanzar(125);
    expect((await segunda).origen).toBe("api");
    expect(llamadas).toHaveLength(5);
  });

  it("en 429 espera lo que dice Retry-After en segundos o como fecha", async () => {
    relojFalso();
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    const { fetch, llamadas } = fetchFalso(
      json({}, 429, { "Retry-After": "2" }),
      json({}, 429, { "Retry-After": "Sun, 18 Oct 2026 12:00:05 GMT" }),
      respuestaDatos([]),
    );
    const consulta = conFetch(fetch).estados({ fuente: "api" });
    await avanzar(1999);
    expect(llamadas).toHaveLength(1);
    await avanzar(1);
    expect(llamadas).toHaveLength(2);
    // La fecha es 12:00:05 y ya son las 12:00:02: faltan 3 s.
    await avanzar(2999);
    expect(llamadas).toHaveLength(2);
    await avanzar(1);
    expect(llamadas).toHaveLength(3);
    await consulta;
  });

  it("por omisión no espera un Retry-After de 60 s: entrega el 429 de inmediato", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      problema(
        "demasiadas-peticiones",
        429,
        "Demasiadas peticiones",
        "Espera.",
        {},
        {
          "Retry-After": "60",
        },
      ),
    );
    const consulta = seguir(conFetch(fetch).estados({ fuente: "api" }));
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as MexicoApiError).status).toBe(429);
    expect(llamadas).toHaveLength(1);
  });

  it("la espera total no pasa de esperaMaximaMs y nunca reintenta antes del Retry-After", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      json({}, 429, { "Retry-After": "6" }),
      json({}, 429, { "Retry-After": "5" }),
    );
    // 6 s caben en los 10 s por omisión; después, 6 + 5 ya no.
    const consulta = seguir(conFetch(fetch).estados({ fuente: "api" }));
    await avanzar(5_999);
    expect(llamadas).toHaveLength(1);
    await avanzar(1);
    expect(llamadas).toHaveLength(2);
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as MexicoApiError).status).toBe(429);
  });

  it("las esperas exponenciales también cuentan, y con 0 no se reintenta", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(errorInterno(), errorInterno(), errorInterno());
    const consulta = seguir(conFetch(fetch, { esperaMaximaMs: 300 }).estados({ fuente: "api" }));
    await avanzar(125);
    expect(llamadas).toHaveLength(2);
    // 125 + 250 > 300: no hay tercer intento.
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as MexicoApiError).status).toBe(500);
    const caido = new TypeError("fetch failed");
    const red = fetchFalso(caido);
    const sinEspera = seguir(conFetch(red.fetch, { esperaMaximaMs: 0 }).estados({ fuente: "api" }));
    await avanzar(0);
    expect((sinEspera.error as MexicoApiError).status).toBe(0);
    expect(red.llamadas).toHaveLength(1);
  });

  it("con esperaMaximaMs mayor espera hasta 60 s; un Retry-After de más no se reintenta", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      json({}, 429, { "Retry-After": "60" }),
      problema(
        "demasiadas-peticiones",
        429,
        "Demasiadas peticiones",
        "Espera.",
        {},
        {
          "Retry-After": "61",
        },
      ),
    );
    const api = conFetch(fetch, { esperaMaximaMs: 600_000 });
    const consulta = seguir(api.estados({ fuente: "api" }));
    await avanzar(59_999);
    expect(llamadas).toHaveLength(1);
    await avanzar(1);
    expect(llamadas).toHaveLength(2);
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as MexicoApiError).status).toBe(429);
    expect((consulta.error as MexicoApiError).tipo).toBe("demasiadas-peticiones");
  });

  it("un 429 sin Retry-After válido y un 503 con él también se reintentan", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      json({}, 429, { "Retry-After": "pronto" }),
      json({}, 503, { "Retry-After": "1" }),
      respuestaDatos([]),
    );
    const consulta = conFetch(fetch).estados({ fuente: "api" });
    await avanzar(125);
    expect(llamadas).toHaveLength(2);
    await avanzar(999);
    expect(llamadas).toHaveLength(2);
    await avanzar(1);
    expect(llamadas).toHaveLength(3);
    await consulta;
  });
});

describe("tiempo de espera", () => {
  it("corta un intento colgado a los timeoutMs, aborta su fetch y no lo reintenta", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(() => colgada());
    const consulta = seguir(conFetch(fetch).estados({ fuente: "api" }));
    await avanzar(9_999);
    expect(consulta.listo).toBe(false);
    await avanzar(1);
    expect(consulta.listo).toBe(true);
    const error = consulta.error as MexicoApiError;
    expect(error.status).toBe(0);
    expect(error.detail).toBe("Se agotó el tiempo de espera (10000 ms).");
    expect(error.cause).toBeUndefined();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.init.signal.aborted).toBe(true);
  });

  it("también corta la lectura del cuerpo", async () => {
    relojFalso();
    const { fetch } = fetchFalso({
      status: 200,
      headers: new Headers(),
      text: () => colgada<string>(),
    });
    const consulta = seguir(conFetch(fetch, { timeoutMs: 50 }).estados({ fuente: "api" }));
    await avanzar(50);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as MexicoApiError).detail).toBe("Se agotó el tiempo de espera (50 ms).");
  });

  it("no deja temporizadores pendientes al terminar", async () => {
    relojFalso();
    const { fetch } = fetchFalso(respuestaDatos([]));
    await conFetch(fetch).estados({ fuente: "api" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cancelación", () => {
  it("con la señal ya abortada rechaza con su motivo sin pedir nada", async () => {
    const { fetch, llamadas } = fetchFalso();
    const control = new AbortController();
    control.abort(new Error("ya no"));
    await expect(
      conFetch(fetch).fixPublicado("2026-10-16", { signal: control.signal }),
    ).rejects.toThrow("ya no");
    await expect(
      crearCliente({ offline: true }).estados({ signal: control.signal }),
    ).rejects.toThrow("ya no");
    expect(llamadas).toHaveLength(0);
  });

  it("abortar durante la petición rechaza con el motivo, sin reintentos ni respaldo", async () => {
    const control = new AbortController();
    const { fetch, llamadas } = fetchFalso(({ init }) => {
      const promesa = colgada<Response>();
      queueMicrotask(() => control.abort(new Error("cancelada")));
      expect(init.signal.aborted).toBe(false);
      return promesa;
    });
    await expect(
      conFetch(fetch).fixPublicado("2026-10-16", { signal: control.signal }),
    ).rejects.toThrow("cancelada");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.init.signal.aborted).toBe(true);
  });

  it("abortar durante la espera entre reintentos rechaza sin otro intento", async () => {
    relojFalso();
    const control = new AbortController();
    const { fetch, llamadas } = fetchFalso(errorInterno(), respuestaDatos([]));
    const consulta = seguir(conFetch(fetch).estados({ fuente: "api", signal: control.signal }));
    await avanzar(50);
    control.abort(new Error("basta"));
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect((consulta.error as Error).message).toBe("basta");
    await avanzar(1_000);
    expect(llamadas).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("abortar justo antes de leer el cuerpo también corta la lectura", async () => {
    const control = new AbortController();
    const { fetch } = fetchFalso({
      status: 200,
      headers: new Headers(),
      text: () => {
        control.abort(new Error("antes del cuerpo"));
        return colgada<string>();
      },
    });
    await expect(
      conFetch(fetch).estados({ fuente: "api", signal: control.signal }),
    ).rejects.toThrow("antes del cuerpo");
  });
});

describe("caché", () => {
  it("sin caché, cada consulta va a la API", async () => {
    const { fetch, llamadas } = fetchFalso(respuestaDatos([]), respuestaDatos([]));
    const api = conFetch(fetch);
    await api.estados({ fuente: "api" });
    await api.estados({ fuente: "api" });
    expect(llamadas).toHaveLength(2);
  });

  it("guarda la respuesta por ttlMs, sin pasar del max-age de la API", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos([SINALOA], { "Cache-Control": "public, max-age=60" }),
      respuestaDatos([], { "Cache-Control": "public, max-age=3600" }),
      respuestaDatos([]),
    );
    const api = conFetch(fetch, { cache: { ttlMs: 120_000 } });
    const primera = await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(59_999);
    expect(await api.estados({ fuente: "api" })).toBe(primera);
    expect(llamadas).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const segunda = await api.estados({ fuente: "api" });
    expect(segunda.data).toEqual([]);
    expect(llamadas).toHaveLength(2);
    vi.advanceTimersByTime(119_999);
    await api.estados({ fuente: "api" });
    expect(llamadas).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await api.estados({ fuente: "api" });
    expect(llamadas).toHaveLength(3);
  });

  it("con cache: true usa 5 minutos y no guarda lo que dice no-store ni los errores", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos([]),
      json({ data: [] }, 200, { "Cache-Control": "no-store" }),
      json({ data: [] }, 200, { "Cache-Control": "no-store" }),
      problema("dato-no-disponible", 404, "Dato todavía no disponible", "Aún no."),
      problema("dato-no-disponible", 404, "Dato todavía no disponible", "Aún no."),
    );
    const api = conFetch(fetch, { cache: true });
    await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(299_999);
    await api.estados({ fuente: "api" });
    expect(llamadas).toHaveLength(1);
    await api.status();
    await api.status();
    expect(llamadas).toHaveLength(3);
    await rechazo(api.udi("2100-01-04", { fuente: "api" }));
    await rechazo(api.udi("2100-01-04", { fuente: "api" }));
    expect(llamadas).toHaveLength(5);
  });

  it("al caducar pregunta con If-None-Match y un 304 renueva lo guardado", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos([SINALOA], { ETag: '"abc"', "Cache-Control": "max-age=10" }),
      new Response(null, { status: 304, headers: { "Cache-Control": "max-age=10" } }),
      respuestaDatos([], { ETag: '"def"' }),
    );
    const api = conFetch(fetch, { cache: true });
    const primera = await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(10_000);
    expect(await api.estados({ fuente: "api" })).toBe(primera);
    expect(llamadas[1]?.init.headers).toEqual({
      Accept: "application/json",
      "If-None-Match": '"abc"',
    });
    vi.advanceTimersByTime(9_999);
    expect(await api.estados({ fuente: "api" })).toBe(primera);
    expect(llamadas).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect((await api.estados({ fuente: "api" })).data).toEqual([]);
    expect(llamadas[2]?.init.headers).toEqual({
      Accept: "application/json",
      "If-None-Match": '"abc"',
    });
  });

  it("un 304 sin nada guardado es una respuesta inesperada", async () => {
    const { fetch } = fetchFalso(new Response(null, { status: 304 }));
    const error = (await rechazo(conFetch(fetch).estados({ fuente: "api" }))) as MexicoApiError;
    expect(error.status).toBe(304);
    expect(error.type).toBe("about:blank");
  });

  it("guarda por URL y saca la menos usada al pasar de maxEntradas", async () => {
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos("01"),
      respuestaDatos("02"),
      respuestaDatos("03"),
      respuestaDatos("02"),
    );
    const api = conFetch(fetch, { cache: { maxEntradas: 2 } });
    await api.estado("01", { fuente: "api" });
    await api.estado("02", { fuente: "api" });
    await api.estado("01", { fuente: "api" });
    await api.estado("03", { fuente: "api" });
    await api.estado("01", { fuente: "api" });
    await api.estado("02", { fuente: "api" });
    expect(llamadas.map((l) => l.url.slice(-2))).toEqual(["01", "02", "03", "02"]);
  });

  it("una respuesta guardada no se puede alterar", async () => {
    const { fetch } = fetchFalso(respuestaDatos([{ ...SINALOA }]));
    const api = conFetch(fetch, { cache: true });
    const r = await api.estados({ fuente: "api" });
    expect(() => {
      (r.data[0] as { nombre: string }).nombre = "Otro";
    }).toThrow(TypeError);
    expect((await api.estados({ fuente: "api" })).data[0]?.nombre).toBe("Sinaloa");
  });
});

describe("respuesta guardada si la API falla (stale-if-error)", () => {
  const CONTROL = "public, max-age=60, stale-if-error=600";

  it("la respuesta guardada conserva sus advertencias después de la de su edad", async () => {
    relojFalso();
    const { fetch } = fetchFalso(
      json({ data: [], advertencias: ["de la API"], meta: META }, 200, {
        "Cache-Control": "max-age=60, stale-if-error=600",
      }),
      errorInterno(),
    );
    const api = conFetch(fetch, { cache: true, reintentos: 0 });
    await api.diasInhabiles({ autoridad: "sat", anio: 2026 });
    vi.advanceTimersByTime(61_000);
    const r = await api.diasInhabiles({ autoridad: "sat", anio: 2026 });
    expect(r.advertencias).toHaveLength(2);
    expect(r.advertencias[0]).toMatch(/^Respuesta guardada de la API/);
    expect(r.advertencias[1]).toBe("de la API");
  });

  it("al caducar, si la API no responde, usa la guardada dentro de stale-if-error", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos([SINALOA], { "Cache-Control": CONTROL, ETag: '"a"' }),
      errorInterno(),
    );
    const api = conFetch(fetch, { cache: true, reintentos: 0 });
    const primera = await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(90_000);
    const rancia = await api.estados({ fuente: "api" });
    expect(llamadas).toHaveLength(2);
    expect(rancia.origen).toBe("api");
    expect(rancia.data).toBe(primera.data);
    expect(rancia.meta).toBe(primera.meta);
    expect(rancia.advertencias).toEqual([
      "Respuesta guardada de la API, de hace 1 min y caducada hace 30 s, porque la API falló: 500 Error interno: Ocurrió un error interno.",
    ]);
    esperarCongelado(rancia, "respuesta");
    expect(primera.advertencias).toEqual([]);
  });

  it("prefiere la respuesta guardada de la API a los datos del paquete", async () => {
    relojFalso();
    const viejo = { fecha: "2026-10-20", valor: "1.000000" };
    const { fetch } = fetchFalso(
      respuestaDatos(viejo, { "Cache-Control": CONTROL }),
      new TypeError("fetch failed"),
    );
    const api = conFetch(fetch, { cache: true, reintentos: 0 });
    await api.udi("2026-10-20");
    vi.advanceTimersByTime(3 * 3_600_000);
    // Más de 600 s después de caducar ya no vale: sale del paquete.
    const r = await api.udi("2026-10-20");
    expect(r.origen).toBe("paquete");

    const otra = fetchFalso(
      respuestaDatos(viejo, { "Cache-Control": CONTROL }),
      new TypeError("fetch failed"),
    );
    const api2 = conFetch(otra.fetch, { cache: true, reintentos: 0 });
    await api2.udi("2026-10-20");
    vi.advanceTimersByTime(120_000);
    const guardada = await api2.udi("2026-10-20");
    expect(guardada.origen).toBe("api");
    expect(guardada.data).toEqual(viejo);
    expect(guardada.advertencias[0]).toMatch(
      /^Respuesta guardada de la API, de hace 2 min y caducada hace 1 min, porque la API falló: Sin respuesta de la API/,
    );
  });

  it("sin stale-if-error, con un problema definitivo o sin caché, no la usa", async () => {
    relojFalso();
    const sinDirectiva = fetchFalso(
      respuestaDatos([], { "Cache-Control": "public, max-age=60" }),
      errorInterno(),
    );
    const api = conFetch(sinDirectiva.fetch, { cache: true, reintentos: 0 });
    await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(61_000);
    expect(((await rechazo(api.estados({ fuente: "api" }))) as MexicoApiError).status).toBe(500);

    const definitivo = fetchFalso(
      respuestaDatos([], { "Cache-Control": CONTROL }),
      problema("no-encontrado", 404, "Recurso no encontrado", "Ya no existe."),
    );
    const api2 = conFetch(definitivo.fetch, { cache: true });
    await api2.estados({ fuente: "api" });
    vi.advanceTimersByTime(61_000);
    expect(((await rechazo(api2.estados({ fuente: "api" }))) as MexicoApiError).status).toBe(404);
  });

  it("la respuesta guardada sigue caducada: la siguiente consulta vuelve a la API", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      respuestaDatos([SINALOA], { "Cache-Control": CONTROL }),
      errorInterno(),
      respuestaDatos([], { "Cache-Control": CONTROL }),
    );
    const api = conFetch(fetch, { cache: true, reintentos: 0 });
    await api.estados({ fuente: "api" });
    vi.advanceTimersByTime(61_000);
    expect((await api.estados({ fuente: "api" })).advertencias).toHaveLength(1);
    const nueva = await api.estados({ fuente: "api" });
    expect(nueva.data).toEqual([]);
    expect(nueva.advertencias).toEqual([]);
    expect(llamadas).toHaveLength(3);
  });

  it("dice la edad en segundos, minutos, horas o días", async () => {
    relojFalso();
    // [tiempo desde que se guardó, max-age en segundos, texto esperado]
    const casos: [number, number, string][] = [
      [65_000, 60, "de hace 1 min y caducada hace 5 s"],
      [2 * 3_600_000, 3_600, "de hace 2 h y caducada hace 1 h"],
      [3 * 86_400_000, 86_400, "de hace 3 días y caducada hace 2 días"],
    ];
    for (const [ms, maxAge, texto] of casos) {
      const { fetch } = fetchFalso(
        respuestaDatos([], { "Cache-Control": `max-age=${maxAge}, stale-if-error=999999` }),
        errorInterno(),
      );
      const api = conFetch(fetch, { cache: { ttlMs: 10 * 86_400_000 }, reintentos: 0 });
      await api.estados({ fuente: "api" });
      vi.advanceTimersByTime(ms);
      expect((await api.estados({ fuente: "api" })).advertencias[0]).toContain(texto);
    }
  });
});

describe("de dónde sale cada respuesta", () => {
  it("los datos estables salen del paquete sin red", async () => {
    const { fetch, llamadas } = fetchFalso();
    for (const api of [conFetch(fetch), crearCliente({ fetch, offline: true })]) {
      expect((await api.estados()).origen).toBe("paquete");
      expect((await api.municipio("25006")).origen).toBe("paquete");
      expect((await api.banco("002")).origen).toBe("paquete");
      const clabe = await api.clabe(CLABE);
      expect(clabe.origen).toBe("paquete");
      expect(clabe.advertencias).toEqual([]);
      // Con el catálogo del paquete, como la API.
      expect(clabe.data.banco_revisado).toBe(true);
    }
    expect(llamadas).toHaveLength(0);
  });

  it("con fuente: api, los estables van a la API", async () => {
    const { fetch, llamadas } = fetchFalso(json({ data: { valido: true }, meta: META }));
    const r = await conFetch(fetch).clabe(CLABE, { fuente: "api" });
    expect(r.origen).toBe("api");
    expect(llamadas.map((l) => l.url)).toEqual([`${BASE}/v1/clabe/${CLABE}`]);
  });

  it("los que caducan van a la API", async () => {
    const { fetch, llamadas } = fetchFalso(respuestaDatos(FIX_API));
    const r = await conFetch(fetch).fixPublicado("2026-10-16");
    expect(r.data).toEqual(FIX_API);
    expect(r.origen).toBe("api");
    expect(llamadas).toHaveLength(1);
  });

  it("si la API no responde, los que caducan salen del paquete con advertencia", async () => {
    const casos: [string, () => Response | Error][] = [
      ["red", () => new TypeError("fetch failed")],
      ["5xx", () => errorInterno()],
      ["429 de más de 60 s", () => json({}, 429, { "Retry-After": "120" })],
      ["JSON inválido", () => new Response("<html>", { status: 200 })],
      ["404 sin problem+json", () => new Response("no", { status: 404 })],
    ];
    for (const [nombre, paso] of casos) {
      const { fetch } = fetchFalso(paso());
      const r = await conFetch(fetch, { reintentos: 0 }).udi("2026-10-20");
      expect(r.origen, nombre).toBe("paquete");
      expect(r.data, nombre).toEqual(udis.serie.find((u) => u.fecha === "2026-10-20"));
      expect(r.meta.dataset, nombre).toBe("udis");
      expect(r.advertencias[0], nombre).toMatch(
        /^Respuesta de los datos del paquete porque la API falló: /,
      );
      esperarCongelado(r, "respuesta");
    }
  });

  it("con la API limitando (429 de 60 s), los que caducan salen del paquete sin esperar", async () => {
    relojFalso();
    const { fetch, llamadas } = fetchFalso(
      problema(
        "demasiadas-peticiones",
        429,
        "Demasiadas peticiones",
        "Espera.",
        {},
        {
          "Retry-After": "60",
        },
      ),
    );
    const consulta = seguir(conFetch(fetch).udi("2026-10-20"));
    await avanzar(0);
    expect(consulta.listo).toBe(true);
    expect(consulta.error).toBeUndefined();
    expect(llamadas).toHaveLength(1);
    const r = await conFetch(fetchFalso(json({}, 429, { "Retry-After": "60" })).fetch).udi(
      "2026-10-20",
    );
    expect(r.origen).toBe("paquete");
    expect(r.advertencias[0]).toBe(
      "Respuesta de los datos del paquete porque la API falló: 429 Respuesta inesperada de la API: La API respondió 429 sin problem+json.",
    );
  });

  it("la advertencia de respaldo nombra el fallo sin la ruta pedida", async () => {
    const { fetch } = fetchFalso(errorInterno());
    const r = await conFetch(fetch, { reintentos: 0 }).fixParaOperacion("2026-10-16");
    expect(r.advertencias[0]).toBe(
      "Respuesta de los datos del paquete porque la API falló: 500 Error interno: Ocurrió un error interno.",
    );
  });

  it("un problema definitivo de la API no se cambia por el paquete", async () => {
    const { fetch } = fetchFalso(
      problema("dato-no-disponible", 404, "Dato todavía no disponible", "Aún no."),
    );
    const error = (await rechazo(conFetch(fetch).fixPublicado("2026-10-16"))) as MexicoApiError;
    expect(error.origen).toBe("api");
    expect(error.tipo).toBe("dato-no-disponible");
  });

  it("con fuente: api no hay respaldo", async () => {
    const { fetch } = fetchFalso(new TypeError("fetch failed"));
    const error = (await rechazo(
      conFetch(fetch, { reintentos: 0 }).udi("2026-10-20", { fuente: "api" }),
    )) as MexicoApiError;
    expect(error.status).toBe(0);
  });

  it("si el paquete tampoco tiene el dato, dice dato-no-disponible con la falla de la API", async () => {
    const { fetch } = fetchFalso(new TypeError("fetch failed"));
    const error = (await rechazo(
      conFetch(fetch, { reintentos: 0 }).fixPublicado("2100-01-04"),
    )) as MexicoApiError;
    expect(error.origen).toBe("paquete");
    expect(error.tipo).toBe("dato-no-disponible");
    expect(error.url).toBe(`${BASE}/v1/tipo-cambio/fix?publicado=2100-01-04`);
    expect(error.cause).toBeInstanceOf(MexicoApiError);
    expect((error.cause as MexicoApiError).status).toBe(0);
  });

  it("con fuente: paquete u offline: true nunca usa la red", async () => {
    const { fetch, llamadas } = fetchFalso();
    const r = await conFetch(fetch).fixPublicado("2026-10-16", { fuente: "paquete" });
    expect(r.origen).toBe("paquete");
    expect(r.advertencias.every((a) => a.startsWith("Los datos de tipo-cambio.fix"))).toBe(true);
    const offline = conFetch(fetch, { offline: true });
    expect((await offline.udi("2026-10-20", { fuente: "api" })).origen).toBe("paquete");
    expect((await offline.diasInhabiles({ anio: 2026 })).origen).toBe("paquete");
    expect(llamadas).toHaveLength(0);
  });

  it("/v1/status solo sale de la API", async () => {
    const { fetch } = fetchFalso(json({ data: [] }));
    expect((await conFetch(fetch).status()).origen).toBe("api");
    await expect(conFetch(fetch).status({ fuente: "paquete" })).rejects.toThrow(
      "El paquete no trae /v1/status: solo la API la responde.",
    );
  });

  it("status() sin red es un error de uso: TypeError", async () => {
    const { fetch, llamadas } = fetchFalso();
    const esperado = new TypeError("El paquete no trae /v1/status: solo la API la responde.");
    for (const consulta of [
      conFetch(fetch).status({ fuente: "paquete" }),
      crearCliente({ offline: true }).status(),
      crearCliente({ offline: true }).consultar("/v1/status"),
    ]) {
      const error = await rechazo(consulta);
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toEqual(esperado);
    }
    expect(llamadas).toHaveLength(0);
  });

  // Antes lanzaba TypeError sin base ni offline: true. Desde que la API pública está en
  // producción, su origen (URL_API) es la base por omisión.
  it("sin base, los datos que caducan se piden a la API pública (URL_API)", async () => {
    expect(URL_API).toBe("https://mexicoapi.dagel4k.workers.dev");
    for (const opciones of [{}, { offline: false }, { base: undefined }]) {
      const { fetch, llamadas } = fetchFalso(respuestaDatos(FIX_API));
      await crearCliente({ ...opciones, fetch }).fixUltimo();
      expect(llamadas.map((l) => l.url)).toEqual([`${URL_API}/v1/tipo-cambio/fix/ultimo`]);
    }
    // Los datos estables y la CLABE no salen del equipo aunque haya base.
    const { fetch, llamadas } = fetchFalso();
    const local = crearCliente({ fetch });
    expect((await local.banco("002")).origen).toBe("paquete");
    expect((await local.clabe(CLABE)).origen).toBe("paquete");
    expect(llamadas).toHaveLength(0);
    expect(Object.isFrozen(crearCliente({ offline: true, base: BASE }))).toBe(true);
  });

  it("una base explícita gana a URL_API y offline: true nunca usa la red", async () => {
    const conBase = fetchFalso(respuestaDatos(FIX_API));
    await crearCliente({ base: BASE, fetch: conBase.fetch }).fixUltimo();
    expect(conBase.llamadas.map((l) => l.url)).toEqual([`${BASE}/v1/tipo-cambio/fix/ultimo`]);
    const sinRed = fetchFalso();
    const r = await crearCliente({ offline: true, fetch: sinRed.fetch }).fixUltimo();
    expect(r.origen).toBe("paquete");
    expect(sinRed.llamadas).toHaveLength(0);
  });

  it("un MexicoApiError de calendario-incompleto no pasa por un error del núcleo", async () => {
    const { fetch } = fetchFalso(
      problema("calendario-incompleto", 422, "Calendario incompleto", "No cubre.", {
        autoridad: "cnbv",
        fecha: "2027-01-01",
        cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
      }),
    );
    const error = (await rechazo(
      conFetch(fetch).diasHabiles({ autoridad: "cnbv", desde: "2026-12-30", dias: 3 }),
    )) as MexicoApiError;
    expect(error.tipo).toBe("calendario-incompleto");
    // La cobertura del problema de la API va en problema, no en el error.
    expect(error.problema.cobertura).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    expect("cobertura" in error).toBe(false);
    expect(problemaDeError(error)).toBeNull();
  });

  it("valida los valores de la ruta antes de pedirlos a la API", async () => {
    const { fetch, llamadas } = fetchFalso();
    const error = (await rechazo(
      conFetch(fetch).clabe("00201007777777777", { fuente: "api" }),
    )) as MexicoApiError;
    expect(error.tipo).toBe("parametro-invalido");
    expect(error.origen).toBe("paquete");
    expect(error.url).toBe(`${BASE}/v1/clabe/{clabe}`);
    expect(error.problema.instance).toBe("/v1/clabe/{clabe}");
    expect(llamadas).toHaveLength(0);
  });

  it("un parámetro de ruta que falta es un TypeError", async () => {
    const api = crearCliente({ offline: true });
    await expect(api.consultar("/v1/estados/{cve_ent}", {} as never)).rejects.toThrow(
      new TypeError("Falta el parámetro cve_ent de /v1/estados/{cve_ent}."),
    );
  });
});

describe("advertencia de antigüedad", () => {
  const hasta = fix.cobertura.hasta;

  it("aparece cuando la serie del paquete llega a más de 7 días antes de hoy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const api = crearCliente({ offline: true });
    vi.setSystemTime(new Date(`${mover(hasta, 7)}T23:59:59Z`));
    expect((await api.fixUltimo()).advertencias).toEqual([]);
    vi.setSystemTime(new Date(`${mover(hasta, 8)}T00:00:00Z`));
    const r = await api.fixUltimo();
    expect(r.advertencias).toEqual([
      `Los datos de tipo-cambio.fix del paquete llegan hasta el ${hasta}, hace 8 días; la API puede tener datos más recientes.`,
    ]);
    expect(r.meta.as_of).toBe(fix.meta.as_of);
  });

  it("también en las UDIS y después de la advertencia de respaldo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${mover(udis.cobertura.hasta, 30)}T12:00:00Z`));
    const { fetch } = fetchFalso(new TypeError("fetch failed"));
    const r = await conFetch(fetch, { reintentos: 0 }).udi(udis.cobertura.hasta);
    expect(r.advertencias).toHaveLength(2);
    expect(r.advertencias[0]).toMatch(/^Respuesta de los datos del paquete/);
    expect(r.advertencias[1]).toBe(
      `Los datos de udis del paquete llegan hasta el ${udis.cobertura.hasta}, hace 30 días; la API puede tener datos más recientes.`,
    );
  });

  it("no aparece en los datos estables ni en los días de la LFT", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    const api = crearCliente({ offline: true });
    expect((await api.bancos()).advertencias).toEqual([]);
    // Solo el aviso fijo de la LFT (art. 715), no el de antigüedad.
    expect((await api.diasInhabiles({ anio: 2026 })).advertencias).toEqual([AVISO_LFT]);
  });
});

describe("opciones", () => {
  it.each([
    [{ base: "api.ejemplo.mx" }, TypeError, "base"],
    [{ base: "ftp://api.ejemplo.mx" }, TypeError, "base"],
    [{ base: "https://api.ejemplo.mx/?q=1" }, TypeError, "base"],
    [{ base: "https://api.ejemplo.mx/#a" }, TypeError, "base"],
    [{ timeoutMs: 0 }, RangeError, "timeoutMs"],
    [{ timeoutMs: Number.POSITIVE_INFINITY }, RangeError, "timeoutMs"],
    [{ timeoutMs: 2 ** 31 }, RangeError, "timeoutMs"],
    [{ timeoutMs: Number.NaN }, RangeError, "timeoutMs"],
    [{ reintentos: -1 }, RangeError, "reintentos"],
    [{ reintentos: 1.5 }, RangeError, "reintentos"],
    [{ reintentos: 11 }, RangeError, "reintentos"],
    [{ cache: { ttlMs: -1 } }, RangeError, "ttlMs"],
    [{ cache: { maxEntradas: 0 } }, RangeError, "maxEntradas"],
    [{ fetch: "fetch" }, TypeError, "fetch"],
    [{ esperaMaximaMs: -1 }, RangeError, "esperaMaximaMs"],
    [{ esperaMaximaMs: Number.NaN }, RangeError, "esperaMaximaMs"],
    [{ esperaMaximaMs: 2 ** 31 }, RangeError, "esperaMaximaMs"],
  ])("rechaza %o", (opciones, clase, texto) => {
    const conOffline = { offline: true, ...opciones } as never;
    expect(() => crearCliente(conOffline)).toThrow(clase);
    expect(() => crearCliente(conOffline)).toThrow(texto);
  });

  it("rechaza una fuente desconocida", async () => {
    await expect(
      crearCliente({ offline: true }).estados({ fuente: "cache" as never }),
    ).rejects.toThrow(new TypeError('fuente debe ser "api" o "paquete".'));
  });

  it("el cliente está congelado", () => {
    expect(Object.isFrozen(crearCliente({ offline: true }))).toBe(true);
  });

  it("sin fetch en el entorno, lo dice", async () => {
    vi.stubGlobal("fetch", undefined);
    try {
      await expect(crearCliente({ base: BASE }).estados({ fuente: "api" })).rejects.toThrow(
        new TypeError("No hay fetch en este entorno; pásalo en crearCliente({ fetch })."),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("tabla de rutas", () => {
  it("el paquete responde justo las rutas que no son solo de la API", async () => {
    const { RUTAS } = await import("../../src/cliente/cliente.js");
    const { PAQUETE } = await import("../../src/cliente/paquete.js");
    const conPaquete = Object.entries(RUTAS)
      .filter(([, modo]) => modo !== "api")
      .map(([ruta]) => ruta);
    expect(Object.keys(PAQUETE).sort()).toEqual(conPaquete.sort());
    expect(Object.entries(RUTAS).filter(([, modo]) => modo === "api")).toEqual([
      ["/v1/status", "api"],
    ]);
  });
});

describe("MexicoApiError", () => {
  it("se arma con un problema y su contexto", () => {
    const causa = new Error("antes");
    const error = new MexicoApiError(
      { type: "about:blank", title: "Sin respuesta de la API", status: 0, detail: "Nada." },
      { url: `${BASE}/v1/udis?fecha=2026-10-20`, origen: "api", cause: causa },
    );
    expect(error.message).toBe("Sin respuesta de la API: Nada.");
    expect(error.cause).toBe(causa);
    expect(error.tipo).toBeUndefined();
    expect(Object.isFrozen(error.problema)).toBe(true);
    expect("cause" in new MexicoApiError(error.problema, { url: "", origen: "api" })).toBe(false);
  });
});

describe("tipos", () => {
  // Antes pedían base u offline: true; ahora la base es opcional (por omisión, URL_API).
  it("las opciones son opcionales: base, offline y las comunes", () => {
    const crear = (): unknown => [
      crearCliente({ base: BASE }),
      crearCliente({ base: new URL(BASE), offline: false }),
      crearCliente({ offline: true }),
      crearCliente({ offline: true, base: BASE, timeoutMs: 1_000 }),
      crearCliente(),
      crearCliente({ timeoutMs: 1_000 }),
      crearCliente({ offline: false }),
      // @ts-expect-error base es un texto o una URL
      crearCliente({ base: 1 }),
    ];
    expectTypeOf(crear).toBeFunction();
  });

  it("cada método da el tipo de su ruta", () => {
    const api: Cliente = crearCliente({ offline: true });
    expectTypeOf(api.estado).returns.resolves.toEqualTypeOf<Respuesta<Estado>>();
    expectTypeOf(api.diasHabiles).returns.resolves.toEqualTypeOf<Respuesta<ResultadoDiasHabiles>>();
    expectTypeOf(api.fixPublicado).returns.resolves.toEqualTypeOf<Respuesta<TipoCambioFix>>();
    expectTypeOf(api.fixParaOperacion).returns.resolves.toEqualTypeOf<Respuesta<FixOperacion>>();
    expectTypeOf(api.udi).returns.resolves.toEqualTypeOf<Respuesta<Udi>>();
    expectTypeOf(api.status).returns.resolves.toEqualTypeOf<
      RespuestaSinMeta<readonly EstadoDataset[]>
    >();
    expectTypeOf(api.consultar<"/v1/estados">).returns.resolves.toEqualTypeOf<
      Respuesta<readonly Estado[]>
    >();
  });

  it("consultar pide los parámetros de cada ruta", () => {
    const api = crearCliente({ offline: true });
    const promesas: Promise<unknown>[] = [
      api.consultar("/v1/estados"),
      api.consultar("/v1/estados/{cve_ent}", { cve_ent: "25" }),
      api.consultar("/v1/tipo-cambio/fix", { publicado: "2026-10-16" }, { fuente: "paquete" }),
      // @ts-expect-error falta cve_ent
      api.consultar("/v1/estados/{cve_ent}"),
      // @ts-expect-error publicado y operacion no van juntos
      api.consultar("/v1/tipo-cambio/fix", { publicado: "2026-10-16", operacion: "2026-10-16" }),
      // @ts-expect-error ruta que no existe
      api.consultar("/v1/nada"),
    ];
    for (const p of promesas) p.catch(() => {});
  });

  it("acepta el fetch y el AbortSignal del entorno", () => {
    expectTypeOf(globalThis.fetch).toExtend<FetchCompatible>();
    expectTypeOf<{ signal: AbortSignal }>().toExtend<OpcionesConsulta>();
    expectTypeOf(MexicoApiError).instance.toHaveProperty("problema");
  });
});
