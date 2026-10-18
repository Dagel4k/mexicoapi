// Servidor de prueba: el arranque compilado del paquete con herramientas de prueba.
import { arrancar } from "../../../dist/binario.js";

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

// Ignora la cancelación y deja un temporizador que mantiene vivo el proceso.
const eterna = {
  name: "eterna",
  title: "Eterna",
  description: "No termina en un minuto e ignora la cancelación.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  ejecutar() {
    return new Promise((resolver) => {
      setTimeout(() => resolver({ content: [{ type: "text", text: "tarde" }] }), 60_000);
    });
  },
};

// Escribe con console.* como lo haría una dependencia descuidada.
const ruidosa = {
  name: "ruidosa",
  title: "Ruidosa",
  description: "Escribe en la consola y responde.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar() {
    console.log("ruido log");
    console.info("ruido info");
    console.debug("ruido debug");
    console.dir({ ruido: "dir" });
    console.table([{ ruido: "tabla" }]);
    return { content: [{ type: "text", text: "listo" }] };
  },
};

await arrancar({
  info: { name: "prueba", title: "Prueba", version: "0.0.0" },
  instrucciones: "Servidor de prueba.",
  herramientas: [repite, eterna, ruidosa],
  msGraciaCierre: 300,
});
