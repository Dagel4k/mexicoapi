import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClienteCloudflare,
  configuracionDespliegue,
  type EntornoCli,
  ErrorCloudflare,
  escribirEstados,
  leerJsonc,
  principal,
  resolverNamespace,
  siguienteEstado,
  subdominio,
  TITULO_KV,
} from "../../scripts/cloudflare.ts";

// Falso y de baja entropía a propósito: gitleaks marca los literales que parecen tokens.
const TOKEN = "falso".repeat(8);
const CUENTA = "0123456789abcdef0123456789abcdef";
const KV = "f00dbabe00000000000000000000cafe";
const BASE = "https://api.cloudflare.com/client/v4";
const AHORA = new Date("2026-10-18T12:00:00.000Z");
const RAIZ_API = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../../scripts/cloudflare.ts", import.meta.url));

interface Peticion {
  metodo: string;
  url: string;
  autorizacion: string | null;
  tipo: string | null;
  cuerpo: string | null;
  conSenal: boolean;
}

/** fetch falso: responde en orden con `respuestas` (un Error se lanza) y registra cada petición. */
function fetchFalso(...respuestas: Array<Response | Error>) {
  const peticiones: Peticion[] = [];
  const falso = async (
    entrada: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const encabezados = new Headers(init.headers);
    peticiones.push({
      metodo: init.method ?? "GET",
      url: String(entrada),
      autorizacion: encabezados.get("authorization"),
      tipo: encabezados.get("content-type"),
      cuerpo: typeof init.body === "string" ? init.body : null,
      conSenal: init.signal instanceof AbortSignal,
    });
    const siguiente = respuestas.shift();
    if (siguiente === undefined) throw new Error(`petición de más: ${String(entrada)}`);
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  };
  return { fetch: falso as typeof fetch, peticiones };
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });

const sobre = (result: unknown, result_info?: unknown) =>
  json({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(result_info === undefined ? {} : { result_info }),
  });

const fallo = (status: number, ...errors: Array<{ code: number; message: string }>) =>
  json({ success: false, errors, messages: [], result: null }, status);

const pagina = (page: number, total_pages: number, items: Array<{ id: string; title: string }>) =>
  sobre(items, { page, per_page: 100, count: items.length, total_count: 150, total_pages });

const cliente = (f: typeof fetch, extra: Partial<ClienteCloudflare> = {}): ClienteCloudflare => ({
  cuenta: CUENTA,
  token: TOKEN,
  fetch: f,
  ...extra,
});

/** Método y ruta debajo de la cuenta. */
const ruta = (p: Peticion) => `${p.metodo} ${p.url.replace(`${BASE}/accounts/${CUENTA}`, "")}`;

const LISTA_1 = "GET /storage/kv/namespaces?per_page=100&page=1";
const LISTA_2 = "GET /storage/kv/namespaces?per_page=100&page=2";
const valor = (clave: string) => `/storage/kv/namespaces/${KV}/values/${encodeURIComponent(clave)}`;

async function rechazo(promesa: Promise<unknown>): Promise<ErrorCloudflare> {
  const error = await promesa.then(
    () => {
      throw new Error("se esperaba un rechazo");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ErrorCloudflare);
  return error as ErrorCloudflare;
}

describe("resolverNamespace", () => {
  it("recorre las páginas y encuentra el título en la segunda", async () => {
    const otros = [{ id: "otro", title: "otro-namespace" }];
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 2, otros),
      pagina(2, 2, [{ id: "elegido", title: TITULO_KV }]),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("elegido");
    expect(peticiones.map(ruta)).toEqual([LISTA_1, LISTA_2]);
  });

  it("con la lista vacía crea el namespace con POST y devuelve su id", async () => {
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 0, []),
      sobre({ id: "nuevo", title: TITULO_KV, supports_url_encoding: true }),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("nuevo");
    expect(peticiones.map(ruta)).toEqual([LISTA_1, "POST /storage/kv/namespaces"]);
    expect(peticiones[1]?.tipo).toBe("application/json");
    expect(JSON.parse(peticiones[1]?.cuerpo ?? "")).toEqual({ title: TITULO_KV });
  });

  it("si el POST falla por título duplicado vuelve a listar y encuentra el de otra corrida", async () => {
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 1, []),
      fallo(400, {
        code: 10014,
        message: "create namespace: 'A namespace with this account ID and title already exists'",
      }),
      pagina(1, 1, [{ id: "de-la-otra-corrida", title: TITULO_KV }]),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("de-la-otra-corrida");
    expect(peticiones.map(ruta)).toEqual([LISTA_1, "POST /storage/kv/namespaces", LISTA_1]);
  });

  it("si el POST falla y al volver a listar no aparece, lanza el error del POST", async () => {
    const { fetch } = fetchFalso(
      pagina(1, 1, []),
      fallo(403, { code: 10000, message: "Authentication error" }),
      pagina(1, 1, []),
    );
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.estado).toBe(403);
    expect(error.errores).toEqual([{ code: 10000, message: "Authentication error" }]);
  });

  it("si el POST responde sin id, vuelve a listar antes de rendirse", async () => {
    const { fetch } = fetchFalso(pagina(1, 1, []), sobre({}), pagina(1, 1, []));
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.message).toMatch(/respuesta inesperada/);
  });

  it("usa el título que se le pasa", async () => {
    const { fetch } = fetchFalso(
      pagina(1, 1, [
        { id: "a", title: TITULO_KV },
        { id: "b", title: "pruebas" },
      ]),
    );
    expect(await resolverNamespace(cliente(fetch), "pruebas")).toBe("b");
  });

  it("sin result_info deja de paginar con una página incompleta", async () => {
    const { fetch, peticiones } = fetchFalso(
      sobre([{ id: "x", title: "otro" }]),
      sobre({ id: "nuevo", title: TITULO_KV }),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("nuevo");
    expect(peticiones.map(ruta)).toEqual([LISTA_1, "POST /storage/kv/namespaces"]);
  });

  it("sin result_info pide la siguiente página si la actual viene llena", async () => {
    const llena = Array.from({ length: 100 }, (_, i) => ({ id: `id${i}`, title: `ns${i}` }));
    const { fetch, peticiones } = fetchFalso(
      sobre(llena),
      sobre([{ id: "elegido", title: TITULO_KV }]),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("elegido");
    expect(peticiones.map(ruta)).toEqual([LISTA_1, LISTA_2]);
  });

  it("manda Authorization: Bearer <token> y un límite de tiempo en cada petición", async () => {
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 1, []),
      fallo(400, { code: 10014, message: "duplicado" }),
      pagina(1, 1, [{ id: "a", title: TITULO_KV }]),
    );
    await resolverNamespace(cliente(fetch));
    expect(peticiones).toHaveLength(3);
    for (const p of peticiones) {
      expect(p.autorizacion).toBe(`Bearer ${TOKEN}`);
      expect(p.conSenal).toBe(true);
      expect(p.url.startsWith(`${BASE}/accounts/${CUENTA}/`)).toBe(true);
    }
  });

  it("usa la base que se le pasa", async () => {
    const { fetch, peticiones } = fetchFalso(pagina(1, 1, [{ id: "a", title: TITULO_KV }]));
    await resolverNamespace(cliente(fetch, { base: "http://127.0.0.1:9/v4" }));
    expect(peticiones[0]?.url).toBe(
      `http://127.0.0.1:9/v4/accounts/${CUENTA}/storage/kv/namespaces?per_page=100&page=1`,
    );
  });
});

describe("errores de Cloudflare", () => {
  it("success: false da ErrorCloudflare con el estado, los códigos y sin el token", async () => {
    const { fetch } = fetchFalso(
      fallo(
        403,
        { code: 10000, message: "Authentication error" },
        { code: 9109, message: "Unauthorized to access requested resource" },
      ),
    );
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.estado).toBe(403);
    expect(error.errores).toEqual([
      { code: 10000, message: "Authentication error" },
      { code: 9109, message: "Unauthorized to access requested resource" },
    ]);
    expect(error.message).toContain("403");
    expect(error.message).toContain("10000");
    expect(error.message).toContain("Authentication error");
    expect(error.message).toContain("9109");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(CUENTA);
  });

  it("success: false con estado 200 también es error", async () => {
    const { fetch } = fetchFalso(
      json({ success: false, errors: [{ code: 7003, message: "No route" }], result: null }),
    );
    const error = await rechazo(subdominio(cliente(fetch)));
    expect(error.estado).toBe(200);
    expect(error.errores).toEqual([{ code: 7003, message: "No route" }]);
  });

  it("tapa el token y la cuenta si Cloudflare los repite en su mensaje", async () => {
    const { fetch } = fetchFalso(
      fallo(400, { code: 1, message: `token ${TOKEN} no sirve en ${CUENTA}` }),
    );
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(CUENTA);
    expect(error.errores[0]?.message).toBe("token *** no sirve en ***");
  });

  it("una respuesta que no es JSON (página de error) da ErrorCloudflare con el estado", async () => {
    const { fetch } = fetchFalso(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.estado).toBe(502);
    expect(error.errores).toEqual([]);
    expect(error.message).toMatch(/502/);
    expect(error.message).toMatch(/sin JSON/);
  });

  it("errores con forma rara se normalizan", async () => {
    const { fetch } = fetchFalso(json({ success: false, errors: [{ code: "x" }, "texto"] }, 500));
    const error = await rechazo(subdominio(cliente(fetch)));
    expect(error.errores).toEqual([{ code: 0, message: "" }]);
  });

  it("una falla de red da ErrorCloudflare con estado 0 y la causa, sin el token", async () => {
    const red = new TypeError("fetch failed", {
      cause: new Error(`getaddrinfo ENOTFOUND (Bearer ${TOKEN})`),
    });
    const { fetch } = fetchFalso(red);
    const error = await rechazo(subdominio(cliente(fetch)));
    expect(error.estado).toBe(0);
    expect(error.message).toContain("fetch failed");
    expect(error.message).toContain("ENOTFOUND");
    expect(error.message).not.toContain(TOKEN);
  });

  it("una falla de red que no es Error también se reporta", async () => {
    const falso = (async () => {
      throw "se cayó";
    }) as unknown as typeof fetch;
    const error = await rechazo(subdominio(cliente(falso)));
    expect(error.message).toContain("se cayó");
  });

  it("una lista sin arreglo en result es respuesta inesperada", async () => {
    const { fetch } = fetchFalso(sobre({ no: "es lista" }));
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.message).toMatch(/respuesta inesperada/);
  });
});

describe("subdominio", () => {
  it("lee el subdominio de workers.dev de la cuenta", async () => {
    const { fetch, peticiones } = fetchFalso(sobre({ subdomain: "dagel" }));
    expect(await subdominio(cliente(fetch))).toBe("dagel");
    expect(peticiones.map(ruta)).toEqual(["GET /workers/subdomain"]);
    expect(peticiones[0]?.autorizacion).toBe(`Bearer ${TOKEN}`);
  });

  it.each([{}, { subdomain: "" }, { subdomain: "a/b" }, null])(
    "rechaza un result sin subdominio válido: %j",
    async (result) => {
      const { fetch } = fetchFalso(sobre(result));
      const error = await rechazo(subdominio(cliente(fetch)));
      expect(error.message).toMatch(/respuesta inesperada/);
    },
  );
});

describe("leerJsonc", () => {
  it("quita comentarios de línea y de bloque fuera de las cadenas", () => {
    const texto = `{
  // comentario de línea completa
  "a": 1, // al final de la línea
  /* bloque
     de varias líneas */
  "b": /* en medio */ "x"
}`;
    expect(leerJsonc(texto)).toEqual({ a: 1, b: "x" });
  });

  it("respeta // y /* dentro de las cadenas, también con comillas escapadas", () => {
    const texto = `{"url": "https://example.com/*x*/", "q": "di \\"hola\\" // no", "b": "\\\\"}`;
    expect(leerJsonc(texto)).toEqual({
      url: "https://example.com/*x*/",
      q: 'di "hola" // no',
      b: "\\",
    });
  });

  it("acepta comas finales en objetos y arreglos, también antes de un comentario", () => {
    const texto = `{"a": [1, 2,], "b": {"c": true, // fin
}, }`;
    expect(leerJsonc(texto)).toEqual({ a: [1, 2], b: { c: true } });
  });

  it("no toca comas dentro de cadenas", () => {
    expect(leerJsonc(`{"a": ", }", "b": ",]"}`)).toEqual({ a: ", }", b: ",]" });
  });

  it("un comentario de bloque sin cerrar es error", () => {
    expect(() => leerJsonc(`{"a": 1 /* sin cerrar`)).toThrow(/sin cerrar/);
  });

  it("una cadena sin cerrar es error de JSON", () => {
    expect(() => leerJsonc(`{"a": "sin cerrar`)).toThrow(SyntaxError);
  });

  it("lee el wrangler.jsonc real", async () => {
    const real = leerJsonc(await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8"));
    expect(real).toMatchObject({
      name: "mexicoapi",
      main: "src/index.ts",
      assets: { directory: "./public", binding: "ASSETS" },
    });
  });
});

const BASE_WRANGLER = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "mexicoapi",
  main: "src/index.ts",
  compatibility_date: "2026-10-01",
  assets: { directory: "./public", binding: "ASSETS", run_worker_first: ["/v1", "/v1/*"] },
  observability: { enabled: false },
  send_metrics: false,
  workers_dev: true,
  preview_urls: false,
};

describe("configuracionDespliegue", () => {
  it("staging: Worker aparte con KV y límite propio", () => {
    expect(configuracionDespliegue(BASE_WRANGLER, "staging", KV)).toStrictEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "mexicoapi-staging",
      main: "src/index.ts",
      compatibility_date: "2026-10-01",
      assets: { directory: "./public", binding: "ASSETS", run_worker_first: ["/v1", "/v1/*"] },
      observability: { enabled: false },
      send_metrics: false,
      workers_dev: true,
      preview_urls: false,
      kv_namespaces: [{ binding: "ESTADO", id: KV }],
      ratelimits: [{ name: "LIMITE", namespace_id: "1002", simple: { limit: 600, period: 60 } }],
    });
  });

  it("producción: el Worker mexicoapi con KV y límite propio", () => {
    expect(configuracionDespliegue(BASE_WRANGLER, "produccion", KV)).toStrictEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "mexicoapi",
      main: "src/index.ts",
      compatibility_date: "2026-10-01",
      assets: { directory: "./public", binding: "ASSETS", run_worker_first: ["/v1", "/v1/*"] },
      observability: { enabled: false },
      send_metrics: false,
      workers_dev: true,
      preview_urls: false,
      kv_namespaces: [{ binding: "ESTADO", id: KV }],
      ratelimits: [{ name: "LIMITE", namespace_id: "1001", simple: { limit: 600, period: 60 } }],
    });
  });

  it("no modifica la base", () => {
    const base = structuredClone(BASE_WRANGLER);
    configuracionDespliegue(base, "staging", KV);
    expect(base).toStrictEqual(BASE_WRANGLER);
  });

  it("main y assets.directory del wrangler.jsonc real existen junto al archivo generado", async () => {
    const real = leerJsonc(await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8"));
    const config = configuracionDespliegue(real as Record<string, unknown>, "produccion", KV);
    await access(join(RAIZ_API, config.main as string));
    expect((config.assets as { directory: string }).directory).toBe("./public");
  });
});

const PREVIO = {
  last_attempt: "2026-10-17T06:00:00.000Z",
  last_success: "2026-10-16T06:00:00Z",
  last_result: "actualizado",
};

describe("siguienteEstado", () => {
  it.each(["sin_cambios", "actualizado"] as const)(
    "%s mueve last_attempt y last_success a ahora",
    (resultado) => {
      expect(siguienteEstado(PREVIO, resultado, AHORA)).toStrictEqual({
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-18T12:00:00.000Z",
        last_result: resultado,
      });
    },
  );

  it.each(["requiere_revision", "error"] as const)(
    "%s mueve last_attempt y conserva el last_success previo",
    (resultado) => {
      expect(siguienteEstado(PREVIO, resultado, AHORA)).toStrictEqual({
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-16T06:00:00Z",
        last_result: resultado,
      });
    },
  );

  it("sin previo, sin_cambios ya tiene last_success", () => {
    expect(siguienteEstado(undefined, "sin_cambios", AHORA).last_success).toBe(
      "2026-10-18T12:00:00.000Z",
    );
  });

  it.each([undefined, null])("sin previo (%s), un error deja last_success en null", (previo) => {
    expect(siguienteEstado(previo, "error", AHORA)).toStrictEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: null,
      last_result: "error",
    });
  });

  it.each([
    ["texto", "no es objeto"],
    ["arreglo", [PREVIO]],
    ["número", 7],
    ["last_success null", { ...PREVIO, last_success: null }],
    ["last_success numérico", { ...PREVIO, last_success: 1_760_000_000 }],
    ["last_success sin formato", { ...PREVIO, last_success: "ayer" }],
    ["sin Z", { ...PREVIO, last_success: "2026-10-16T06:00:00" }],
    ["con espacio", { ...PREVIO, last_success: "2026-10-16 06:00:00Z" }],
    ["sin segundos", { ...PREVIO, last_success: "2026-10-16T06:00Z" }],
    ["fecha imposible", { ...PREVIO, last_success: "2026-02-30T06:00:00Z" }],
    ["29 de febrero no bisiesto", { ...PREVIO, last_success: "2025-02-29T06:00:00Z" }],
    ["hora 24", { ...PREVIO, last_success: "2026-10-16T24:00:00Z" }],
    ["año 0000", { ...PREVIO, last_success: "0000-01-01T00:00:00Z" }],
  ])("previo malformado (%s): requiere_revision deja last_success en null", (_, previo) => {
    expect(siguienteEstado(previo, "requiere_revision", AHORA).last_success).toBeNull();
  });

  it("conserva un last_success válido aunque el resto del previo no tenga forma", () => {
    const previo = { last_success: "2024-02-29T23:59:59.123Z", last_result: "otro" };
    expect(siguienteEstado(previo, "error", AHORA)).toStrictEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: "2024-02-29T23:59:59.123Z",
      last_result: "error",
    });
  });
});

const ok = () => sobre(null);
const sinClave = () => fallo(404, { code: 10009, message: "get: 'key not found'" });
const guardado = (valor: unknown) =>
  new Response(typeof valor === "string" ? valor : JSON.stringify(valor), { status: 200 });

describe("escribirEstados", () => {
  it("código 0: cada resultado con su estado; un valor ausente cuenta como vacío", async () => {
    const resumen = {
      resultados: [
        { dataset: "inegi.estados", estado: "sin_cambios", registros: 32, escrito: false },
        { dataset: "bancos", estado: "actualizado", registros: 150, escrito: true },
      ],
      errores: [],
    };
    const { fetch, peticiones } = fetchFalso(sinClave(), ok(), guardado(PREVIO), ok());
    const escritos = await escribirEstados(cliente(fetch), KV, resumen, 0, AHORA);
    expect(escritos).toEqual(["inegi.estados", "bancos"]);
    expect(peticiones.map(ruta)).toEqual([
      `GET ${valor("estado:inegi.estados")}`,
      `PUT ${valor("estado:inegi.estados")}`,
      `GET ${valor("estado:bancos")}`,
      `PUT ${valor("estado:bancos")}`,
    ]);
    expect(peticiones[1]?.url).toContain("/values/estado%3Ainegi.estados");
    const puestos = peticiones.filter((p) => p.metodo === "PUT");
    for (const p of puestos) {
      expect(p.tipo).toBe("application/octet-stream");
      expect(p.autorizacion).toBe(`Bearer ${TOKEN}`);
    }
    expect(puestos.map((p) => JSON.parse(p.cuerpo ?? ""))).toEqual([
      {
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-18T12:00:00.000Z",
        last_result: "sin_cambios",
      },
      {
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-18T12:00:00.000Z",
        last_result: "actualizado",
      },
    ]);
  });

  it("código 3: requiere_revision conserva el último éxito", async () => {
    const resumen = {
      resultados: [{ dataset: "bancos", estado: "requiere_revision", motivos: ["baja masiva"] }],
      errores: [],
    };
    const { fetch, peticiones } = fetchFalso(guardado(PREVIO), ok());
    expect(await escribirEstados(cliente(fetch), KV, resumen, 3, AHORA)).toEqual(["bancos"]);
    expect(JSON.parse(peticiones[1]?.cuerpo ?? "")).toEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: "2026-10-16T06:00:00Z",
      last_result: "requiere_revision",
    });
  });

  it("código 1: los errores reciben error y los resultados su estado", async () => {
    const resumen = {
      resultados: [{ dataset: "inegi.estados", estado: "sin_cambios" }],
      errores: [
        { dataset: "bancos", mensaje: "HTTP 503" },
        { dataset: "inegi.municipios", mensaje: "tiempo agotado" },
      ],
    };
    const { fetch, peticiones } = fetchFalso(
      sinClave(),
      ok(),
      guardado("{no es json"),
      ok(),
      guardado(PREVIO),
      ok(),
    );
    const escritos = await escribirEstados(cliente(fetch), KV, resumen, 1, AHORA);
    expect(escritos).toEqual(["inegi.estados", "bancos", "inegi.municipios"]);
    const cuerpos = peticiones
      .filter((p) => p.metodo === "PUT")
      .map((p) => [p.url.slice(p.url.lastIndexOf("/") + 1), JSON.parse(p.cuerpo ?? "")]);
    expect(cuerpos).toEqual([
      [
        "estado%3Ainegi.estados",
        {
          last_attempt: "2026-10-18T12:00:00.000Z",
          last_success: "2026-10-18T12:00:00.000Z",
          last_result: "sin_cambios",
        },
      ],
      [
        "estado%3Abancos",
        { last_attempt: "2026-10-18T12:00:00.000Z", last_success: null, last_result: "error" },
      ],
      [
        "estado%3Ainegi.municipios",
        {
          last_attempt: "2026-10-18T12:00:00.000Z",
          last_success: "2026-10-16T06:00:00Z",
          last_result: "error",
        },
      ],
    ]);
  });

  it("un resumen sin datasets no hace peticiones", async () => {
    const { fetch, peticiones } = fetchFalso();
    expect(
      await escribirEstados(cliente(fetch), KV, { resultados: [], errores: [] }, 0, AHORA),
    ).toEqual([]);
    expect(peticiones).toEqual([]);
  });

  it.each([
    ["código fuera de 0, 1 y 3", { resultados: [], errores: [] }, 2, /código/],
    ["errores con código 0", { resultados: [], errores: [{ dataset: "bancos" }] }, 0, /errores/],
    ["errores con código 3", { resultados: [], errores: [{ dataset: "bancos" }] }, 3, /errores/],
    ["no es objeto", [], 0, /resumen/],
    ["sin errores[]", { resultados: [] }, 0, /resumen/],
    ["sin resultados[]", { errores: [] }, 0, /resumen/],
    [
      "estado desconocido",
      { resultados: [{ dataset: "bancos", estado: "raro" }], errores: [] },
      0,
      /resumen/,
    ],
    [
      "dataset con caracteres raros",
      { resultados: [{ dataset: "../x", estado: "sin_cambios" }], errores: [] },
      0,
      /resumen/,
    ],
    ["error sin dataset", { resultados: [], errores: [{ mensaje: "x" }] }, 1, /resumen/],
    ["resultado que no es objeto", { resultados: ["bancos"], errores: [] }, 0, /resumen/],
  ])("rechaza %s sin hacer peticiones", async (_, resumen, codigo, mensaje) => {
    const { fetch, peticiones } = fetchFalso();
    await expect(escribirEstados(cliente(fetch), KV, resumen, codigo, AHORA)).rejects.toThrow(
      mensaje,
    );
    expect(peticiones).toEqual([]);
  });

  it("una falla al leer el valor previo detiene la escritura", async () => {
    const resumen = { resultados: [{ dataset: "bancos", estado: "sin_cambios" }], errores: [] };
    const { fetch, peticiones } = fetchFalso(fallo(500, { code: 10001, message: "interno" }));
    const error = await rechazo(escribirEstados(cliente(fetch), KV, resumen, 0, AHORA));
    expect(error.estado).toBe(500);
    expect(error.message).toContain("estado:bancos");
    expect(peticiones.map((p) => p.metodo)).toEqual(["GET"]);
  });

  it("una falla al escribir es ErrorCloudflare", async () => {
    const resumen = { resultados: [{ dataset: "bancos", estado: "sin_cambios" }], errores: [] };
    const { fetch } = fetchFalso(
      sinClave(),
      fallo(403, { code: 10000, message: "Authentication error" }),
    );
    const error = await rechazo(escribirEstados(cliente(fetch), KV, resumen, 0, AHORA));
    expect(error.estado).toBe(403);
    expect(error.message).not.toContain(TOKEN);
  });
});

const VARIABLES = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: CUENTA };

describe("CLI", () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "mexicoapi-cloudflare-"));
    await writeFile(
      join(raiz, "wrangler.jsonc"),
      await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8"),
    );
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  function cli(variables: Record<string, string | undefined>, f?: typeof fetch) {
    const salida: string[] = [];
    const errores: string[] = [];
    const entorno: EntornoCli = {
      variables,
      raizApi: raiz,
      ahora: () => AHORA,
      escribir: (t) => void salida.push(t),
      escribirError: (t) => void errores.push(t),
      ...(f === undefined ? {} : { fetch: f }),
    };
    return { entorno, salida, errores, todo: () => [...salida, ...errores].join("") };
  }

  const configurar = (entorno = "staging", salida = join(raiz, "wrangler.staging.json")) => [
    "configurar",
    "--entorno",
    entorno,
    "--salida",
    salida,
  ];

  it.each([
    ["configurar", () => configurar()],
    ["estado", () => ["estado", "--resumen", join(raiz, "resumen.json"), "--codigo", "0"]],
  ])("%s sin variables sale con 2 y lo dice", async (_, argumentos) => {
    const { fetch, peticiones } = fetchFalso();
    const c = cli({}, fetch);
    expect(await principal(argumentos(), c.entorno)).toBe(2);
    expect(c.errores.join("")).toContain("CLOUDFLARE_API_TOKEN");
    expect(c.errores.join("")).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(peticiones).toEqual([]);
  });

  it("nombra solo la variable que falta; una vacía cuenta como ausente", async () => {
    const c = cli({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "  " });
    expect(await principal(configurar(), c.entorno)).toBe(2);
    expect(c.errores.join("")).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(c.errores.join("")).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  it.each(["tok en dos", "tok\u0000nulo", "tok\ninterno", "tokén"])(
    "un token con espacios o caracteres raros sale con 2 sin mostrarlo: %j",
    async (token) => {
      const { fetch, peticiones } = fetchFalso();
      const c = cli({ ...VARIABLES, CLOUDFLARE_API_TOKEN: token }, fetch);
      expect(await principal(configurar(), c.entorno)).toBe(2);
      expect(c.errores.join("")).toContain("CLOUDFLARE_API_TOKEN");
      expect(c.todo()).not.toContain(token);
      expect(peticiones).toEqual([]);
    },
  );

  it("recorta espacios y saltos de línea al borde del token", async () => {
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      sobre({ subdomain: "dagel" }),
    );
    const c = cli({ CLOUDFLARE_API_TOKEN: ` ${TOKEN}\n`, CLOUDFLARE_ACCOUNT_ID: CUENTA }, fetch);
    expect(await principal(configurar(), c.entorno)).toBe(0);
    expect(peticiones.map((p) => p.autorizacion)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it.each([
    ["staging", "https://mexicoapi-staging.dagel.workers.dev\n"],
    ["produccion", "https://mexicoapi.dagel.workers.dev\n"],
  ] as const)(
    "configurar %s escribe el JSON de wrangler e imprime la URL",
    async (entorno, url) => {
      const salida = join(raiz, `wrangler.${entorno}.json`);
      const { fetch, peticiones } = fetchFalso(
        pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
        sobre({ subdomain: "dagel" }),
      );
      const c = cli(VARIABLES, fetch);
      expect(await principal(configurar(entorno, salida), c.entorno)).toBe(0);
      expect(c.salida).toEqual([url]);
      expect(peticiones.map(ruta)).toEqual([LISTA_1, "GET /workers/subdomain"]);
      const base = leerJsonc(await readFile(join(raiz, "wrangler.jsonc"), "utf8"));
      expect(await readFile(salida, "utf8")).toBe(
        `${JSON.stringify(configuracionDespliegue(base as Record<string, unknown>, entorno, KV), null, 2)}\n`,
      );
      expect(c.todo()).not.toContain(TOKEN);
      expect(c.todo()).not.toContain(CUENTA);
    },
  );

  it("configurar con una falla de Cloudflare sale con 1, sin el token y sin escribir", async () => {
    const salida = join(raiz, "wrangler.staging.json");
    const { fetch } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      fallo(403, { code: 10000, message: `Authentication error for ${TOKEN}` }),
    );
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar("staging", salida), c.entorno)).toBe(1);
    expect(c.errores.join("")).toContain("10000");
    expect(c.todo()).not.toContain(TOKEN);
    expect(c.todo()).not.toContain(CUENTA);
    await expect(access(salida)).rejects.toThrow();
  });

  it("configurar sin wrangler.jsonc sale con 1", async () => {
    await rm(join(raiz, "wrangler.jsonc"));
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar(), c.entorno)).toBe(1);
    expect(c.errores.join("")).toContain("wrangler.jsonc");
    expect(peticiones).toEqual([]);
  });

  it("configurar con un wrangler.jsonc que no es objeto sale con 1", async () => {
    await writeFile(join(raiz, "wrangler.jsonc"), "[1, 2]");
    const c = cli(VARIABLES, fetchFalso().fetch);
    expect(await principal(configurar(), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/wrangler\.jsonc/);
  });

  it("configurar rechaza una salida fuera de la carpeta de wrangler.jsonc", async () => {
    const c = cli(VARIABLES, fetchFalso().fetch);
    const fuera = join(raiz, "otra", "wrangler.staging.json");
    expect(await principal(configurar("staging", fuera), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/misma carpeta/);
  });

  it("configurar rechaza un entorno desconocido", async () => {
    const c = cli(VARIABLES, fetchFalso().fetch);
    expect(await principal(configurar("pruebas"), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/--entorno/);
  });

  it("estado escribe cada dataset del resumen e imprime cuáles", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(
      rutaResumen,
      JSON.stringify({
        resultados: [{ dataset: "bancos", estado: "actualizado" }],
        errores: [{ dataset: "inegi.estados", mensaje: "HTTP 500" }],
      }),
    );
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      sinClave(),
      ok(),
      guardado(PREVIO),
      ok(),
    );
    const c = cli(VARIABLES, fetch);
    expect(await principal(["estado", "--resumen", rutaResumen, "--codigo", "1"], c.entorno)).toBe(
      0,
    );
    expect(c.salida).toEqual(["estado: bancos, inegi.estados\n"]);
    expect(peticiones.map(ruta)).toEqual([
      LISTA_1,
      `GET ${valor("estado:bancos")}`,
      `PUT ${valor("estado:bancos")}`,
      `GET ${valor("estado:inegi.estados")}`,
      `PUT ${valor("estado:inegi.estados")}`,
    ]);
    expect(JSON.parse(peticiones[4]?.cuerpo ?? "")).toEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: "2026-10-16T06:00:00Z",
      last_result: "error",
    });
  });

  it("estado con un resumen vacío lo dice", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(rutaResumen, JSON.stringify({ resultados: [], errores: [] }));
    const c = cli(VARIABLES, fetchFalso(pagina(1, 1, [{ id: KV, title: TITULO_KV }])).fetch);
    expect(await principal(["estado", "--resumen", rutaResumen, "--codigo", "0"], c.entorno)).toBe(
      0,
    );
    expect(c.salida).toEqual(["estado: el resumen no trae datasets\n"]);
  });

  it("estado valida el resumen antes de hablar con Cloudflare", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(rutaResumen, JSON.stringify({ resultados: [] }));
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(["estado", "--resumen", rutaResumen, "--codigo", "0"], c.entorno)).toBe(
      1,
    );
    expect(c.errores.join("")).toMatch(/resumen/);
    expect(peticiones).toEqual([]);
  });

  it.each([
    ["no existe", null],
    ["no es JSON", "{"],
  ])("estado con un resumen que %s sale con 1", async (_, contenido) => {
    const rutaResumen = join(raiz, "resumen.json");
    if (contenido !== null) await writeFile(rutaResumen, contenido);
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(["estado", "--resumen", rutaResumen, "--codigo", "0"], c.entorno)).toBe(
      1,
    );
    expect(c.errores.join("")).toContain("resumen.json");
    expect(peticiones).toEqual([]);
  });

  it.each([
    ["sin comando", []],
    ["comando desconocido", ["desplegar"]],
    ["opción desconocida", ["configurar", "--entorno", "staging", "--salida", "x", "--zona", "y"]],
    ["opción de otro comando", ["estado", "--resumen", "r.json", "--codigo", "0", "--salida", "x"]],
    ["argumento de más", ["estado", "extra", "--resumen", "r.json", "--codigo", "0"]],
    ["falta --salida", ["configurar", "--entorno", "staging"]],
    ["falta --codigo", ["estado", "--resumen", "r.json"]],
    ["código no entero", ["estado", "--resumen", "r.json", "--codigo", "uno"]],
    ["código negativo", ["estado", "--resumen", "r.json", "--codigo", "-1"]],
  ])("%s sale con 1 y muestra el uso", async (_, argumentos) => {
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(argumentos, c.entorno)).toBe(1);
    expect(c.errores.join("")).toContain("Uso:");
    expect(peticiones).toEqual([]);
  });

  it("ejecutado con node, sin variables sale con 2", { timeout: 30_000 }, () => {
    const env = { ...process.env };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const salida = join(RAIZ_API, "wrangler.staging.json");
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "configurar", "--entorno", "staging", "--salida", salida],
      { env, encoding: "utf8", timeout: 25_000 },
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("CLOUDFLARE_API_TOKEN");
  });
});
