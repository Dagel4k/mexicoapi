import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ERROR_PARSEO, SOLICITUD_INVALIDA } from "../src/protocolo.js";
import { ejecutarStdio, MAX_BYTES_MENSAJE } from "../src/stdio.js";
import { conectar, crearLenta, INFO } from "./ayudas.js";

const PING = '{"jsonrpc":"2.0","id":"p","method":"ping"}';
const OK_PING = { jsonrpc: "2.0", id: "p", result: {} };

describe("lectura por líneas", () => {
  it("rearma un mensaje que llega en trozos, aunque corte un carácter UTF-8", async () => {
    const cliente = conectar();
    await cliente.inicializar();
    const bytes = Buffer.from(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "eco", arguments: { texto: "ñandú ☃" } } })}\n`,
    );
    for (const byte of bytes) cliente.escribir(Buffer.from([byte]));
    expect((await cliente.recibir()).result).toEqual({
      content: [{ type: "text", text: "ñandú ☃" }],
      structuredContent: { texto: "ñandú ☃" },
    });
  });

  it("atiende varios mensajes que llegan en un solo trozo", async () => {
    const cliente = conectar();
    cliente.escribir(`${PING.replace('"p"', '"a"')}\n${PING.replace('"p"', '"b"')}\n`);
    expect((await cliente.recibir()).id).toBe("a");
    expect((await cliente.recibir()).id).toBe("b");
  });

  it("acepta fin de línea CRLF", async () => {
    const cliente = conectar();
    cliente.escribir(`${PING}\r\n`);
    expect(await cliente.recibir()).toEqual(OK_PING);
  });

  it("ignora líneas vacías o de solo espacios sin responder", async () => {
    const cliente = conectar();
    cliente.escribir("\n\n   \n\t\r\n");
    await cliente.sinRespuesta();
    expect(cliente.lineas).toHaveLength(1);
  });

  it("acepta trozos de texto si la entrada ya decodifica", async () => {
    const cliente = conectar();
    cliente.entrada.setEncoding("utf8");
    cliente.escribir(`${PING}\n`);
    expect(await cliente.recibir()).toEqual(OK_PING);
  });

  it("UTF-8 inválido da Parse error y el proceso sigue", async () => {
    const cliente = conectar();
    cliente.escribir(
      Buffer.concat([
        Buffer.from('{"jsonrpc":"2.0","id":1,"method":"'),
        Buffer.from([0xff, 0xfe]),
        Buffer.from('"}\n'),
      ]),
    );
    expect(await cliente.recibir()).toEqual({
      jsonrpc: "2.0",
      error: { code: ERROR_PARSEO, message: "El mensaje no es UTF-8 válido" },
    });
    await cliente.sinRespuesta();
  });

  it("cada respuesta sale en una sola línea JSON, aunque el texto traiga saltos", async () => {
    const cliente = conectar();
    await cliente.inicializar();
    await cliente.pedir("tools/call", { name: "eco", arguments: { texto: "a\nb\r\nc " } });
    for (const linea of cliente.lineas) {
      expect(linea).not.toMatch(/[\r\n]/);
      expect(() => JSON.parse(linea)).not.toThrow();
    }
    expect(cliente.salida.readableLength).toBe(0);
  });
});

describe("tope de tamaño por mensaje", () => {
  it("es de 1 MiB por omisión", () => {
    expect(MAX_BYTES_MENSAJE).toBe(1024 * 1024);
  });

  it("un mensaje más grande da Invalid Request con id null y se descarta completo", async () => {
    const cliente = conectar({ maxBytesMensaje: 64 });
    const grande = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { x: "y".repeat(200) },
    });
    // Llega en trozos, sin salto, y luego el salto junto con el siguiente mensaje.
    cliente.escribir(grande.slice(0, 50));
    cliente.escribir(grande.slice(50, 120));
    cliente.escribir(grande.slice(120));
    cliente.escribir(`\n${PING}\n`);
    expect(await cliente.recibir()).toEqual({
      jsonrpc: "2.0",
      error: { code: SOLICITUD_INVALIDA, message: "El mensaje pasa de 64 bytes" },
    });
    expect(await cliente.recibir()).toEqual(OK_PING);
    expect(cliente.lineas).toHaveLength(2);
    expect(cliente.registros).toContain("mexicoapi-mcp: se descartó un mensaje de más de 64 bytes");
  });

  it("un mensaje grande que llega en un solo trozo con salto también se rechaza", async () => {
    const cliente = conectar({ maxBytesMensaje: 64 });
    cliente.escribir(`${"x".repeat(65)}\n${PING}\n`);
    expect((await cliente.recibir()).error).toEqual({
      code: SOLICITUD_INVALIDA,
      message: "El mensaje pasa de 64 bytes",
    });
    expect(await cliente.recibir()).toEqual(OK_PING);
  });

  it("un mensaje que se pasa del tope justo al llegar su salto también se rechaza", async () => {
    const cliente = conectar({ maxBytesMensaje: 64 });
    cliente.escribir("x".repeat(40));
    cliente.escribir(`${"x".repeat(40)}\n${PING}\n`);
    expect((await cliente.recibir()).error).toEqual({
      code: SOLICITUD_INVALIDA,
      message: "El mensaje pasa de 64 bytes",
    });
    expect(await cliente.recibir()).toEqual(OK_PING);
  });

  it("acepta un mensaje justo en el tope, contando bytes y sin contar el CR", async () => {
    const relleno = 64 - Buffer.byteLength(PING.replace('"ping"', '"ping","params":{"x":""}'));
    const justo = PING.replace('"ping"', `"ping","params":{"x":"${"é".repeat(relleno / 2)}"}`);
    expect(Buffer.byteLength(justo)).toBe(64);
    const cliente = conectar({ maxBytesMensaje: 64 });
    cliente.escribir(`${justo}\r\n`);
    expect(await cliente.recibir()).toEqual(OK_PING);
    cliente.escribir(`${justo.replace('"x":"', '"x":"a')}\n`);
    expect((await cliente.recibir()).error).toMatchObject({ code: SOLICITUD_INVALIDA });
  });
});

describe("contrapresión", () => {
  it("deja de leer mientras la salida está llena y sigue con drain", async () => {
    const entrada = new PassThrough();
    const escritas: string[] = [];
    const pendientes: Array<() => void> = [];
    const salida = new Writable({
      highWaterMark: 1,
      write(trozo: Buffer, _codificacion, listo) {
        escritas.push(trozo.toString("utf8"));
        pendientes.push(listo);
      },
    });
    ejecutarStdio({ entrada, salida, info: INFO, instrucciones: "x", herramientas: [] });
    entrada.write(`${PING}\n`);
    await vi.waitFor(() => expect(escritas).toHaveLength(1));
    expect(entrada.isPaused()).toBe(true);
    entrada.write(`${PING.replace('"p"', '"q"')}\n`);
    await new Promise((r) => setImmediate(r));
    expect(escritas).toHaveLength(1);
    pendientes.shift()?.();
    await vi.waitFor(() => expect(escritas).toHaveLength(2));
    expect(JSON.parse(escritas[1] as string)).toEqual({ ...OK_PING, id: "q" });
  });

  it("no reanuda la lectura si la conexión se cerró mientras esperaba", async () => {
    const entrada = new PassThrough();
    const pendientes: Array<() => void> = [];
    const salida = new Writable({
      highWaterMark: 1,
      write(_trozo, _codificacion, listo) {
        pendientes.push(listo);
      },
    });
    const conexion = ejecutarStdio({
      entrada,
      salida,
      info: INFO,
      instrucciones: "x",
      herramientas: [],
    });
    entrada.write(`${PING}\n`);
    await vi.waitFor(() => expect(pendientes).toHaveLength(1));
    conexion.cerrar();
    pendientes.shift()?.();
    await new Promise((r) => setImmediate(r));
    expect(entrada.destroyed).toBe(true);
    expect(entrada.isPaused()).toBe(true);
  });
});

describe("fin de la entrada y cierre", () => {
  it("con EOF atiende la última línea sin salto, espera lo pendiente y termina", async () => {
    const lenta = crearLenta();
    const cliente = conectar({ herramientas: [lenta.herramienta] });
    await cliente.inicializar();
    cliente.escribir(
      '{"jsonrpc":"2.0","id":"l","method":"tools/call","params":{"name":"lenta"}}\n',
    );
    cliente.escribir(PING);
    cliente.entrada.end();
    expect(await cliente.recibir()).toEqual(OK_PING);
    let termino = false;
    void cliente.conexion.terminado.then(() => {
      termino = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(termino).toBe(false);
    lenta.soltar();
    await cliente.conexion.terminado;
    expect(await cliente.recibir()).toMatchObject({
      id: "l",
      result: { content: [{ text: "listo" }] },
    });
    expect(lenta.senales[0]?.aborted).toBe(false);
  });

  it("con EOF y solo espacios pendientes termina sin escribir", async () => {
    const cliente = conectar();
    cliente.escribir("  ");
    cliente.entrada.end();
    await cliente.conexion.terminado;
    expect(cliente.lineas).toEqual([]);
  });

  it("cerrar aborta lo que está en curso, deja de leer y no escribe más", async () => {
    const lenta = crearLenta();
    const cliente = conectar({ herramientas: [lenta.herramienta] });
    await cliente.inicializar();
    cliente.escribir(
      '{"jsonrpc":"2.0","id":"l","method":"tools/call","params":{"name":"lenta"}}\n',
    );
    await cliente.sinRespuesta();
    const antes = cliente.lineas.length;
    cliente.conexion.cerrar();
    cliente.conexion.cerrar();
    await cliente.conexion.terminado;
    expect(lenta.senales[0]?.aborted).toBe(true);
    expect(cliente.entrada.destroyed).toBe(true);
    lenta.soltar();
    await new Promise((r) => setImmediate(r));
    expect(cliente.lineas).toHaveLength(antes);
  });

  it("un error al escribir en la salida cierra la conexión", async () => {
    const cliente = conectar();
    cliente.salida.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    await cliente.conexion.terminado;
    expect(cliente.entrada.destroyed).toBe(true);
    expect(cliente.registros).toContain("mexicoapi-mcp: la salida se cerró (EPIPE); terminando");
  });

  it("un error al leer la entrada cierra la conexión", async () => {
    const cliente = conectar();
    cliente.entrada.destroy(new Error("lectura"));
    await cliente.conexion.terminado;
    expect(cliente.registros).toContain("mexicoapi-mcp: error al leer la entrada; terminando");
  });

  it("no escribe si la salida ya terminó", async () => {
    const cliente = conectar();
    cliente.salida.end();
    cliente.escribir(`${PING}\n`);
    cliente.entrada.end();
    await cliente.conexion.terminado;
    expect(cliente.lineas).toEqual([]);
  });
});
