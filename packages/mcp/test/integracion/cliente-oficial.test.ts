// Interoperabilidad: el binario compilado (`node dist/index.js`) con el cliente oficial de MCP
// (@modelcontextprotocol/sdk, solo de desarrollo) por stdio real. El cliente negocia la versión,
// lista las herramientas y llama cada una; con el outputSchema que publicó cada herramienta valida
// structuredContent (Ajv con formatos) y rechaza la respuesta que no lo cumple. Lo que el cliente no
// puede asociar a un pedido (una línea que no es JSON, un id desconocido) va a su onerror, que debe
// quedar vacío.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type CallToolResult,
  type JSONRPCMessage,
  LATEST_PROTOCOL_VERSION,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { directorioTemporal, guardarCatalogo } from "../ayudas-sepomex.js";

const RAIZ = new URL("../../", import.meta.url);
const BINARIO = fileURLToPath(new URL("dist/index.js", RAIZ));
const PAQUETE = JSON.parse(readFileSync(new URL("package.json", RAIZ), "utf8")) as {
  name: string;
  version: string;
};

// Caché de SEPOMEX vacía para el binario: nunca la del equipo.
const CACHE_VACIA = mkdtempSync(join(tmpdir(), "mexicoapi-mcp-cliente-oficial-"));

/** Argumentos válidos para cada herramienta, sin red. */
const LLAMADAS: Record<string, Record<string, unknown>> = {
  buscar_municipio: { texto: "culiacan" },
  municipio: { cvegeo: "25006" },
  validar_clabe: { clabe: "002010077777777771" },
  banco_por_codigo: { codigo: "002" },
  validar_rfc: { rfc: "XAXX010101000" },
  validar_curp: { curp: "HEGG560427MVZRRL04" },
  validar_nss: { nss: "12345678903" },
  tipo_de_cambio_fix: { publicado: "2026-10-12" },
  udis: { fecha: "2026-10-01" },
  dias_inhabiles: { autoridad: "lft", anio: 2026 },
  sumar_dias_habiles: { autoridad: "sat", tipo_plazo: "general", desde: "2026-07-17", dias: 3 },
  constantes: { tipo: "uma", anio: 2026 },
  codigo_postal: { cp: "80000" },
};

/** Lo que cada llamada de LLAMADAS debe traer en `datos`, para saber que respondió lo pedido. */
const DATOS: Record<string, unknown> = {
  buscar_municipio: expect.arrayContaining([expect.objectContaining({ cvegeo: "25006" })]),
  municipio: expect.objectContaining({ cvegeo: "25006", nombre: "Culiacán" }),
  validar_clabe: expect.objectContaining({ valido: true }),
  banco_por_codigo: expect.objectContaining({ codigo: "002", nombre_corto: "BANAMEX" }),
  validar_rfc: expect.objectContaining({ valido: true }),
  validar_curp: expect.objectContaining({ valido: true }),
  validar_nss: expect.objectContaining({ valido: true }),
  tipo_de_cambio_fix: expect.objectContaining({ valor: "18.4163" }),
  udis: expect.objectContaining({ valor: "8.836029" }),
  dias_inhabiles: expect.arrayContaining([expect.objectContaining({ fecha: "2026-11-16" })]),
  sumar_dias_habiles: expect.objectContaining({ resultado: "2026-08-05" }),
  constantes: expect.objectContaining({ anio: 2026 }),
};

beforeAll(() => {
  if (!existsSync(BINARIO)) {
    throw new Error(
      "Falta dist/index.js: corre `pnpm -r build` antes de las pruebas de integración.",
    );
  }
});

afterAll(() => {
  rmSync(CACHE_VACIA, { recursive: true, force: true });
});

/** Lo que los clientes de la prueba en curso recibieron en onerror. */
let erroresCliente: Error[] = [];

afterEach(() => {
  const errores = erroresCliente;
  erroresCliente = [];
  expect(errores.map((e) => e.message)).toEqual([]);
});

/**
 * El transporte stdio del cliente oficial con el binario. El entorno es el mínimo que hereda el
 * transporte (sin MEXICOAPI_BASE) más MEXICOAPI_SIN_RED=1, para no usar la API pública, y `cache`
 * como base de la caché de SEPOMEX (por omisión, un directorio vacío): el binario la busca en
 * `<cache>/mexicoapi/sepomex`.
 */
function transporteStdio(cache = CACHE_VACIA): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: [BINARIO],
    env: { LOCALAPPDATA: cache, XDG_CACHE_HOME: cache, MEXICOAPI_SIN_RED: "1" },
    stderr: "pipe",
  });
}

/** Un transporte que deja pasar todo y cambia con `alterar` lo que llega del servidor. */
class TransporteAlterado implements Transport {
  onclose?: NonNullable<Transport["onclose"]>;
  onerror?: NonNullable<Transport["onerror"]>;
  onmessage?: NonNullable<Transport["onmessage"]>;
  readonly #base: Transport;
  readonly #alterar: (mensaje: JSONRPCMessage) => JSONRPCMessage;

  constructor(base: Transport, alterar: (mensaje: JSONRPCMessage) => JSONRPCMessage) {
    this.#base = base;
    this.#alterar = alterar;
  }

  start(): Promise<void> {
    this.#base.onmessage = (mensaje) => this.onmessage?.(this.#alterar(mensaje));
    this.#base.onclose = () => this.onclose?.();
    this.#base.onerror = (error) => this.onerror?.(error);
    return this.#base.start();
  }

  send(mensaje: JSONRPCMessage): Promise<void> {
    return this.#base.send(mensaje);
  }

  close(): Promise<void> {
    return this.#base.close();
  }
}

async function conectar(transporte: Transport = transporteStdio()): Promise<Client> {
  const cliente = new Client({ name: "prueba-interoperabilidad", version: "1.0.0" });
  cliente.onerror = (error) => erroresCliente.push(error);
  await cliente.connect(transporte);
  return cliente;
}

describe("binario con el cliente oficial de MCP", () => {
  it("negocia la versión más reciente y publica sus datos", async () => {
    const transporte = transporteStdio();
    let errores = "";
    transporte.stderr?.on("data", (trozo: Buffer) => {
      errores += trozo.toString("utf8");
    });
    const cliente = await conectar(transporte);
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(cliente.getServerVersion()).toEqual({
      name: PAQUETE.name,
      title: "MéxicoAPI",
      version: PAQUETE.version,
    });
    expect(cliente.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
    expect(cliente.getInstructions()).toMatch(/as_of/);
    expect(await cliente.ping()).toEqual({});
    await cliente.close();
    expect(errores).toContain(`sesión iniciada (protocolo ${LATEST_PROTOCOL_VERSION})`);
    expect(errores).toContain("datos del paquete, sin red");
  });

  it("lista las 13 herramientas, de solo lectura y con outputSchema", async () => {
    const cliente = await conectar();
    const { tools, nextCursor } = await cliente.listTools();
    expect(nextCursor).toBeUndefined();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(LLAMADAS).sort());
    for (const herramienta of tools) {
      expect(herramienta.title, herramienta.name).toEqual(expect.any(String));
      expect(herramienta.annotations?.readOnlyHint, herramienta.name).toBe(true);
      expect(herramienta.inputSchema.type, herramienta.name).toBe("object");
      expect(herramienta.outputSchema?.type, herramienta.name).toBe("object");
    }
    await cliente.close();
  });

  it("llama cada herramienta y cada structuredContent cumple su outputSchema", async () => {
    const cliente = await conectar();
    // listTools guarda en el cliente el validador de cada outputSchema; callTool lo aplica.
    const { tools } = await cliente.listTools();
    const conEsquema = tools.filter((t: Tool) => t.outputSchema !== undefined);
    expect(conEsquema).toHaveLength(13);
    for (const [nombre, args] of Object.entries(LLAMADAS)) {
      const resultado = (await cliente.callTool({
        name: nombre,
        arguments: args,
      })) as CallToolResult;
      expect(resultado.content[0]?.type, nombre).toBe("text");
      if (nombre === "codigo_postal") {
        // Sin catálogo descargado: error de la herramienta que dice cómo descargarlo.
        expect(resultado.isError).toBe(true);
        expect(resultado.content[0]).toMatchObject({
          text: expect.stringContaining("npx mexicoapi sepomex sync"),
        });
        continue;
      }
      expect(resultado.isError, nombre).toBeFalsy();
      expect(resultado.structuredContent, nombre).toMatchObject({
        datos: DATOS[nombre],
        fuente: { nombre: expect.any(String), url: expect.stringMatching(/^https:\/\//) },
        origen: "paquete",
        advertencias: expect.any(Array),
      });
      expect(resultado.structuredContent, nombre).toHaveProperty("as_of");
    }
    await cliente.close();
  });

  it("con un catálogo descargado, codigo_postal responde de la caché y cumple su outputSchema", async () => {
    const temporal = await directorioTemporal();
    try {
      await guardarCatalogo(temporal.trabajo, join(temporal.trabajo, "mexicoapi", "sepomex"));
      const cliente = await conectar(transporteStdio(temporal.trabajo));
      await cliente.listTools();
      const resultado = (await cliente.callTool({
        name: "codigo_postal",
        arguments: LLAMADAS.codigo_postal,
      })) as CallToolResult;
      expect(resultado.isError).toBeFalsy();
      expect(resultado.structuredContent).toMatchObject({
        datos: {
          cp: "80000",
          municipio: expect.objectContaining({ cvegeo: "25006" }),
          asentamientos: [expect.objectContaining({ nombre: "Centro de Prueba" })],
        },
        // Importado de un archivo: Correos de México no dio la fecha de corte.
        as_of: null,
        descargado: expect.any(String),
        aviso: expect.stringContaining("Correos de México"),
        origen: "cache_local",
      });
      await cliente.close();
    } finally {
      await temporal.borrar();
    }
  });

  it("onerror recoge lo que el cliente no puede asociar a un pedido", async () => {
    // Comprueba que el afterEach vería un error: se inyecta una respuesta con un id que nadie pidió.
    const transporte = new TransporteAlterado(transporteStdio(), (mensaje) => mensaje);
    const cliente = await conectar(transporte);
    transporte.onmessage?.({ jsonrpc: "2.0", id: 999_999, result: {} });
    expect(erroresCliente).toHaveLength(1);
    erroresCliente = [];
    await cliente.close();
  });

  it("el cliente rechaza un structuredContent que no cumple el outputSchema publicado", async () => {
    // El servidor nunca responde así (valida su salida); se altera la respuesta en el camino para
    // comprobar que esta prueba fallaría si una herramienta no cumpliera su esquema.
    let idLlamada: unknown;
    const transporte = new TransporteAlterado(transporteStdio(), (mensaje) => {
      if (!("id" in mensaje) || mensaje.id !== idLlamada || !("result" in mensaje)) return mensaje;
      const resultado = mensaje.result as CallToolResult;
      return {
        ...mensaje,
        result: { ...resultado, structuredContent: { ...resultado.structuredContent, as_of: 1 } },
      };
    });
    const cliente = await conectar(transporte);
    await cliente.listTools();
    const original = transporte.send.bind(transporte);
    transporte.send = (mensaje) => {
      if ("method" in mensaje && mensaje.method === "tools/call" && "id" in mensaje) {
        idLlamada = mensaje.id;
      }
      return original(mensaje);
    };
    const llamada = cliente.callTool({ name: "udis", arguments: LLAMADAS.udis });
    await expect(llamada).rejects.toThrow(McpError);
    await expect(llamada).rejects.toThrow(/output schema/);
    await cliente.close();
  });
});
