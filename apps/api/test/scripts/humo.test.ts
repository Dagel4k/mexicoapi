import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { principal, probarHumo } from "../../scripts/humo.ts";

const BASE = "https://api.ejemplo.mx";
const SCRIPT = fileURLToPath(new URL("../../scripts/humo.ts", import.meta.url));
const SEGURIDAD = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const UDIS = "/v1/udis?fecha=2024-06-03";
const DIAS = "/v1/dias-habiles?autoridad=lft&desde=2026-11-13&dias=1";

interface Ruta {
  estado?: number;
  tipo?: string;
  cuerpo: unknown;
}

const ESTADOS = Array.from({ length: 32 }, (_, i) => ({ cve_ent: String(i + 1).padStart(2, "0") }));

function rutasBuenas(): Record<string, Ruta> {
  return {
    "/v1/estados": { cuerpo: { data: ESTADOS, meta: { as_of: "2026-10-01" } } },
    "/v1/municipios/25006": { cuerpo: { data: { cvegeo: "25006", nombre: "Culiacán" } } },
    "/v1/bancos/012": { cuerpo: { data: { codigo: "012" } } },
    "/v1/clabe/012180000000000015": { cuerpo: { data: { valido: true } } },
    [DIAS]: { cuerpo: { data: { resultado: "2026-11-17" } } },
    "/v1/tipo-cambio/fix/ultimo": {
      cuerpo: { data: { fecha_publicacion: "2026-10-16", valor: "18.4250" } },
    },
    [UDIS]: { cuerpo: { data: { fecha: "2024-06-03", valor: "8.146030" } } },
    "/v1/estados/33": {
      estado: 404,
      tipo: "application/problem+json; charset=utf-8",
      cuerpo: { status: 404 },
    },
    "/v1/status": { cuerpo: { data: [{ dataset: "bancos", status: "ok" }] } },
    "/v1/openapi.json": { cuerpo: { openapi: "3.1.0" } },
    "/descargas/SHA256SUMS": { tipo: "text/plain; charset=utf-8", cuerpo: "abc  bancos.json\n" },
  };
}

function falso(
  rutas: Record<string, Ruta>,
  alterar?: (ruta: string) => Response | undefined,
): typeof fetch {
  return (async (entrada: string | URL | Request) => {
    const ruta = String(entrada).slice(BASE.length);
    const propia = alterar?.(ruta);
    if (propia) return propia;
    const r = rutas[ruta];
    if (!r) return new Response("no", { status: 500 });
    const texto = typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo);
    return new Response(texto, {
      status: r.estado ?? 200,
      headers: { "content-type": r.tipo ?? "application/json; charset=utf-8", ...SEGURIDAD },
    });
  }) as typeof fetch;
}

describe("probarHumo", () => {
  it("todo bien: ok, sin fallas y un tiempo por ruta", async () => {
    const r = await probarHumo(`${BASE}/`, { fetch: falso(rutasBuenas()) });
    expect(r.fallas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.tiempos)).toHaveLength(11);
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
    expect(r.fallas).toHaveLength(11);
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

  it("valida el cuerpo de cada ruta", async () => {
    const malas: [string, unknown, string][] = [
      ["/v1/estados", { data: ESTADOS.slice(1), meta: { as_of: "2026-10-01" } }, "no trae 32"],
      ["/v1/estados", { data: ESTADOS, meta: { as_of: "ayer" } }, "meta.as_of"],
      ["/v1/estados", [], "no trae 32"],
      ["/v1/municipios/25006", { data: { cvegeo: "25006", nombre: "Otro" } }, "no es Culiacán"],
      ["/v1/bancos/012", { data: { codigo: "014" } }, "no es el banco"],
      ["/v1/clabe/012180000000000015", { data: { valido: false } }, "no es válida"],
      [DIAS, { data: { resultado: "2026-11-16" } }, "no 2026-11-17"],
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

describe("principal", () => {
  it("imprime un renglón por ruta y sale con 0", async () => {
    const salida: string[] = [];
    const codigo = await principal([BASE], (t) => salida.push(t), { fetch: falso(rutasBuenas()) });
    expect(codigo).toBe(0);
    const texto = salida.join("");
    expect(texto.match(/^ok /gm)).toHaveLength(11);
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

  it.each([[[]], [["no-es-url"]], [[BASE, "otro"]]])(
    "argumentos %j: uso y código 2",
    async (args) => {
      const salida: string[] = [];
      expect(await principal(args, (t) => salida.push(t))).toBe(2);
      expect(salida.join("")).toContain("Uso:");
    },
  );

  it("el script corre con Node: sin base sale con 2", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Uso:");
  });

  it("el script corre con Node: un origen inalcanzable sale con 1", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "http://127.0.0.1:1"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FALLA");
  });
});
