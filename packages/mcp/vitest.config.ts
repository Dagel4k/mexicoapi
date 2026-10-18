import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import { pluginDatos } from "../sdk/scripts/datos.ts";

const SDK = fileURLToPath(new URL("../sdk/src/", import.meta.url));

export default defineProject({
  // Las pruebas leen mexicoapi desde su src, sin compilarlo, como el typecheck (paths en
  // tsconfig.json). Sus datos los sirve el plugin del sdk y @mexicoapi/core sale de su src.
  plugins: [pluginDatos(fileURLToPath(new URL("../../data", import.meta.url)))],
  resolve: {
    alias: [
      { find: /^mexicoapi$/, replacement: `${SDK}index.ts` },
      { find: /^mexicoapi\/(datos|cliente|sepomex)$/, replacement: `${SDK}$1/index.ts` },
      { find: /^mexicoapi\/datos\/([a-z]+)$/, replacement: `${SDK}datos/$1.ts` },
    ],
  },
  ssr: {
    resolve: {
      conditions: ["@mexicoapi/source"],
    },
  },
  test: {
    name: "mcp",
    include: ["test/**/*.test.ts"],
    // Las de integración levantan el binario compilado; van aparte, después del build.
    exclude: ["test/integracion/**"],
  },
});
