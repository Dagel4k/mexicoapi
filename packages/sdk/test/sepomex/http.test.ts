// El transporte por omisión contra un servidor local en 127.0.0.1: sin red.
import dns from "node:dns";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SepomexError } from "../../src/sepomex/error.js";
import { buscarIpv4Primero, crearTransporte } from "../../src/sepomex/http.js";

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

const transporte = crearTransporte({ maxBytes: 1000, esperaMs: 2000 });

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
    const r = await transporte(base, { method: "GET", headers: {}, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/error.aspx");
  });

  it("corta una respuesta que pasa del límite", async () => {
    const base = await levantar((_p, _c, respuesta) => {
      respuesta.write(Buffer.alloc(600));
      respuesta.end(Buffer.alloc(600));
    });
    const error = await transporte(base, { method: "GET", headers: {}, redirect: "manual" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SepomexError);
    expect((error as SepomexError).tipo).toBe("archivo-invalido");
    expect((error as SepomexError).message).toMatch(/pasa de 1000 bytes/);
  });

  it("se rinde si el servidor no responde", async () => {
    const base = await levantar(() => {});
    const lento = crearTransporte({ maxBytes: 1000, esperaMs: 100 });
    await expect(lento(base, { method: "GET", headers: {}, redirect: "manual" })).rejects.toThrow(
      /no respondió en 0.1 s/,
    );
  });

  it("rechaza si no se puede conectar", async () => {
    const base = await levantar(() => {});
    const s = servidor as Server;
    servidor = undefined;
    await new Promise((listo) => s.close(listo));
    await expect(
      transporte(base, { method: "GET", headers: {}, redirect: "manual" }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("solo acepta http y https", async () => {
    await expect(
      transporte("ftp://127.0.0.1/x", { method: "GET", headers: {}, redirect: "manual" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("buscarIpv4Primero", () => {
  it("pide las direcciones con las IPv4 primero", async () => {
    const espia = vi.spyOn(dns, "lookup");
    const direcciones = await new Promise<dns.LookupAddress[]>((listo, falla) =>
      buscarIpv4Primero("localhost", { all: true }, (error, resultado) =>
        error ? falla(error) : listo(resultado as dns.LookupAddress[]),
      ),
    );
    expect(espia).toHaveBeenCalledWith(
      "localhost",
      expect.objectContaining({ all: true, order: "ipv4first" }),
      expect.any(Function),
    );
    expect(direcciones.length).toBeGreaterThan(0);
    const familias = direcciones.map((d) => d.family);
    expect(familias).toEqual([...familias].sort((a, b) => a - b));
  });
});
