import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutar } from "../../src/cli/cli.js";
import type { ModuloSepomexCli } from "../../src/cli/tipos.js";
import type { EstadoSepomex } from "../../src/sepomex/index.js";
import * as sepomexReal from "../../src/sepomex/index.js";
import { SepomexError } from "../../src/sepomex/index.js";
import { type Corrida, probarCli } from "./comun.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mexicoapi-cli-cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** SEPOMEX real con la caché en un directorio temporal. */
const enDirectorio: ModuloSepomexCli = {
  sync: (o) => sepomexReal.sync({ ...o, dir }),
  importar: (ruta, o) => sepomexReal.importar(ruta, { ...o, dir }),
  cp: (c, o) => sepomexReal.cp(c, { ...o, dir }),
  estado: (o) => sepomexReal.estado({ ...o, dir }),
};

async function correr(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
  sepomex: ModuloSepomexCli = enDirectorio,
): Promise<Corrida> {
  let salida = "";
  let errores = "";
  const codigo = await ejecutar(argv, {
    salida: (t) => {
      salida += t;
    },
    errores: (t) => {
      errores += t;
    },
    env,
    version: "9.9.9",
    sepomex,
  });
  return { codigo, salida, errores };
}

describe("CLI (lógica)", () => {
  probarCli((argv, env) => correr(argv, env), "9.9.9");
});

const ESTADO: EstadoSepomex = {
  dir: "/cache",
  descargado: "2026-10-18T10:00:00.000Z",
  origen: "descarga",
  fuente: "https://ejemplo.test/cp",
  as_of: null,
  aviso: "aviso",
  nota: "Nota de prueba.",
  filas: 10,
  codigos_postales: 5,
  municipios: 3,
  sin_municipio_inegi: 1,
  advertencias: ["una advertencia"],
  sha256: "abc",
  json: "/cache/c.json",
  sqlite: null,
  sin_sqlite: "sin node:sqlite",
};

describe("CLI: sepomex sync con un falso", () => {
  it("muestra el aviso en stderr, el resultado en stdout y sale con 0", async () => {
    const falso: ModuloSepomexCli = {
      ...enDirectorio,
      sync: async (o) => {
        o?.aviso?.("AVISO DE CORREOS");
        return ESTADO;
      },
    };
    const c = await correr(["sepomex", "sync"], {}, falso);
    expect(c.codigo).toBe(0);
    expect(c.errores).toBe("AVISO DE CORREOS\n");
    expect(c.salida).toContain("Catálogo descargado.");
    expect(c.salida).toContain("Información de Correos de México al: sin dato");
    expect(c.salida).toContain("SQLite: no (sin node:sqlite)");
    expect(c.salida).toContain("Aviso: una advertencia");
    const enJson = await correr(["sepomex", "sync", "--json"], {}, falso);
    expect(JSON.parse(enJson.salida)).toEqual(ESTADO);
    expect(enJson.errores).toBe("AVISO DE CORREOS\n");
  });

  it("un SepomexError (también ocupado) sale con su mensaje y 1", async () => {
    for (const tipo of ["ocupado", "bloqueado"] as const) {
      const falso: ModuloSepomexCli = {
        ...enDirectorio,
        sync: async () => {
          throw new SepomexError(tipo, `mensaje ${tipo}`);
        },
      };
      const c = await correr(["sepomex", "sync"], {}, falso);
      expect(c).toEqual({ codigo: 1, salida: "", errores: `mexicoapi: mensaje ${tipo}\n` });
    }
  });

  it("con el SQLite escrito lo muestra", async () => {
    const falso: ModuloSepomexCli = {
      ...enDirectorio,
      sync: async () => ({
        ...ESTADO,
        sqlite: "/cache/c.sqlite",
        sin_sqlite: null,
        as_of: "2026-09-01",
      }),
    };
    const c = await correr(["sepomex", "sync"], {}, falso);
    expect(c.salida).toContain("SQLite: /cache/c.sqlite");
    expect(c.salida).toContain("al: 2026-09-01");
  });
});

describe("CLI: errores inesperados", () => {
  const roto: ModuloSepomexCli = {
    ...enDirectorio,
    estado: async () => {
      throw new Error("falla interna");
    },
  };

  it("sin --depurar no imprime la traza", async () => {
    const c = await correr(["sepomex", "estado"], {}, roto);
    expect(c.codigo).toBe(1);
    expect(c.errores).toBe(
      "mexicoapi: error inesperado: falla interna\nUsa --depurar para ver el detalle.\n",
    );
  });

  it("con --depurar imprime la traza", async () => {
    const c = await correr(["sepomex", "estado", "--depurar"], {}, roto);
    expect(c.codigo).toBe(1);
    expect(c.errores).toContain("mexicoapi: error inesperado: falla interna");
    expect(c.errores).toContain("    at ");
  });

  it("lo que no es un Error también se imprime", async () => {
    const raro: ModuloSepomexCli = {
      ...enDirectorio,
      estado: () => Promise.reject("texto suelto"),
    };
    const c = await correr(["sepomex", "estado", "--depurar"], {}, raro);
    expect(c.errores).toBe("mexicoapi: error inesperado: texto suelto\ntexto suelto\n");
  });

  it("una base inválida es un error de entrada, sin traza", async () => {
    const c = await correr(["banco", "002", "--base", "no es una url"]);
    expect(c.codigo).toBe(1);
    expect(c.errores).toMatch(/^mexicoapi: /);
    expect(c.errores).not.toContain("    at ");
  });

  it("usa mexicoapi/sepomex si no se inyecta nada", async () => {
    // La caché por omisión queda en el directorio temporal, sin tocar la del equipo.
    vi.stubEnv("LOCALAPPDATA", dir);
    vi.stubEnv("XDG_CACHE_HOME", dir);
    let salida = "";
    let errores = "";
    try {
      const codigo = await ejecutar(["sepomex", "cp", "80000"], {
        salida: (t) => {
          salida += t;
        },
        errores: (t) => {
          errores += t;
        },
        env: {},
        version: "0",
      });
      expect(codigo).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(salida).toBe("");
    expect(errores).toContain("Corre `mexicoapi sepomex sync`");
  });
});
