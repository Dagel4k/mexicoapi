// Prueba de humo de mexicoapi-mcp instalado desde su .tgz, en JavaScript sin Vitest ni dependencias
// para que corra igual en cada Node que soporta el paquete. Va en la carpeta del proyecto que
// instaló mexicoapi y mexicoapi-mcp y se corre con `node humo.mjs`: lanza el binario instalado
// (node_modules/.bin/mexicoapi-mcp), le habla por stdio (initialize, tools/list y un tools/call) y
// termina con código distinto de 0 si algo falla. No usa la red: sin MEXICOAPI_BASE, el servidor
// responde con los datos del paquete mexicoapi.
import { deepEqual, equal, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const MS_LIMITE = 60_000;
const HERRAMIENTAS = [
  "buscar_municipio",
  "municipio",
  "validar_clabe",
  "banco_por_codigo",
  "validar_rfc",
  "validar_curp",
  "validar_nss",
  "tipo_de_cambio_fix",
  "udis",
  "dias_inhabiles",
  "sumar_dias_habiles",
  "constantes",
  "codigo_postal",
];

const paso = (texto) => process.stdout.write(`humo: ${texto}\n`);
const leerJson = async (ruta) => JSON.parse(await readFile(ruta, "utf8"));

const mcp = await leerJson(join(AQUI, "node_modules", "mexicoapi-mcp", "package.json"));
const sdk = await leerJson(join(AQUI, "node_modules", "mexicoapi", "package.json"));
equal(mcp.dependencies.mexicoapi, `^${sdk.version}`);
// npm usó el mexicoapi del proyecto para la dependencia del servidor: no hay otra copia adentro.
equal(existsSync(join(AQUI, "node_modules", "mexicoapi-mcp", "node_modules", "mexicoapi")), false);
paso(`Node ${process.versions.node}: mexicoapi-mcp ${mcp.version} con mexicoapi ${sdk.version}`);

const lineas = [];
const esperando = [];
let resto = "";
let errores = "";

const entorno = { ...process.env };
delete entorno.MEXICOAPI_BASE;
// En Windows el binario de node_modules/.bin es un .cmd: solo se lanza con shell.
const hijo = spawn(join("node_modules", ".bin", "mexicoapi-mcp"), [], {
  cwd: AQUI,
  env: entorno,
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
});

const vigilante = setTimeout(() => {
  process.stderr.write(`humo: el servidor no respondió en ${MS_LIMITE} ms\n${errores}`);
  hijo.kill();
  process.exit(1);
}, MS_LIMITE);

const avisar = () => {
  for (const despertar of esperando.splice(0)) despertar();
};
hijo.stdout.setEncoding("utf8");
hijo.stdout.on("data", (trozo) => {
  resto += trozo;
  for (let i = resto.indexOf("\n"); i >= 0; i = resto.indexOf("\n")) {
    lineas.push(resto.slice(0, i));
    resto = resto.slice(i + 1);
  }
  avisar();
});
hijo.stderr.setEncoding("utf8");
hijo.stderr.on("data", (trozo) => {
  errores += trozo;
});
const fin = new Promise((resolver) => {
  hijo.on("close", (codigo, senal) => {
    resolver({ codigo, senal });
    avisar();
  });
});

let leidas = 0;
const enviar = (mensaje) => hijo.stdin.write(`${JSON.stringify(mensaje)}\n`);
async function recibir() {
  while (leidas >= lineas.length) {
    if (hijo.exitCode !== null || hijo.signalCode !== null) {
      throw new Error(`el servidor terminó sin responder:\n${errores}`);
    }
    await new Promise((despertar) => esperando.push(despertar));
  }
  return JSON.parse(lineas[leidas++]);
}

enviar({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "humo", version: "1.0.0" },
  },
});
const inicial = await recibir();
equal(inicial.id, 1);
equal(inicial.result.protocolVersion, "2025-11-25");
deepEqual(inicial.result.serverInfo, {
  name: "mexicoapi-mcp",
  title: "MéxicoAPI",
  version: mcp.version,
});
deepEqual(inicial.result.capabilities, { tools: { listChanged: false } });
enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
paso("initialize");

enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const lista = await recibir();
equal(lista.id, 2);
deepEqual(
  lista.result.tools.map((t) => t.name),
  HERRAMIENTAS,
);
for (const herramienta of lista.result.tools) {
  equal(herramienta.annotations.readOnlyHint, true);
  equal(herramienta.outputSchema.type, "object");
}
paso(`tools/list: ${lista.result.tools.length} herramientas`);

enviar({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "validar_clabe", arguments: { clabe: "002010077777777771" } },
});
const llamada = await recibir();
equal(llamada.id, 3);
equal(llamada.result.isError, undefined);
const { structuredContent } = llamada.result;
equal(structuredContent.datos.valido, true);
equal(structuredContent.datos.detalle.banco.nombre_corto, "BANAMEX");
equal(structuredContent.origen, "paquete");
ok(structuredContent.fuente.url.startsWith("https://"));
ok(llamada.result.content[0].text.includes("BANAMEX"));
paso("tools/call validar_clabe");

hijo.stdin.end();
deepEqual(await fin, { codigo: 0, senal: null });
clearTimeout(vigilante);
equal(resto, "");
equal(lineas.length, 3);
for (const linea of lineas) JSON.parse(linea);
ok(errores.includes("datos del paquete, sin red"), errores);
paso("termina con código 0 al cerrar la entrada");

paso("OK");
