// Respuestas del cliente sin red para los calendarios de la CNBV y el SAT y las constantes, que
// corren igual sobre src y sobre dist. Se comparan con las entradas de datos del paquete y el
// núcleo; los textos que dependen de la cobertura se arman con la cobertura de los datos.
import { readFileSync } from "node:fs";
import { diasDescansoCff } from "@mexicoapi/core";
import { beforeAll, expect, it } from "vitest";
import type { Cliente, ConsultaDiasHabiles, MexicoApiError } from "../../src/cliente/index.js";
import type { CoberturaSerie } from "../../src/index.js";
import type { Modulo } from "../comun.js";
import { esperarCongelado } from "../datos/comun.js";
import type { ModuloCalendarios, ModuloConstantes } from "../datos/curados.js";
import { PROBLEMAS, rechazo } from "./ayudas.js";
import { AVISO_LFT, type ModuloCliente, mover } from "./comun.js";

export interface ModulosCurados {
  cliente: ModuloCliente;
  calendarios: ModuloCalendarios;
  constantes: ModuloConstantes;
  mexicoapi: Modulo;
}

const DOCS_API = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#";

const PLAZOS_SAT = (
  JSON.parse(
    readFileSync(
      new URL("../../../../data/dias-inhabiles-sat/calendario.json", import.meta.url),
      "utf8",
    ),
  ) as { plazos: Record<"general" | "declaraciones_pagos", { cobertura: CoberturaSerie }> }
).plazos;

/**
 * Si el plazo general del SAT termina antes que declaraciones_pagos, porque faltan vacaciones por
 * publicar: entonces tiene respaldo y la lista del año lo advierte. Se lee de data/ al definir las
 * pruebas, para saltar las que solo aplican entonces.
 */
const SAT_GENERAL_CORTO =
  PLAZOS_SAT.general.cobertura.hasta < PLAZOS_SAT.declaraciones_pagos.cobertura.hasta;

const cubre = ({ desde, hasta }: CoberturaSerie): string => `cubre del ${desde} al ${hasta}`;
const siguiente = (fecha: string): string =>
  new Date(Date.parse(fecha) + 86_400_000).toISOString().slice(0, 10);

export function probarCuradosSinRed(cargar: () => Promise<ModulosCurados>): void {
  let m: ModulosCurados;
  let api: Cliente;

  beforeAll(async () => {
    m = await cargar();
    api = m.cliente.crearCliente({ offline: true });
  });

  async function problemaDe(consulta: Promise<unknown>, tipo: string, status: number) {
    const error = (await rechazo(consulta)) as MexicoApiError;
    expect(error).toBeInstanceOf(m.cliente.MexicoApiError);
    expect(error.origen).toBe("paquete");
    expect(error.type).toBe(PROBLEMAS + tipo);
    expect(error.status).toBe(status);
    return error;
  }

  it("suma días hábiles con los calendarios de la CNBV y el SAT", async () => {
    const casos = [
      ["cnbv", "general", "2026-12-23", 3],
      ["sat", "general", "2026-07-17", 3],
      ["sat", "declaraciones_pagos", "2026-07-17", 3],
    ] as const;
    for (const [autoridad, tipoPlazo, desde, dias] of casos) {
      const consulta: ConsultaDiasHabiles =
        autoridad === "sat" ? { autoridad, tipoPlazo, desde, dias } : { autoridad, desde, dias };
      const r = await api.diasHabiles(consulta);
      const nucleo = m.mexicoapi.sumarDiasHabiles({
        calendario: m.calendarios.calendario(autoridad, tipoPlazo),
        desde,
        dias,
      });
      // Nuevo: declaraciones_pagos vence el 22 de julio, de vacaciones del SAT: avisa de la
      // prórroga del art. 12, como la API. El resultado es el mismo.
      expect(r.data).toEqual(
        tipoPlazo === "declaraciones_pagos"
          ? {
              ...nucleo,
              advertencias: [
                `El resultado (${nucleo.resultado}) es día de vacaciones del SAT. El art. 12 del CFF, quinto párrafo, prorroga el plazo al siguiente día hábil si ese día están cerradas las oficinas donde se hace el trámite, incluidos los bancos que reciben el pago, o si es viernes y el pago se hace en una institución de crédito autorizada. El resultado no incluye esa prórroga.`,
              ],
            }
          : nucleo,
      );
      expect(r.meta).toEqual({ ...m.calendarios.meta[autoridad], docs: `${DOCS_API}dias-habiles` });
      expect(r.origen).toBe("paquete");
      esperarCongelado(r, "respuesta");
    }
    const general = await api.diasHabiles({
      autoridad: "sat",
      tipoPlazo: "general",
      desde: "2026-07-17",
      dias: 3,
    });
    expect(general.data.resultado).toBe("2026-08-05");
  });

  it("pide tipo_plazo con el SAT y lo rechaza con las demás autoridades", async () => {
    const falta = await problemaDe(
      // @ts-expect-error con el SAT el tipo de plazo es obligatorio
      api.diasHabiles({ autoridad: "sat", desde: "2026-07-17", dias: 3 }),
      "parametro-faltante",
      400,
    );
    expect(falta.detail).toBe(
      "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
    );
    expect(falta.problema.parametro).toBe("tipo_plazo");
    for (const autoridad of ["lft", "cnbv"] as const) {
      const sobra = await problemaDe(
        // @ts-expect-error el tipo de plazo solo va con el SAT
        api.diasHabiles({ autoridad, tipoPlazo: "general", desde: "2026-07-17", dias: 3 }),
        "parametro-invalido",
        400,
      );
      expect(sobra.detail).toBe("El parámetro tipo_plazo solo se acepta con autoridad=sat.");
    }
    const consultar = api.consultar as unknown as (
      ruta: string,
      parametros: Record<string, unknown>,
    ) => Promise<unknown>;
    const malo = await problemaDe(
      consultar("/v1/dias-habiles", {
        autoridad: "sat",
        tipo_plazo: "anual",
        desde: "2026-07-17",
        dias: 3,
      }),
      "parametro-invalido",
      400,
    );
    expect(malo.detail).toBe(
      "El tipo de plazo (tipo_plazo) debe ser general o declaraciones_pagos.",
    );
    const otra = await problemaDe(
      consultar("/v1/dias-habiles", { autoridad: "imss", desde: "2026-07-17", dias: 3 }),
      "parametro-invalido",
      400,
    );
    expect(otra.detail).toBe("Autoridades disponibles: lft, cnbv y sat.");
  });

  it("da los 422 de cobertura con el texto de la API", async () => {
    const cnbv = m.calendarios.calendarioCurado("cnbv");
    const despuesCnbv = siguiente(cnbv.amplia.hasta);
    const fuera = await problemaDe(
      api.diasHabiles({ autoridad: "cnbv", desde: cnbv.amplia.hasta, dias: 3 }),
      "calendario-incompleto",
      422,
    );
    expect(fuera.detail).toBe(
      `El calendario de la CNBV no cubre ${despuesCnbv}; ${cubre(cnbv.amplia)}.`,
    );
    expect(fuera.problema).toMatchObject({
      autoridad: "cnbv",
      fecha: despuesCnbv,
      cobertura: cnbv.amplia,
    });

    const lft = await problemaDe(
      api.diasHabiles({ desde: "2100-12-30", dias: 2 }),
      "calendario-incompleto",
      422,
    );
    expect(lft.detail).toBe(
      "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
    );
  });

  it.skipIf(!SAT_GENERAL_CORTO)("el 422 del SAT general dice por qué no cubre", async () => {
    const sat = m.calendarios.calendarioCurado("sat");
    const general = sat.general.cobertura;
    const corto = await problemaDe(
      api.diasHabiles({ autoridad: "sat", tipoPlazo: "general", desde: general.hasta, dias: 5 }),
      "calendario-incompleto",
      422,
    );
    const pagos = sat.plazos.get("declaraciones_pagos")?.cobertura as CoberturaSerie;
    expect(corto.detail).toBe(
      `El calendario del SAT para tipo_plazo=general no cubre ${siguiente(general.hasta)}; ${cubre(general)} porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, ${cubre(pagos)}.`,
    );
    expect(corto.problema.cobertura).toEqual(general);
  });

  it.skipIf(!SAT_GENERAL_CORTO)("con permitir_incompleto usa el respaldo y avisa", async () => {
    const sat = m.calendarios.calendarioCurado("sat");
    const { general } = sat;
    if (general.respaldo === undefined) throw new Error("El SAT general no tiene respaldo");
    const r = await api.diasHabiles({
      autoridad: "sat",
      tipoPlazo: "general",
      desde: general.cobertura.hasta,
      dias: 20,
      permitirIncompleto: true,
    });
    const esperado = m.mexicoapi.sumarDiasHabiles({
      calendario: general.respaldo,
      desde: general.cobertura.hasta,
      dias: 20,
      permitirIncompleto: true,
    });
    expect(r.data.resultado).toBe(esperado.resultado);
    expect(r.data.inhabiles_saltados).toEqual(esperado.inhabiles_saltados);
    expect(r.data.advertencias[0]).toBe(
      `Calendario incompleto: SAT con tipo_plazo=general ${cubre(general.cobertura)}; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.`,
    );
    // Cambio: 60 días ya no pasan de la cobertura amplia (la regla del art. 12 llega a 2100):
    // solo el aviso del respaldo, y se descuentan los días publicados entre semana del tramo, que
    // salen de los datos (hoy, el 25 de diciembre, el 1 de enero y el primer lunes de febrero).
    const largo = await api.diasHabiles({
      autoridad: "sat",
      tipoPlazo: "general",
      desde: general.cobertura.hasta,
      dias: 60,
      permitirIncompleto: true,
    });
    expect(largo.data.advertencias).toHaveLength(1);
    const entreSemana = (fecha: string): boolean => ![0, 6].includes(new Date(fecha).getUTCDay());
    expect(largo.data.inhabiles_saltados.map((d) => d.fecha).filter(entreSemana)).toEqual(
      sat.dias
        .map((d) => d.fecha)
        .filter((f) => f > general.cobertura.hasta && f <= largo.data.resultado && entreSemana(f)),
    );
    // Más allá de la cobertura amplia se suma el aviso del núcleo.
    const fuera = Number(sat.amplia.hasta.slice(0, 4)) + 1;
    const lejos = await api.diasHabiles({
      autoridad: "sat",
      tipoPlazo: "general",
      desde: mover(sat.amplia.hasta, -11),
      dias: 20,
      permitirIncompleto: true,
    });
    expect(lejos.data.advertencias).toHaveLength(2);
    expect(lejos.data.advertencias[1]).toMatch(
      new RegExp(`^Calendario incompleto: SAT ${fuera}; solo se`),
    );
    // Si el cálculo no entra en la zona incompleta, no hay aviso.
    const dentro = await api.diasHabiles({
      autoridad: "sat",
      tipoPlazo: "general",
      desde: "2026-07-17",
      dias: 3,
      permitirIncompleto: true,
    });
    expect(dentro.data.advertencias).toEqual([]);
  });

  it("lista los días inhábiles con las advertencias de primer nivel de la API", async () => {
    const cnbv = await api.diasInhabiles({ autoridad: "cnbv", anio: 2026 });
    expect(cnbv.data).toEqual(
      m.calendarios.calendarioCurado("cnbv").dias.filter((d) => d.fecha.startsWith("2026-")),
    );
    expect(cnbv.advertencias).toEqual([]);
    expect(cnbv.meta.docs).toBe(`${DOCS_API}dias-inhabiles`);
    const sat = await api.diasInhabiles({ autoridad: "sat", anio: 2026 });
    expect(sat.data).toEqual(
      m.calendarios.calendarioCurado("sat").dias.filter((d) => d.fecha.startsWith("2026-")),
    );
    const { general, amplia } = m.calendarios.calendarioCurado("sat");
    // Mientras falte el segundo periodo de vacaciones de 2026, la lista lo advierte.
    expect(sat.advertencias).toEqual(
      SAT_GENERAL_CORTO
        ? [
            `Los días de tipo vacaciones del SAT solo están completos del ${general.cobertura.desde} al ${general.cobertura.hasta}; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa.`,
          ]
        : [],
    );
    const lft = await api.diasInhabiles({ anio: 2026 });
    // La lista de la LFT está completa, con el aviso fijo de lo que no incluye (art. 715).
    expect(lft.advertencias).toEqual([AVISO_LFT]);
    // Cambio: el año después de las vacaciones publicadas (hoy 2027) ya se responde con los días
    // del art. 12. Sale de los datos: capturar las vacaciones de 2027 lo mueve al siguiente.
    const sinVacaciones = Number(general.cobertura.hasta.slice(0, 4)) + 1;
    const regla = await api.diasInhabiles({ autoridad: "sat", anio: sinVacaciones });
    expect(regla.data).toEqual(diasDescansoCff(sinVacaciones));
    expect(regla.data).toEqual(
      m.calendarios
        .calendarioCurado("sat")
        .dias.filter((d) => d.fecha.startsWith(`${sinVacaciones}-`)),
    );
    expect(regla.advertencias).toEqual([
      `Los días de tipo vacaciones del SAT solo están completos del ${general.cobertura.desde} al ${general.cobertura.hasta}; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de ${sinVacaciones} está completa.`,
    ]);
    // El año después de la cobertura amplia sale de los datos (hoy 2101, por la regla).
    const fuera = Number(amplia.hasta.slice(0, 4)) + 1;
    const sinAnio = await problemaDe(
      api.diasInhabiles({ autoridad: "sat", anio: fuera }),
      "calendario-incompleto",
      422,
    );
    expect(sinAnio.detail).toBe(
      `El calendario del SAT no cubre el año ${fuera}; ${cubre(amplia)}.`,
    );
    expect(sinAnio.problema.fecha).toBe(`${fuera}-01-01`);
    const lftLejos = await problemaDe(
      api.diasInhabiles({ anio: 2200 }),
      "calendario-incompleto",
      422,
    );
    expect(lftLejos.detail).toBe(
      "El calendario de la LFT no cubre el año 2200; cubre del 2007-01-01 al 2100-12-31.",
    );
  });

  it("responde la UMA, el salario mínimo y las tarifas de ISR del paquete", async () => {
    const c = m.constantes;
    const ultima = c.umas().at(-1)?.anio as number;
    const uma = await api.uma(ultima);
    expect(uma.data).toBe(c.uma(ultima));
    expect(uma.meta).toEqual(c.meta.uma);
    const vigente = await api.umaVigente("2026-01-15");
    expect(vigente.data).toBe(c.uma(2025));
    expect(vigente.meta).toEqual({ ...c.meta.uma, docs: `${DOCS_API}constantes` });
    const salario = await api.salarioMinimo(2026);
    expect(salario.data).toEqual(c.salarioMinimo(2026));
    expect(salario.meta).toEqual(c.meta.salarioMinimo);
    const isr = await api.tarifaIsr("mensual", 2026);
    expect(isr.data).toBe(c.tarifaIsr("mensual", 2026));
    expect(isr.meta).toEqual(c.meta.isr);
    esperarCongelado(salario, "salario");
  });

  it("dice los años que no están como la API: antes no existen, después no se cargan", async () => {
    const { anios } = m.constantes;
    const rango = (lista: readonly number[]) =>
      lista.length === 1
        ? `el único año cargado es ${lista[0]}`
        : `los años cargados van de ${lista[0]} a ${lista.at(-1)}`;
    const umaAntes = (anios.uma[0] as number) - 1;
    const antes = await problemaDe(api.uma(umaAntes), "no-encontrado", 404);
    expect(antes.detail).toBe(`No existe la UMA de ${umaAntes} en los datos; ${rango(anios.uma)}.`);
    expect(antes.problema.instance).toBe(`/v1/constantes/uma/${umaAntes}`);
    const despues = await problemaDe(api.uma(2090), "dato-no-disponible", 404);
    expect(despues.detail).toBe(`Todavía no se carga la UMA de 2090; ${rango(anios.uma)}.`);
    const salario = await problemaDe(api.salarioMinimo(2090), "dato-no-disponible", 404);
    expect(salario.detail).toBe(
      `Todavía no se carga el salario mínimo de 2090; ${rango(anios.salarioMinimo)}.`,
    );
    const mensualAntes = (anios.isr.mensual[0] as number) - 1;
    const isr = await problemaDe(api.tarifaIsr("mensual", mensualAntes), "no-encontrado", 404);
    expect(isr.detail).toBe(
      `No existe la tarifa mensual de ISR de ${mensualAntes} en los datos; ${rango(anios.isr.mensual)}.`,
    );

    const umas = m.constantes.umas();
    const primera = umas[0];
    const ultima = umas.at(-1);
    if (primera === undefined || ultima === undefined) throw new Error("Sin UMA");
    const cobertura = { desde: primera.vigencia_desde, hasta: `${ultima.anio + 1}-01-31` };
    const vieja = await problemaDe(api.umaVigente("2000-06-01"), "no-encontrado", 404);
    expect(vieja.detail).toBe(
      `Los datos empiezan con la UMA de ${primera.anio}, vigente desde el ${cobertura.desde}; no incluyen la UMA vigente el 2000-06-01.`,
    );
    expect(vieja.problema).toMatchObject({ fecha: "2000-06-01", cobertura });
    const futura = await problemaDe(api.umaVigente("2090-06-01"), "dato-no-disponible", 404);
    expect(futura.detail).toBe(
      `La UMA vigente el 2090-06-01 todavía no está cargada; la última cargada es la de ${ultima.anio}, vigente hasta el ${cobertura.hasta}.`,
    );
  });

  it("revisa el año, el periodo y la fecha con las reglas de la API", async () => {
    const anio = "El año (anio) debe tener 4 dígitos, de 0001 a 9999.";
    for (const consulta of [api.uma(26), api.salarioMinimo(0), api.tarifaIsr("anual", 20260)]) {
      const error = await problemaDe(consulta, "parametro-invalido", 400);
      expect(error.detail).toBe(anio);
      expect(error.problema.parametro).toBe("anio");
    }
    const periodo = await problemaDe(
      api.tarifaIsr("semanal" as "mensual", 2026),
      "parametro-invalido",
      400,
    );
    expect(periodo.detail).toBe("El periodo de la tarifa debe ser mensual o anual.");
    expect(periodo.problema.parametro).toBe("periodo");
    const fecha = await problemaDe(api.umaVigente("2026-13-01"), "parametro-invalido", 400);
    expect(fecha.detail).toBe(
      "La fecha que se consulta (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    const falta = await problemaDe(
      api.consultar("/v1/constantes/uma", {} as never),
      "parametro-faltante",
      400,
    );
    expect(falta.detail).toBe("Falta el parámetro fecha.");
  });
}
