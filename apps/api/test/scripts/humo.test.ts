import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { principal, probarHumo } from "../../scripts/humo.ts";

const BASE = "https://api.ejemplo.mx";
const SCRIPT = fileURLToPath(new URL("../../scripts/humo.ts", import.meta.url));
const HSTS = "max-age=31536000";
const SEGURIDAD = {
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
  "strict-transport-security": HSTS,
  vary: "Accept-Encoding",
};
/** La regla `/*` de `_headers`, la única que alcanza al 404 de los assets. */
const DE_TODAS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "strict-transport-security": HSTS,
  vary: "Accept-Encoding",
};
const UDIS = "/v1/udis?fecha=2024-06-03";
const DIAS = "/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=1";
const DIAS_SAT = "/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-15&dias=10";
const UMA = "/v1/constantes/uma/2026";
const UMA_2015 = "/v1/constantes/uma/2015";
const PROBLEMAS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md";
/** La llave de `falso` para `/v1/estados` pedido por http. */
const HTTP = "http:/v1/estados";
/** El renglón de la comprobación por http en las fallas y los tiempos. */
const ETIQUETA_HTTP = "http:// /v1/estados";

interface Ruta {
  estado?: number;
  tipo?: string;
  cuerpo: unknown;
  /** Sin ningún encabezado de seguridad. */
  sinSeguridad?: boolean;
  /** En lugar de los del Worker; el 404 de los assets solo lleva los de `/*` (`DE_TODAS`). */
  encabezados?: Record<string, string>;
}

const ESTADOS = Array.from({ length: 32 }, (_, i) => ({ cve_ent: String(i + 1).padStart(2, "0") }));

function rutasBuenas(): Record<string, Ruta> {
  return {
    "/v1/estados": { cuerpo: { data: ESTADOS, meta: { as_of: "2026-10-01" } } },
    "/v1/municipios/25006": { cuerpo: { data: { cvegeo: "25006", nombre: "Culiacán" } } },
    "/v1/bancos/012": { cuerpo: { data: { codigo: "012" } } },
    "/v1/clabe/012180000000000015": { cuerpo: { data: { valido: true } } },
    [DIAS]: { cuerpo: { data: { resultado: "2026-11-17" } } },
    [DIAS_SAT]: { cuerpo: { data: { resultado: "2026-08-12" } } },
    "/v1/tipo-cambio/fix/ultimo": {
      cuerpo: { data: { fecha_publicacion: "2026-10-16", valor: "18.4250" } },
    },
    [UDIS]: { cuerpo: { data: { fecha: "2024-06-03", valor: "8.146030" } } },
    [UMA]: { cuerpo: { data: { anio: 2026, diaria: "117.31" } } },
    [UMA_2015]: {
      estado: 404,
      tipo: "application/problem+json; charset=utf-8",
      cuerpo: { type: `${PROBLEMAS}#no-encontrado`, status: 404 },
    },
    "/v1/estados/33": {
      estado: 404,
      tipo: "application/problem+json; charset=utf-8",
      cuerpo: { status: 404 },
    },
    "/v1/status": { cuerpo: { data: [{ dataset: "bancos", status: "ok" }] } },
    "/v1/openapi.json": { cuerpo: { openapi: "3.1.0" } },
    "/descargas/SHA256SUMS": { tipo: "text/plain; charset=utf-8", cuerpo: "abc  bancos.json\n" },
    "/": { tipo: "text/html; charset=utf-8", cuerpo: "<!doctype html><h1>MéxicoAPI</h1>" },
    "/llms.txt": { tipo: "text/plain; charset=utf-8", cuerpo: "# MéxicoAPI\n\n> Datos\n" },
    "/v2": {
      estado: 404,
      tipo: "text/html; charset=utf-8",
      cuerpo: "<h1>No existe esta página</h1>",
      encabezados: DE_TODAS,
    },
    // La misma API por http: el Worker responde 403 sin redirigir.
    [HTTP]: {
      estado: 403,
      tipo: "application/problem+json; charset=utf-8",
      cuerpo: { type: `${PROBLEMAS}#https-requerido`, status: 403 },
    },
  };
}

/** Cada petición que recibió un `falso`: la URL completa y su `redirect`. */
interface Pedida {
  url: string;
  redirect: RequestInit["redirect"];
}

/**
 * fetch falso que responde `rutas`. La llave es la ruta con su query, y `http:<ruta>` si se pidió
 * por http. `extra` se agrega a toda respuesta.
 */
function falso(
  rutas: Record<string, Ruta>,
  alterar?: (ruta: string) => Response | undefined,
  extra: Record<string, string> = {},
  pedidas: Pedida[] = [],
): typeof fetch {
  return (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    pedidas.push({ url: url.href, redirect: init?.redirect });
    const ruta = `${url.protocol === "http:" ? "http:" : ""}${url.pathname}${url.search}`;
    const propia = alterar?.(ruta);
    if (propia) return propia;
    const r = rutas[ruta];
    if (!r) return new Response("no", { status: 500 });
    const texto = typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo);
    return new Response(texto, {
      status: r.estado ?? 200,
      headers: {
        "content-type": r.tipo ?? "application/json; charset=utf-8",
        ...(r.sinSeguridad === true ? {} : (r.encabezados ?? SEGURIDAD)),
        ...extra,
      },
    });
  }) as typeof fetch;
}

describe("probarHumo", () => {
  it("todo bien: ok, sin fallas y un tiempo por ruta", async () => {
    const r = await probarHumo(`${BASE}/`, { fetch: falso(rutasBuenas()) });
    expect(r.fallas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.tiempos)).toHaveLength(18);
    expect(Object.keys(r.tiempos)).toContain(ETIQUETA_HTTP);
  });

  it("un 200 con HTML es una falla", async () => {
    const html = new Response("<html></html>", {
      headers: { "content-type": "text/html", ...SEGURIDAD },
    });
    const r = await probarHumo(BASE, {
      fetch: falso(rutasBuenas(), (ruta) => (ruta === "/v1/status" ? html : undefined)),
    });
    expect(r.ok).toBe(false);
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toMatch(/^\/v1\/status: tipo de contenido text\/html/);
  });

  it("un estado distinto es una falla", async () => {
    const rutas = rutasBuenas();
    rutas["/v1/bancos/012"] = { estado: 500, cuerpo: {} };
    const r = await probarHumo(BASE, { fetch: falso(rutas) });
    expect(r.fallas).toEqual(["/v1/bancos/012: estado 500, se esperaba 200"]);
  });

  it("un timeout es una falla y no frena las demás rutas", async () => {
    const bueno = falso(rutasBuenas());
    const colgado = ((entrada: string, init?: RequestInit) =>
      String(entrada).endsWith("/v1/status")
        ? new Promise((_, rechazar) =>
            init?.signal?.addEventListener("abort", () => rechazar(new Error("abortado"))),
          )
        : bueno(entrada, init)) as typeof fetch;
    const r = await probarHumo(BASE, { fetch: colgado, timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.fallas).toEqual(["/v1/status: sin respuesta en 20 ms"]);
    expect(r.tiempos["/v1/status"]).toBeGreaterThanOrEqual(15);
  });

  it("un cuerpo que no termina de llegar también vence", async () => {
    const bueno = falso(rutasBuenas());
    const atascado = (async (entrada: string, init?: RequestInit) => {
      if (!String(entrada).endsWith("/v1/status")) return bueno(entrada, init);
      return new Response(new ReadableStream({ start() {} }), {
        headers: { "content-type": "application/json", ...SEGURIDAD },
      });
    }) as typeof fetch;
    const r = await probarHumo(BASE, { fetch: atascado, timeoutMs: 50 });
    expect(r.fallas).toEqual(["/v1/status: sin respuesta en 50 ms"]);
  });

  it("un fetch que ignora la señal también vence", async () => {
    const mudo = (() => new Promise(() => {})) as typeof fetch;
    const r = await probarHumo(BASE, { fetch: mudo, timeoutMs: 5 });
    expect(r.fallas).toHaveLength(18);
  });

  it("un error de red es una falla con su mensaje", async () => {
    const roto = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
    const r = await probarHumo(BASE, { fetch: roto });
    expect(r.fallas[0]).toBe("/v1/estados: ECONNREFUSED");
  });

  it.each([
    ["access-control-allow-origin", "*"],
    ["x-content-type-options", "nosniff"],
  ])("falta %s en una respuesta: falla", async (nombre, valor) => {
    const sin = (ruta: string) => {
      if (ruta !== "/descargas/SHA256SUMS") return undefined;
      const h: Record<string, string> = { "content-type": "text/plain", ...SEGURIDAD };
      delete h[nombre as string];
      return new Response("abc\n", { headers: h });
    };
    const r = await probarHumo(BASE, { fetch: falso(rutasBuenas(), sin) });
    expect(r.fallas).toEqual([`/descargas/SHA256SUMS: ${nombre}: ausente, se esperaba ${valor}`]);
  });

  // Un fallo del humo de producción revierte el despliegue: un HSTS más largo, con otras
  // directivas o junto al que agregue el borde no debe hacerlo fallar.
  it.each(["/v1/estados", "/descargas/SHA256SUMS", "/", "/v2"])(
    "%s: HSTS con max-age de un año o más, aunque venga con otros valores",
    async (ruta) => {
      for (const [valor, bien] of [
        [HSTS, true],
        ["max-age=63072000; includeSubDomains; preload", true],
        ["MAX-AGE=31536000", true],
        ['max-age="31536000"', true],
        ["includeSubDomains; max-age=31536000", true],
        [" max-age = 31536000 ", true],
        ["max-age=15552000, max-age=31536000", true],
        ["max-age=31536000,max-age=15552000; includeSubDomains", true],
        [undefined, false],
        ["", false],
        ["max-age=0", false],
        ["max-age=31535999", false],
        ["max-age=15552000; includeSubDomains", false],
        ["includeSubDomains", false],
        ["max-age=", false],
        ["max-age=abc", false],
        ["max-age=31536000abc", false],
        ["max-ages=31536000", false],
      ] as const) {
        const rutas = rutasBuenas();
        const propia = rutas[ruta] as Ruta;
        const encabezados: Record<string, string> = { ...(propia.encabezados ?? SEGURIDAD) };
        if (valor === undefined) delete encabezados["strict-transport-security"];
        else encabezados["strict-transport-security"] = valor;
        rutas[ruta] = { ...propia, encabezados };
        const r = await probarHumo(BASE, { fetch: falso(rutas) });
        if (bien) {
          expect(r.fallas, valor).toEqual([]);
        } else {
          const actual = valor === undefined ? "ausente" : valor === "" ? "(vacío)" : valor;
          expect(r.fallas, valor).toEqual([
            `${ruta}: strict-transport-security: ${actual}, se esperaba max-age de 31536000 o más`,
          ]);
        }
      }
    },
  );

  // La plataforma puede agregar su propio Vary: basta con que nombre Accept-Encoding.
  it.each(["/v1/estados", "/descargas/SHA256SUMS", "/", "/v2"])(
    "%s: Vary debe nombrar Accept-Encoding",
    async (ruta) => {
      for (const [valor, bien] of [
        ["Accept-Encoding", true],
        ["accept-encoding", true],
        ["Origin, Accept-Encoding", true],
        ["Accept-Encoding,Cookie", true],
        [undefined, false],
        ["Accept", false],
        ["Accept-Encodings", false],
        ["Origin", false],
      ] as const) {
        const rutas = rutasBuenas();
        const propia = rutas[ruta] as Ruta;
        const encabezados: Record<string, string> = { ...(propia.encabezados ?? SEGURIDAD) };
        if (valor === undefined) delete encabezados.vary;
        else encabezados.vary = valor;
        rutas[ruta] = { ...propia, encabezados };
        const r = await probarHumo(BASE, { fetch: falso(rutas) });
        if (bien) expect(r.fallas, valor).toEqual([]);
        else
          expect(r.fallas, valor).toEqual([expect.stringMatching(new RegExp(`^${ruta}: vary: `))]);
      }
    },
  );

  it("valida el cuerpo de cada ruta", async () => {
    const malas: [string, unknown, string][] = [
      ["/v1/estados", { data: ESTADOS.slice(1), meta: { as_of: "2026-10-01" } }, "no trae 32"],
      ["/v1/estados", { data: ESTADOS, meta: { as_of: "ayer" } }, "meta.as_of"],
      ["/v1/estados", [], "no trae 32"],
      ["/v1/municipios/25006", { data: { cvegeo: "25006", nombre: "Otro" } }, "no es Culiacán"],
      ["/v1/bancos/012", { data: { codigo: "014" } }, "no es el banco"],
      ["/v1/clabe/012180000000000015", { data: { valido: false } }, "no es válida"],
      [DIAS, { data: { resultado: "2026-11-16" } }, "no 2026-11-17"],
      // Sin el primer periodo de vacaciones del SAT, el plazo vencería el 2026-07-29.
      [DIAS_SAT, { data: { resultado: "2026-07-29" } }, "no 2026-08-12"],
      [UMA, { data: { anio: 2025 } }, "no es la UMA de 2026"],
      [UMA, { data: { anio: 2026, diaria: 117.31 } }, "diaria"],
      ["/v1/tipo-cambio/fix/ultimo", { data: {} }, "fecha_publicacion no es una fecha"],
      [
        "/v1/tipo-cambio/fix/ultimo",
        { data: { fecha_publicacion: "2026-10-16", valor: "18.425" } },
        "4 decimales",
      ],
      [UDIS, { data: { fecha: "2024-06-04", valor: "8.146030" } }, "no 2024-06-03"],
      [UDIS, { data: { fecha: "2024-06-03", valor: "8.14603" } }, "6 decimales"],
      ["/v1/status", { data: {} }, "no es una lista"],
      ["/v1/status", { data: [] }, "no trae datasets"],
    ];
    for (const [ruta, cuerpo, texto] of malas) {
      const rutas = rutasBuenas();
      rutas[ruta] = { cuerpo };
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas, ruta).toHaveLength(1);
      expect(r.fallas[0], ruta).toContain(texto);
    }
  });

  it("la UMA de 2015 debe ser no-encontrado: la UMA empezó a publicarse en 2016", async () => {
    for (const [cuerpo, texto] of [
      [{ type: `${PROBLEMAS}#dato-no-disponible`, status: 404 }, "dato-no-disponible"],
      [{ status: 404 }, "undefined"],
    ] as const) {
      const rutas = rutasBuenas();
      rutas[UMA_2015] = { estado: 404, tipo: "application/problem+json", cuerpo };
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas).toEqual([`${UMA_2015}: type ${texto}, no no-encontrado`]);
    }
  });

  it("JSON roto, SHA256SUMS vacío y un 404 sin problem+json fallan", async () => {
    const rutas = rutasBuenas();
    rutas["/v1/openapi.json"] = { cuerpo: "{no es json" };
    rutas["/descargas/SHA256SUMS"] = { tipo: "text/plain", cuerpo: "  \n" };
    rutas["/v1/estados/33"] = { estado: 404, cuerpo: {} };
    const r = await probarHumo(BASE, { fetch: falso(rutas) });
    expect(r.fallas.map((f) => f.split(": ")[0])).toEqual([
      "/v1/estados/33",
      "/v1/openapi.json",
      "/descargas/SHA256SUMS",
    ]);
  });
});

describe("el sitio de los assets", () => {
  it("/ debe ser la página de inicio en HTML, con nosniff", async () => {
    const casos: [Ruta, string][] = [
      [{ tipo: "text/html", cuerpo: "<h1>Otra</h1>" }, "/: no es la página de inicio"],
      [{ cuerpo: { nombre: "MéxicoAPI" } }, "/: tipo de contenido application/json"],
      [{ estado: 404, tipo: "text/html", cuerpo: "<h1>MéxicoAPI</h1>" }, "/: estado 404"],
      [
        { tipo: "text/html", cuerpo: "<h1>MéxicoAPI</h1>", sinSeguridad: true },
        "/: x-content-type-options: ausente",
      ],
    ];
    for (const [ruta, falla] of casos) {
      const rutas = rutasBuenas();
      rutas["/"] = ruta;
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas, falla).toHaveLength(1);
      expect(r.fallas[0]).toContain(falla);
    }
  });

  it("/llms.txt debe ser texto con CORS que empieza con el título", async () => {
    const casos: [Ruta, string][] = [
      [{ tipo: "text/plain", cuerpo: "<html>" }, "/llms.txt: no empieza con # MéxicoAPI"],
      [{ tipo: "text/html", cuerpo: "# MéxicoAPI" }, "/llms.txt: tipo de contenido text/html"],
      [
        { tipo: "text/plain", cuerpo: "# MéxicoAPI", sinSeguridad: true },
        "/llms.txt: access-control-allow-origin: ausente",
      ],
    ];
    for (const [ruta, falla] of casos) {
      const rutas = rutasBuenas();
      rutas["/llms.txt"] = ruta;
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas).toEqual([expect.stringContaining(falla)]);
    }
  });

  // Fuera de /v1, lo que no existe lo responde 404.html de los assets: si llega al Worker, el
  // despliegue perdió `not_found_handling`.
  it("/v2 debe ser el 404 de los assets y no el del Worker", async () => {
    const casos: [Ruta, string][] = [
      [
        {
          estado: 404,
          tipo: "application/problem+json; charset=utf-8",
          cuerpo: { status: 404 },
        },
        "/v2: tipo de contenido application/problem+json, se esperaba text/html",
      ],
      [{ estado: 200, tipo: "text/html", cuerpo: "<h1>MéxicoAPI</h1>" }, "/v2: estado 200"],
      [
        { estado: 404, tipo: "text/html", cuerpo: "<h1>Otra</h1>", encabezados: DE_TODAS },
        "/v2: no es 404.html",
      ],
    ];
    for (const [ruta, falla] of casos) {
      const rutas = rutasBuenas();
      rutas["/v2"] = ruta;
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas).toEqual([expect.stringContaining(falla)]);
    }
    // Al 404 de los assets no se le exige CORS, pero sí lo de /* en _headers.
    const r = await probarHumo(BASE, { fetch: falso(rutasBuenas()) });
    expect(r.fallas).toEqual([]);
    const rutas = rutasBuenas();
    rutas["/v2"] = { ...(rutas["/v2"] as Ruta), encabezados: SEGURIDAD };
    const sinRegla = await probarHumo(BASE, { fetch: falso(rutas) });
    expect(sinRegla.fallas).toEqual(["/v2: x-frame-options: ausente, se esperaba DENY"]);
  });
});

describe("la API por http", () => {
  it("con una base https pide /v1/estados por http, sin seguir redirecciones", async () => {
    const pedidas: Pedida[] = [];
    const r = await probarHumo(BASE, { fetch: falso(rutasBuenas(), undefined, {}, pedidas) });
    expect(r.fallas).toEqual([]);
    expect(pedidas.filter((p) => p.url.startsWith("http:"))).toEqual([
      { url: "http://api.ejemplo.mx/v1/estados", redirect: "manual" },
    ]);
  });

  // Las pruebas de integración corren el humo contra el Worker local por http, que no da 403.
  it("con una base http no la pide", async () => {
    const pedidas: Pedida[] = [];
    const local = "http://127.0.0.1:8787";
    const reenviar = falso(rutasBuenas(), undefined, {}, pedidas);
    const r = await probarHumo(local, {
      fetch: ((entrada: string, init?: RequestInit) =>
        reenviar(String(entrada).replace(local, BASE), init)) as typeof fetch,
    });
    expect(r.fallas).toEqual([]);
    expect(Object.keys(r.tiempos)).toHaveLength(17);
    expect(Object.keys(r.tiempos)).not.toContain(ETIQUETA_HTTP);
    expect(pedidas.filter((p) => p.url.startsWith("http:"))).toEqual([]);
  });

  // Si la plataforma empezara a redirigir http a https antes del Worker, la API sigue protegida:
  // no es motivo para revertir el despliegue.
  it.each([301, 302, 307, 308])(
    "acepta una redirección %i de la plataforma a la misma URL con https",
    async (estado) => {
      const rutas = rutasBuenas();
      rutas[HTTP] = {
        estado,
        tipo: "text/html",
        cuerpo: "",
        encabezados: { location: `${BASE}/v1/estados` },
      };
      const r = await probarHumo(BASE, { fetch: falso(rutas), robots: "noindex" });
      expect(r.fallas.filter((f) => f.startsWith(ETIQUETA_HTTP))).toEqual([]);
    },
  );

  it("una redirección a otro lugar, o un 200 por http, falla", async () => {
    const redireccion = (estado: number, location?: string): Ruta => ({
      estado,
      tipo: "text/html",
      cuerpo: "",
      encabezados: location === undefined ? {} : { location },
    });
    const ESPERADO = "se esperaba 403 o una redirección a https://";
    const casos: [Ruta, string][] = [
      [{ cuerpo: { data: ESTADOS, meta: { as_of: "2026-10-01" } } }, `estado 200, ${ESPERADO}`],
      [
        redireccion(301, "https://otro.example/v1/estados"),
        `redirige a https://otro.example/v1/estados, se esperaba ${BASE}/v1/estados`,
      ],
      [redireccion(308, `${BASE}/`), `redirige a ${BASE}/, se esperaba ${BASE}/v1/estados`],
      [
        redireccion(302, "http://api.ejemplo.mx/v1/estados"),
        `redirige a http://api.ejemplo.mx/v1/estados, se esperaba ${BASE}/v1/estados`,
      ],
      [redireccion(307, "/v1/estados"), `redirige a /v1/estados, se esperaba ${BASE}/v1/estados`],
      [redireccion(301), "redirección 301 sin location"],
      [redireccion(303, `${BASE}/v1/estados`), `estado 303, ${ESPERADO}`],
    ];
    for (const [ruta, falla] of casos) {
      const rutas = rutasBuenas();
      rutas[HTTP] = ruta;
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas, falla).toEqual([`${ETIQUETA_HTTP}: ${falla}`]);
    }
  });

  it("el 403 debe ser https-requerido en problem+json, sin Location", async () => {
    const casos: [Ruta, string][] = [
      [
        { estado: 403, tipo: "text/html", cuerpo: "<h1>Forbidden</h1>" },
        "tipo de contenido text/html, se esperaba application/problem+json",
      ],
      [
        {
          estado: 403,
          tipo: "application/problem+json",
          cuerpo: { type: `${PROBLEMAS}#metodo-no-permitido`, status: 403 },
        },
        "type metodo-no-permitido, no https-requerido",
      ],
      [
        {
          estado: 403,
          tipo: "application/problem+json",
          cuerpo: { type: `${PROBLEMAS}#https-requerido`, status: 403 },
          encabezados: { ...SEGURIDAD, location: `${BASE}/v1/estados` },
        },
        `location: ${BASE}/v1/estados, se esperaba ausente`,
      ],
    ];
    for (const [ruta, falla] of casos) {
      const rutas = rutasBuenas();
      rutas[HTTP] = ruta;
      const r = await probarHumo(BASE, { fetch: falso(rutas) });
      expect(r.fallas, falla).toEqual([`${ETIQUETA_HTTP}: ${falla}`]);
    }
  });
});

describe("X-Robots-Tag", () => {
  const NOINDEX = { "x-robots-tag": "noindex" };

  it("sin la opción no se revisa", async () => {
    for (const extra of [{}, NOINDEX]) {
      const r = await probarHumo(BASE, { fetch: falso(rutasBuenas(), undefined, extra) });
      expect(r.fallas).toEqual([]);
    }
  });

  it("noindex (staging): toda respuesta lo trae", async () => {
    const r = await probarHumo(BASE, {
      fetch: falso(rutasBuenas(), undefined, NOINDEX),
      robots: "noindex",
    });
    expect(r.fallas).toEqual([]);
    for (const ruta of ["/v1/estados", "/", "/llms.txt", "/v2", "/descargas/SHA256SUMS"]) {
      const rutas = rutasBuenas();
      const sin = (pedida: string) => {
        if (pedida !== ruta) return undefined;
        const propia = rutas[ruta] as Ruta;
        const texto =
          typeof propia.cuerpo === "string" ? propia.cuerpo : JSON.stringify(propia.cuerpo);
        return new Response(texto, {
          status: propia.estado ?? 200,
          headers: {
            "content-type": propia.tipo ?? "application/json",
            ...(propia.encabezados ?? SEGURIDAD),
          },
        });
      };
      const conFalla = await probarHumo(BASE, {
        fetch: falso(rutas, sin, NOINDEX),
        robots: "noindex",
      });
      expect(conFalla.fallas).toEqual([`${ruta}: x-robots-tag: ausente, se esperaba noindex`]);
    }
  });

  it("ninguno (producción): / y /v1 no lo traen", async () => {
    const r = await probarHumo(BASE, { fetch: falso(rutasBuenas()), robots: "ninguno" });
    expect(r.fallas).toEqual([]);
    for (const ruta of ["/", "/v1/estados", "/v1/status"]) {
      const con = (pedida: string) => {
        if (pedida !== ruta) return undefined;
        const propia = rutasBuenas()[ruta] as Ruta;
        const texto =
          typeof propia.cuerpo === "string" ? propia.cuerpo : JSON.stringify(propia.cuerpo);
        return new Response(texto, {
          headers: { "content-type": propia.tipo ?? "application/json", ...SEGURIDAD, ...NOINDEX },
        });
      };
      const conFalla = await probarHumo(BASE, {
        fetch: falso(rutasBuenas(), con),
        robots: "ninguno",
      });
      expect(conFalla.fallas).toEqual([`${ruta}: x-robots-tag: noindex, se esperaba ausente`]);
    }
  });
});

describe("despliegue.yml", () => {
  const flujo = readFileSync(
    fileURLToPath(new URL("../../../../.github/workflows/despliegue.yml", import.meta.url)),
    "utf8",
  );

  it("corre el humo de staging con --robots noindex y el de producción con --robots ninguno", () => {
    // La variable de la URL y lo que sigue hasta la redirección de la salida.
    const llamadas = [
      ...flujo.matchAll(/node apps\/api\/scripts\/humo\.ts "\$\{(\w+)\}"([^>\n]*)/g),
    ].map(([, variable, resto]) => [variable, resto?.trim()]);
    expect(llamadas).toEqual([
      ["URL_STAGING", "--robots noindex"],
      ["URL_PROD", "--robots ninguno"],
    ]);
  });
});

describe("principal", () => {
  it("imprime un renglón por ruta y sale con 0", async () => {
    const salida: string[] = [];
    const codigo = await principal([BASE], (t) => salida.push(t), { fetch: falso(rutasBuenas()) });
    expect(codigo).toBe(0);
    const texto = salida.join("");
    expect(texto.match(/^ok /gm)).toHaveLength(18);
    expect(texto).toContain("Prueba de humo correcta.");
  });

  it("con fallas imprime cada una y sale con 1", async () => {
    const salida: string[] = [];
    const rutas = rutasBuenas();
    rutas["/v1/status"] = { estado: 503, cuerpo: {} };
    const codigo = await principal([BASE], (t) => salida.push(t), { fetch: falso(rutas) });
    expect(codigo).toBe(1);
    const texto = salida.join("");
    expect(texto).toMatch(/FALLA .*\/v1\/status/);
    expect(texto).toContain("falla: /v1/status: estado 503, se esperaba 200");
  });

  it("--robots pasa la revisión de X-Robots-Tag", async () => {
    const salida: string[] = [];
    const sinTag = falso(rutasBuenas());
    expect(
      await principal([BASE, "--robots", "ninguno"], (t) => salida.push(t), { fetch: sinTag }),
    ).toBe(0);
    expect(
      await principal([BASE, "--robots", "noindex"], (t) => salida.push(t), { fetch: sinTag }),
    ).toBe(1);
    expect(salida.join("")).toContain("x-robots-tag: ausente, se esperaba noindex");
    const conTag = falso(rutasBuenas(), undefined, { "x-robots-tag": "noindex" });
    expect(await principal(["--robots", "noindex", BASE], () => {}, { fetch: conTag })).toBe(0);
  });

  it.each([
    [[]],
    [["no-es-url"]],
    [[BASE, "otro"]],
    [[BASE, "--robots"]],
    [[BASE, "--robots", "otro"]],
    [[BASE, "--otra"]],
  ])("argumentos %j: uso y código 2", async (args) => {
    const salida: string[] = [];
    expect(await principal(args, (t) => salida.push(t))).toBe(2);
    expect(salida.join("")).toContain("Uso:");
  });

  it("el script corre con Node: sin base sale con 2", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Uso:");
  });

  it("el script corre con Node: un origen inalcanzable sale con 1", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "http://127.0.0.1:1"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FALLA");
  });
});
