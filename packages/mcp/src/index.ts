#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { arrancar } from "./binario.js";
import { INSTRUCCIONES } from "./protocolo.js";

const paquete = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};

await arrancar({
  info: { name: paquete.name, title: "MéxicoAPI", version: paquete.version },
  instrucciones: INSTRUCCIONES,
  herramientas: [],
});
