import { describe, expect, it } from "vitest";
import { AGENTE, crearCliente, ErrorHttp } from "../src/http.js";

type Paso = Response | Error;

function res(estado: number, cuerpo = "", cabeceras: Record<string, string> = {}): Response {
  return new Response(cuerpo, { status: estado, headers: cabeceras });
}

/** fetch falso: responde según la URL; las listas se consumen en orden y el último paso se repite. */
function montar(rutas: Record<string, Paso[]>) {
  const pedidas: string[] = [];
  const agentes: string[] = [];
  const esperas: number[] = [];
  let t = 1_000_000;
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    pedidas.push(url);
    agentes.push(new Headers(init?.headers).get("user-agent") ?? "");
    const lista = rutas[url];
    const paso = lista && lista.length > 1 ? lista.shift() : lista?.[0];
    if (paso === undefined) return res(404);
    if (paso instanceof Error) throw paso;
    return paso.clone();
  }) as unknown as typeof fetch;
  const cliente = crearCliente({
    fetch: fetchFalso,
    esperar: async (ms) => {
      esperas.push(ms);
      t += ms;
    },
    ahora: () => t,
  });
  return { cliente, pedidas, agentes, esperas };
}

const ROBOTS_ABIERTO = res(200, "User-agent: *\nDisallow: /privado\n");
const A = "https://a.example.mx";
const B = "https://b.example.mx";

describe("crearCliente", () => {
  it("devuelve cuerpo, tipo, url y fecha, y manda el User-Agent", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/d`]: [res(200, "hola", { "content-type": "text/plain" })],
    });
    const r = await m.cliente.obtener(`${A}/d`);
    expect(new TextDecoder().decode(r.cuerpo)).toBe("hola");
    expect(r.tipo).toBe("text/plain");
    expect(r.estado).toBe(200);
    expect(r.url).toBe(`${A}/d`);
    expect(r.obtenido_en).toBe("1970-01-01T00:16:41.000Z");
    expect(m.agentes).toHaveLength(2);
    expect(m.agentes.every((a) => a === AGENTE)).toBe(true);
  });

  it("separa 1000 ms las peticiones al mismo host y no espera entre hosts", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/1`]: [res(200)],
      [`${B}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${B}/1`]: [res(200)],
    });
    await m.cliente.obtener(`${A}/1`);
    expect(m.esperas).toEqual([1000]); // robots y luego la página
    await m.cliente.obtener(`${B}/1`);
    expect(m.esperas).toEqual([1000, 1000]); // b: robots sin espera, página con 1000
  });

  it("serializa llamadas simultáneas al mismo host", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/1`]: [res(200)],
      [`${A}/2`]: [res(200)],
    });
    await Promise.all([m.cliente.obtener(`${A}/1`), m.cliente.obtener(`${A}/2`)]);
    expect(m.esperas).toEqual([1000, 1000]);
    expect(m.pedidas.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("pide robots.txt una sola vez por host aunque dé 404", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(404)],
      [`${A}/1`]: [res(200)],
    });
    await m.cliente.obtener(`${A}/1`);
    await m.cliente.obtener(`${A}/1`);
    expect(m.pedidas.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("reintenta 503, 503 y luego 200 con esperas de 1000 y 2000", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(503), res(503), res(200, "ok")],
    });
    const r = await m.cliente.obtener(`${A}/x`);
    expect(r.estado).toBe(200);
    // robots (sin espera), página (1000 de intervalo), backoff 1000, backoff 2000
    expect(m.esperas).toEqual([1000, 1000, 2000]);
  });

  it("respeta Retry-After en segundos y lo topa en 60000", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(429, "", { "retry-after": "5" }), res(200)],
      [`${A}/y`]: [res(429, "", { "retry-after": "900" }), res(200)],
    });
    await m.cliente.obtener(`${A}/x`);
    expect(m.esperas).toContain(5000);
    await m.cliente.obtener(`${A}/y`);
    expect(m.esperas).toContain(60000);
  });

  it("ignora un Retry-After en formato fecha y usa el backoff", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(503, "", { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), res(200)],
    });
    await m.cliente.obtener(`${A}/x`);
    expect(m.esperas).toEqual([1000, 1000]);
  });

  it("cuatro 500 seguidos lanzan ErrorHttp con estado 500", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(500)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBe(500);
    expect(m.pedidas.filter((u) => u === `${A}/x`)).toHaveLength(4);
  });

  it("un 404 no se reintenta", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(404)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect((e as ErrorHttp).estado).toBe(404);
    expect(m.pedidas.filter((u) => u === `${A}/x`)).toHaveLength(1);
  });

  it("una ruta negada por robots lanza sin pedir la URL", async () => {
    const m = montar({ [`${A}/robots.txt`]: [ROBOTS_ABIERTO] });
    const e = await m.cliente.obtener(`${A}/privado/x?a=1`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBeNull();
    expect((e as ErrorHttp).message).toMatch(/robots/);
    expect(m.pedidas).toEqual([`${A}/robots.txt`]);
  });

  it("si robots.txt da 5xx tras los reintentos lanza y no cachea el fallo", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(500), res(500), res(500), res(500), res(200, "")],
      [`${A}/x`]: [res(200)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect((e as ErrorHttp).estado).toBe(500);
    expect((await m.cliente.obtener(`${A}/x`)).estado).toBe(200);
  });

  it("reintenta un timeout y un error de red", async () => {
    const timeout = new DOMException("tiempo", "TimeoutError");
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [timeout as unknown as Error, new TypeError("fetch failed"), res(200)],
    });
    expect((await m.cliente.obtener(`${A}/x`)).estado).toBe(200);
  });

  it("un error de red persistente lanza ErrorHttp con estado null", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [new TypeError("fetch failed")],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBeNull();
  });

  it("propaga errores que no son de red", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [new RangeError("raro")],
    });
    await expect(m.cliente.obtener(`${A}/x`)).rejects.toBeInstanceOf(RangeError);
  });

  it("crea un cliente con los valores por defecto", () => {
    expect(typeof crearCliente().obtener).toBe("function");
  });
});
