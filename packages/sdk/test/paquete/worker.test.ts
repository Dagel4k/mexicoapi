// mexicoapi en un Worker de Cloudflare: un Worker mínimo (worker/index.js) que importa el paquete
// instalado desde su .tgz (globalSetup instalar.ts), levantado en workerd con unstable_startWorker,
// como las pruebas de integración de la API, sin `nodejs_compat`. Que ninguna entrada universal
// importe módulos de Node lo revisa paquete.test.ts en el grafo de módulos: workerd acepta algunos
// `node:` aun sin esa bandera, así que esta prueba no lo detectaría.
import { copyFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { unstable_startWorker } from "wrangler";

const WORKER = fileURLToPath(new URL("./worker/index.js", import.meta.url));
const { dir } = inject("paqueteInstalado");

let worker: Awaited<ReturnType<typeof unstable_startWorker>> | undefined;
let base: string;
// Una API falsa en 127.0.0.1: /v1/estados responde datos y /redirige/v1/estados redirige.
let api: Server | undefined;
let baseApi: string;

beforeAll(async () => {
  api = createServer((peticion, respuesta) => {
    if (peticion.url === "/v1/estados") {
      respuesta.writeHead(200, { "Content-Type": "application/json" });
      respuesta.end(
        JSON.stringify({
          data: [{ cve_ent: "25", nombre: "Sinaloa", abreviatura: "Sin.", cvegeo: "25" }],
          meta: { dataset: "inegi.estados", as_of: "2026-10-17", sources: [], docs: "" },
        }),
      );
    } else {
      respuesta.writeHead(301, { Location: "/v1/estados" }).end();
    }
  });
  await new Promise<void>((listo) => api?.listen(0, "127.0.0.1", listo));
  baseApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  await copyFile(WORKER, join(dir, "worker.js"));
  const config = {
    name: "consumidor-mexicoapi",
    main: "worker.js",
    compatibility_date: "2026-10-01",
    observability: { enabled: false },
    send_metrics: false,
  };
  await writeFile(join(dir, "wrangler.json"), `${JSON.stringify(config, null, 2)}\n`);
  worker = await unstable_startWorker({
    config: join(dir, "wrangler.json"),
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: false,
      watch: false,
      logLevel: "error",
    },
  });
  await worker.ready;
  base = (await worker.url).href;
  // Si el Worker falla al cargar, wrangler lo dice en stderr pero `ready` se cumple igual y cada
  // petición se queda esperando: una primera petición con tope hace que falle aquí, de una vez.
  await fetch(base, { signal: AbortSignal.timeout(30_000) });
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
  await new Promise((listo) => (api === undefined ? listo(undefined) : api.close(listo)));
});

async function pedir(ruta: string): Promise<unknown> {
  const respuesta = await fetch(new URL(ruta, base), { signal: AbortSignal.timeout(10_000) });
  const cuerpo: unknown = await respuesta.json();
  expect(respuesta.status, JSON.stringify(cuerpo)).toBe(200);
  return cuerpo;
}

describe("mexicoapi en un Worker (workerd)", () => {
  it("valida una CLABE con el catálogo de bancos del paquete", async () => {
    expect(await pedir("/clabe?valor=002010077777777771")).toMatchObject({
      valido: true,
      detalle: { banco: { codigo: "002", activo: true } },
    });
    expect(await pedir("/clabe?valor=002010077777777770")).toMatchObject({
      valido: false,
      errores: ["digito_verificador"],
    });
  });

  it("da la fecha de hoy en la Ciudad de México", async () => {
    expect(await pedir("/hoy?ahora=2026-10-19T01:03:00Z")).toEqual({ hoy: "2026-10-18" });
  });

  it("busca municipios en los datos del paquete", async () => {
    expect(await pedir("/municipios?texto=culiacan")).toMatchObject({
      estados: 32,
      encontrados: [{ cvegeo: "25006", nombre: "Culiacán" }],
    });
  });

  it.each([
    ["lft", null, "2026-04-01", 1, "2026-04-02"],
    ["cnbv", null, "2026-04-01", 1, "2026-04-06"],
    ["sat", "general", "2026-07-17", 3, "2026-08-05"],
    ["sat", "declaraciones_pagos", "2026-07-17", 3, "2026-07-22"],
  ])("suma días hábiles con %s %s", async (autoridad, tipoPlazo, desde, dias, resultado) => {
    const query = new URLSearchParams({ autoridad, desde, dias: String(dias) });
    if (tipoPlazo !== null) query.set("tipo_plazo", tipoPlazo);
    expect(await pedir(`/dias-habiles?${query}`)).toMatchObject({ autoridad, resultado });
  });

  it("consulta el FIX, las UDIS y la UMA del paquete", async () => {
    expect(await pedir("/indicadores?fecha=2026-03-01")).toMatchObject({
      fix: { tipo: "encontrado" },
      udi: { tipo: "encontrado" },
      uma: { anio: 2026, diaria: "117.31" },
    });
  });

  it("consulta una API con la red de workerd y no sigue una redirección", async () => {
    const query = (b: string) => `/cliente/api?${new URLSearchParams({ base: b })}`;
    expect(await pedir(query(baseApi))).toEqual({ origen: "api", estados: 1 });
    expect(await pedir(query(`${baseApi}/redirige`))).toEqual({
      error: {
        status: 301,
        title: "Respuesta inesperada de la API",
        detail: "La API respondió con una redirección.",
      },
    });
  });

  it("responde con el cliente offline y sus errores tipados", async () => {
    expect(await pedir("/cliente/dias-habiles?desde=2026-07-17&dias=3")).toEqual({
      origen: "paquete",
      resultado: "2026-08-05",
    });
    expect(await pedir("/cliente/banco?codigo=002")).toEqual({
      origen: "paquete",
      nombre_corto: "BANAMEX",
    });
    expect(await pedir("/cliente/banco?codigo=999")).toEqual({
      error: { status: 404, tipo: "no-encontrado", origen: "paquete" },
    });
  });
});
