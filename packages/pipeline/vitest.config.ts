import { defineProject } from "vitest/config";

export default defineProject({
  // Las pruebas leen @mexicoapi/core desde src, sin compilarlo. Los proyectos
  // no heredan la configuración raíz, por eso la condición va aquí.
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "pipeline",
    include: ["test/**/*.test.ts"],
  },
});
