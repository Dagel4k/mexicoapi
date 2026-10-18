#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { arrancar } from "./binario.js";
import { crearHerramientas } from "./catalogo.js";
import { type Configuracion, configurar } from "./configuracion.js";
import { INSTRUCCIONES } from "./protocolo.js";

const paquete = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};

let configuracion: Configuracion | undefined;
try {
  configuracion = configurar(process.env);
} catch (error) {
  // Sin process.exit: así stderr termina de escribirse. Nada más mantiene vivo el proceso.
  process.stderr.write(`${paquete.name}: ${(error as Error).message}\n`);
  process.exitCode = 2;
}

if (configuracion !== undefined) {
  // Nunca se registra la base: podría traer un token en la ruta.
  const modo = configuracion.conApi
    ? "consulta la API de MEXICOAPI_BASE"
    : "datos del paquete, sin red";
  process.stderr.write(`${paquete.name}: ${modo}\n`);
  await arrancar({
    info: { name: paquete.name, title: "MéxicoAPI", version: paquete.version },
    instrucciones: INSTRUCCIONES,
    herramientas: crearHerramientas(configuracion),
  });
}
