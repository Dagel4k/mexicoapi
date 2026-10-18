import { defineConfig } from "vitest/config";

// Pruebas del paquete compilado (tamaño, imports, tipos, el .tgz instalado en un proyecto nuevo y
// en un Worker). No forman parte del proyecto `sdk` de la raíz y piden `pnpm -r build` antes.
export default defineConfig({
  test: {
    name: "sdk-paquete",
    include: ["test/paquete/**/*.test.ts"],
    globalSetup: ["test/paquete/instalar.ts"],
    testTimeout: 60_000,
  },
});
