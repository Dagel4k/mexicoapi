// Límites de la descarga: tamaño mientras llega el cuerpo (con o sin Content-Length) y tiempo
// total, con un fetch propio y con el transporte por omisión contra un servidor local. Sin red.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { crearTransporte } from "../../src/sepomex/http.js";
import { type FetchSepomex, LIMITES, sync } from "../../src/sepomex/index.js";
import { paginaEnBytes, zipOficial } from "./ayudas.js";
import { rechazo } from "./comun.js";

let trabajo: string;
let dir: string;
let servidor: Server | undefined;
const aviso = () => {};

beforeEach(async () => {
  trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
  dir = join(trabajo, "cache");
});

afterEach(async () => {
  vi.useRealTimers();
  const s = servidor;
  servidor = undefined;
  if (s !== undefined) {
    s.closeAllConnections();
    await new Promise((listo) => s.close(listo));
  }
  await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
});

/** Un cuerpo que no se acaba: da trozos de 64 KB mientras se le pidan. */
function cuerpoSinFin() {
  const visto = { enviados: 0, cancelado: false };
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(control) {
      visto.enviados += 65_536;
      control.enqueue(new Uint8Array(65_536));
    },
    cancel() {
      visto.cancelado = true;
    },
  });
  return { cuerpo, visto };
}

it("corta un cuerpo sin Content-Length que pasa del límite mientras llega", async () => {
  const { cuerpo, visto } = cuerpoSinFin();
  const fetch: FetchSepomex = async () => ({
    status: 200,
    headers: { get: () => null },
    body: cuerpo,
    arrayBuffer: () => Promise.reject(new Error("no debe leerse entero")),
  });
  await rechazo(sync({ dir, aviso, fetch }), "archivo-invalido", /La respuesta pasa de 1\.0 MB/);
  expect(visto.cancelado).toBe(true);
  expect(visto.enviados).toBeLessThan(LIMITES.pagina + 4 * 65_536);
});

it("dice si el cuerpo se corta a medias", async () => {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(new Uint8Array(10));
      control.error(new Error("socket hang up"));
    },
  });
  const fetch: FetchSepomex = async () => ({
    status: 200,
    headers: { get: () => null },
    body: cuerpo,
    arrayBuffer: () => Promise.reject(new Error("no se usa")),
  });
  await rechazo(
    sync({ dir, aviso, fetch }),
    "sin-respuesta",
    /Se cortó la descarga.*socket hang up/,
  );
});

async function esperarTope(fetch: FetchSepomex, llamado: Promise<void>) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const resultado = sync({ dir, aviso, fetch }).catch((e: unknown) => e);
  await llamado;
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  vi.useRealTimers();
  return resultado;
}

it("se rinde si la descarga pasa de 5 minutos, aunque el fetch ignore la señal", async () => {
  let senal: { aborted: boolean } | undefined;
  let avisar: () => void = () => {};
  const llamado = new Promise<void>((listo) => {
    avisar = listo;
  });
  const fetch: FetchSepomex = (_url, init) => {
    senal = init.signal;
    avisar();
    return new Promise(() => {});
  };
  const error = await esperarTope(fetch, llamado);
  await rechazo(Promise.reject(error), "sin-respuesta", /pasó de 5 min/);
  expect(senal?.aborted).toBe(true);
});

it("el tope de 5 minutos también corta un cuerpo que deja de llegar", async () => {
  let avisar: () => void = () => {};
  const llamado = new Promise<void>((listo) => {
    avisar = listo;
  });
  const fetch: FetchSepomex = async () => ({
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      pull() {
        avisar();
        return new Promise(() => {});
      },
    }),
    arrayBuffer: () => Promise.reject(new Error("no se usa")),
  });
  const error = await esperarTope(fetch, llamado);
  await rechazo(Promise.reject(error), "sin-respuesta", /pasó de 5 min/);
});

/** Servidor local con la forma del sitio; `fetch` lleva las peticiones a él. */
async function sitioLocal(
  manejar: (metodo: string, respuesta: import("node:http").ServerResponse) => void,
): Promise<FetchSepomex> {
  const s = createServer((pedido, respuesta) => {
    pedido.resume();
    pedido.on("end", () => manejar(pedido.method ?? "", respuesta));
  });
  servidor = s;
  await new Promise<void>((listo) => s.listen(0, "127.0.0.1", listo));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const transporte = crearTransporte({ esperaMs: 5_000 });
  return (url, init) => transporte(base + new URL(url).pathname, init);
}

it("con el transporte por omisión descarga de punta a punta", async () => {
  const fetch = await sitioLocal((metodo, respuesta) => {
    respuesta.end(metodo === "GET" ? paginaEnBytes() : zipOficial());
  });
  const e = await sync({ dir, aviso, fetch });
  expect(e.as_of).toBe("2026-10-17");
  expect(e.codigos_postales).toBeGreaterThan(30);
});

it("con el transporte por omisión deja de recibir una página de más de 1 MB", async () => {
  let escritos = 0;
  const trozo = Buffer.alloc(65_536, 0x20);
  const fetch = await sitioLocal((_metodo, respuesta) => {
    let abierta = true;
    respuesta.on("close", () => {
      abierta = false;
    });
    const enviar = () => {
      while (abierta && escritos < 50 * 1_048_576) {
        escritos += trozo.length;
        if (!respuesta.write(trozo)) {
          respuesta.once("drain", enviar);
          return;
        }
      }
      respuesta.end();
    };
    enviar();
  });
  await rechazo(sync({ dir, aviso, fetch }), "archivo-invalido", /pasa de 1\.0 MB/);
  expect(escritos).toBeLessThan(20 * 1_048_576);
});
