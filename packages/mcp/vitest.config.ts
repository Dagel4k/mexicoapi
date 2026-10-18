import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "mcp",
    include: ["test/**/*.test.ts"],
    // Las de integración levantan el binario compilado; van aparte, después del build.
    exclude: ["test/integracion/**"],
  },
});
