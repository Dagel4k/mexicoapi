import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RAIZ = new URL("../../", import.meta.url);
const BINARIO = fileURLToPath(new URL("dist/index.js", RAIZ));
const SERVIDOR_PRUEBA = fileURLToPath(
  new URL("test/integracion/fixtures/servidor-repite.mjs", RAIZ),
);
const PAQUETE = JSON.parse(readFileSync(new URL("package.json", RAIZ), "utf8")) as {
  name: string;
  version: string;
};

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "prueba", version: "1.0.0" },
  },
};

// Caché de SEPOMEX vacía para el binario: nunca la del equipo.
const CACHE_VACIA = mkdtempSync(join(tmpdir(), "mexicoapi-mcp-integracion-"));

afterAll(() => {
  rmSync(CACHE_VACIA, { recursive: true, force: true });
});

beforeAll(() => {
  if (!existsSync(BINARIO)) {
    throw new Error(
      "Falta dist/index.js: corre `pnpm -r build` antes de las pruebas de integración.",
    );
  }
});

/**
 * Lanza un proceso de Node y le habla por stdin/stdout reales, una línea JSON por mensaje. Sin
 * MEXICOAPI_BASE y sin red (MEXICOAPI_SIN_RED=1: sin base usaría la API pública), salvo que `env`
 * traiga una base, y con la caché de SEPOMEX en un directorio vacío.
 */
function lanzar(archivo: string, env: Record<string, string> = {}) {
  const entorno: Record<string, string | undefined> = {
    ...process.env,
    LOCALAPPDATA: CACHE_VACIA,
    XDG_CACHE_HOME: CACHE_VACIA,
    MEXICOAPI_SIN_RED: env.MEXICOAPI_BASE === undefined ? "1" : "",
    ...env,
  };
  if (env.MEXICOAPI_BASE === undefined) delete entorno.MEXICOAPI_BASE;
  const hijo = spawn(process.execPath, [archivo], {
    stdio: ["pipe", "pipe", "pipe"],
    env: entorno,
  });
  const lineas: string[] = [];
  const pendientes: string[] = [];
  const esperando: Array<() => void> = [];
  let resto = "";
  let errores = "";
  hijo.stdout.setEncoding("utf8");
  hijo.stderr.setEncoding("utf8");
  hijo.stdout.on("data", (trozo: string) => {
    resto += trozo;
    for (let i = resto.indexOf("\n"); i >= 0; i = resto.indexOf("\n")) {
      lineas.push(resto.slice(0, i));
      pendientes.push(resto.slice(0, i));
      resto = resto.slice(i + 1);
    }
    for (const avisar of esperando.splice(0)) avisar();
  });
  hijo.stderr.on("data", (trozo: string) => {
    errores += trozo;
  });
  const fin = new Promise<{ codigo: number | null; senal: NodeJS.Signals | null }>((resolver) => {
    hijo.on("close", (codigo, senal) => resolver({ codigo, senal }));
  });
  return {
    hijo,
    lineas,
    fin,
    errores: () => errores,
    resto: () => resto,
    enviar(mensaje: unknown) {
      hijo.stdin.write(`${typeof mensaje === "string" ? mensaje : JSON.stringify(mensaje)}\n`);
    },
    async recibir(): Promise<Record<string, unknown>> {
      while (pendientes.length === 0) await new Promise<void>((r) => esperando.push(r));
      return JSON.parse(pendientes.shift() as string) as Record<string, unknown>;
    },
  };
}

describe("binario por stdio real", () => {
  it("negocia, lista, llama y termina limpio con EOF", async () => {
    const proceso = lanzar(BINARIO);
    proceso.enviar(INITIALIZE);
    const inicial = await proceso.recibir();
    expect(inicial).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: PAQUETE.name, title: "MéxicoAPI", version: PAQUETE.version },
      },
    });
    expect((inicial.result as { instructions: string }).instructions).toMatch(/as_of/);
    proceso.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });

    proceso.enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const lista = await proceso.recibir();
    expect(Array.isArray((lista.result as { tools: unknown }).tools)).toBe(true);

    proceso.enviar({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "no_existe", arguments: { dato: "SECRETO-XYZ" } },
    });
    expect(await proceso.recibir()).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602, message: "Herramienta desconocida: no_existe" },
    });

    proceso.enviar("{ esto no es json");
    expect((await proceso.recibir()).error).toMatchObject({ code: -32700 });
    proceso.enviar({ jsonrpc: "2.0", id: 4, method: "ping" });
    expect(await proceso.recibir()).toEqual({ jsonrpc: "2.0", id: 4, result: {} });

    proceso.hijo.stdin.end();
    expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
    expect(proceso.resto()).toBe("");
    for (const linea of proceso.lineas) expect(() => JSON.parse(linea)).not.toThrow();
    expect(proceso.errores()).not.toContain("SECRETO");
  });

  it.skipIf(process.platform === "win32").each(["SIGTERM", "SIGINT"] as const)(
    "termina limpio con %s",
    async (senal) => {
      const proceso = lanzar(BINARIO);
      proceso.enviar(INITIALIZE);
      await proceso.recibir();
      proceso.hijo.kill(senal);
      expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
    },
  );
});

/** Inicia una sesión con el binario y devuelve cómo llamar herramientas. */
async function sesion(env: Record<string, string> = {}) {
  const proceso = lanzar(BINARIO, env);
  proceso.enviar(INITIALIZE);
  await proceso.recibir();
  proceso.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
  let id = 10;
  return {
    proceso,
    async llamar(name: string, args: Record<string, unknown>) {
      proceso.enviar({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const respuesta = await proceso.recibir();
      expect(respuesta.error).toBeUndefined();
      return respuesta.result as {
        content: Array<{ text: string }>;
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
    },
    async terminar() {
      proceso.hijo.stdin.end();
      expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
      for (const linea of proceso.lineas) expect(() => JSON.parse(linea)).not.toThrow();
    },
  };
}

describe("herramientas en el binario compilado", () => {
  it("publica las 15 herramientas y responde con mexicoapi compilado, sin red", async () => {
    const s = await sesion();
    s.proceso.enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const lista = (await s.proceso.recibir()).result as { tools: Array<{ name: string }> };
    expect(lista.tools).toHaveLength(15);
    const clabe = await s.llamar("validar_clabe", { clabe: "002010077777777771" });
    expect(clabe.structuredContent).toMatchObject({
      datos: { valido: true, detalle: { banco: { nombre_corto: "BANAMEX" } } },
      origen: "paquete",
    });
    const fix = await s.llamar("tipo_de_cambio_fix", { publicado: "2026-10-12" });
    expect(fix.structuredContent).toMatchObject({ datos: { valor: "18.4163" }, origen: "paquete" });
    // La publicación más reciente del paquete puede no ser la última: lo advierte una vez. Cambio:
    // es el aviso del núcleo que también da el cliente (antes nombraba MEXICOAPI_SIN_RED=1).
    const ultimo = await s.llamar("tipo_de_cambio_fix", {});
    expect(ultimo.structuredContent).toMatchObject({
      origen: "paquete",
      advertencias: [expect.stringContaining("pueden faltar publicaciones recientes")],
    });
    const inhabil = await s.llamar("sumar_dias_habiles", {
      autoridad: "sat",
      tipo_plazo: "general",
      desde: "2026-07-17",
      dias: 3,
    });
    expect(inhabil.structuredContent).toMatchObject({ datos: { resultado: "2026-08-05" } });
    const cp = await s.llamar("codigo_postal", { cp: "80000" });
    expect(cp.isError).toBe(true);
    expect(cp.content[0]?.text).toContain("npx mexicoapi sepomex sync");
    expect(cp.content[0]?.text).not.toContain(CACHE_VACIA);
    await s.terminar();
    expect(s.proceso.errores()).toContain("datos del paquete, sin red");
  });

  it("con MEXICOAPI_BASE que no responde, usa el paquete y lo advierte", async () => {
    // Un puerto local cerrado: la conexión se rechaza enseguida, sin salir del equipo.
    const s = await sesion({ MEXICOAPI_BASE: "http://127.0.0.1:9" });
    const udi = await s.llamar("udis", { fecha: "2026-10-01" });
    expect(udi.structuredContent).toMatchObject({
      datos: { valor: "8.836029" },
      origen: "paquete",
    });
    const advertencias = udi.structuredContent?.advertencias as string[];
    expect(advertencias[0]).toMatch(/^Respuesta de los datos del paquete porque la API falló/);
    await s.terminar();
    expect(s.proceso.errores()).toContain("consulta la API de MEXICOAPI_BASE");
  }, 30_000);

  it("una MEXICOAPI_BASE inválida sale con código 2 sin repetir la base", async () => {
    const proceso = lanzar(BINARIO, {
      MEXICOAPI_BASE: "https://usuario:CLAVE-SECRETA@api.example",
    });
    expect(await proceso.fin).toEqual({ codigo: 2, senal: null });
    expect(proceso.lineas).toEqual([]);
    expect(proceso.errores()).toContain("MEXICOAPI_BASE no es válida");
    expect(proceso.errores()).not.toContain("CLAVE-SECRETA");
  });

  it("un MEXICOAPI_SIN_RED que no se reconoce sale con código 2 y dice qué valores acepta", async () => {
    const proceso = lanzar(BINARIO, { MEXICOAPI_SIN_RED: "verdadero" });
    expect(await proceso.fin).toEqual({ codigo: 2, senal: null });
    expect(proceso.lineas).toEqual([]);
    expect(proceso.errores()).toContain("mexicoapi-mcp: MEXICOAPI_SIN_RED no es válida: usa 1,");
    expect(proceso.errores()).not.toContain("verdadero");
  });
});

describe("servidor con herramientas de prueba por stdio real", () => {
  it("con EOF termina aunque una herramienta ignore la cancelación", async () => {
    const proceso = lanzar(SERVIDOR_PRUEBA);
    proceso.enviar(INITIALIZE);
    await proceso.recibir();
    proceso.enviar({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "eterna" } });
    proceso.enviar({ jsonrpc: "2.0", id: 10, method: "ping" });
    expect(await proceso.recibir()).toEqual({ jsonrpc: "2.0", id: 10, result: {} });
    const inicio = Date.now();
    proceso.hijo.stdin.end();
    expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
    // 300 ms de gracia más 2 s de salida forzada, con holgura; nunca el minuto de la herramienta.
    expect(Date.now() - inicio).toBeLessThan(15_000);
    expect(proceso.lineas.join("\n")).not.toContain('"id":9');
    expect(proceso.errores()).toContain("lo pendiente no terminó en 300 ms; se cancela");
  }, 30_000);

  it("lo que una herramienta escribe con console va a stderr, no a stdout", async () => {
    const proceso = lanzar(SERVIDOR_PRUEBA);
    proceso.enviar(INITIALIZE);
    await proceso.recibir();
    proceso.enviar({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ruidosa" } });
    expect((await proceso.recibir()).result).toEqual({
      content: [{ type: "text", text: "listo" }],
    });
    proceso.hijo.stdin.end();
    expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
    for (const linea of proceso.lineas) expect(() => JSON.parse(linea)).not.toThrow();
    for (const texto of ["ruido log", "ruido info", "ruido debug", "dir", "tabla"]) {
      expect(proceso.errores()).toContain(texto);
    }
  });

  it("responde tools/call completo aunque la entrada se cierre enseguida", async () => {
    const proceso = lanzar(SERVIDOR_PRUEBA);
    proceso.enviar(INITIALIZE);
    await proceso.recibir();
    proceso.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
    proceso.enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const lista = await proceso.recibir();
    expect((lista.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual([
      "repite",
      "eterna",
      "ruidosa",
    ]);
    proceso.enviar({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "repite", arguments: { n: 0 } },
    });
    expect((await proceso.recibir()).result).toEqual({
      content: [
        {
          type: "text",
          text: '[parametro-invalido] Argumentos inválidos para repite: "n" debe ser mayor o igual a 1',
        },
      ],
      isError: true,
    });
    proceso.enviar({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "repite", arguments: { n: 1_500_000 } },
    });
    proceso.hijo.stdin.end();
    const llamada = await proceso.recibir();
    expect(llamada.id).toBe(4);
    const resultado = llamada.result as {
      content: Array<{ text: string }>;
      structuredContent: unknown;
    };
    expect(resultado.content[0]?.text).toHaveLength(1_500_000);
    expect(resultado.structuredContent).toEqual({ largo: 1_500_000 });
    expect(await proceso.fin).toEqual({ codigo: 0, senal: null });
  });
});
