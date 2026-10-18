import { defineProject } from "vitest/config";

export default defineProject({
  // Igual que en el pipeline: @mexicoapi/core se lee desde src sin compilarlo.
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "sdk",
    include: ["test/**/*.test.ts"],
    // Las de test/paquete revisan dist: corren después del build con vitest.paquete.config.ts.
    exclude: ["test/paquete/**"],
  },
});
