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
import type { ModuloCalendarios, ModuloConstantes } from "../datos/curados.ts";

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
let constantes: ModuloConstantes;
let calendarios: ModuloCalendarios;
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
  [m, fix, udis, datos, constantes, calendarios] = await Promise.all([
    importar<ModuloCliente>("cliente/index.js"),
    importar<ModuloFix>("datos/fix.js"),
    importar<ModuloUdis>("datos/udis.js"),
    importar<ModuloDatos>("datos/index.js"),
    importar<ModuloConstantes>("datos/constantes.js"),
    importar<ModuloCalendarios>("datos/calendarios.js"),
  ]);
  base = inject("urlApi");
});

const enMedio = <T>(serie: readonly T[]): T => serie[Math.floor(serie.length / 2)] as T;

/**
 * El primer feriado bancario de la CNBV después del último FIX, si el calendario lo tiene. Se lee
 * al definir las pruebas para saltar (y que se vea) la que lo necesita.
 */
const FERIADO = await (async () => {
  const [cal, serie] = await Promise.all([
    importar<ModuloCalendarios>("datos/calendarios.js"),
    importar<ModuloFix>("datos/fix.js"),
  ]);
  return cal
    .calendarioCurado("cnbv")
    .dias.find((d) => d.tipo === "descanso" && d.fecha > serie.cobertura.hasta)?.fecha;
})();

/** Una consulta con su nombre, para correrla con la API y con el paquete. */
type Consulta = [string, (api: Cliente, op: OpcionesConsulta) => Promise<unknown>];

/**
 * Hasta dónde llegan los calendarios curados del paquete. Los casos del borde salen de aquí y no
 * de fechas fijas: después de una captura siguen probando el respaldo, la cobertura amplia y los 422.
 */
function bordes() {
  const sat = calendarios.calendarioCurado("sat");
  return {
    satGeneral: sat.general.cobertura.hasta,
    satPagos: sat.plazos.get("declaraciones_pagos")?.cobertura.hasta as string,
    satAmplia: sat.amplia.hasta,
    cnbv: calendarios.calendarioCurado("cnbv").general.cobertura.hasta,
  };
}

/** Días naturales de `desde` a `hasta`. */
const diasEntre = (desde: string, hasta: string): number =>
  (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;

/** Las consultas que el paquete también responde, por nombre. */
function consultas(): Consulta[] {
  const { satGeneral, satPagos, satAmplia, cnbv } = bordes();
  // Del respaldo de general hasta pasar la cobertura amplia: los días hábiles no son más que los
  // naturales. Con la regla del art. 12 la amplia llega a 2100, más lejos de lo que la API acepta
  // (3650 días), así que empieza a lo más 60 días antes de su fin, ya en el respaldo.
  const antesDeAmplia = mover(satAmplia, -60);
  const desdeRespaldo = satGeneral > antesDeAmplia ? satGeneral : antesDeAmplia;
  const masAllaDeAmplia = diasEntre(desdeRespaldo, satAmplia) + 5;
  // El primer año sin vacaciones publicadas (hoy 2027): la lista sale solo de la regla.
  const sinVacaciones = Number(satGeneral.slice(0, 4)) + 1;
  const publicado = enMedio(fix.serie).fecha_publicacion;
  const primeraUma = constantes.anios.uma[0] as number;
  const ultimaUma = constantes.anios.uma.at(-1) as number;
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
    [
      "días hábiles CNBV",
      (api, op) => api.diasHabiles({ autoridad: "cnbv", desde: "2026-12-23", dias: 3 }, op),
    ],
    [
      "días hábiles SAT general",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "general", desde: "2026-07-17", dias: 3 },
          op,
        ),
    ],
    [
      "días hábiles SAT declaraciones_pagos",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-07-17", dias: 3 },
          op,
        ),
    ],
    [
      "días hábiles SAT general con respaldo después de su cobertura",
      (api, op) =>
        api.diasHabiles(
          {
            autoridad: "sat",
            tipoPlazo: "general",
            desde: satGeneral,
            dias: 20,
            permitirIncompleto: true,
          },
          op,
        ),
    ],
    [
      "días hábiles SAT general más allá de la cobertura amplia",
      (api, op) =>
        api.diasHabiles(
          {
            autoridad: "sat",
            tipoPlazo: "general",
            desde: desdeRespaldo,
            dias: masAllaDeAmplia,
            permitirIncompleto: true,
          },
          op,
        ),
    ],
    [
      "días hábiles CNBV con permitir_incompleto",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "cnbv", desde: mover(cnbv, -3), dias: 10, permitirIncompleto: true },
          op,
        ),
    ],
    [
      "días hábiles CNBV cruzando el sábado 12 de diciembre, publicado como inhábil",
      (api, op) => api.diasHabiles({ autoridad: "cnbv", desde: "2026-12-11", dias: 1 }, op),
    ],
    [
      "días hábiles SAT general con permitir_incompleto después de la cobertura amplia",
      (api, op) =>
        api.diasHabiles(
          {
            autoridad: "sat",
            tipoPlazo: "general",
            desde: satAmplia,
            dias: 3,
            permitirIncompleto: true,
          },
          op,
        ),
    ],
    [
      "días hábiles SAT declaraciones_pagos con permitir_incompleto después de su cobertura",
      (api, op) =>
        api.diasHabiles(
          {
            autoridad: "sat",
            tipoPlazo: "declaraciones_pagos",
            desde: mover(satPagos, -1),
            dias: 3,
            permitirIncompleto: true,
          },
          op,
        ),
    ],
    ["días inhábiles CNBV", (api, op) => api.diasInhabiles({ autoridad: "cnbv", anio: 2026 }, op)],
    [
      "días inhábiles CNBV 2025",
      (api, op) => api.diasInhabiles({ autoridad: "cnbv", anio: 2025 }, op),
    ],
    ["días inhábiles SAT", (api, op) => api.diasInhabiles({ autoridad: "sat", anio: 2026 }, op)],
    // Los días del art. 12 por regla: declaraciones_pagos pasa a 2027 sin permitir_incompleto, el
    // primer año sin vacaciones publicadas se lista y 2030 avisa de la transmisión.
    [
      "días hábiles SAT declaraciones_pagos en 2027, sin permitir_incompleto",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-12-30", dias: 2 },
          op,
        ),
    ],
    [
      "días hábiles SAT declaraciones_pagos de 30 días desde el 20 de noviembre",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-11-20", dias: 30 },
          op,
        ),
    ],
    [
      "días hábiles SAT por el 1o. de octubre de 2030",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2030-09-30", dias: 1 },
          op,
        ),
    ],
    [
      "días inhábiles SAT del primer año sin vacaciones publicadas",
      (api, op) => api.diasInhabiles({ autoridad: "sat", anio: sinVacaciones }, op),
    ],
    [
      "días inhábiles SAT 2030",
      (api, op) => api.diasInhabiles({ autoridad: "sat", anio: 2030 }, op),
    ],
    // declaraciones_pagos avisa de la prórroga del art. 12: viernes, vacaciones y cierres bancarios.
    [
      "días hábiles SAT declaraciones_pagos que vence en viernes",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-07-16", dias: 1 },
          op,
        ),
    ],
    [
      "días hábiles SAT declaraciones_pagos que vence en un cierre bancario",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-10-30", dias: 1 },
          op,
        ),
    ],
    [
      "días hábiles SAT declaraciones_pagos que vence en vacaciones del SAT",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: "2026-04-01", dias: 1 },
          op,
        ),
    ],
    // La LFT avisa en cada respuesta que no tiene las suspensiones de labores (art. 715).
    [
      "días hábiles LFT por el Viernes Santo",
      (api, op) => api.diasHabiles({ desde: "2026-03-31", dias: 3 }, op),
    ],
    ["UMA por año", (api, op) => api.uma(2026, op)],
    ["UMA vigente en enero", (api, op) => api.umaVigente("2026-01-15", op)],
    ["UMA vigente en febrero", (api, op) => api.umaVigente("2026-02-01", op)],
    [
      "UMA vigente el 31 de enero siguiente a la última",
      (api, op) => api.umaVigente(`${ultimaUma + 1}-01-31`, op),
    ],
    [
      "UMA vigente el 1 de febrero de la primera",
      (api, op) => api.umaVigente(`${primeraUma}-02-01`, op),
    ],
    ["salario mínimo", (api, op) => api.salarioMinimo(2026, op)],
    ["tarifa mensual de ISR", (api, op) => api.tarifaIsr("mensual", 2026, op)],
    ["tarifa anual de ISR", (api, op) => api.tarifaIsr("anual", 2025, op)],
  ];
}

/**
 * Las que dan un problema, en la API y en el paquete. Las que dependen de hasta dónde llegan los
 * calendarios y las constantes salen de los datos: una captura nueva no las vuelve 200.
 */
function problemas(): Consulta[] {
  const antes = mover(fix.cobertura.desde, -3);
  const { satGeneral, satPagos, satAmplia, cnbv } = bordes();
  const satFuera = Number(satAmplia.slice(0, 4)) + 1;
  const { anios } = constantes;
  const ultimaUma = anios.uma.at(-1) as number;
  const umaFutura = ultimaUma + 2;
  const salarioFuturo = (anios.salarioMinimo.at(-1) as number) + 2;
  const isrFutura = (anios.isr.anual.at(-1) as number) + 2;
  return [
    ["estado que no existe", (api, op) => api.estado("33", op)],
    ["municipios de un estado que no existe", (api, op) => api.municipios("33", op)],
    ["municipio que no existe", (api, op) => api.municipio("99999", op)],
    ["municipio de un estado que existe", (api, op) => api.municipio("25999", op)],
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
    // Los tipos no dejan escribir estas tres; la API y el paquete las rechazan igual. Cambio: con
    // consultar, porque diasHabiles las rechaza antes con un TypeError (tipoPlazo).
    [
      "SAT sin tipo_plazo",
      (api, op) =>
        api.consultar(
          "/v1/dias-habiles",
          { autoridad: "sat", desde: "2026-07-17", dias: 3 } as never,
          op,
        ),
    ],
    [
      "LFT con tipo_plazo",
      (api, op) =>
        api.consultar(
          "/v1/dias-habiles",
          { autoridad: "lft", tipo_plazo: "general", desde: "2026-07-17", dias: 3 } as never,
          op,
        ),
    ],
    [
      "CNBV con tipo_plazo",
      (api, op) =>
        api.consultar(
          "/v1/dias-habiles",
          { autoridad: "cnbv", tipo_plazo: "general", desde: "2026-07-17", dias: 3 } as never,
          op,
        ),
    ],
    [
      "tipo_plazo que no existe",
      (api, op) =>
        api.consultar(
          "/v1/dias-habiles",
          { autoridad: "sat", tipo_plazo: "anual", desde: "2026-07-17", dias: 3 } as never,
          op,
        ),
    ],
    [
      "SAT general fuera de su cobertura",
      (api, op) =>
        api.diasHabiles({ autoridad: "sat", tipoPlazo: "general", desde: satGeneral, dias: 5 }, op),
    ],
    // Cambio: declaraciones_pagos llega a 2100 con la regla del art. 12 (antes, al 2026-12-31).
    [
      "SAT declaraciones_pagos fuera de su cobertura",
      (api, op) =>
        api.diasHabiles(
          { autoridad: "sat", tipoPlazo: "declaraciones_pagos", desde: satPagos, dias: 3 },
          op,
        ),
    ],
    [
      "CNBV fuera de su cobertura",
      (api, op) => api.diasHabiles({ autoridad: "cnbv", desde: cnbv, dias: 3 }, op),
    ],
    [
      "CNBV antes de su cobertura",
      (api, op) => api.diasHabiles({ autoridad: "cnbv", desde: "2024-12-20", dias: 3 }, op),
    ],
    [
      "días inhábiles SAT del año después de su cobertura",
      (api, op) => api.diasInhabiles({ autoridad: "sat", anio: satFuera }, op),
    ],
    [
      "días inhábiles CNBV 2024",
      (api, op) => api.diasInhabiles({ autoridad: "cnbv", anio: 2024 }, op),
    ],
    ["días inhábiles LFT 2101", (api, op) => api.diasInhabiles({ anio: 2101 }, op)],
    ["UMA de 2016", (api, op) => api.uma(2016, op)],
    ["UMA que todavía no se carga", (api, op) => api.uma(umaFutura, op)],
    ["UMA vigente antes de la primera", (api, op) => api.umaVigente("2017-01-31", op)],
    ["UMA vigente después de la última", (api, op) => api.umaVigente(`${ultimaUma + 1}-02-01`, op)],
    ["UMA vigente sin fecha", (api, op) => api.consultar("/v1/constantes/uma", {} as never, op)],
    ["UMA vigente con fecha inválida", (api, op) => api.umaVigente("2026-02-30", op)],
    ["salario mínimo de 2018", (api, op) => api.salarioMinimo(2018, op)],
    ["salario mínimo que todavía no se carga", (api, op) => api.salarioMinimo(salarioFuturo, op)],
    ["tarifa mensual de ISR de 2025", (api, op) => api.tarifaIsr("mensual", 2025, op)],
    [
      "tarifa anual de ISR que todavía no se carga",
      (api, op) => api.tarifaIsr("anual", isrFutura, op),
    ],
    [
      "parámetro desconocido en una constante",
      (api, op) =>
        api.consultar("/v1/constantes/uma/{anio}", { anio: 2026, zona: "x" } as never, op),
    ],
    ["año 0", (api, op) => api.diasInhabiles({ anio: 0 }, op)],
    ["año de 5 dígitos", (api, op) => api.diasInhabiles({ anio: 10_000 }, op)],
    [
      "autoridad que no existe",
      (api, op) =>
        api.diasHabiles({ desde: "2026-11-13", dias: 3, autoridad: "imss" as "lft" }, op),
    ],
    [
      "permitir_incompleto que no es booleano",
      (api, op) =>
        api.consultar(
          "/v1/dias-habiles",
          { autoridad: "lft", desde: "2026-11-13", dias: 3, permitir_incompleto: "si" } as never,
          op,
        ),
    ],
    ["desde vacío", (api, op) => api.diasHabiles({ desde: "", dias: 3 }, op)],
    ["fecha vacía", (api, op) => api.consultar("/v1/udis", { fecha: "" }, op)],
    [
      "falta un obligatorio",
      (api, op) =>
        api.consultar("/v1/dias-habiles", { autoridad: "lft", desde: "2026-11-13" } as never, op),
    ],
    [
      "parámetro desconocido en una ruta sin query",
      (api, op) => api.consultar("/v1/estados", { orden: "nombre" } as never, op),
    ],
    [
      "parámetro desconocido junto a uno inválido",
      (api, op) => api.consultar("/v1/udis", { fecha: "ayer", hora: "12" } as never, op),
    ],
    [
      "parámetro desconocido en la CLABE",
      (api, op) => api.consultar("/v1/clabe/{clabe}", { clabe: CLABE, banco: "002" } as never, op),
    ],
    [
      "parámetro sin nombre",
      (api, op) => api.consultar("/v1/udis", { fecha: "2026-10-20", "": "1" } as never, op),
    ],
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
      expect(dePaquete.origen, nombre).toBe("paquete");
      expect(dePaquete.data, nombre).toEqual(deApi.data);
      expect(dePaquete.meta, nombre).toEqual(deApi.meta);
      // Las mismas advertencias de primer nivel; la de antigüedad de una serie y la del último FIX
      // (cambio: pueden faltar publicaciones, como en el MCP) son solo del paquete.
      const { AVISO_SIN_API, codigoAviso } = await importar<{
        AVISO_SIN_API: string;
        codigoAviso: (texto: string) => string;
      }>("index.js");
      const propias = dePaquete.advertencias.filter(
        (a) => !/^Los datos de .* del paquete/.test(a) && a !== AVISO_SIN_API,
      );
      expect(propias, nombre).toEqual(deApi.advertencias);
      // Con las dos fuentes, avisos son las advertencias con su código, ninguna sin código.
      for (const r of [deApi, dePaquete]) {
        expect(r.avisos, nombre).toEqual(
          r.advertencias.map((texto) => ({ codigo: codigoAviso(texto), texto })),
        );
        for (const a of r.avisos ?? []) expect(a.codigo, a.texto).not.toBe("otro");
      }
    }
  });

  /** Cada consulta da el mismo problema con la API y con el paquete, como MexicoApiError. */
  async function mismosProblemas(casos: readonly Consulta[]): Promise<void> {
    const api = m.crearCliente({ base });
    for (const [nombre, consultar] of casos) {
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
  }

  it("los problem+json de la API llegan como MexicoApiError, como los del paquete", async () => {
    await mismosProblemas(problemas());
  });

  // Con los datos de hoy hay días hábiles entre el último FIX y el feriado: los dos cargan el
  // calendario de la CNBV y dan dato-no-disponible. El caso con el feriado pegado a los datos se
  // prueba con datos de ejemplo (test/cliente/fix-feriados.test.ts).
  it.skipIf(FERIADO === undefined)(
    "con un feriado bancario después del último FIX, la API y el paquete dan el mismo problema",
    async () => {
      const feriado = FERIADO as string;
      await mismosProblemas([
        [
          "FIX publicado en un feriado después de los datos",
          (api, op) => api.fixPublicado(feriado, op),
        ],
        [
          "operación después de un feriado sin FIX cargado",
          (api, op) => api.fixParaOperacion(mover(feriado, 1), op),
        ],
      ]);
    },
  );

  it("las reglas de la ruta del cliente dan el mismo 400 que el Worker", async () => {
    const api = m.crearCliente({ base });
    const casos: [string, string, (valor: string) => Promise<unknown>][] = [
      ["/v1/estados/{cve_ent}", "2", (v) => api.estado(v, API)],
      ["/v1/estados/{cve_ent}", "e", (v) => api.estado(v, API)],
      ["/v1/estados/{cve_ent}/municipios", "251", (v) => api.municipios(v, API)],
      ["/v1/municipios/{cvegeo}", "5", (v) => api.municipio(v, API)],
      ["/v1/municipios/{cvegeo}", "2500", (v) => api.municipio(v, API)],
      ["/v1/bancos/{codigo}", "3", (v) => api.banco(v, API)],
      ["/v1/bancos/{codigo}", "02", (v) => api.banco(v, API)],
      ["/v1/clabe/{clabe}", "1", (v) => api.clabe(v, API)],
      ["/v1/clabe/{clabe}", "8", (v) => api.clabe(v, API)],
      ["/v1/clabe/{clabe}", "a", (v) => api.clabe(v, API)],
      ["/v1/clabe/{clabe}", CLABE.slice(0, 17), (v) => api.clabe(v, API)],
      ["/v1/constantes/uma/{anio}", "26", (v) => api.uma(Number(v), API)],
      [
        "/v1/constantes/uma/{anio}",
        "0000",
        (v) => api.consultar("/v1/constantes/uma/{anio}", { anio: v } as never, API),
      ],
      [
        "/v1/constantes/salario-minimo/{anio}",
        "x",
        (v) => api.consultar("/v1/constantes/salario-minimo/{anio}", { anio: v } as never, API),
      ],
      ["/v1/isr/tarifa/{periodo}/2026", "semanal", (v) => api.tarifaIsr(v as "mensual", 2026, API)],
      [
        "/v1/isr/tarifa/semanal/{anio}",
        "20260",
        (v) => api.tarifaIsr("semanal" as "mensual", Number(v), API),
      ],
    ];
    for (const [plantilla, valor, consultar] of casos) {
      const ruta = plantilla.replace(/\{\w+\}/, valor);
      const directa = await fetch(new URL(ruta, base));
      const delWorker = (await directa.json()) as Record<string, unknown>;
      const local = await errorDe(consultar(valor));
      expect(local.origen, ruta).toBe("paquete");
      expect(delWorker.instance, ruta).toBe(ruta);
      expect(local.problema.instance, ruta).toBe(plantilla.includes("{clabe}") ? plantilla : ruta);
      const { instance: _a, ...restoWorker } = delWorker;
      const { instance: _b, ...restoLocal } = local.problema;
      expect(restoLocal, ruta).toEqual(restoWorker);
      expect(local.status, ruta).toBe(directa.status);
    }
  });

  it("los errores traen las claves públicas de la ruta y el 404 es el mismo que el del Worker", async () => {
    const api = m.crearCliente({ base });
    const sinBarra = base.replace(/\/$/, "");
    const casos: [string, string, (op: OpcionesConsulta) => Promise<unknown>][] = [
      ["/v1/municipios/25999", "No existe el municipio 25999.", (op) => api.municipio("25999", op)],
      ["/v1/bancos/999", "No existe el banco 999.", (op) => api.banco("999", op)],
    ];
    for (const [ruta, detalle, consultar] of casos) {
      const delWorker = (await (await fetch(new URL(ruta, base))).json()) as { detail: string };
      expect(delWorker.detail, ruta).toBe(detalle);
      for (const op of [API, PAQUETE]) {
        const error = await errorDe(consultar(op));
        expect(error.status, ruta).toBe(404);
        expect(error.tipo, ruta).toBe("no-encontrado");
        expect(error.detail, ruta).toBe(detalle);
        expect(error.message, ruta).toBe(`404 Recurso no encontrado: ${detalle}`);
        expect(error.problema.instance, ruta).toBe(ruta);
        expect(error.url, ruta).toBe(`${sinBarra}${ruta}`);
      }
    }
  });

  it("la CLABE no aparece en errores, URLs ni causas", async () => {
    const api = m.crearCliente({ base });
    const error = await errorDe(api.consultar("/v1/clabe/{clabe}", { clabe: "1" }, API));
    expect(error.problema.instance).toBe("/v1/clabe/{clabe}");
    expect(error.url).toBe(`${base.replace(/\/$/, "")}/v1/clabe/{clabe}`);
    const largo = await errorDe(
      api.consultar("/v1/clabe/{clabe}", { clabe: CLABE, banco: "002" } as never, API),
    );
    expect(`${largo.message} ${JSON.stringify(largo.problema)} ${largo.url}`).not.toContain(CLABE);
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

  it("si la API falla al revalidar, usa la respuesta guardada dentro del stale-if-error del Worker", async () => {
    let caida = false;
    const api = m.crearCliente({
      base,
      cache: { ttlMs: 1 },
      reintentos: 0,
      fetch: (url, init) =>
        caida ? Promise.reject(new TypeError("fetch failed")) : fetch(url, init),
    });
    const fecha = enMedio(udis.serie).fecha;
    const primera = await api.udi(fecha);
    expect(primera.origen).toBe("api");
    await new Promise((resolver) => setTimeout(resolver, 5));
    caida = true;
    const guardada = await api.udi(fecha);
    expect(guardada.origen).toBe("api");
    expect(guardada.data).toBe(primera.data);
    expect(guardada.advertencias).toHaveLength(1);
    expect(guardada.advertencias[0]).toMatch(/^Respuesta guardada de la API, de hace \d+ s/);
    expect(guardada.avisos).toEqual([
      { codigo: "respuesta-guardada", texto: guardada.advertencias[0] },
    ]);
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
