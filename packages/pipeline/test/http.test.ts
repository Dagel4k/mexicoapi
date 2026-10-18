import { describe, expect, it } from "vitest";
import { AGENTE, crearCliente, ErrorHttp, TOPE_CUERPO_BYTES } from "../src/http.js";

/** Una respuesta fija (se clona en cada pedido), un error o una función que arma una nueva. */
type Paso = Response | Error | (() => Response);

function res(estado: number, cuerpo = "", cabeceras: Record<string, string> = {}): Response {
  return new Response(cuerpo, { status: estado, headers: cabeceras });
}

/**
 * Un cuerpo que entrega `trozo` sin fin (o `veces` veces) y anota si alguien lo canceló, para
 * comprobar que el cliente no lo deja abierto.
 */
function cuerpoVigilado(trozo = new Uint8Array(4), veces = Number.POSITIVE_INFINITY) {
  let entregados = 0;
  const vigia = { cancelado: false, entregados: 0 };
  // Sin cola (highWaterMark 0): solo entrega un trozo cuando alguien lo lee.
  const flujo = new ReadableStream<Uint8Array>(
    {
      pull(control) {
        if (entregados >= veces) {
          control.close();
          return;
        }
        entregados++;
        vigia.entregados = entregados;
        control.enqueue(trozo.slice());
      },
      cancel() {
        vigia.cancelado = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { flujo, vigia };
}

/** fetch falso: responde según la URL; las listas se consumen en orden y el último paso se repite. */
function montar(rutas: Record<string, Paso[]>) {
  const pedidas: string[] = [];
  const agentes: string[] = [];
  const modos: string[] = [];
  const esperas: number[] = [];
  let t = 1_000_000;
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    pedidas.push(url);
    agentes.push(new Headers(init?.headers).get("user-agent") ?? "");
    modos.push(init?.redirect ?? "");
    const lista = rutas[url];
    const paso = lista && lista.length > 1 ? lista.shift() : lista?.[0];
    if (paso === undefined) return res(404);
    if (paso instanceof Error) throw paso;
    if (typeof paso === "function") return paso();
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
  return { cliente, pedidas, agentes, modos, esperas };
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

  it("respeta Retry-After como fecha HTTP, con tope y sin esperas negativas", async () => {
    // El reloj falso empieza en 1_000_000 ms (00:16:40 GMT); la página se pide en 1_001_000.
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(503, "", { "retry-after": "Thu, 01 Jan 1970 00:16:51 GMT" }), res(200)],
    });
    await m.cliente.obtener(`${A}/x`);
    expect(m.esperas).toEqual([1000, 10_000]);

    const lejos = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(429, "", { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), res(200)],
    });
    await lejos.cliente.obtener(`${A}/x`);
    expect(lejos.esperas).toEqual([1000, 60_000]);

    const pasada = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(503, "", { "retry-after": "Thu, 01 Jan 1970 00:00:01 GMT" }), res(200)],
    });
    await pasada.cliente.obtener(`${A}/x`);
    // Sin espera por Retry-After; el intervalo entre pedidos al host se cumple igual.
    expect(pasada.esperas).toEqual([1000, 0, 1000]);
  });

  it("ignora un Retry-After que no es número ni fecha y usa el backoff", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(503, "", { "retry-after": "pronto" }), res(200)],
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

  it("un estado en aceptar se devuelve con su cuerpo, sin lanzar ni reintentar", async () => {
    const cuerpo = '{"messageCode":404,"response":"NOT_FOUND"}';
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(404, cuerpo, { "content-type": "application/json" })],
      [`${A}/y`]: [res(503, "caído"), res(200)],
    });
    const r = await m.cliente.obtener(`${A}/x`, { aceptar: [404] });
    expect(r.estado).toBe(404);
    expect(new TextDecoder().decode(r.cuerpo)).toBe(cuerpo);
    expect(r.tipo).toBe("application/json");
    expect(r.url).toBe(`${A}/x`);
    expect(r.obtenido_en).toMatch(/^1970-01-01T/);
    const y = await m.cliente.obtener(`${A}/y`, { aceptar: [503] });
    expect(y.estado).toBe(503);
    expect(new TextDecoder().decode(y.cuerpo)).toBe("caído");
    expect(m.pedidas.filter((u) => u === `${A}/x` || u === `${A}/y`)).toEqual([`${A}/x`, `${A}/y`]);
    // Solo los intervalos entre peticiones, sin backoff.
    expect(m.esperas).toEqual([1000, 1000]);
  });

  it("los estados fuera de aceptar siguen lanzando y reintentando como siempre", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(410)],
      [`${A}/y`]: [res(500)],
      [`${A}/z`]: [res(404)],
    });
    const e410 = await m.cliente.obtener(`${A}/x`, { aceptar: [404] }).catch((x: unknown) => x);
    expect(e410).toBeInstanceOf(ErrorHttp);
    expect((e410 as ErrorHttp).estado).toBe(410);
    const e500 = await m.cliente.obtener(`${A}/y`, { aceptar: [404] }).catch((x: unknown) => x);
    expect((e500 as ErrorHttp).estado).toBe(500);
    expect(m.pedidas.filter((u) => u === `${A}/y`)).toHaveLength(4);
    // Sin opciones, un 404 sigue siendo un error.
    const e404 = await m.cliente.obtener(`${A}/z`).catch((x: unknown) => x);
    expect((e404 as ErrorHttp).estado).toBe(404);
    const vacio = await m.cliente.obtener(`${A}/z`, { aceptar: [] }).catch((x: unknown) => x);
    expect((vacio as ErrorHttp).estado).toBe(404);
  });

  it("aceptar no cambia el trato de robots.txt", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(503), res(503), res(503), res(503)],
      [`${A}/x`]: [res(200)],
    });
    const e = await m.cliente.obtener(`${A}/x`, { aceptar: [503] }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBe(503);
    expect(m.pedidas).not.toContain(`${A}/x`);
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

  it("si robots.txt da 429 tras los reintentos lanza y no lo cachea como permitido", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(429), res(429), res(429), res(429), ROBOTS_ABIERTO],
      [`${A}/x`]: [res(200)],
      [`${A}/privado/y`]: [res(200)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBe(429);
    expect(m.pedidas).not.toContain(`${A}/x`);
    // Se vuelve a pedir robots.txt y su regla se respeta.
    const negado = await m.cliente.obtener(`${A}/privado/y`).catch((x: unknown) => x);
    expect((negado as ErrorHttp).message).toMatch(/robots/);
    expect(m.pedidas.filter((u) => u.endsWith("robots.txt"))).toHaveLength(5);
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

const HOST_A = "a.example.mx";
const HOST_B = "b.example.mx";

describe("redirecciones", () => {
  it("pide con redirect manual y sigue una redirección en el mismo host con robots e intervalo", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(301, "", { location: "/y?z=1" })],
      [`${A}/y?z=1`]: [res(200, "fin")],
    });
    const r = await m.cliente.obtener(`${A}/x`);
    expect(new TextDecoder().decode(r.cuerpo)).toBe("fin");
    expect(r.url).toBe(`${A}/y?z=1`);
    expect(m.pedidas).toEqual([`${A}/robots.txt`, `${A}/x`, `${A}/y?z=1`]);
    expect(m.modos.every((modo) => modo === "manual")).toBe(true);
    // Cada salto respeta el intervalo del host.
    expect(m.esperas).toEqual([1000, 1000]);
  });

  it("revisa robots.txt en cada salto", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(302, "", { location: `${A}/privado/z` })],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/robots/);
    expect(m.pedidas).not.toContain(`${A}/privado/z`);
  });

  it("no sigue una redirección a un host que no está permitido", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(302, "", { location: `${B}/y` })],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/host no permitido.*b\.example\.mx/i);
    expect((e as ErrorHttp).url).toBe(`${A}/x`);
    expect(m.pedidas.some((u) => new URL(u).host === new URL(B).host)).toBe(false);
    // Tampoco con una lista de hosts que no lo incluye, ni se reintenta.
    const otra = await m.cliente
      .obtener(`${A}/x`, { hosts: [HOST_A, "c.example.mx"] })
      .catch((x: unknown) => x);
    expect((otra as ErrorHttp).message).toMatch(/host no permitido/i);
    expect(m.pedidas.filter((u) => u === `${A}/x`)).toHaveLength(2);
  });

  it("sigue una redirección a otro host de la lista, con su robots.txt y su intervalo", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(307, "", { location: `${B}/y` })],
      [`${B}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${B}/y`]: [res(200, "de b")],
      [`${A}/z`]: [res(308, "", { location: `${B}/privado/w` })],
    });
    const r = await m.cliente.obtener(`${A}/x`, { hosts: [HOST_A, HOST_B] });
    expect(new TextDecoder().decode(r.cuerpo)).toBe("de b");
    expect(r.url).toBe(`${B}/y`);
    expect(m.pedidas).toEqual([`${A}/robots.txt`, `${A}/x`, `${B}/robots.txt`, `${B}/y`]);
    // a: robots sin espera, página con 1000; b: robots sin espera, página con 1000.
    expect(m.esperas).toEqual([1000, 1000]);
    const e = await m.cliente.obtener(`${A}/z`, { hosts: [HOST_A, HOST_B] }).catch((x) => x);
    expect((e as ErrorHttp).message).toMatch(/robots/);
    expect(m.pedidas).not.toContain(`${B}/privado/w`);
  });

  it("no sigue una redirección a http", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(301, "", { location: "http://a.example.mx/y" })],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/https/);
    expect(m.pedidas.some((u) => u.startsWith("http:"))).toBe(false);
  });

  it("corta un bucle de redirecciones", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(302, "", { location: "/y" })],
      [`${A}/y`]: [res(302, "", { location: "/x" })],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/bucle/);
    expect(m.pedidas).toEqual([`${A}/robots.txt`, `${A}/x`, `${A}/y`]);
  });

  it("corta después de 5 redirecciones", async () => {
    const rutas: Record<string, Paso[]> = { [`${A}/robots.txt`]: [ROBOTS_ABIERTO] };
    for (let i = 0; i < 7; i++) rutas[`${A}/${i}`] = [res(302, "", { location: `/${i + 1}` })];
    const m = montar(rutas);
    const e = await m.cliente.obtener(`${A}/0`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/5 redirecciones/);
    expect(m.pedidas).toContain(`${A}/5`);
    expect(m.pedidas).not.toContain(`${A}/6`);
  });

  it("una redirección sin Location o con una Location inválida es un error y no se reintenta", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(302)],
      [`${A}/y`]: [res(302, "", { location: "https://[::1" })],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).estado).toBe(302);
    const f = await m.cliente.obtener(`${A}/y`).catch((x: unknown) => x);
    expect(f).toBeInstanceOf(ErrorHttp);
    expect((f as ErrorHttp).message).toMatch(/Location/);
    expect(m.pedidas.filter((u) => u === `${A}/x` || u === `${A}/y`)).toHaveLength(2);
  });

  it("rechaza sin pedir nada una URL que no es https o cuyo host no está en la lista", async () => {
    const m = montar({ [`${A}/robots.txt`]: [ROBOTS_ABIERTO], [`${A}/x`]: [res(200)] });
    const http = await m.cliente.obtener("http://a.example.mx/x").catch((x: unknown) => x);
    expect((http as ErrorHttp).message).toMatch(/https/);
    const fuera = await m.cliente.obtener(`${A}/x`, { hosts: [HOST_B] }).catch((x) => x);
    expect((fuera as ErrorHttp).message).toMatch(/host no permitido/i);
    expect(m.pedidas).toEqual([]);
  });

  it("robots.txt sigue su redirección a otro host de la lista (como el de Banxico)", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(302, "", { location: `${B}/robots.txt` })],
      [`${B}/robots.txt`]: [res(200, "User-agent: *\nDisallow: /privado\n")],
      [`${A}/x`]: [res(200, "ok")],
    });
    const hosts = [HOST_A, HOST_B];
    expect((await m.cliente.obtener(`${A}/x`, { hosts })).estado).toBe(200);
    const e = await m.cliente.obtener(`${A}/privado/y`, { hosts }).catch((x: unknown) => x);
    expect((e as ErrorHttp).message).toMatch(/robots/);
    expect(m.pedidas).toEqual([`${A}/robots.txt`, `${B}/robots.txt`, `${A}/x`]);
  });

  it("robots.txt no sigue una redirección fuera de la lista y no la guarda como permitida", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [res(302, "", { location: `${B}/robots.txt` })],
      [`${A}/x`]: [res(200)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect(m.pedidas).toEqual([`${A}/robots.txt`]);
    await m.cliente.obtener(`${A}/x`).catch(() => undefined);
    expect(m.pedidas).toEqual([`${A}/robots.txt`, `${A}/robots.txt`]);
  });
});

describe("cuerpo", () => {
  it("rechaza un Content-Length mayor que el tope sin leer el cuerpo ni reintentar", async () => {
    const { flujo, vigia } = cuerpoVigilado();
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [() => new Response(flujo, { headers: { "content-length": "11" } })],
    });
    const e = await m.cliente.obtener(`${A}/x`, { topeBytes: 10 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorHttp);
    expect((e as ErrorHttp).message).toMatch(/tope/);
    expect((e as ErrorHttp).estado).toBe(200);
    expect(vigia.entregados).toBe(0);
    expect(vigia.cancelado).toBe(true);
    expect(m.pedidas.filter((u) => u === `${A}/x`)).toHaveLength(1);
  });

  it("corta a media lectura un cuerpo que pasa el tope y lo cancela", async () => {
    const { flujo, vigia } = cuerpoVigilado(new Uint8Array(4));
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [() => new Response(flujo)],
    });
    const e = await m.cliente.obtener(`${A}/x`, { topeBytes: 10 }).catch((x: unknown) => x);
    expect((e as ErrorHttp).message).toMatch(/tope/);
    expect(vigia.cancelado).toBe(true);
    expect(vigia.entregados).toBeLessThanOrEqual(4);
  });

  it("acepta un cuerpo justo en el tope, leído por partes", async () => {
    const { flujo } = cuerpoVigilado(new TextEncoder().encode("abcde"), 2);
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [() => new Response(flujo)],
    });
    const r = await m.cliente.obtener(`${A}/x`, { topeBytes: 10 });
    expect(new TextDecoder().decode(r.cuerpo)).toBe("abcdeabcde");
  });

  it("el tope por omisión es de 50 MB", async () => {
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [res(200, "", { "content-length": String(TOPE_CUERPO_BYTES + 1) })],
    });
    expect(TOPE_CUERPO_BYTES).toBe(50 * 1024 * 1024);
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect((e as ErrorHttp).message).toMatch(/tope/);
  });

  it("cancela el cuerpo de las respuestas que no devuelve", async () => {
    const vigias: { cancelado: boolean }[] = [];
    const vigilada =
      (estado: number, cabeceras: Record<string, string> = {}) =>
      () => {
        const { flujo, vigia } = cuerpoVigilado();
        vigias.push(vigia);
        return new Response(flujo, { status: estado, headers: cabeceras });
      };
    const m = montar({
      [`${A}/robots.txt`]: [ROBOTS_ABIERTO],
      [`${A}/x`]: [vigilada(503), vigilada(301, { location: "/y" })],
      [`${A}/y`]: [vigilada(404)],
    });
    const e = await m.cliente.obtener(`${A}/x`).catch((x: unknown) => x);
    expect((e as ErrorHttp).estado).toBe(404);
    expect(vigias).toHaveLength(3);
    expect(vigias.every((v) => v.cancelado)).toBe(true);
  });
});
