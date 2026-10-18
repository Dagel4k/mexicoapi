import { defineConfig } from "vitest/config";

// Pruebas del paquete compilado (tamaño, imports, tipos y contenido de npm pack). No forman parte
// del proyecto `sdk` de la raíz y piden `pnpm -r build` antes.
export default defineConfig({
  test: {
    name: "sdk-paquete",
    include: ["test/paquete/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
