#!/usr/bin/env node
// Binario `mexicoapi`. La lógica está en cli.ts; aquí solo se conecta con el proceso.
import { readFileSync } from "node:fs";
import { ejecutar } from "./cli.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

process.exitCode = await ejecutar(process.argv.slice(2), {
  salida: (texto) => process.stdout.write(texto),
  errores: (texto) => process.stderr.write(texto),
  env: process.env,
  version,
});
