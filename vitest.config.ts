import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**"],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
