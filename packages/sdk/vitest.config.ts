import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import { pluginDatos } from "./scripts/datos.ts";

export default defineProject({
  // src/datos importa los módulos que genera el build; en las pruebas sobre src los sirve este
  // plugin con el mismo código, leído de data/.
  plugins: [pluginDatos(fileURLToPath(new URL("../../data", import.meta.url)))],
  // Igual que en el pipeline: @mexicoapi/core se lee desde src sin compilarlo.
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "sdk",
    include: ["test/**/*.test.ts"],
    // Las de test/paquete revisan dist y las de test/integracion lo prueban contra el Worker:
    // corren después del build, con vitest.paquete.config.ts y vitest.integracion.config.ts.
    exclude: ["test/paquete/**", "test/integracion/**"],
  },
});
