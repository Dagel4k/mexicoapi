import { defineConfig } from "vitest/config";

// Pruebas contra el binario compilado (`node dist/index.js`) por stdio real. No forman parte del
// proyecto `mcp` de la raíz y piden `pnpm -r build` antes.
export default defineConfig({
  test: {
    name: "mcp-integracion",
    include: ["test/integracion/**/*.test.ts"],
  },
});
