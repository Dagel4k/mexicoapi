// El transporte por omisión contra un servidor local en 127.0.0.1: sin red.
import dns from "node:dns";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarIpv4Primero, crearTransporte } from "../../src/sepomex/http.js";
import type { RespuestaFetchSepomex } from "../../src/sepomex/tipos.js";

let servidor: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  const s = servidor;
  servidor = undefined;
  if (s !== undefined) {
    s.closeAllConnections();
    await new Promise((listo) => s.close(listo));
  }
});

type Manejador = (pedido: IncomingMessage, cuerpo: string, respuesta: ServerResponse) => void;

async function levantar(manejador: Manejador): Promise<string> {
  const s = createServer((pedido, respuesta) => {
    const trozos: Buffer[] = [];
    pedido.on("data", (t: Buffer) => trozos.push(t));
    pedido.on("end", () => manejador(pedido, Buffer.concat(trozos).toString("utf8"), respuesta));
  });
  servidor = s;
  await new Promise<void>((listo) => s.listen(0, "127.0.0.1", listo));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

const transporte = crearTransporte({ esperaMs: 2000 });
const GET = { method: "GET", headers: {}, redirect: "manual" } as const;

function lector(r: RespuestaFetchSepomex) {
  if (!r.body) throw new Error("sin body");
  return r.body.getReader();
}

describe("crearTransporte", () => {
  it("hace un GET y devuelve estado, encabezados y bytes", async () => {
    let visto: Record<string, string | undefined> = {};
    const base = await levantar((pedido, _cuerpo, respuesta) => {
      visto = { metodo: pedido.method, ua: pedido.headers["user-agent"], ruta: pedido.url };
      respuesta.writeHead(200, {
        "Content-Type": "text/html; charset=iso-8859-1",
        "X-Doble": ["a", "b"],
      });
      respuesta.end(Buffer.from("Códigos", "latin1"));
    });
    const r = await transporte(`${base}/pagina.aspx?x=1`, {
      method: "GET",
      headers: { "User-Agent": "prueba" },
      redirect: "manual",
    });
    expect(visto).toEqual({ metodo: "GET", ua: "prueba", ruta: "/pagina.aspx?x=1" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/html; charset=iso-8859-1");
    expect(r.headers.get("x-doble")).toBe("a, b");
    expect(r.headers.get("x-no-esta")).toBeNull();
    expect(Buffer.from(await r.arrayBuffer()).toString("latin1")).toBe("Códigos");
  });

  it("envía el cuerpo de un POST", async () => {
    let recibido = "";
    const base = await levantar((pedido, cuerpo, respuesta) => {
      recibido = `${pedido.method} ${pedido.headers["content-type"]} ${cuerpo}`;
      respuesta.end("ok");
    });
    await transporte(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "a=1&b=%2F",
      redirect: "manual",
    });
    expect(recibido).toBe("POST application/x-www-form-urlencoded a=1&b=%2F");
  });

  it("no sigue redirecciones", async () => {
    const base = await levantar((_p, _c, respuesta) => {
      respuesta.writeHead(302, { Location: "/error.aspx" });
      respuesta.end();
    });
    const r = await transporte(base, GET);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/error.aspx");
  });

  it("entrega el cuerpo mientras llega y corta la conexión si se cancela", async () => {
    let cerrada: () => void = () => {};
    const cierre = new Promise<void>((listo) => {
      cerrada = listo;
    });
    const base = await levantar((_p, _c, respuesta) => {
      respuesta.on("close", cerrada);
      respuesta.write(Buffer.alloc(600, 1));
      // No termina: quien lee debe recibir el primer trozo sin esperar el resto.
    });
    const r = await transporte(base, GET);
    const leer = lector(r);
    const primero = await leer.read();
    expect(primero.done).toBe(false);
    expect(primero.value?.byteLength).toBe(600);
    await leer.cancel();
    await cierre;
  });

  it("se rinde si el servidor no responde, también a mitad del cuerpo", async () => {
    const lento = crearTransporte({ esperaMs: 100 });
    const base = await levantar((pedido, _c, respuesta) => {
      if (pedido.url === "/a-medias") respuesta.write("a");
    });
    await expect(lento(`${base}/nada`, GET)).rejects.toThrow(/no respondió en 0.1 s/);
    const r = await lento(`${base}/a-medias`, GET);
    const leer = lector(r);
    await leer.read();
    await expect(leer.read()).rejects.toThrow(/no respondió en 0.1 s/);
  });

  it("corta la petición con la señal", async () => {
    const base = await levantar(() => {});
    const controlador = new AbortController();
    const pendiente = transporte(base, { ...GET, signal: controlador.signal });
    controlador.abort(new Error("se acabó el tiempo"));
    await expect(pendiente).rejects.toThrow();
  });

  it("rechaza si no se puede conectar", async () => {
    const base = await levantar(() => {});
    const s = servidor as Server;
    servidor = undefined;
    await new Promise((listo) => s.close(listo));
    await expect(transporte(base, GET)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("solo acepta http y https", async () => {
    await expect(transporte("ftp://127.0.0.1/x", GET)).rejects.toThrow(TypeError);
  });
});

describe("buscarIpv4Primero", () => {
  const DIRECCIONES = [
    { address: "2801:c4:a3:2::5", family: 6 },
    { address: "187.218.53.183", family: 4 },
    { address: "2801:c4:a3:2::6", family: 6 },
  ];

  const buscar = (opciones: dns.LookupOptions, host = "www.correosdemexico.gob.mx") =>
    new Promise<[string | dns.LookupAddress[], number | undefined]>((listo, falla) =>
      buscarIpv4Primero(host, opciones, (error, direccion, familia) =>
        error ? falla(error) : listo([direccion, familia]),
      ),
    );

  it("ordena las direcciones con las IPv4 primero, sin depender de la versión de Node", async () => {
    const espia = vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opciones: dns.LookupAllOptions,
      listo: (error: null, direcciones: dns.LookupAddress[]) => void,
    ) => {
      listo(null, DIRECCIONES);
    }) as unknown as typeof dns.lookup);
    expect(await buscar({ all: true })).toEqual([
      [DIRECCIONES[1], DIRECCIONES[0], DIRECCIONES[2]],
      undefined,
    ]);
    expect(await buscar({ family: 0 })).toEqual(["187.218.53.183", 4]);
    expect(espia).toHaveBeenCalledWith(
      "www.correosdemexico.gob.mx",
      { family: 0, all: true },
      expect.any(Function),
    );
  });

  it("pasa los errores de DNS", async () => {
    const error = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opciones: unknown,
      listo: (e: Error) => void,
    ) => {
      listo(error);
    }) as unknown as typeof dns.lookup);
    await expect(buscar({ all: true })).rejects.toBe(error);
    await expect(buscar({})).rejects.toBe(error);
    vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opciones: unknown,
      listo: (e: null, d: dns.LookupAddress[]) => void,
    ) => {
      listo(null, []);
    }) as unknown as typeof dns.lookup);
    await expect(buscar({})).rejects.toThrow(/ENOTFOUND www\.correosdemexico\.gob\.mx/);
  });

  it("con el resolvedor real da direcciones ordenadas", async () => {
    // localhost lo resuelve el sistema sin consultar un DNS externo: la prueba no sale a la red.
    const [direcciones] = await buscar({ all: true }, "localhost");
    const familias = (direcciones as dns.LookupAddress[]).map((d) => d.family);
    expect(familias.length).toBeGreaterThan(0);
    expect(familias).toEqual([...familias].sort((a, b) => a - b));
  });
});
