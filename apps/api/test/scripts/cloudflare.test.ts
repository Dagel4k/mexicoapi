import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archivoEncabezados } from "../../../../packages/pipeline/src/sitio/paginas/encabezados.ts";
import {
  ASSETS_STAGING,
  type ClienteCloudflare,
  configuracionDespliegue,
  type EntornoCli,
  ErrorCloudflare,
  ErrorEstados,
  encabezadosSinIndexar,
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

/** Respuesta cuyo cuerpo se corta al leerlo. */
const cortada = (status: number) =>
  new Response(
    new ReadableStream({
      start(control) {
        control.error(new Error("conexión cortada"));
      },
    }),
    { status },
  );

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

  it("sin result_info y con una página llena falla claro en vez de adivinar", async () => {
    const llena = Array.from({ length: 100 }, (_, i) => ({ id: `id${i}`, title: `ns${i}` }));
    const { fetch, peticiones } = fetchFalso(sobre(llena));
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.message).toMatch(/result_info/);
    expect(peticiones.map(ruta)).toEqual([LISTA_1]);
  });

  it("recorre hasta 50 páginas", async () => {
    const paginas = Array.from({ length: 49 }, (_, i) => pagina(i + 1, 50, []));
    const { fetch, peticiones } = fetchFalso(
      ...paginas,
      pagina(50, 50, [{ id: "al-final", title: TITULO_KV }]),
    );
    expect(await resolverNamespace(cliente(fetch))).toBe("al-final");
    expect(peticiones).toHaveLength(50);
  });

  it("con más de 50 páginas falla claro sin recorrerlas", async () => {
    const { fetch, peticiones } = fetchFalso(pagina(1, 51, []));
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.message).toMatch(/51 páginas/);
    expect(peticiones).toHaveLength(1);
  });

  it("si al volver a listar tras un POST fallido también falla, conserva el error del POST", async () => {
    const { fetch } = fetchFalso(
      pagina(1, 1, []),
      fallo(403, { code: 10000, message: "Authentication error" }),
      fallo(500, { code: 10001, message: "interno" }),
    );
    const error = await rechazo(resolverNamespace(cliente(fetch)));
    expect(error.estado).toBe(403);
    expect(error.errores).toEqual([{ code: 10000, message: "Authentication error" }]);
    expect(error.message).toContain("403");
    expect(error.message).toContain("10000");
    expect(error.message).toContain("500");
    expect(error.message).toContain("10001");
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

  it("tapa la cuenta codificada cuando el transporte repite la URL", async () => {
    const cuenta = 'ab/cd"ef';
    const falso = (async (entrada: string | URL | Request) => {
      throw new TypeError(`Failed to parse URL from ${String(entrada)}`);
    }) as typeof fetch;
    const error = await rechazo(subdominio({ cuenta, token: TOKEN, fetch: falso }));
    expect(error.message).toContain("Failed to parse URL");
    expect(error.message).toContain("/accounts/***/workers/subdomain");
    expect(error.message).not.toContain(encodeURIComponent(cuenta));
    expect(error.message).not.toContain(cuenta);
  });

  it("con el fetch real, una URL que no se puede armar no muestra la cuenta codificada", async () => {
    const cuenta = "ab/cd";
    const error = await rechazo(
      subdominio({ cuenta, token: TOKEN, base: "http://base invalida/client/v4" }),
    );
    expect(error.estado).toBe(0);
    expect(error.message).not.toContain("ab%2Fcd");
    expect(error.message).not.toContain(cuenta);
    expect(error.message).not.toContain(TOKEN);
  });

  it("tapa también la forma codificada del token", async () => {
    const token = "falso/".repeat(4);
    const falso = (async () => {
      throw new Error(`eco ${encodeURIComponent(token)} y ${token}`);
    }) as unknown as typeof fetch;
    const error = await rechazo(subdominio({ cuenta: CUENTA, token, fetch: falso }));
    expect(error.message).toBe("no se pudo leer el subdominio de workers.dev: eco *** y ***");
  });

  it("un cuerpo que se corta al leerlo es error, no respuesta sin JSON", async () => {
    const { fetch } = fetchFalso(cortada(200));
    const error = await rechazo(subdominio(cliente(fetch)));
    expect(error.estado).toBe(200);
    expect(error.message).toMatch(/no se pudo leer la respuesta/);
    expect(error.message).toContain("conexión cortada");
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
      name: "mexicoapi-local",
      main: "src/index.ts",
      assets: { directory: "./public", binding: "ASSETS" },
    });
  });
});

const BASE_WRANGLER = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "mexicoapi-local",
  main: "src/index.ts",
  compatibility_date: "2026-10-01",
  assets: { directory: "./public", binding: "ASSETS", run_worker_first: ["/v1", "/v1/*"] },
  observability: { enabled: false },
  send_metrics: false,
  workers_dev: true,
  preview_urls: false,
};

describe("configuracionDespliegue", () => {
  // Staging no se indexa: X-Robots-Tag en el Worker (vars) y en los assets, que salen de una copia
  // de public/ con su propio _headers.
  it("staging: Worker aparte con KV y límite propio, sin indexar", () => {
    expect(configuracionDespliegue(BASE_WRANGLER, "staging", KV)).toStrictEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "mexicoapi-staging",
      main: "src/index.ts",
      compatibility_date: "2026-10-01",
      assets: {
        directory: "./public-staging",
        binding: "ASSETS",
        run_worker_first: ["/v1", "/v1/*"],
      },
      observability: { enabled: false },
      send_metrics: false,
      workers_dev: true,
      preview_urls: false,
      kv_namespaces: [{ binding: "ESTADO", id: KV }],
      ratelimits: [{ name: "LIMITE", namespace_id: "1002", simple: { limit: 600, period: 60 } }],
      vars: { X_ROBOTS_TAG: "noindex" },
    });
    expect(ASSETS_STAGING).toBe("./public-staging");
  });

  it("staging conserva las vars de la base y agrega X_ROBOTS_TAG", () => {
    const base = { ...BASE_WRANGLER, vars: { OTRA: "1" } };
    expect(configuracionDespliegue(base, "staging", KV).vars).toStrictEqual({
      OTRA: "1",
      X_ROBOTS_TAG: "noindex",
    });
  });

  it("staging sin assets.directory en la base es un error", () => {
    const { assets: _sin, ...base } = BASE_WRANGLER;
    expect(() => configuracionDespliegue(base, "staging", KV)).toThrow(/assets\.directory/);
    expect(() =>
      configuracionDespliegue({ ...base, assets: { binding: "ASSETS" } }, "staging", KV),
    ).toThrow(/assets\.directory/);
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

  // Producción se indexa: con el wrangler.jsonc real no lleva X_ROBOTS_TAG ni la copia de staging.
  it("producción, con el wrangler.jsonc real, no lleva X_ROBOTS_TAG", async () => {
    const real = leerJsonc(await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8")) as Record<
      string,
      unknown
    >;
    const config = configuracionDespliegue(real, "produccion", KV);
    expect(JSON.stringify(config)).not.toContain("X_ROBOTS_TAG");
    expect(JSON.stringify(config)).not.toContain("public-staging");
  });

  // Lo que no es un asset ni está en /v1 lo responden los assets con 404.html, sin el Worker:
  // cada entorno debe llevar el bloque `assets` completo de wrangler.jsonc.
  it.each([
    ["staging", "./public-staging"],
    ["produccion", "./public"],
  ] as const)(
    "%s conserva el bloque assets de wrangler.jsonc, con el 404 de los assets",
    async (entorno, directorio) => {
      const real = leerJsonc(await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8")) as Record<
        string,
        unknown
      >;
      const config = configuracionDespliegue(real, entorno, KV);
      expect(config.assets).toStrictEqual({
        directory: directorio,
        binding: "ASSETS",
        run_worker_first: ["/v1", "/v1/*"],
        not_found_handling: "404-page",
      });
      expect(config.assets).toStrictEqual({
        ...(real.assets as Record<string, unknown>),
        directory: directorio,
      });
    },
  );
});

describe("encabezadosSinIndexar", () => {
  it("agrega X-Robots-Tag: noindex a la regla /* y deja lo demás igual", () => {
    const texto = archivoEncabezados(["SHA256SUMS", "bancos.csv"]);
    const resultado = encabezadosSinIndexar(texto);
    expect(resultado).toBe(`/*\n  X-Robots-Tag: noindex\n${texto.slice("/*\n".length)}`);
    // Solo una vez, dentro de la regla /*.
    expect(resultado.split("X-Robots-Tag").length).toBe(2);
    const reglaTodas = resultado.slice(0, resultado.indexOf("\n\n"));
    expect(reglaTodas).toContain("  X-Robots-Tag: noindex\n");
    expect(reglaTodas).toContain("  Strict-Transport-Security: max-age=31536000");
  });

  it("un _headers que no empieza con la regla /* es un error", () => {
    for (const texto of ["", "/descargas/x\n  A: b\n", "/*/x\n  A: b\n", " /*\n"]) {
      expect(() => encabezadosSinIndexar(texto), JSON.stringify(texto)).toThrow(/regla \/\*/);
    }
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
      expect(siguienteEstado(PREVIO, resultado, true, AHORA)).toStrictEqual({
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-18T12:00:00.000Z",
        last_result: resultado,
      });
    },
  );

  it.each(["requiere_revision", "error"] as const)(
    "%s mueve last_attempt y conserva el last_success previo",
    (resultado) => {
      expect(siguienteEstado(PREVIO, resultado, true, AHORA)).toStrictEqual({
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-16T06:00:00Z",
        last_result: resultado,
      });
    },
  );

  it("actualizado sin publicar conserva el last_success previo", () => {
    expect(siguienteEstado(PREVIO, "actualizado", false, AHORA)).toStrictEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: "2026-10-16T06:00:00Z",
      last_result: "actualizado",
    });
  });

  it("actualizado sin publicar y sin previo deja last_success en null", () => {
    expect(siguienteEstado(undefined, "actualizado", false, AHORA).last_success).toBeNull();
  });

  it("sin_cambios mueve last_success aunque no se publique nada", () => {
    expect(siguienteEstado(PREVIO, "sin_cambios", false, AHORA).last_success).toBe(
      "2026-10-18T12:00:00.000Z",
    );
  });

  it("sin previo, sin_cambios ya tiene last_success", () => {
    expect(siguienteEstado(undefined, "sin_cambios", true, AHORA).last_success).toBe(
      "2026-10-18T12:00:00.000Z",
    );
  });

  it.each([undefined, null])("sin previo (%s), un error deja last_success en null", (previo) => {
    expect(siguienteEstado(previo, "error", true, AHORA)).toStrictEqual({
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
    expect(siguienteEstado(previo, "requiere_revision", true, AHORA).last_success).toBeNull();
  });

  it("conserva un last_success válido aunque el resto del previo no tenga forma", () => {
    const previo = { last_success: "2024-02-29T23:59:59.123Z", last_result: "otro" };
    expect(siguienteEstado(previo, "error", true, AHORA)).toStrictEqual({
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
    const escritos = await escribirEstados(cliente(fetch), KV, resumen, 0, true, AHORA);
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
    expect(await escribirEstados(cliente(fetch), KV, resumen, 3, true, AHORA)).toEqual(["bancos"]);
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
    const escritos = await escribirEstados(cliente(fetch), KV, resumen, 1, false, AHORA);
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

  it("sin publicar: actualizado conserva el último éxito y sin_cambios avanza", async () => {
    const resumen = {
      resultados: [
        { dataset: "bancos", estado: "actualizado" },
        { dataset: "inegi.estados", estado: "sin_cambios" },
      ],
      errores: [],
    };
    const { fetch, peticiones } = fetchFalso(guardado(PREVIO), ok(), guardado(PREVIO), ok());
    await escribirEstados(cliente(fetch), KV, resumen, 0, false, AHORA);
    const cuerpos = peticiones
      .filter((p) => p.metodo === "PUT")
      .map((p) => JSON.parse(p.cuerpo ?? ""));
    expect(cuerpos).toEqual([
      {
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-16T06:00:00Z",
        last_result: "actualizado",
      },
      {
        last_attempt: "2026-10-18T12:00:00.000Z",
        last_success: "2026-10-18T12:00:00.000Z",
        last_result: "sin_cambios",
      },
    ]);
  });

  it("código 1 con publicado se rechaza sin peticiones: con error no se publica nada", async () => {
    const resumen = {
      resultados: [{ dataset: "bancos", estado: "actualizado" }],
      errores: [{ dataset: "inegi.estados", mensaje: "HTTP 500" }],
    };
    const { fetch, peticiones } = fetchFalso();
    await expect(escribirEstados(cliente(fetch), KV, resumen, 1, true, AHORA)).rejects.toThrow(
      /código 1/,
    );
    expect(peticiones).toEqual([]);
  });

  it("descarta el cuerpo de un 404 en vez de dejarlo colgado", async () => {
    const ausente = sinClave();
    const { fetch } = fetchFalso(ausente, ok());
    const resumen = { resultados: [{ dataset: "bancos", estado: "sin_cambios" }], errores: [] };
    await escribirEstados(cliente(fetch), KV, resumen, 0, true, AHORA);
    expect(ausente.bodyUsed).toBe(true);
  });

  it("un 404 con el cuerpo roto sigue contando como ausente", async () => {
    const { fetch, peticiones } = fetchFalso(cortada(404), ok());
    const resumen = { resultados: [{ dataset: "bancos", estado: "sin_cambios" }], errores: [] };
    expect(await escribirEstados(cliente(fetch), KV, resumen, 0, true, AHORA)).toEqual(["bancos"]);
    expect(peticiones.map((p) => p.metodo)).toEqual(["GET", "PUT"]);
  });

  it("un resumen sin datasets no hace peticiones", async () => {
    const { fetch, peticiones } = fetchFalso();
    expect(
      await escribirEstados(cliente(fetch), KV, { resultados: [], errores: [] }, 0, true, AHORA),
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
    await expect(
      escribirEstados(cliente(fetch), KV, resumen, codigo, false, AHORA),
    ).rejects.toThrow(mensaje);
    expect(peticiones).toEqual([]);
  });

  /** Rechazo de escribirEstados: un ErrorEstados con lo escrito y lo que falló. */
  async function fallaEstados(promesa: Promise<unknown>): Promise<ErrorEstados> {
    const error = await promesa.then(
      () => {
        throw new Error("se esperaba un rechazo");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorEstados);
    return error as ErrorEstados;
  }

  const TRES = {
    resultados: [
      { dataset: "inegi.estados", estado: "sin_cambios" },
      { dataset: "inegi.municipios", estado: "sin_cambios" },
      { dataset: "bancos", estado: "actualizado" },
    ],
    errores: [],
  };

  it("una falla al leer el valor previo no escribe ese dataset y sigue con los demás", async () => {
    const { fetch, peticiones } = fetchFalso(
      sinClave(),
      ok(),
      fallo(500, { code: 10001, message: "interno" }),
      sinClave(),
      ok(),
    );
    const error = await fallaEstados(escribirEstados(cliente(fetch), KV, TRES, 0, true, AHORA));
    expect(error.escritos).toEqual(["inegi.estados", "bancos"]);
    expect(error.fallas.map((f) => f.dataset)).toEqual(["inegi.municipios"]);
    expect(error.fallas[0]?.mensaje).toContain("500");
    expect(error.message).toContain("inegi.estados, bancos");
    expect(error.message).toContain("inegi.municipios");
    expect(peticiones.map(ruta)).toEqual([
      `GET ${valor("estado:inegi.estados")}`,
      `PUT ${valor("estado:inegi.estados")}`,
      `GET ${valor("estado:inegi.municipios")}`,
      `GET ${valor("estado:bancos")}`,
      `PUT ${valor("estado:bancos")}`,
    ]);
  });

  it("un valor previo cuyo cuerpo se corta es falla, no vacío: no pisa last_success", async () => {
    const resumen = {
      resultados: [{ dataset: "bancos", estado: "requiere_revision" }],
      errores: [],
    };
    const { fetch, peticiones } = fetchFalso(cortada(200));
    const error = await fallaEstados(escribirEstados(cliente(fetch), KV, resumen, 3, true, AHORA));
    expect(error.escritos).toEqual([]);
    expect(error.fallas[0]?.mensaje).toMatch(/no se pudo leer la respuesta/);
    expect(error.message).toMatch(/escritos: ninguno/);
    expect(peticiones.map((p) => p.metodo)).toEqual(["GET"]);
  });

  it("una falla al escribir se reporta sin el token y sigue con los demás", async () => {
    const { fetch } = fetchFalso(
      sinClave(),
      fallo(403, { code: 10000, message: `Authentication error ${TOKEN}` }),
      sinClave(),
      ok(),
      sinClave(),
      new TypeError("fetch failed"),
    );
    const error = await fallaEstados(escribirEstados(cliente(fetch), KV, TRES, 0, true, AHORA));
    expect(error.escritos).toEqual(["inegi.municipios"]);
    expect(error.fallas.map((f) => f.dataset)).toEqual(["inegi.estados", "bancos"]);
    expect(error.fallas[0]?.mensaje).toContain("403");
    expect(error.fallas[1]?.mensaje).toContain("fetch failed");
    expect(error.message).not.toContain(TOKEN);
  });

  it("una falla que no es ErrorCloudflare también se junta", async () => {
    const resumen = { resultados: [{ dataset: "bancos", estado: "sin_cambios" }], errores: [] };
    // Una fecha inválida hace fallar toISOString después de leer el valor previo.
    const ahora = new Date(Number.NaN);
    const { fetch } = fetchFalso(sinClave());
    const error = await fallaEstados(escribirEstados(cliente(fetch), KV, resumen, 0, true, ahora));
    expect(error.fallas[0]?.dataset).toBe("bancos");
    expect(error.fallas[0]?.mensaje).toMatch(/Invalid time value/);
  });
});

const VARIABLES = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: CUENTA };

describe("CLI", () => {
  let raiz: string;

  /** Un `public/` mínimo, como el del build. */
  const HEADERS = archivoEncabezados(["SHA256SUMS"]);

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "mexicoapi-cloudflare-"));
    await writeFile(
      join(raiz, "wrangler.jsonc"),
      await readFile(join(RAIZ_API, "wrangler.jsonc"), "utf8"),
    );
    await mkdir(join(raiz, "public", "descargas"), { recursive: true });
    await writeFile(join(raiz, "public", "_headers"), HEADERS);
    await writeFile(join(raiz, "public", "index.html"), "<!doctype html>");
    await writeFile(join(raiz, "public", "descargas", "SHA256SUMS"), "abc  x.csv\n");
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
    [
      "estado",
      () => [
        "estado",
        "--resumen",
        join(raiz, "resumen.json"),
        "--codigo",
        "0",
        "--publicado",
        "si",
      ],
    ],
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

  it.each([
    ["con comillas", `"${CUENTA}"`],
    ["con barra", "ab/cd"],
    ["corta", CUENTA.slice(1)],
    ["larga", `${CUENTA}0`],
    ["en mayúsculas", CUENTA.toUpperCase()],
    ["con letras fuera de hex", `${CUENTA.slice(1)}g`],
  ])("una cuenta %s sale con 2 sin mostrarla ni codificarla", async (_, cuenta) => {
    const { fetch, peticiones } = fetchFalso();
    const c = cli({ ...VARIABLES, CLOUDFLARE_ACCOUNT_ID: cuenta }, fetch);
    expect(await principal(configurar(), c.entorno)).toBe(2);
    expect(c.errores.join("")).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(c.errores.join("")).toMatch(/32 caracteres hexadecimales/);
    expect(c.todo()).not.toContain(cuenta);
    expect(c.todo()).not.toContain(encodeURIComponent(cuenta));
    expect(peticiones).toEqual([]);
  });

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

  it("configurar staging copia public/ en public-staging/ con X-Robots-Tag en /*", async () => {
    // Lo que quedó de una corrida anterior no pasa a la nueva copia.
    await mkdir(join(raiz, "public-staging"), { recursive: true });
    await writeFile(join(raiz, "public-staging", "viejo.html"), "x");
    const { fetch } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      sobre({ subdomain: "dagel" }),
    );
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar(), c.entorno)).toBe(0);
    const copia = join(raiz, "public-staging");
    expect(await readFile(join(copia, "_headers"), "utf8")).toBe(encabezadosSinIndexar(HEADERS));
    expect(await readFile(join(copia, "index.html"), "utf8")).toBe("<!doctype html>");
    expect(await readFile(join(copia, "descargas", "SHA256SUMS"), "utf8")).toBe("abc  x.csv\n");
    await expect(access(join(copia, "viejo.html"))).rejects.toThrow();
    // El public/ de producción no cambia.
    expect(await readFile(join(raiz, "public", "_headers"), "utf8")).toBe(HEADERS);
    const config = JSON.parse(await readFile(join(raiz, "wrangler.staging.json"), "utf8"));
    expect(config.assets.directory).toBe("./public-staging");
    expect(config.vars).toEqual({ X_ROBOTS_TAG: "noindex" });
    expect(c.errores.join("")).toContain("public-staging");
  });

  it("configurar produccion no hace la copia ni toca public/", async () => {
    const salida = join(raiz, "wrangler.produccion.json");
    const { fetch } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      sobre({ subdomain: "dagel" }),
    );
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar("produccion", salida), c.entorno)).toBe(0);
    await expect(access(join(raiz, "public-staging"))).rejects.toThrow();
    expect(await readFile(join(raiz, "public", "_headers"), "utf8")).toBe(HEADERS);
    const texto = await readFile(salida, "utf8");
    expect(texto).not.toContain("X_ROBOTS_TAG");
    expect(texto).not.toContain("public-staging");
  });

  it("configurar staging sin el build (sin public/_headers) sale con 1, antes de pedir nada", async () => {
    await rm(join(raiz, "public"), { recursive: true });
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    const salida = join(raiz, "wrangler.staging.json");
    expect(await principal(configurar("staging", salida), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/_headers/);
    expect(c.errores.join("")).toMatch(/build/);
    expect(peticiones).toEqual([]);
    await expect(access(salida)).rejects.toThrow();
    await expect(access(join(raiz, "public-staging"))).rejects.toThrow();
  });

  it("configurar staging con un _headers sin la regla /* sale con 1 sin copiar", async () => {
    await writeFile(join(raiz, "public", "_headers"), "/descargas/x\n  A: b\n");
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar(), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/regla \/\*/);
    expect(peticiones).toEqual([]);
    await expect(access(join(raiz, "public-staging"))).rejects.toThrow();
  });

  // Borrar la copia antes de hacerla borraría los assets mismos.
  it.each(["./public-staging", "./public-staging/sub", "."])(
    "configurar staging con assets.directory %s sale con 1 sin borrar nada",
    async (directorio) => {
      const wrangler = JSON.parse(
        JSON.stringify(leerJsonc(await readFile(join(raiz, "wrangler.jsonc"), "utf8"))),
      );
      wrangler.assets.directory = directorio;
      await writeFile(join(raiz, "wrangler.jsonc"), JSON.stringify(wrangler));
      await mkdir(join(raiz, "public-staging", "sub"), { recursive: true });
      await writeFile(join(raiz, "public-staging", "sub", "_headers"), HEADERS);
      const { fetch, peticiones } = fetchFalso();
      const c = cli(VARIABLES, fetch);
      expect(await principal(configurar(), c.entorno)).toBe(1);
      expect(c.errores.join("")).toMatch(/public-staging/);
      expect(peticiones).toEqual([]);
      expect(await readFile(join(raiz, "public-staging", "sub", "_headers"), "utf8")).toBe(HEADERS);
      expect(await readFile(join(raiz, "public", "_headers"), "utf8")).toBe(HEADERS);
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

  it("configurar no deja que la salida pise wrangler.jsonc", async () => {
    const original = await readFile(join(raiz, "wrangler.jsonc"), "utf8");
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(await principal(configurar("staging", join(raiz, "wrangler.jsonc")), c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/no puede ser wrangler\.jsonc/);
    expect(await readFile(join(raiz, "wrangler.jsonc"), "utf8")).toBe(original);
    expect(peticiones).toEqual([]);
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
    expect(
      await principal(
        ["estado", "--resumen", rutaResumen, "--codigo", "1", "--publicado", "no"],
        c.entorno,
      ),
    ).toBe(0);
    expect(c.salida).toEqual(["estado: bancos, inegi.estados\n"]);
    expect(peticiones.map(ruta)).toEqual([
      LISTA_1,
      `GET ${valor("estado:bancos")}`,
      `PUT ${valor("estado:bancos")}`,
      `GET ${valor("estado:inegi.estados")}`,
      `PUT ${valor("estado:inegi.estados")}`,
    ]);
    expect(JSON.parse(peticiones[2]?.cuerpo ?? "")).toEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: null,
      last_result: "actualizado",
    });
    expect(JSON.parse(peticiones[4]?.cuerpo ?? "")).toEqual({
      last_attempt: "2026-10-18T12:00:00.000Z",
      last_success: "2026-10-16T06:00:00Z",
      last_result: "error",
    });
  });

  it("estado con --codigo 1 y --publicado si sale con 1 sin hablar con Cloudflare", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(
      rutaResumen,
      JSON.stringify({ resultados: [], errores: [{ dataset: "bancos", mensaje: "x" }] }),
    );
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    const argumentos = ["estado", "--resumen", rutaResumen, "--codigo", "1", "--publicado", "si"];
    expect(await principal(argumentos, c.entorno)).toBe(1);
    expect(c.errores.join("")).toMatch(/código 1/);
    expect(peticiones).toEqual([]);
  });

  it("estado con una escritura fallida intenta todas, sale con 1 y dice cuáles", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(
      rutaResumen,
      JSON.stringify({
        resultados: [
          { dataset: "bancos", estado: "actualizado" },
          { dataset: "inegi.estados", estado: "sin_cambios" },
        ],
        errores: [],
      }),
    );
    const { fetch, peticiones } = fetchFalso(
      pagina(1, 1, [{ id: KV, title: TITULO_KV }]),
      sinClave(),
      fallo(500, { code: 10001, message: "interno" }),
      sinClave(),
      ok(),
    );
    const c = cli(VARIABLES, fetch);
    expect(
      await principal(
        ["estado", "--resumen", rutaResumen, "--codigo", "0", "--publicado", "si"],
        c.entorno,
      ),
    ).toBe(1);
    expect(peticiones).toHaveLength(5);
    const errores = c.errores.join("");
    expect(errores).toContain("escritos: inegi.estados");
    expect(errores).toContain("fallaron: bancos");
    expect(c.todo()).not.toContain(TOKEN);
    expect(c.todo()).not.toContain(CUENTA);
  });

  it("estado con un resumen vacío lo dice", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(rutaResumen, JSON.stringify({ resultados: [], errores: [] }));
    const c = cli(VARIABLES, fetchFalso(pagina(1, 1, [{ id: KV, title: TITULO_KV }])).fetch);
    expect(
      await principal(
        ["estado", "--resumen", rutaResumen, "--codigo", "0", "--publicado", "si"],
        c.entorno,
      ),
    ).toBe(0);
    expect(c.salida).toEqual(["estado: el resumen no trae datasets\n"]);
  });

  it("estado valida el resumen antes de hablar con Cloudflare", async () => {
    const rutaResumen = join(raiz, "resumen.json");
    await writeFile(rutaResumen, JSON.stringify({ resultados: [] }));
    const { fetch, peticiones } = fetchFalso();
    const c = cli(VARIABLES, fetch);
    expect(
      await principal(
        ["estado", "--resumen", rutaResumen, "--codigo", "0", "--publicado", "si"],
        c.entorno,
      ),
    ).toBe(1);
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
    expect(
      await principal(
        ["estado", "--resumen", rutaResumen, "--codigo", "0", "--publicado", "si"],
        c.entorno,
      ),
    ).toBe(1);
    expect(c.errores.join("")).toContain("resumen.json");
    expect(peticiones).toEqual([]);
  });

  it.each([
    ["sin comando", []],
    ["comando desconocido", ["desplegar"]],
    ["opción desconocida", ["configurar", "--entorno", "staging", "--salida", "x", "--zona", "y"]],
    [
      "opción de otro comando",
      ["estado", "--resumen", "r.json", "--codigo", "0", "--publicado", "si", "--salida", "x"],
    ],
    [
      "argumento de más",
      ["estado", "extra", "--resumen", "r.json", "--codigo", "0", "--publicado", "si"],
    ],
    ["falta --salida", ["configurar", "--entorno", "staging"]],
    ["falta --codigo", ["estado", "--resumen", "r.json", "--publicado", "si"]],
    ["falta --publicado", ["estado", "--resumen", "r.json", "--codigo", "0"]],
    [
      "--publicado inválido",
      ["estado", "--resumen", "r.json", "--codigo", "0", "--publicado", "tal vez"],
    ],
    ["comando heredado de Object", ["constructor"]],
    ["otro comando heredado", ["toString", "--entorno", "staging"]],
    ["__proto__ como comando", ["__proto__"]],
    ["código no entero", ["estado", "--resumen", "r.json", "--codigo", "uno", "--publicado", "si"]],
    ["código negativo", ["estado", "--resumen", "r.json", "--codigo", "-1", "--publicado", "si"]],
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
