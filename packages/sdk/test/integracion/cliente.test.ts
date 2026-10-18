// El cliente compilado (dist) contra el Worker real de apps/api en workerd, que levanta el
// globalSetup de las pruebas de integración de la API (vitest.integracion.config.ts). Pide
// `pnpm -r build` antes: el Worker sirve el `public/` del build y el cliente sale de dist.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type {
  Cliente,
  FetchCompatible,
  MexicoApiError,
  OpcionesConsulta,
  RespuestaSinMeta,
} from "../../src/cliente/index.js";
import type { ModuloCliente } from "../cliente/comun.ts";
import { mover } from "../cliente/comun.ts";
import type { ModuloDatos, ModuloFix, ModuloUdis } from "../datos/comun.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** Origen del Worker local, por ejemplo `http://127.0.0.1:51234/`. */
    urlApi: string;
  }
}

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const importar = async <T>(archivo: string): Promise<T> =>
  (await import(pathToFileURL(join(DIST, archivo)).href)) as T;

const CLABE = "002010077777777771";
const API: OpcionesConsulta = { fuente: "api" };
const PAQUETE: OpcionesConsulta = { fuente: "paquete" };

let m: ModuloCliente;
let fix: ModuloFix;
let udis: ModuloUdis;
let datos: ModuloDatos;
let base: string;

/** Un fetch que anota lo que pide y lo que responde el Worker. */
function anotado(): {
  fetch: FetchCompatible;
  pedidos: { url: string; encabezados: Record<string, string>; status: number }[];
} {
  const pedidos: { url: string; encabezados: Record<string, string>; status: number }[] = [];
  return {
    pedidos,
    fetch: async (url, init) => {
      const respuesta = await fetch(url, init);
      pedidos.push({ url, encabezados: init.headers, status: respuesta.status });
      return respuesta;
    },
  };
}

beforeAll(async () => {
  [m, fix, udis, datos] = await Promise.all([
    importar<ModuloCliente>("cliente/index.js"),
    importar<ModuloFix>("datos/fix.js"),
    importar<ModuloUdis>("datos/udis.js"),
    importar<ModuloDatos>("datos/index.js"),
  ]);
  base = inject("urlApi");
});

const enMedio = <T>(serie: readonly T[]): T => serie[Math.floor(serie.length / 2)] as T;

/** Las consultas que el paquete también responde, por nombre. */
function consultas(): [string, (api: Cliente, op: OpcionesConsulta) => Promise<unknown>][] {
  const publicado = enMedio(fix.serie).fecha_publicacion;
  const inactivo = datos.bancos({ activos: false })[0];
  const primeros = `${inactivo?.codigo ?? "000"}${"0".repeat(14)}`;
  return [
    ["estados", (api, op) => api.estados(op)],
    ["estado", (api, op) => api.estado("25", op)],
    ["municipios", (api, op) => api.municipios(undefined, op)],
    ["municipios de un estado", (api, op) => api.municipios("25", op)],
    ["municipio", (api, op) => api.municipio("25006", op)],
    ["bancos", (api, op) => api.bancos(op)],
    ["banco", (api, op) => api.banco("002", op)],
    ["clabe", (api, op) => api.clabe(CLABE, op)],
    ["clabe con otro dígito", (api, op) => api.clabe("002010077777777772", op)],
    [
      "clabe de un banco inactivo",
      async (api, op) => {
        const { digitoControlClabe } = await importar<{
          digitoControlClabe: (p: string) => string;
        }>("index.js");
        return api.clabe(primeros + digitoControlClabe(primeros), op);
      },
    ],
    ["días hábiles", (api, op) => api.diasHabiles({ desde: "2026-11-13", dias: 15 }, op)],
    [
      "días hábiles fuera del calendario",
      (api, op) => api.diasHabiles({ desde: "2100-12-30", dias: 2, permitirIncompleto: true }, op),
    ],
    ["días inhábiles", (api, op) => api.diasInhabiles({ anio: 2026 }, op)],
    ["FIX publicado", (api, op) => api.fixPublicado(publicado, op)],
    ["FIX para una operación", (api, op) => api.fixParaOperacion(mover(publicado, 1), op)],
    ["FIX último", (api, op) => api.fixUltimo(op)],
    ["UDI", (api, op) => api.udi(enMedio(udis.serie).fecha, op)],
  ];
}

/** Las que dan un problema, en la API y en el paquete. */
function problemas(): [string, (api: Cliente, op: OpcionesConsulta) => Promise<unknown>][] {
  const antes = mover(fix.cobertura.desde, -3);
  return [
    ["estado que no existe", (api, op) => api.estado("33", op)],
    ["municipios de un estado que no existe", (api, op) => api.municipios("33", op)],
    ["municipio que no existe", (api, op) => api.municipio("99999", op)],
    ["banco que no existe", (api, op) => api.banco("999", op)],
    ["fecha inválida", (api, op) => api.diasHabiles({ desde: "2026-02-30", dias: 3 }, op)],
    ["días de más", (api, op) => api.diasHabiles({ desde: "2026-11-13", dias: 3651 }, op)],
    ["calendario incompleto", (api, op) => api.diasHabiles({ desde: "2100-12-30", dias: 2 }, op)],
    [
      "resultado después de 9999",
      (api, op) => api.diasHabiles({ desde: "9999-12-30", dias: 5, permitirIncompleto: true }, op),
    ],
    ["año fuera del calendario", (api, op) => api.diasInhabiles({ anio: 2200 }, op)],
    ["FIX que todavía no está", (api, op) => api.fixPublicado("2100-01-04", op)],
    ["FIX antes de la serie", (api, op) => api.fixPublicado(antes, op)],
    ["operación sin FIX cargado", (api, op) => api.fixParaOperacion("2100-01-04", op)],
    ["UDI que todavía no está", (api, op) => api.udi("2100-01-04", op)],
    [
      "FIX con publicado y operacion",
      (api, op) =>
        api.consultar(
          "/v1/tipo-cambio/fix",
          { publicado: "2026-10-16", operacion: "2026-10-16" } as never,
          op,
        ),
    ],
    ["FIX sin fecha", (api, op) => api.consultar("/v1/tipo-cambio/fix", {} as never, op)],
  ];
}

async function errorDe(consulta: Promise<unknown>): Promise<MexicoApiError> {
  try {
    await consulta;
  } catch (error) {
    expect(error).toBeInstanceOf(m.MexicoApiError);
    return error as MexicoApiError;
  }
  throw new Error("Se esperaba un MexicoApiError");
}

describe("el cliente contra el Worker", () => {
  it("cada ruta da con la API lo mismo que con el paquete, con la misma meta", async () => {
    const api = m.crearCliente({ base });
    for (const [nombre, consultar] of consultas()) {
      const deApi = (await consultar(api, API)) as RespuestaSinMeta<unknown> & { meta: unknown };
      const dePaquete = (await consultar(api, PAQUETE)) as typeof deApi;
      expect(deApi.origen, nombre).toBe("api");
      expect(deApi.advertencias, nombre).toEqual([]);
      expect(dePaquete.origen, nombre).toBe("paquete");
      expect(dePaquete.data, nombre).toEqual(deApi.data);
      expect(dePaquete.meta, nombre).toEqual(deApi.meta);
    }
  });

  it("los problem+json de la API llegan como MexicoApiError, como los del paquete", async () => {
    const api = m.crearCliente({ base });
    for (const [nombre, consultar] of problemas()) {
      const deApi = await errorDe(consultar(api, API));
      const dePaquete = await errorDe(consultar(api, PAQUETE));
      expect(deApi.origen, nombre).toBe("api");
      expect(dePaquete.origen, nombre).toBe("paquete");
      expect(deApi.type, nombre).toMatch(
        /^https:\/\/github\.com\/Dagel4k\/mexicoapi\/blob\/main\/docs\/api\/problemas\.md#/,
      );
      expect(dePaquete.status, nombre).toBe(deApi.status);
      expect(dePaquete.type, nombre).toBe(deApi.type);
      expect(dePaquete.title, nombre).toBe(deApi.title);
      // Las series del paquete explican con sus propias palabras qué datos trae.
      const { detail: _a, ...restoApi } = deApi.problema;
      const { detail: _b, ...restoPaquete } = dePaquete.problema;
      expect(restoPaquete, nombre).toEqual(restoApi);
      if (!/FIX|UDI|operación/.test(nombre)) expect(dePaquete.detail, nombre).toBe(deApi.detail);
      expect(deApi.url.startsWith(base.replace(/\/$/, "")), nombre).toBe(true);
    }
  });

  it("ningún error trae los valores de la ruta", async () => {
    const api = m.crearCliente({ base });
    const error = await errorDe(api.municipio("99999", API));
    expect(error.status).toBe(404);
    expect(error.tipo).toBe("no-encontrado");
    expect(error.detail).toBe("No existe el municipio {cvegeo}.");
    expect(error.problema.instance).toBe("/v1/municipios/{cvegeo}");
    expect(error.url).toBe(`${base.replace(/\/$/, "")}/v1/municipios/{cvegeo}`);
    expect(`${error.message} ${JSON.stringify(error.problema)} ${error.url}`).not.toContain(
      "99999",
    );
  });

  it("un parámetro que la API no conoce lo rechaza el Worker", async () => {
    const api = m.crearCliente({ base });
    const error = await errorDe(
      api.consultar("/v1/udis", { fecha: "2026-10-20", hora: "12" } as never, API),
    );
    expect(error.status).toBe(400);
    expect(error.tipo).toBe("parametro-desconocido");
    expect(error.problema.parametro).toBe("hora");
  });

  it("/v1/status responde sin meta, con cada dataset del build", async () => {
    const r = await m.crearCliente({ base }).status();
    expect(r.origen).toBe("api");
    expect("meta" in r).toBe(false);
    expect(r.data.map((d) => d.dataset)).toEqual(
      expect.arrayContaining(["bancos", "inegi.estados", "tipo-cambio.fix", "udis"]),
    );
    expect(r.data.find((d) => d.dataset === "udis")?.cobertura).toEqual(udis.cobertura);
  });

  it("con caché, al caducar un shard pregunta con su ETag y el Worker responde 304", async () => {
    const { fetch, pedidos } = anotado();
    const api = m.crearCliente({ base, fetch, cache: { ttlMs: 1 } });
    const primera = await api.estados(API);
    await new Promise((resolver) => setTimeout(resolver, 5));
    const segunda = await api.estados(API);
    expect(segunda).toBe(primera);
    expect(pedidos.map((p) => p.status)).toEqual([200, 304]);
    expect(pedidos[1]?.encabezados["If-None-Match"]).toMatch(/^(W\/)?"/);
  });

  it("los datos estables no salen a la red: la CLABE no viaja si no se pide la API", async () => {
    const { fetch, pedidos } = anotado();
    const api = m.crearCliente({ base, fetch });
    expect((await api.clabe(CLABE)).origen).toBe("paquete");
    expect((await api.municipios("25")).origen).toBe("paquete");
    expect(pedidos).toEqual([]);
    expect((await api.fixUltimo()).origen).toBe("api");
    expect(pedidos).toHaveLength(1);
  });

  it("con la API caída, el FIX y las UDIS salen del paquete con advertencia", async () => {
    // Un puerto sin nadie escuchando: la conexión se rechaza.
    const api = m.crearCliente({ base: "http://127.0.0.1:9", reintentos: 0, timeoutMs: 5_000 });
    const publicado = enMedio(fix.serie);
    const r = await api.fixPublicado(publicado.fecha_publicacion);
    expect(r.origen).toBe("paquete");
    expect(r.data).toEqual(publicado);
    expect(r.advertencias[0]).toMatch(
      /^Respuesta de los datos del paquete porque la API falló: Sin respuesta de la API: /,
    );
    const futuro = await errorDe(api.udi("2100-01-04"));
    expect(futuro.tipo).toBe("dato-no-disponible");
    expect(futuro.origen).toBe("paquete");
    expect((futuro.cause as MexicoApiError).status).toBe(0);
    await expect(api.status()).rejects.toMatchObject({ status: 0 });
  });
});
