import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

// Un segundo Worker con la misma fuente y el mismo `public/`, más un binding LIMITE de 3
// peticiones por minuto, como el de producción pero corto. El Worker del globalSetup no tiene
// límite.
const RAIZ = new URL("../../", import.meta.url);
const ruta = (relativa: string): string => fileURLToPath(new URL(relativa, RAIZ));

let dir: string;
let worker: Awaited<ReturnType<typeof unstable_startWorker>> | undefined;
let origen: string;

// Levantar workerd tarda unos segundos; el tope por omisión de un hook es de 10.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-limite-"));
  const base = JSON.parse(
    (await readFile(ruta("wrangler.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, ""),
  ) as { assets: Record<string, unknown> };
  const config = {
    ...base,
    name: "mexicoapi-limite-local",
    main: ruta("src/index.ts"),
    assets: { ...base.assets, directory: ruta("public") },
    ratelimits: [{ name: "LIMITE", namespace_id: "1001", simple: { limit: 3, period: 60 } }],
  };
  const archivo = join(dir, "wrangler.json");
  await writeFile(archivo, JSON.stringify(config));
  worker = await unstable_startWorker({
    config: archivo,
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: false,
      watch: false,
      logLevel: "error",
    },
  });
  await worker.ready;
  origen = (await worker.url).origin;
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
  await rm(dir, { recursive: true, force: true });
});

function pedirDesde(ip: string, camino: string, method = "GET"): Promise<Response> {
  return fetch(`${origen}${camino}`, {
    method,
    headers: { "CF-Connecting-IP": ip },
    redirect: "manual",
  });
}

async function estado(respuesta: Response): Promise<number> {
  await respuesta.arrayBuffer();
  return respuesta.status;
}

describe("límite de peticiones en el Worker local", () => {
  it("después de 3 GET la misma IP recibe 429, pero su OPTIONS sigue en 204", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 3; i++) expect(await estado(await pedirDesde(ip, "/v1"))).toBe(200);
    const rechazada = await pedirDesde(ip, "/v1/estados");
    expect(await estado(rechazada)).toBe(429);
    expect(rechazada.headers.get("retry-after")).toBe("60");

    for (const camino of ["/v1/estados", "/v1/no-existe", "/v1/estados/"]) {
      const preflight = await pedirDesde(ip, camino, "OPTIONS");
      expect(await estado(preflight), camino).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
      expect(preflight.headers.get("access-control-allow-headers")).toBe("If-None-Match");
    }
    // Otra IP no comparte el límite.
    expect(await estado(await pedirDesde("203.0.113.8", "/v1"))).toBe(200);
  });

  it("los OPTIONS no gastan del límite: después de 5, la IP todavía tiene sus 3 GET", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) {
      expect(await estado(await pedirDesde(ip, "/v1/estados", "OPTIONS"))).toBe(204);
    }
    for (let i = 0; i < 3; i++) expect(await estado(await pedirDesde(ip, "/v1"))).toBe(200);
    expect(await estado(await pedirDesde(ip, "/v1"))).toBe(429);
  });
});
