import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutar } from "../../src/cli/cli.js";
import type { ModuloSepomexCli } from "../../src/cli/tipos.js";
import { type FetchCompatible, URL_API } from "../../src/cliente/index.js";
import type { ResumenSepomex } from "../../src/sepomex/index.js";
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
  resumen: (o) => sepomexReal.resumen({ ...o, dir }),
};

async function correr(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
  sepomex: ModuloSepomexCli = enDirectorio,
  fetch?: FetchCompatible,
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
    // Sin red salvo que la prueba la pida: sin MEXICOAPI_BASE, la CLI usaría la API pública.
    env: { MEXICOAPI_SIN_RED: "1", ...env },
    version: "9.9.9",
    sepomex,
    fetch,
  });
  return { codigo, salida, errores };
}

describe("CLI (lógica)", () => {
  probarCli((argv, env) => correr(argv, env), "9.9.9");
});

describe("CLI: a qué API pregunta", () => {
  const DIAS = ["dias-habiles", "--desde", "2026-03-16", "--dias", "5"];
  const respuesta = () =>
    new Response(
      JSON.stringify({
        data: {
          desde: "2026-03-16",
          dias: 5,
          autoridad: "lft",
          resultado: "2026-03-30",
          inhabiles_saltados: [],
          advertencias: [],
        },
        meta: { dataset: "calendario.lft", as_of: "2026-03-01", sources: [], docs: "" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const fetchFalso = () => {
    const urls: string[] = [];
    const fetch: FetchCompatible = async (url) => {
      urls.push(url);
      return respuesta();
    };
    return { fetch, urls };
  };
  const conRed = { MEXICOAPI_SIN_RED: undefined };

  it("sin MEXICOAPI_BASE, los datos que caducan se piden a la API pública (URL_API)", async () => {
    const { fetch, urls } = fetchFalso();
    const c = await correr(DIAS, conRed, enDirectorio, fetch);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("2026-03-16 + 5 días hábiles (lft): 2026-03-30");
    expect(c.salida).toContain("Origen: API");
    expect(urls).toEqual([`${URL_API}/v1/dias-habiles?autoridad=lft&desde=2026-03-16&dias=5`]);
  });

  it("los validadores, banco y municipio no usan la red", async () => {
    const { fetch, urls } = fetchFalso();
    for (const argv of [
      ["clabe", "002010077777777771"],
      ["banco", "002"],
      ["municipio", "25006"],
      ["municipio", "culiacan"],
      ["rfc", "XAXX010101000"],
    ]) {
      expect((await correr(argv, conRed, enDirectorio, fetch)).codigo, argv.join(" ")).toBe(0);
    }
    expect(urls).toEqual([]);
  });

  it("MEXICOAPI_BASE cambia la API; MEXICOAPI_SIN_RED=1 deja todo en el paquete", async () => {
    const otra = fetchFalso();
    await correr(
      DIAS,
      { ...conRed, MEXICOAPI_BASE: "https://otra.example/v1" },
      enDirectorio,
      otra.fetch,
    );
    expect(otra.urls[0]).toMatch(/^https:\/\/otra\.example\/v1\/dias-habiles\?/);
    const sinRed = fetchFalso();
    for (const env of [
      { MEXICOAPI_SIN_RED: "1" },
      { MEXICOAPI_SIN_RED: "1", MEXICOAPI_BASE: "https://otra.example" },
    ]) {
      const c = await correr(DIAS, env, enDirectorio, sinRed.fetch);
      expect(c.salida).toContain("Origen: datos del paquete, sin red");
    }
    expect(sinRed.urls).toEqual([]);
  });

  it("--base gana a MEXICOAPI_SIN_RED y a MEXICOAPI_BASE", async () => {
    const { fetch, urls } = fetchFalso();
    const env = { MEXICOAPI_SIN_RED: "1", MEXICOAPI_BASE: "https://otra.example" };
    await correr([...DIAS, "--base", "https://flag.example"], env, enDirectorio, fetch);
    expect(urls[0]).toMatch(/^https:\/\/flag\.example\/v1\/dias-habiles\?/);
  });
});

const ESTADO: ResumenSepomex = {
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
    resumen: async () => {
      throw new Error("falla interna");
    },
  };

  it("sin --depurar no imprime la traza", async () => {
    const c = await correr(["sepomex", "resumen"], {}, roto);
    expect(c.codigo).toBe(1);
    expect(c.errores).toBe(
      "mexicoapi: error inesperado: falla interna\nUsa --depurar para ver el detalle.\n",
    );
  });

  it("con --depurar imprime la traza", async () => {
    const c = await correr(["sepomex", "resumen", "--depurar"], {}, roto);
    expect(c.codigo).toBe(1);
    expect(c.errores).toContain("mexicoapi: error inesperado: falla interna");
    expect(c.errores).toContain("    at ");
  });

  it("lo que no es un Error también se imprime", async () => {
    const raro: ModuloSepomexCli = {
      ...enDirectorio,
      resumen: () => Promise.reject("texto suelto"),
    };
    const c = await correr(["sepomex", "resumen", "--depurar"], {}, raro);
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
