import { describe, expect, it } from "vitest";
import { crearCalendario } from "../../src/dias-habiles/calendario.js";
import {
  type CalendarioCurado,
  crearCalendarioCurado,
  type DatosCalendarioCurado,
  diasInhabilesCurados,
  exigirAnio,
  feriadosBancarios,
  PLAZOS,
  revisarPlazos,
  sumarDiasHabilesCurado,
} from "../../src/dias-habiles/curados.js";
import { COBERTURA_LFT } from "../../src/dias-habiles/lft.js";
import { sumarDiasHabiles } from "../../src/dias-habiles/sumar.js";
import type { TipoPlazo } from "../../src/dias-habiles/tipos.js";
import { CalendarioIncompletoError, FechaFueraDeRangoError } from "../../src/errores.js";
import {
  DIAS_CNBV,
  DIAS_SAT,
  FUENTE_CFF,
  FUENTE_CNBV,
  FUENTE_CNBV_2025,
  PRIMER_PERIODO,
  SHARD_CNBV,
  SHARD_SAT,
} from "./ejemplos-curados.js";

const COBERTURA_GENERAL = { desde: "2026-01-01", hasta: "2026-11-30" };
const COBERTURA_DECLARACIONES = { desde: "2026-01-01", hasta: "2026-12-31" };
const COBERTURA_CNBV = { desde: "2025-01-01", hasta: "2026-12-31" };

const AVISO_GENERAL =
  "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.";

const DETALLE_GENERAL = (fecha: string) =>
  `El calendario del SAT para tipo_plazo=general no cubre ${fecha}; cubre del 2026-01-01 al 2026-11-30 porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre del 2026-01-01 al 2026-12-31.`;

const ADVERTENCIA_SAT_2026 =
  "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa.";

const SAT = crearCalendarioCurado(SHARD_SAT);
const CNBV = crearCalendarioCurado(SHARD_CNBV);

const fechas = (dias: readonly { fecha: string }[]) => dias.map((d) => d.fecha);

/** Lo que daría el núcleo con el calendario del plazo, sin respaldo ni textos. */
function delNucleo(datos: DatosCalendarioCurado, tipo: TipoPlazo, desde: string, dias: number) {
  const plazo = datos.plazos[tipo];
  if (plazo === undefined) throw new Error(tipo);
  const { cobertura, excluir_tipos } = plazo;
  const calendario = crearCalendario({
    autoridad: datos.autoridad,
    cobertura,
    dias: datos.dias.filter((d) => d.fecha >= cobertura.desde && d.fecha <= cobertura.hasta),
    fuenteFinDeSemana: (anio) => datos.fuentes_fin_de_semana[String(anio)] as typeof FUENTE_CFF,
    excluirTipos: excluir_tipos,
  });
  return sumarDiasHabiles({ calendario, desde, dias });
}

/** El error que lanza `hacer`, que debe ser CalendarioIncompletoError. */
function incompleto(hacer: () => unknown): CalendarioIncompletoError {
  try {
    hacer();
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarioIncompletoError);
    return error as CalendarioIncompletoError;
  }
  throw new Error("Se esperaba CalendarioIncompletoError");
}

const sat = (
  tipoPlazo: TipoPlazo,
  desde: string,
  dias: number,
  permitirIncompleto?: boolean,
  calendario: CalendarioCurado = SAT,
) => sumarDiasHabilesCurado(calendario, { tipoPlazo, desde, dias, permitirIncompleto });

describe("PLAZOS y revisarPlazos", () => {
  it("cada autoridad tiene un plazo general que cuenta todos los tipos de día", () => {
    expect(PLAZOS.cnbv).toEqual({ general: [] });
    expect(PLAZOS.sat).toEqual({ general: [], declaraciones_pagos: ["vacaciones"] });
    expect(Object.isFrozen(PLAZOS.sat)).toBe(true);
    expect(Object.isFrozen(PLAZOS.sat.declaraciones_pagos)).toBe(true);
  });

  it("da la cobertura de cada plazo y la amplia, la del plazo que contiene a los demás", () => {
    const revision = revisarPlazos(
      PLAZOS.sat,
      {
        descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
        vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
      },
      [{ fecha: "2026-12-25" }],
    );
    expect(revision).toEqual({
      plazos: {
        general: { cobertura: COBERTURA_GENERAL, excluir_tipos: [] },
        declaraciones_pagos: {
          cobertura: COBERTURA_DECLARACIONES,
          excluir_tipos: ["vacaciones"],
        },
      },
      amplia: COBERTURA_DECLARACIONES,
      fallas: [],
    });
  });

  it("la cobertura de un plazo es la intersección de las de los tipos de día que cuenta", () => {
    const { plazos } = revisarPlazos(
      PLAZOS.sat,
      {
        descanso: { desde: "2026-02-01", hasta: "2026-12-31" },
        vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
      },
      [],
    );
    expect(plazos.general?.cobertura).toEqual({ desde: "2026-02-01", hasta: "2026-11-30" });
  });

  it("falla si ningún plazo contiene la cobertura de los demás", () => {
    const revision = revisarPlazos(
      { general: [], declaraciones_pagos: ["vacaciones"], otro: ["descanso"] } as never,
      {
        descanso: { desde: "2026-01-01", hasta: "2026-06-30" },
        vacaciones: { desde: "2026-03-01", hasta: "2026-12-31" },
      },
      [],
    );
    expect(revision).toEqual({
      plazos: {},
      amplia: null,
      fallas: ["ningún tipo de plazo contiene la cobertura de los demás"],
    });
  });

  it("falla si un plazo queda sin cobertura o con una cobertura vacía", () => {
    expect(revisarPlazos(PLAZOS.sat, { vacaciones: COBERTURA_DECLARACIONES }, []).fallas).toEqual([
      "el plazo declaraciones_pagos no tiene cobertura de un tipo de día que cuente",
    ]);
    expect(
      revisarPlazos(
        PLAZOS.sat,
        {
          descanso: { desde: "2026-01-01", hasta: "2026-03-31" },
          vacaciones: { desde: "2026-06-01", hasta: "2026-12-31" },
        },
        [],
      ),
    ).toEqual({ plazos: {}, amplia: null, fallas: ["la cobertura del plazo general queda vacía"] });
  });

  it("falla con cada día que no cae en la cobertura amplia", () => {
    const { fallas } = revisarPlazos(PLAZOS.cnbv, { descanso: COBERTURA_DECLARACIONES }, [
      { fecha: "2025-12-12" },
      { fecha: "2026-12-12" },
      { fecha: "2027-01-01" },
    ]);
    expect(fallas).toEqual([
      "2025-12-12: no cae en la cobertura de ningún tipo de plazo (general del 2026-01-01 al 2026-12-31)",
      "2027-01-01: no cae en la cobertura de ningún tipo de plazo (general del 2026-01-01 al 2026-12-31)",
    ]);
  });
});

describe("crearCalendarioCurado", () => {
  it("arma un calendario por tipo de plazo, en el orden del shard", () => {
    expect(SAT.autoridad).toBe("sat");
    expect([...SAT.plazos.keys()]).toEqual(["general", "declaraciones_pagos"]);
    expect(SAT.general).toBe(SAT.plazos.get("general"));
    expect(SAT.general.cobertura).toEqual(COBERTURA_GENERAL);
    expect(SAT.general.excluirTipos).toEqual([]);
    expect(SAT.plazos.get("declaraciones_pagos")?.excluirTipos).toEqual(["vacaciones"]);
    expect(SAT.amplia).toEqual(COBERTURA_DECLARACIONES);
    expect(SAT.dias).toEqual(DIAS_SAT);
    expect([...CNBV.plazos.keys()]).toEqual(["general"]);
    expect(CNBV.amplia).toEqual(COBERTURA_CNBV);
  });

  it("general cuenta las vacaciones; declaraciones_pagos no, y cubre hasta diciembre", () => {
    const declaraciones = SAT.plazos.get("declaraciones_pagos");
    expect(SAT.general.calendario.inhabil("2026-07-20")?.tipo).toBe("vacaciones");
    expect(declaraciones?.calendario.inhabil("2026-07-20")).toBeNull();
    expect(declaraciones?.calendario.inhabil("2026-07-25")?.tipo).toBe("fin_de_semana");
    expect(declaraciones?.calendario.inhabil("2026-12-25")?.tipo).toBe("descanso");
    expect(declaraciones?.calendario.inhabil("2026-12-26")?.fuente).toEqual(FUENTE_CFF);
    // El 25 de diciembre queda fuera de la cobertura de general: no entra a su calendario.
    expect(() => SAT.general.calendario.inhabil("2026-12-25")).toThrow(CalendarioIncompletoError);
  });

  it("un plazo más corto que la cobertura amplia trae un respaldo con lo publicado hasta ella", () => {
    const { respaldo } = SAT.general;
    expect(respaldo?.cobertura).toEqual(COBERTURA_DECLARACIONES);
    expect(respaldo?.inhabil("2026-07-20")?.tipo).toBe("vacaciones");
    expect(respaldo?.inhabil("2026-12-25")).toMatchObject({ tipo: "descanso", fuente: FUENTE_CFF });
    expect(respaldo?.inhabil("2026-12-01")).toBeNull();
    expect(SAT.plazos.get("declaraciones_pagos")?.respaldo).toBeUndefined();
    expect(CNBV.general.respaldo).toBeUndefined();
  });

  it("cita cada fin de semana con la fuente de su año", () => {
    const { calendario } = CNBV.general;
    expect(calendario.inhabil("2025-10-18")).toEqual({
      fecha: "2025-10-18",
      motivo: "Sábado",
      tipo: "fin_de_semana",
      fuente: FUENTE_CNBV_2025,
    });
    expect(calendario.inhabil("2026-10-17")?.fuente).toEqual(FUENTE_CNBV);
    // Un día publicado que cae en sábado conserva su propia cita.
    expect(calendario.inhabil("2026-12-12")).toMatchObject({
      tipo: "descanso",
      fuente: FUENTE_CNBV,
    });
  });

  it("lo que devuelve no se puede alterar y los días solo traen sus campos", () => {
    const conExtra = {
      ...SHARD_SAT,
      dias: DIAS_SAT.map((d) => ({ ...d, autoridad: "sat", fuente: { ...d.fuente, x: 1 } })),
    };
    const calendario = crearCalendarioCurado(conExtra);
    expect(calendario.dias).toEqual(DIAS_SAT);
    for (const parte of [
      calendario,
      calendario.dias,
      calendario.dias[0],
      calendario.dias[0]?.fuente,
      calendario.general,
      calendario.general.cobertura,
      calendario.general.excluirTipos,
      calendario.amplia,
      calendario.plazos,
    ]) {
      expect(Object.isFrozen(parte)).toBe(true);
    }
    const plazos = calendario.plazos as unknown as Map<string, unknown>;
    expect(() => plazos.set("otro", {})).toThrow(TypeError);
    expect(() => Map.prototype.set.call(plazos, "otro", {})).toThrow(TypeError);
  });

  it("plazos se lee como un Map de solo lectura", () => {
    const { plazos } = SAT;
    expect(plazos.size).toBe(2);
    expect(plazos.has("declaraciones_pagos")).toBe(true);
    expect(CNBV.plazos.has("declaraciones_pagos")).toBe(false);
    expect([...plazos.values()]).toEqual([SAT.general, plazos.get("declaraciones_pagos")]);
    expect([...plazos.entries()].map(([tipo]) => tipo)).toEqual(["general", "declaraciones_pagos"]);
    expect([...plazos].map(([tipo]) => tipo)).toEqual(["general", "declaraciones_pagos"]);
    const vistos: [string, unknown][] = [];
    const contexto = {};
    plazos.forEach(function (this: unknown, plazo, tipo, mapa) {
      expect(this).toBe(contexto);
      expect(mapa).toBe(plazos);
      vistos.push([tipo, plazo]);
    }, contexto);
    expect(vistos).toEqual([...plazos]);
  });

  const { general, declaraciones_pagos } = SHARD_SAT.plazos as Required<
    DatosCalendarioCurado["plazos"]
  >;
  const conPlazos = (plazos: unknown) => ({ ...SHARD_SAT, plazos }) as DatosCalendarioCurado;
  const conDias = (dias: unknown) => ({ ...SHARD_SAT, dias }) as DatosCalendarioCurado;
  const diaUno = DIAS_SAT[0] as DatosCalendarioCurado["dias"][number];
  const conDia = (cambios: Record<string, unknown>) => conDias([{ ...diaUno, ...cambios }]);
  const conFuentes = (fuentes: unknown) =>
    ({ ...SHARD_SAT, fuentes_fin_de_semana: fuentes }) as DatosCalendarioCurado;
  const conCobertura = (desde: string, hasta: string) => ({
    ...general,
    cobertura: { desde, hasta },
  });

  it.each([
    ["un plazo desconocido", conPlazos({ general, anual: general })],
    ["un plazo vacío", conPlazos({ general, declaraciones_pagos: undefined })],
    [
      "un tipo de día que no existe",
      conPlazos({
        general,
        declaraciones_pagos: { ...declaraciones_pagos, excluir_tipos: ["fin_de_semana"] },
      }),
    ],
    [
      "una cobertura con una fecha que no existe",
      conPlazos({ general: conCobertura("2026-01-01", "2026-02-30") }),
    ],
    ["una cobertura invertida", conPlazos({ general: conCobertura("2026-12-31", "2026-01-01") })],
    ["sin general", conPlazos({ declaraciones_pagos })],
    ["un general que no cuenta las vacaciones", conPlazos({ general: declaraciones_pagos })],
    [
      "ningún plazo que contenga a los demás",
      conPlazos({
        general,
        declaraciones_pagos: {
          ...declaraciones_pagos,
          cobertura: { desde: "2026-02-01", hasta: "2026-12-31" },
        },
      }),
    ],
    ["sin la fuente de un año de la cobertura", conFuentes({})],
    [
      "la fuente de un año fuera de la cobertura",
      conFuentes({ 2026: FUENTE_CFF, 2027: FUENTE_CFF }),
    ],
    ["otra llave en vez del año", conFuentes({ "2026-01": FUENTE_CFF })],
    ["días fuera de orden", conDias([DIAS_SAT[1], DIAS_SAT[0]])],
    ["una fecha repetida", conDias([diaUno, diaUno])],
    ["un día fuera de toda cobertura", conDia({ fecha: "2027-01-01" })],
    ["un día con una fecha que no existe", conDia({ fecha: "2026-02-30" })],
    ["un día de fin de semana", conDia({ tipo: "fin_de_semana" })],
  ])("rechaza un calendario con %s", (_caso, datos) => {
    expect(() => crearCalendarioCurado(datos)).toThrow(RangeError);
  });

  it("el error nombra la autoridad", () => {
    expect(() => crearCalendarioCurado(conPlazos({ declaraciones_pagos }))).toThrow(
      "El calendario de sat no tiene un plazo general que cuente todos los días.",
    );
  });
});

describe("sumarDiasHabilesCurado con el SAT", () => {
  it("un plazo que cruza el primer periodo de vacaciones: general lo salta, declaraciones_pagos no", () => {
    const general = sat("general", "2026-07-15", 10);
    expect(general).toEqual(delNucleo(SHARD_SAT, "general", "2026-07-15", 10));
    expect(general).toMatchObject({
      autoridad: "sat",
      desde: "2026-07-15",
      dias: 10,
      resultado: "2026-08-12",
      advertencias: [],
    });
    expect(fechas(general.inhabiles_saltados)).toEqual(PRIMER_PERIODO);
    const declaraciones = sat("declaraciones_pagos", "2026-07-15", 10);
    expect(declaraciones).toEqual(delNucleo(SHARD_SAT, "declaraciones_pagos", "2026-07-15", 10));
    expect(declaraciones).toMatchObject({
      resultado: "2026-07-29",
      inhabiles_saltados: [],
      advertencias: [],
    });
  });

  it.each([
    ["general", "2026-07-17", "2026-08-03"],
    ["declaraciones_pagos", "2026-07-17", "2026-07-20"],
    // 2 y 3 de abril: vacaciones del SAT, hábiles en declaraciones y pagos.
    ["general", "2026-04-01", "2026-04-06"],
    ["declaraciones_pagos", "2026-04-01", "2026-04-02"],
    // El tercer lunes de noviembre es descanso en los dos.
    ["general", "2026-11-13", "2026-11-17"],
    ["declaraciones_pagos", "2026-11-13", "2026-11-17"],
    ["declaraciones_pagos", "2026-12-24", "2026-12-28"],
  ] as const)("%s: %s más 1 día hábil es %s", (tipo, desde, resultado) => {
    const r = sat(tipo, desde, 1);
    expect(r.resultado).toBe(resultado);
    expect(r).toEqual(delNucleo(SHARD_SAT, tipo, desde, 1));
  });

  it("el 25 de diciembre se salta con su cita del CFF", () => {
    expect(sat("declaraciones_pagos", "2026-12-24", 1).inhabiles_saltados).toEqual([
      { fecha: "2026-12-25", motivo: "25 de diciembre", tipo: "descanso", fuente: FUENTE_CFF },
    ]);
  });

  it("general después del 30 de noviembre: dice por qué y hasta dónde llega declaraciones_pagos", () => {
    for (const [desde, dias, permitir, fecha] of [
      ["2026-11-27", 2, undefined, "2026-12-01"],
      ["2026-11-27", 2, false, "2026-12-01"],
      ["2026-12-24", 1, undefined, "2026-12-25"],
    ] as const) {
      const error = incompleto(() => sat("general", desde, dias, permitir));
      expect(error).toMatchObject({ autoridad: "sat", fecha, cobertura: COBERTURA_GENERAL });
      expect(error.detalle).toBe(DETALLE_GENERAL(fecha));
      expect(error.codigo).toBe("calendario-incompleto");
    }
  });

  describe("general con permitirIncompleto después del 30 de noviembre", () => {
    it("salta el 25 de diciembre publicado, con su cita, y advierte lo que puede faltar", () => {
      expect(sat("general", "2026-12-24", 1, true)).toEqual({
        autoridad: "sat",
        desde: "2026-12-24",
        dias: 1,
        resultado: "2026-12-28",
        inhabiles_saltados: [
          { fecha: "2026-12-25", motivo: "25 de diciembre", tipo: "descanso", fuente: FUENTE_CFF },
        ],
        advertencias: [AVISO_GENERAL],
      });
    });

    it("cruzar el 30 de noviembre da el día hábil siguiente con la advertencia", () => {
      expect(sat("general", "2026-11-27", 2, true)).toMatchObject({
        resultado: "2026-12-01",
        inhabiles_saltados: [],
        advertencias: [AVISO_GENERAL],
      });
    });

    it("un rango que llega a 2027 lleva las dos advertencias", () => {
      const r = sat("general", "2026-12-24", 5, true);
      expect(r).toMatchObject({
        resultado: "2027-01-01",
        advertencias: [
          AVISO_GENERAL,
          "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
        ],
      });
      expect(fechas(r.inhabiles_saltados)).toEqual(["2026-12-25"]);
    });

    it("dentro de la cobertura de general no hay advertencias", () => {
      expect(sat("general", "2026-07-15", 10, true)).toEqual(
        delNucleo(SHARD_SAT, "general", "2026-07-15", 10),
      );
    });

    it("si empieza después de la cobertura amplia, solo queda la advertencia del núcleo", () => {
      expect(sat("general", "2026-12-31", 1, true)).toMatchObject({
        resultado: "2027-01-01",
        advertencias: ["Calendario incompleto: SAT 2027; solo se descontaron fines de semana."],
      });
    });

    it("antes de la cobertura amplia, solo la advertencia del núcleo para ese año", () => {
      expect(sat("general", "2025-12-30", 2, true)).toMatchObject({
        resultado: "2026-01-02",
        advertencias: ["Calendario incompleto: SAT 2025; solo se descontaron fines de semana."],
      });
    });
  });

  it("declaraciones_pagos cubre diciembre; después del 31, su cobertura sin explicación", () => {
    expect(sat("declaraciones_pagos", "2026-11-27", 2)).toMatchObject({
      resultado: "2026-12-01",
      advertencias: [],
    });
    const error = incompleto(() => sat("declaraciones_pagos", "2026-12-31", 1));
    expect(error).toMatchObject({ fecha: "2027-01-01", cobertura: COBERTURA_DECLARACIONES });
    expect(error.detalle).toBe(
      "El calendario del SAT para tipo_plazo=declaraciones_pagos no cubre 2027-01-01; cubre del 2026-01-01 al 2026-12-31.",
    );
    // Sin respaldo: con permitirIncompleto solo descuenta fines de semana después del 31.
    expect(sat("declaraciones_pagos", "2026-12-31", 1, true).advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
    ]);
  });

  it("antes del inicio de toda cobertura, sin explicación de otros plazos", () => {
    const error = incompleto(() => sat("general", "2025-12-30", 1));
    expect(error).toMatchObject({ fecha: "2025-12-31", cobertura: COBERTURA_GENERAL });
    expect(error.detalle).toBe(
      "El calendario del SAT para tipo_plazo=general no cubre 2025-12-31; cubre del 2026-01-01 al 2026-11-30.",
    );
  });

  describe("calendarios armados para casos que el SAT 2026 no tiene", () => {
    const conPlazos = (cambiosGeneral: object, cambiosDeclaraciones: object) => {
      const { general, declaraciones_pagos } = SHARD_SAT.plazos as Required<
        DatosCalendarioCurado["plazos"]
      >;
      return crearCalendarioCurado({
        ...SHARD_SAT,
        plazos: {
          general: { ...general, ...cambiosGeneral },
          declaraciones_pagos: { ...declaraciones_pagos, ...cambiosDeclaraciones },
        },
      });
    };
    // General empieza en febrero: enero solo lo cubre declaraciones_pagos.
    const desdeFebrero = conPlazos({ cobertura: { desde: "2026-02-01", hasta: "2026-11-30" } }, {});
    // Declaraciones_pagos cuenta todo: fuera de general no falta ningún tipo de día.
    const sinExcluir = conPlazos({}, { excluir_tipos: [] });

    it("un hueco al inicio de la cobertura: advertencia con permitirIncompleto y explicación sin él", () => {
      expect(sat("general", "2026-01-05", 1, true, desdeFebrero)).toMatchObject({
        resultado: "2026-01-06",
        advertencias: [
          "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-02-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.",
        ],
      });
      const error = incompleto(() => sat("general", "2026-01-05", 1, false, desdeFebrero));
      expect(error).toMatchObject({
        fecha: "2026-01-06",
        cobertura: { desde: "2026-02-01", hasta: "2026-11-30" },
      });
      expect(error.detalle).toBe(
        "El calendario del SAT para tipo_plazo=general no cubre 2026-01-06; cubre del 2026-02-01 al 2026-11-30 porque los días de tipo vacaciones anteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre del 2026-01-01 al 2026-12-31.",
      );
    });

    it("si ningún tipo de día puede faltar, ni advertencia ni explicación", () => {
      expect(sat("general", "2026-12-24", 1, true, sinExcluir)).toMatchObject({
        resultado: "2026-12-28",
        advertencias: [],
      });
      const error = incompleto(() => sat("general", "2026-11-27", 2, false, sinExcluir));
      expect(error.detalle).toBe(
        "El calendario del SAT para tipo_plazo=general no cubre 2026-12-01; cubre del 2026-01-01 al 2026-11-30.",
      );
    });
  });

  it("un resultado después del año 9999 lanza FechaFueraDeRangoError", () => {
    expect(() => sat("general", "9999-12-31", 1, true)).toThrow(FechaFueraDeRangoError);
  });

  it("los parámetros inválidos son RangeError, como en sumarDiasHabiles", () => {
    expect(() => sat("general", "2026-02-30", 1)).toThrow(RangeError);
    expect(() => sat("general", "2026-07-15", 0)).toThrow(RangeError);
  });

  it("un plazo que el calendario no tiene es RangeError", () => {
    expect(() =>
      sumarDiasHabilesCurado(CNBV, {
        tipoPlazo: "declaraciones_pagos",
        desde: "2026-07-15",
        dias: 1,
      }),
    ).toThrow(
      new RangeError("El calendario de cnbv no tiene el tipo de plazo declaraciones_pagos."),
    );
  });
});

describe("sumarDiasHabilesCurado con la CNBV", () => {
  const cnbv = (desde: string, dias: number, permitirIncompleto?: boolean) =>
    sumarDiasHabilesCurado(CNBV, { tipoPlazo: "general", desde, dias, permitirIncompleto });

  it("salta el 2 de noviembre de la CNBV", () => {
    const r = cnbv("2026-10-30", 1);
    expect(r).toEqual(delNucleo(SHARD_CNBV, "general", "2026-10-30", 1));
    expect(r.resultado).toBe("2026-11-03");
    expect(r.inhabiles_saltados).toEqual([DIAS_CNBV[1]]);
  });

  it("salta el 12 de diciembre de 2026, sábado publicado como inhábil, con su cita", () => {
    const r = cnbv("2026-12-11", 1);
    expect(r).toMatchObject({ resultado: "2026-12-14", advertencias: [] });
    expect(r.inhabiles_saltados).toEqual([DIAS_CNBV[2]]);
  });

  it("fuera de la cobertura, el texto sin tipo de plazo; con permitirIncompleto, la advertencia", () => {
    for (const [desde, fecha] of [
      ["2026-12-31", "2027-01-01"],
      ["2024-12-30", "2024-12-31"],
    ] as const) {
      const error = incompleto(() => cnbv(desde, 1));
      expect(error).toMatchObject({ autoridad: "cnbv", fecha, cobertura: COBERTURA_CNBV });
      expect(error.detalle).toBe(
        `El calendario de la CNBV no cubre ${fecha}; cubre del 2025-01-01 al 2026-12-31.`,
      );
    }
    expect(cnbv("2026-12-31", 1, true)).toMatchObject({
      resultado: "2027-01-01",
      advertencias: ["Calendario incompleto: CNBV 2027; solo se descontaron fines de semana."],
    });
  });
});

describe("diasInhabilesCurados", () => {
  it("cnbv: los días del año con su cita, sin advertencias", () => {
    expect(diasInhabilesCurados(CNBV, 2026)).toEqual({
      dias: DIAS_CNBV.slice(1),
      advertencias: [],
    });
    expect(diasInhabilesCurados(CNBV, 2025).dias).toEqual(DIAS_CNBV.slice(0, 1));
  });

  it("sat 2026: la lista conocida, con la advertencia de las vacaciones que pueden faltar", () => {
    expect(diasInhabilesCurados(SAT, 2026)).toEqual({
      dias: DIAS_SAT,
      advertencias: [ADVERTENCIA_SAT_2026],
    });
  });

  it("sin advertencias si el plazo general cubre todo el año", () => {
    const completo = crearCalendarioCurado({
      ...SHARD_SAT,
      plazos: {
        ...SHARD_SAT.plazos,
        general: { cobertura: COBERTURA_DECLARACIONES, excluir_tipos: [] },
      },
    });
    expect(diasInhabilesCurados(completo, 2026).advertencias).toEqual([]);
  });

  it("sin advertencias si el plazo que cubre el año cuenta todos los tipos de día", () => {
    const declaraciones = { cobertura: COBERTURA_DECLARACIONES, excluir_tipos: [] };
    const calendario = crearCalendarioCurado({
      ...SHARD_SAT,
      plazos: { ...SHARD_SAT.plazos, declaraciones_pagos: declaraciones },
    });
    expect(diasInhabilesCurados(calendario, 2026).advertencias).toEqual([]);
  });

  it.each([
    [SAT, 2025, "2025", COBERTURA_DECLARACIONES, "del SAT"],
    [SAT, 2027, "2027", COBERTURA_DECLARACIONES, "del SAT"],
    [SAT, 1, "0001", COBERTURA_DECLARACIONES, "del SAT"],
    [CNBV, 2024, "2024", COBERTURA_CNBV, "de la CNBV"],
    [CNBV, 2027, "2027", COBERTURA_CNBV, "de la CNBV"],
    [CNBV, 9999, "9999", COBERTURA_CNBV, "de la CNBV"],
  ] as const)(
    "%#: un año fuera de toda cobertura lanza desde su 1 de enero",
    (c, anio, texto, cobertura, de) => {
      const error = incompleto(() => diasInhabilesCurados(c, anio));
      expect(error).toMatchObject({ autoridad: c.autoridad, fecha: `${texto}-01-01`, cobertura });
      expect(error.detalle).toBe(
        `El calendario ${de} no cubre el año ${texto}; cubre del ${cobertura.desde} al ${cobertura.hasta}.`,
      );
    },
  );

  it("un año cubierto en parte lanza con el primer día que falta", () => {
    const cnbv = (desde: string, hasta: string) =>
      crearCalendarioCurado({
        ...SHARD_CNBV,
        plazos: { general: { cobertura: { desde, hasta }, excluir_tipos: [] } },
        fuentes_fin_de_semana: { 2026: FUENTE_CNBV },
        dias: DIAS_CNBV.slice(1, 2),
      });
    const alFinal = incompleto(() => diasInhabilesCurados(cnbv("2026-01-01", "2026-11-30"), 2026));
    expect(alFinal).toMatchObject({
      fecha: "2026-12-01",
      cobertura: { desde: "2026-01-01", hasta: "2026-11-30" },
    });
    expect(alFinal.detalle).toBe(
      "El calendario de la CNBV no cubre el año 2026; cubre del 2026-01-01 al 2026-11-30.",
    );
    const alInicio = incompleto(() => diasInhabilesCurados(cnbv("2026-03-01", "2026-12-31"), 2026));
    expect(alInicio).toMatchObject({ fecha: "2026-01-01" });
  });

  it.each([0, 10_000, 2026.5, Number.NaN])("el año %s es RangeError", (anio) => {
    expect(() => diasInhabilesCurados(SAT, anio)).toThrow(RangeError);
  });
});

describe("exigirAnio", () => {
  it("no hace nada si la cobertura tiene el año completo", () => {
    expect(exigirAnio("lft", 2026, COBERTURA_LFT)).toBeUndefined();
    expect(exigirAnio("lft", 2100, COBERTURA_LFT)).toBeUndefined();
  });

  it("lanza CalendarioIncompletoError con el texto del año", () => {
    const error = incompleto(() => exigirAnio("lft", 2101, COBERTURA_LFT));
    expect(error).toMatchObject({
      autoridad: "lft",
      fecha: "2101-01-01",
      cobertura: COBERTURA_LFT,
    });
    expect(error.detalle).toBe(
      "El calendario de la LFT no cubre el año 2101; cubre del 2007-01-01 al 2100-12-31.",
    );
    expect(incompleto(() => exigirAnio("lft", 2006, COBERTURA_LFT)).fecha).toBe("2006-01-01");
  });
});

describe("feriadosBancarios", () => {
  const conLunes16 = crearCalendarioCurado({
    ...SHARD_CNBV,
    dias: [
      ...DIAS_CNBV.slice(0, 2),
      {
        fecha: "2026-11-16",
        motivo: "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
        tipo: "descanso",
        fuente: FUENTE_CNBV,
      },
      ...DIAS_CNBV.slice(2),
    ],
  });

  it("marca los días de descanso de la CNBV dentro de su cobertura", () => {
    const feriado = feriadosBancarios(conLunes16);
    expect(feriado("2026-11-16")).toBe(true);
    expect(feriado("2026-11-02")).toBe(true);
    expect(feriado("2025-12-12")).toBe(true);
    // Un día hábil y un fin de semana no son feriados bancarios.
    expect(feriado("2026-11-17")).toBe(false);
    expect(feriado("2026-11-14")).toBe(false);
  });

  it("fuera de su cobertura no marca nada y no lanza", () => {
    const feriado = feriadosBancarios(conLunes16);
    expect(feriado("2027-01-01")).toBe(false);
    expect(feriado("2024-12-25")).toBe(false);
  });

  it("solo cuentan los días de descanso: unas vacaciones no cierran los bancos", () => {
    const vacaciones = crearCalendarioCurado({
      ...SHARD_CNBV,
      dias: DIAS_CNBV.map((d) => (d.fecha === "2026-11-02" ? { ...d, tipo: "vacaciones" } : d)),
    });
    expect(feriadosBancarios(vacaciones)("2026-11-02")).toBe(false);
  });

  it("pide el calendario de la CNBV", () => {
    expect(() => feriadosBancarios(SAT)).toThrow(RangeError);
  });
});
