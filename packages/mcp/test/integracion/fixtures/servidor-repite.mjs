// Servidor de prueba: el código compilado del paquete con una herramienta que repite una letra.
import { ejecutarStdio } from "../../../dist/stdio.js";

const repite = {
  name: "repite",
  title: "Repite",
  description: "Devuelve la letra x repetida n veces.",
  inputSchema: {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, maximum: 2000000 } },
    required: ["n"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { largo: { type: "integer" } },
    required: ["largo"],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar(args) {
    return {
      content: [{ type: "text", text: "x".repeat(args.n) }],
      structuredContent: { largo: args.n },
    };
  },
};

const conexion = ejecutarStdio({
  entrada: process.stdin,
  salida: process.stdout,
  registrar: (mensaje) => process.stderr.write(`${mensaje}\n`),
  info: { name: "prueba", title: "Prueba", version: "0.0.0" },
  instrucciones: "Servidor de prueba.",
  herramientas: [repite],
});
await conexion.terminado;
