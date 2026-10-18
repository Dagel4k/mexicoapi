import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**", "packages/pipeline/src/**", "apps/api/src/**"],
      exclude: ["packages/pipeline/src/bin.ts"],
      thresholds: {
        "packages/core/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        "packages/pipeline/src/**": {
          lines: 85,
          branches: 85,
          functions: 85,
          statements: 85,
        },
        "apps/api/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
