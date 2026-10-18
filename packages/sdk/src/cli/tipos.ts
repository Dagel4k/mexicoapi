import type * as Sepomex from "../sepomex/index.js";

/** Lo que la CLI usa de `mexicoapi/sepomex`; las pruebas pasan uno falso. */
export type ModuloSepomexCli = Pick<typeof Sepomex, "sync" | "importar" | "cp" | "resumen">;
