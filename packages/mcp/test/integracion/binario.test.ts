import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

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

beforeAll(() => {
  if (!existsSync(BINARIO)) {
    throw new Error(
      "Falta dist/index.js: corre `pnpm -r build` antes de las pruebas de integración.",
    );
  }
});

/** Lanza un proceso de Node y le habla por stdin/stdout reales, una línea JSON por mensaje. */
function lanzar(archivo: string) {
  const hijo = spawn(process.execPath, [archivo], { stdio: ["pipe", "pipe", "pipe"] });
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

describe("servidor con herramienta por stdio real", () => {
  it("responde tools/call completo aunque la entrada se cierre enseguida", async () => {
    const proceso = lanzar(SERVIDOR_PRUEBA);
    proceso.enviar(INITIALIZE);
    await proceso.recibir();
    proceso.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
    proceso.enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const lista = await proceso.recibir();
    expect((lista.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual([
      "repite",
    ]);
    proceso.enviar({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "repite", arguments: { n: 0 } },
    });
    expect((await proceso.recibir()).result).toEqual({
      content: [
        { type: "text", text: 'Argumentos inválidos para repite: "n" debe ser mayor o igual a 1' },
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
