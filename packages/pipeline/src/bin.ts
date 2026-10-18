import { fileURLToPath } from "node:url";
import { principal } from "./cli.js";
import { crearCliente } from "./http.js";

const raizDatos = fileURLToPath(new URL("../../../data/", import.meta.url));
const escribir = (t: string): void => void process.stdout.write(t);
const escribirError = (t: string): void => void process.stderr.write(t);
const entorno = {
  crearCliente: (ms: number) => crearCliente({ intervaloMinimoMs: ms }),
  raizDatos,
  ahora: () => new Date(),
  escribir,
  escribirError,
};
try {
  process.exitCode = await principal(process.argv.slice(2), entorno);
} catch (error) {
  escribirError(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
