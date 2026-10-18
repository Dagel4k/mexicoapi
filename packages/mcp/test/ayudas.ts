import { PassThrough } from "node:stream";
import { expect } from "vitest";
import type { Herramienta } from "../src/herramientas.js";
import type { OpcionesServidor } from "../src/protocolo.js";
import { ejecutarStdio, type OpcionesStdio } from "../src/stdio.js";

/** Herramienta de prueba: devuelve el texto, opcionalmente repetido o en mayúsculas. */
export const eco: Herramienta = {
  name: "eco",
  title: "Eco",
  description: "Devuelve el texto recibido.",
  inputSchema: {
    type: "object",
    properties: {
      texto: { type: "string", minLength: 1, maxLength: 20, description: "Texto a devolver." },
      veces: { type: "integer", minimum: 1, maximum: 3 },
      modo: { type: "string", enum: ["normal", "mayusculas"] },
    },
    required: ["texto"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { texto: { type: "string" } },
    required: ["texto"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  async ejecutar(args) {
    const repetido = String(args.texto).repeat(typeof args.veces === "number" ? args.veces : 1);
    const texto = args.modo === "mayusculas" ? repetido.toUpperCase() : repetido;
    return { content: [{ type: "text", text: texto }], structuredContent: { texto } };
  },
};

/** Lanza una excepción que trae el argumento en el mensaje, para revisar que no se registre. */
export const falla: Herramienta = {
  name: "falla",
  title: "Falla",
  description: "Siempre lanza una excepción.",
  inputSchema: {
    type: "object",
    properties: { dato: { type: "string" } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar(args) {
    throw new TypeError(`no se pudo con ${String(args.dato)}`);
  },
};

/** Responde con un error de negocio (resultado con isError, no excepción). */
export const rechaza: Herramienta = {
  name: "rechaza",
  title: "Rechaza",
  description: "Siempre responde con isError.",
  inputSchema: { type: "object", additionalProperties: false },
  outputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async ejecutar() {
    return { content: [{ type: "text", text: "No hay dato para esa fecha." }], isError: true };
  },
};

/** Devuelve un structuredContent que no cumple su outputSchema. */
export const salidaMala: Herramienta = {
  name: "salida_mala",
  title: "Salida mala",
  description: "Devuelve un resultado que no cumple su esquema de salida.",
  inputSchema: {
    type: "object",
    properties: { caso: { type: "string" } },
    additionalProperties: false,
  },
  outputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar(args) {
    if (args.caso === "sin_structured") return { content: [{ type: "text", text: "n = 1" }] };
    return { content: [{ type: "text", text: "n = 1.5" }], structuredContent: { n: 1.5 } };
  },
};

/** Devuelve algo que ni siquiera tiene la forma de un resultado. */
export const formaMala: Herramienta = {
  name: "forma_mala",
  title: "Forma mala",
  description: "Devuelve un resultado sin content.",
  inputSchema: {
    type: "object",
    properties: { caso: { type: "string" } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar(args) {
    const casos: Record<string, unknown> = {
      nulo: null,
      sin_content: { structuredContent: {} },
      bloque_raro: { content: [{ type: "imagen" }] },
      texto_no_string: { content: [{ type: "text", text: 1 }] },
      structured_lista: { content: [], structuredContent: [] },
      is_error_texto: { content: [], isError: "sí" },
      no_serializable: { content: [], structuredContent: { n: 1n } },
    };
    return casos[String(args.caso)] as never;
  },
};

/** Espera hasta que la cancelen o hasta que la prueba la suelte. */
export function crearLenta(): {
  herramienta: Herramienta;
  soltar: () => void;
  senales: AbortSignal[];
} {
  const senales: AbortSignal[] = [];
  let soltar = (): void => {};
  const herramienta: Herramienta = {
    name: "lenta",
    title: "Lenta",
    description: "Tarda hasta que la sueltan.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    ejecutar(_args, contexto) {
      senales.push(contexto.signal);
      return new Promise((resolver) => {
        soltar = () => resolver({ content: [{ type: "text", text: "listo" }] });
      });
    },
  };
  return { herramienta, soltar: () => soltar(), senales };
}

export const INFO = { name: "mexicoapi-mcp", title: "MéxicoAPI", version: "0.1.0" } as const;

type Conexion = ReturnType<typeof ejecutarStdio>;

export interface Cliente {
  readonly conexion: Conexion;
  readonly entrada: PassThrough;
  readonly salida: PassThrough;
  /** Registros que el servidor mandó a stderr. */
  readonly registros: string[];
  /** Líneas crudas que salieron por stdout. */
  readonly lineas: string[];
  escribir(texto: string | Buffer): void;
  enviar(mensaje: unknown): void;
  recibir(): Promise<Record<string, unknown>>;
  pedir(metodo: string, params?: unknown, id?: string | number): Promise<Record<string, unknown>>;
  inicializar(version?: string): Promise<Record<string, unknown>>;
  /** Comprueba que el mensaje anterior no produjo respuesta: la siguiente es la del ping testigo. */
  sinRespuesta(): Promise<void>;
}

/** Conecta un servidor a flujos en memoria y da un cliente mínimo para hablarle por líneas. */
export function conectar(
  opciones: Partial<OpcionesServidor> & Pick<Partial<OpcionesStdio>, "maxBytesMensaje"> = {},
): Cliente {
  const entrada = new PassThrough();
  const salida = new PassThrough();
  const registros: string[] = [];
  const lineas: string[] = [];
  const pendientes: string[] = [];
  const esperando: Array<() => void> = [];
  let resto = "";
  let siguienteId = 1;
  let testigo = 0;
  salida.on("data", (trozo: Buffer) => {
    resto += trozo.toString("utf8");
    for (let i = resto.indexOf("\n"); i >= 0; i = resto.indexOf("\n")) {
      const linea = resto.slice(0, i);
      resto = resto.slice(i + 1);
      lineas.push(linea);
      pendientes.push(linea);
    }
    for (const avisar of esperando.splice(0)) avisar();
  });
  const conexion = ejecutarStdio({
    entrada,
    salida,
    info: INFO,
    instrucciones: "Instrucciones de prueba.",
    herramientas: [eco, falla, rechaza, salidaMala, formaMala],
    registrar: (mensaje) => registros.push(mensaje),
    ...opciones,
  });
  const cliente: Cliente = {
    conexion,
    entrada,
    salida,
    registros,
    lineas,
    escribir: (texto) => void entrada.write(texto),
    enviar: (mensaje) => void entrada.write(`${JSON.stringify(mensaje)}\n`),
    async recibir() {
      while (pendientes.length === 0) await new Promise<void>((r) => esperando.push(r));
      return JSON.parse(pendientes.shift() as string) as Record<string, unknown>;
    },
    pedir(metodo, params, id) {
      cliente.enviar({
        jsonrpc: "2.0",
        id: id ?? siguienteId++,
        method: metodo,
        ...(params === undefined ? {} : { params }),
      });
      return cliente.recibir();
    },
    inicializar(version = "2025-11-25") {
      const respuesta = cliente.pedir("initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "prueba", version: "1.0.0" },
      });
      cliente.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
      return respuesta;
    },
    async sinRespuesta() {
      const id = `testigo-${++testigo}`;
      expect(await cliente.pedir("ping", undefined, id)).toEqual({
        jsonrpc: "2.0",
        id,
        result: {},
      });
    },
  };
  return cliente;
}
