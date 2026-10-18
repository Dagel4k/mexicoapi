import { defineConfig } from "vitest/config";

// Pruebas del paquete compilado: mexicoapi-mcp instalado desde su .tgz, junto al de mexicoapi, en
// un proyecto nuevo. No forman parte del proyecto `mcp` de la raíz y piden `pnpm -r build` antes.
export default defineConfig({
  test: {
    name: "mcp-paquete",
    include: ["test/paquete/**/*.test.ts"],
    globalSetup: ["test/paquete/instalar.ts"],
    testTimeout: 60_000,
  },
});
