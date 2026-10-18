#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { INSTRUCCIONES } from "./protocolo.js";
import { ejecutarStdio } from "./stdio.js";

const paquete = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};
const registrar = (mensaje: string): void => void process.stderr.write(`${mensaje}\n`);
// Los registros son de mejor esfuerzo: si el cliente cierra stderr, el servidor sigue.
process.stderr.on("error", () => {});

const conexion = ejecutarStdio({
  entrada: process.stdin,
  salida: process.stdout,
  registrar,
  info: { name: paquete.name, title: "MéxicoAPI", version: paquete.version },
  instrucciones: INSTRUCCIONES,
  herramientas: [],
});
registrar(`${paquete.name} ${paquete.version}: servidor MCP por stdio`);

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.once(senal, () => {
    conexion.cerrar();
    // Si algo en curso no respeta la cancelación, que no deje el proceso colgado.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

await conexion.terminado;
