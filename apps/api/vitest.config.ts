import { defineProject } from "vitest/config";

export default defineProject({
  // Igual que en el pipeline: @mexicoapi/core se lee desde src sin compilarlo.
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "api",
    include: ["test/unit/**/*.test.ts", "test/scripts/**/*.test.ts"],
  },
});
