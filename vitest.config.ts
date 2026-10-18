import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      provider: "v8",
      include: [
        "packages/core/src/**",
        "packages/pipeline/src/**",
        "packages/sdk/src/**",
        "packages/sdk/scripts/**/*.ts",
        "packages/mcp/src/**",
        "apps/api/src/**",
        "apps/api/scripts/**/*.ts",
      ],
      exclude: [
        "packages/pipeline/src/bin.ts",
        "packages/sdk/src/cli/index.ts",
        "packages/mcp/src/index.ts",
        "packages/mcp/src/binario.ts",
      ],
      thresholds: {
        "packages/core/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        "packages/pipeline/src/**": {
          lines: 95,
          branches: 93,
          functions: 95,
          statements: 95,
        },
        "packages/sdk/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        "packages/sdk/scripts/**": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        "packages/mcp/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        "apps/api/src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        "apps/api/scripts/**": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
