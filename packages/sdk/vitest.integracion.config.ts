import { defineConfig } from "vitest/config";

// El cliente compilado contra el Worker local, con el mismo globalSetup que las pruebas de
// integración de la API (levanta wrangler.jsonc en workerd con el `public/` del build). No forma
// parte del proyecto `sdk` de la raíz y pide `pnpm -r build` antes.
export default defineConfig({
  test: {
    name: "sdk-integracion",
    include: ["test/integracion/**/*.test.ts"],
    globalSetup: ["../../apps/api/test/integracion/worker.ts"],
    testTimeout: 30_000,
  },
});
