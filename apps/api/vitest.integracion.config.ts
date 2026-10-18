import { defineConfig } from "vitest/config";

// Pruebas contra el Worker real en workerd, con el `public/` del build. No forman parte del
// proyecto `api` de la raíz (que solo incluye test/unit) y piden `pnpm -r build` antes.
export default defineConfig({
  // La prueba de contrato lee la tabla de rutas desde src; @mexicoapi/core se lee sin compilar.
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "api-integracion",
    include: ["test/integracion/**/*.test.ts"],
    // Un solo Worker para todos los archivos de prueba.
    globalSetup: ["test/integracion/worker.ts"],
  },
});
