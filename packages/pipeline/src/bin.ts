import { fileURLToPath } from "node:url";
import { principal } from "./cli.js";
import { crearCliente } from "./http.js";

const raizDatos = fileURLToPath(new URL("../../../data/", import.meta.url));
const escribir = (t: string): void => void process.stdout.write(t);
const escribirError = (t: string): void => void process.stderr.write(t);
const entorno = {
  cliente: crearCliente(),
  raizDatos,
  ahora: () => new Date(),
  escribir,
  escribirError,
};
process.exit(await principal(process.argv.slice(2), entorno));
