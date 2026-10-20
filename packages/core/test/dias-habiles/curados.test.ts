import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { avisosDe } from "../../src/avisos.js";
import { crearCalendario } from "../../src/dias-habiles/calendario.js";
import {
  avisoTransmisionCff,
  COBERTURA_CFF,
  diasDescansoCff,
  FUENTE_CFF_12,
} from "../../src/dias-habiles/cff.js";
import {
  type CalendarioCurado,
  coberturaConRegla,
  crearCalendarioCurado,
  type DatosCalendarioCurado,
  diasInhabilesCurados,
  exigirAnio,
  feriadosBancarios,
  PLAZOS,
  REGLAS,
  revisarPlazos,
  sumarDiasHabilesCurado,
} from "../../src/dias-habiles/curados.js";
import { COBERTURA_LFT } from "../../src/dias-habiles/lft.js";
import { type ResultadoDiasHabiles, sumarDiasHabiles } from "../../src/dias-habiles/sumar.js";
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
  VACACIONES_SAT,
} from "./ejemplos-curados.js";

const COBERTURA_GENERAL = { desde: "2026-01-01", hasta: "2026-11-30" };
// Los días del art. 12 salen de la regla hasta 2100: declaraciones_pagos, que no cuenta las
// vacaciones, cubre lo mismo que la regla.
const COBERTURA_DECLARACIONES = { desde: "2026-01-01", hasta: "2100-12-31" };
const ANIO_2026 = { desde: "2026-01-01", hasta: "2026-12-31" };
const COBERTURA_CNBV = { desde: "2025-01-01", hasta: "2026-12-31" };

/** Los días del art. 12 de los años de `desde` a `hasta`, que da la regla. */
const delCff = (desde: number, hasta: number) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => diasDescansoCff(desde + i)).flat();

/** Lo que el calendario del SAT tiene en `dias`: la regla hasta 2100 y las vacaciones. */
const DIAS_CALENDARIO_SAT = [...delCff(2026, 2100), ...VACACIONES_SAT].sort((a, b) =>
  a.fecha < b.fecha ? -1 : 1,
);

const AVISO_GENERAL =
  "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.";

const DETALLE_GENERAL = (fecha: string) =>
  `El calendario del SAT para tipo_plazo=general no cubre ${fecha}; cubre del 2026-01-01 al 2026-11-30 porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Puedes calcular con permitir_incompleto=true: descuenta lo publicado y el resultado puede cambiar cuando se publique lo que falta. Solo si el plazo es para presentar declaraciones o pagar contribuciones, usa tipo_plazo=declaraciones_pagos, que no los cuenta y cubre del 2026-01-01 al 2100-12-31.`;

/** El aviso de la prórroga del quinto párrafo del art. 12 del CFF para `fecha`. */
const PRORROGA = (fecha: string, hechos: string) =>
  `El resultado (${fecha}) es ${hechos}. El art. 12 del CFF, quinto párrafo, prorroga el plazo al siguiente día hábil si ese día están cerradas las oficinas donde se hace el trámite, incluidos los bancos que reciben el pago, o si es viernes y el pago se hace en una institución de crédito autorizada. El resultado no incluye esa prórroga.`;

/** El aviso de un resultado de declaraciones_pagos después de las vacaciones publicadas. */
const VACACIONES_SIN_PUBLICAR = (hasta: string, fecha: string) =>
  `Las vacaciones del SAT posteriores al ${hasta} no están publicadas: si el ${fecha} resulta ser día de vacaciones, el art. 12 del CFF, quinto párrafo, puede prorrogar el plazo al siguiente día hábil. El resultado no incluye esa prórroga.`;

/** Lo mismo con un resultado antes de las vacaciones publicadas. */
const VACACIONES_ANTES = (desde: string, fecha: string) =>
  `Las vacaciones del SAT anteriores al ${desde} no están publicadas: si el ${fecha} resulta ser día de vacaciones, el art. 12 del CFF, quinto párrafo, puede prorrogar el plazo al siguiente día hábil. El resultado no incluye esa prórroga.`;

/** Lo que nombra el SAT fuera de la cobertura, con o sin sus vacaciones. */
const FALTA_ART_12 =
  "Pueden faltar días del art. 12 del CFF, como el 25 de diciembre y el 1 de enero.";
const FALTA_ART_12_Y_VACACIONES =
  "Pueden faltar días del art. 12 del CFF, como el 25 de diciembre y el 1 de enero, y vacaciones del SAT.";

const ADVERTENCIA_SAT_2026 =
  "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa.";

const SAT = crearCalendarioCurado(SHARD_SAT);
const CNBV = crearCalendarioCurado(SHARD_CNBV);

const fechas = (dias: readonly { fecha: string }[]) => dias.map((d) => d.fecha);

/**
 * Lo que daría el núcleo con el calendario del plazo, sin respaldo ni textos. En el SAT, los días
 * de descanso son los de la regla en la cobertura y sus fines de semana los cita el art. 12.
 */
function delNucleo(datos: DatosCalendarioCurado, tipo: TipoPlazo, desde: string, dias: number) {
  const plazo = datos.plazos[tipo];
  if (plazo === undefined) throw new Error(tipo);
  const { cobertura, excluir_tipos } = plazo;
  const sat = datos.autoridad === "sat";
  const todos = sat
    ? [
        ...delCff(Number(cobertura.desde.slice(0, 4)), Number(cobertura.hasta.slice(0, 4))),
        ...datos.dias.filter((d) => d.tipo !== "descanso"),
      ]
    : datos.dias;
  const calendario = crearCalendario({
    autoridad: datos.autoridad,
    cobertura,
    dias: todos.filter((d) => d.fecha >= cobertura.desde && d.fecha <= cobertura.hasta),
    fuenteFinDeSemana: (anio) =>
      sat ? FUENTE_CFF_12 : (datos.fuentes_fin_de_semana[String(anio)] as typeof FUENTE_CFF),
    excluirTipos: excluir_tipos,
  });
  return sumarDiasHabiles({ calendario, desde, dias });
}

/** `r` con otras advertencias y sus avisos, como los agrega sumarDiasHabilesCurado. */
const conAdvertencias = (
  r: ResultadoDiasHabiles,
  advertencias: string[],
): ResultadoDiasHabiles => ({
  ...r,
  advertencias,
  avisos: avisosDe(advertencias),
});

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
        declaraciones_pagos: { cobertura: ANIO_2026, excluir_tipos: ["vacaciones"] },
      },
      amplia: ANIO_2026,
      fallas: [],
    });
  });

  it("con la cobertura de la regla del SAT, declaraciones_pagos llega a 2100", () => {
    const cobertura = coberturaConRegla("sat", {
      vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
    });
    expect(cobertura).toEqual({ vacaciones: COBERTURA_GENERAL, descanso: COBERTURA_CFF });
    expect(revisarPlazos(PLAZOS.sat, cobertura, VACACIONES_SAT)).toEqual({
      plazos: {
        general: { cobertura: COBERTURA_GENERAL, excluir_tipos: [] },
        declaraciones_pagos: { cobertura: COBERTURA_DECLARACIONES, excluir_tipos: ["vacaciones"] },
      },
      amplia: COBERTURA_DECLARACIONES,
      fallas: [],
    });
    // La CNBV no tiene regla: su cobertura queda igual.
    const cnbv = { descanso: COBERTURA_CNBV };
    expect(coberturaConRegla("cnbv", cnbv)).toBe(cnbv);
  });

  it("la regla del SAT son los días de descanso del art. 12 del CFF", () => {
    expect(Object.keys(REGLAS)).toEqual(["sat"]);
    expect(REGLAS.sat).toMatchObject({
      tipo: "descanso",
      cobertura: COBERTURA_CFF,
      fuente: FUENTE_CFF_12,
    });
    expect(REGLAS.sat?.dias(2027)).toEqual(diasDescansoCff(2027));
    expect(Object.isFrozen(REGLAS)).toBe(true);
    expect(Object.isFrozen(REGLAS.sat)).toBe(true);
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
    expect(revisarPlazos(PLAZOS.sat, { vacaciones: ANIO_2026 }, []).fallas).toEqual([
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
    const { fallas } = revisarPlazos(PLAZOS.cnbv, { descanso: ANIO_2026 }, [
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
  it("arma un calendario por tipo de plazo, en el orden de TIPOS_PLAZO aunque el shard traiga otro", () => {
    expect(SAT.autoridad).toBe("sat");
    expect([...SAT.plazos.keys()]).toEqual(["general", "declaraciones_pagos"]);
    const { general, declaraciones_pagos } = SHARD_SAT.plazos;
    const alReves = crearCalendarioCurado({
      ...SHARD_SAT,
      plazos: { declaraciones_pagos, general },
    } as DatosCalendarioCurado);
    expect([...alReves.plazos.keys()]).toEqual(["general", "declaraciones_pagos"]);
    expect(SAT.general).toBe(SAT.plazos.get("general"));
    expect(SAT.general.cobertura).toEqual(COBERTURA_GENERAL);
    expect(SAT.general.excluirTipos).toEqual([]);
    expect(SAT.plazos.get("declaraciones_pagos")?.excluirTipos).toEqual(["vacaciones"]);
    expect(SAT.amplia).toEqual(COBERTURA_DECLARACIONES);
    // Cambio: los días del SAT son los de la regla del art. 12 hasta 2100 y las vacaciones.
    expect(SAT.dias).toEqual(DIAS_CALENDARIO_SAT);
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

  it("el SAT toma de la regla los días del art. 12 de cada año, con sus fines de semana", () => {
    const declaraciones = SAT.plazos.get("declaraciones_pagos")?.calendario;
    expect(declaraciones?.inhabil("2027-01-01")).toEqual({
      fecha: "2027-01-01",
      motivo: "1o. de enero",
      tipo: "descanso",
      fuente: FUENTE_CFF_12,
    });
    expect(declaraciones?.inhabil("2026-05-05")?.motivo).toBe("5 de mayo");
    expect(declaraciones?.inhabil("2100-12-25")?.tipo).toBe("descanso");
    expect(declaraciones?.inhabil("2027-01-02")).toMatchObject({
      tipo: "fin_de_semana",
      fuente: FUENTE_CFF_12,
    });
    // La transmisión del Poder Ejecutivo de 2030 no se descuenta (ver avisosTransmisionCff).
    expect(declaraciones?.inhabil("2030-10-01")).toBeNull();
    expect(declaraciones?.inhabil("2030-12-01")?.tipo).toBe("fin_de_semana");
    expect(() => declaraciones?.inhabil("2101-01-01")).toThrow(CalendarioIncompletoError);
  });

  it("los días de descanso del shard son opcionales: el calendario es el mismo sin ellos", () => {
    const soloVacaciones = crearCalendarioCurado({ ...SHARD_SAT, dias: VACACIONES_SAT });
    expect(soloVacaciones.dias).toEqual(SAT.dias);
    expect(soloVacaciones.amplia).toEqual(SAT.amplia);
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
    expect(calendario.dias).toEqual(DIAS_CALENDARIO_SAT);
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

  it("copia la fuente de los fines de semana de cada año: cambiar la entrada no cambia las citas", () => {
    // El SAT cita sus fines de semana con la regla; se prueba con la CNBV.
    const fuente = { ...FUENTE_CNBV, extra: "no es de la cita" };
    const calendario = crearCalendarioCurado({
      ...SHARD_CNBV,
      fuentes_fin_de_semana: { 2025: FUENTE_CNBV_2025, 2026: fuente },
    });
    fuente.nombre = "Otra";
    fuente.fragmento = "cambiado después";
    const sabado = calendario.general.calendario.inhabil("2026-01-03");
    expect(sabado?.fuente).toEqual(FUENTE_CNBV);
    expect(Object.isFrozen(sabado?.fuente)).toBe(true);
    expect(calendario.general.calendario.inhabil("2026-12-26")?.fuente).toEqual(FUENTE_CNBV);
  });

  it("plazos se ve en JSON como un objeto y al inspeccionarlo como un Map", () => {
    const json = JSON.parse(JSON.stringify(SAT.plazos)) as Record<string, Record<string, unknown>>;
    expect(Object.keys(json)).toEqual(["general", "declaraciones_pagos"]);
    expect(json.general?.cobertura).toEqual(COBERTURA_GENERAL);
    expect(json.declaraciones_pagos?.excluirTipos).toEqual(["vacaciones"]);
    expect(JSON.parse(JSON.stringify(CNBV)).plazos).toEqual({
      general: JSON.parse(JSON.stringify(CNBV.general)),
    });
    expect(inspect(SAT.plazos, { depth: 0 })).toBe(
      "Map(2) { 'general' => [Object], 'declaraciones_pagos' => [Object] }",
    );
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
    ({ ...SHARD_CNBV, fuentes_fin_de_semana: fuentes }) as DatosCalendarioCurado;
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
    ["sin la fuente de un año de la cobertura", conFuentes({ 2025: FUENTE_CNBV_2025 })],
    [
      "la fuente de un año fuera de la cobertura",
      conFuentes({ 2025: FUENTE_CNBV_2025, 2026: FUENTE_CNBV, 2027: FUENTE_CNBV }),
    ],
    ["otra llave en vez del año", conFuentes({ 2025: FUENTE_CNBV_2025, "2026-01": FUENTE_CNBV })],
    [
      "fuentes de fines de semana en el SAT, que los cita con la regla",
      { ...SHARD_SAT, fuentes_fin_de_semana: { 2026: FUENTE_CFF } },
    ],
    [
      "una cobertura del SAT que pasa de la regla",
      conPlazos({
        general,
        declaraciones_pagos: {
          ...declaraciones_pagos,
          cobertura: { desde: "2026-01-01", hasta: "2101-12-31" },
        },
      }),
    ],
    ["días fuera de orden", conDias([DIAS_SAT[1], DIAS_SAT[0]])],
    ["una fecha repetida", conDias([diaUno, diaUno])],
    ["un día fuera de toda cobertura", conDia({ fecha: "2101-01-01" })],
    ["un día con una fecha que no existe", conDia({ fecha: "2026-02-30" })],
    ["un día de fin de semana", conDia({ tipo: "fin_de_semana" })],
    ["un día de descanso que no es del art. 12", conDia({ fecha: "2026-03-18" })],
    ["un día del art. 12 con otro motivo", conDia({ motivo: "Año nuevo" })],
    [
      "un día del art. 12 con otra fuente",
      conDia({ fuente: { ...FUENTE_CFF, fecha_publicacion: "2021-11-12" } }),
    ],
    ["vacaciones en un día del art. 12", conDia({ tipo: "vacaciones" })],
  ])("rechaza un calendario con %s", (_caso, datos) => {
    expect(() => crearCalendarioCurado(datos)).toThrow(RangeError);
  });

  it("exige los tipos de plazo y los excluir_tipos de PLAZOS de su autoridad", () => {
    // Con excluir_tipos: [] el SAT contaría sus vacaciones en declaraciones_pagos (CFF art. 12).
    expect(() =>
      crearCalendarioCurado(
        conPlazos({ general, declaraciones_pagos: { ...declaraciones_pagos, excluir_tipos: [] } }),
      ),
    ).toThrow(
      new RangeError(
        "El calendario del SAT tiene en declaraciones_pagos excluir_tipos [] y la regla del núcleo pide [vacaciones].",
      ),
    );
    expect(() =>
      crearCalendarioCurado({
        ...SHARD_CNBV,
        plazos: {
          ...SHARD_CNBV.plazos,
          declaraciones_pagos: { cobertura: COBERTURA_CNBV, excluir_tipos: ["vacaciones"] },
        },
      }),
    ).toThrow(
      new RangeError(
        "El calendario de la CNBV trae el tipo de plazo declaraciones_pagos, que no es suyo (solo general).",
      ),
    );
    expect(PLAZOS.sat.declaraciones_pagos).toEqual(["vacaciones"]);
    // Sin un plazo que no es general, solo ese plazo falta: general sigue respondiendo.
    const soloGeneral = crearCalendarioCurado({
      ...SHARD_SAT,
      plazos: { general },
      dias: DIAS_SAT.filter((d) => d.fecha <= "2026-11-30"),
    });
    expect([...soloGeneral.plazos.keys()]).toEqual(["general"]);
    expect(soloGeneral.dias.at(-1)?.fecha).toBe("2026-11-16");
  });

  it("los errores de la regla dicen qué no cuadra", () => {
    expect(() => crearCalendarioCurado(conDia({ fecha: "2026-03-18" }))).toThrow(
      new RangeError(
        "El calendario del SAT trae el día de descanso 2026-03-18, que no da la regla del núcleo (Código Fiscal de la Federación, artículo 12).",
      ),
    );
    expect(() => crearCalendarioCurado(conDia({ motivo: "Año nuevo" }))).toThrow(
      new RangeError(
        "El calendario del SAT trae el día de descanso 2026-01-01 distinto del que da la regla del núcleo (Código Fiscal de la Federación, artículo 12).",
      ),
    );
    expect(() => crearCalendarioCurado(conDia({ tipo: "vacaciones" }))).toThrow(
      new RangeError(
        "El calendario del SAT trae como vacaciones el 2026-01-01, que ya es de descanso por la regla del núcleo (Código Fiscal de la Federación, artículo 12).",
      ),
    );
    expect(() =>
      crearCalendarioCurado({ ...SHARD_SAT, fuentes_fin_de_semana: { 2026: FUENTE_CFF } }),
    ).toThrow(
      new RangeError(
        "El calendario del SAT cita fines de semana, que cita la regla del núcleo (Código Fiscal de la Federación, artículo 12).",
      ),
    );
    expect(() =>
      crearCalendarioCurado(
        conPlazos({
          general,
          declaraciones_pagos: {
            ...declaraciones_pagos,
            cobertura: { desde: "2026-01-01", hasta: "2101-12-31" },
          },
        }),
      ),
    ).toThrow(
      new RangeError(
        "El calendario del SAT tiene en declaraciones_pagos una cobertura fuera de la de la regla del núcleo (del 2026-01-01 al 2100-12-31).",
      ),
    );
  });

  it("rechaza una autoridad sin calendario curado", () => {
    expect(() => crearCalendarioCurado({ ...SHARD_SAT, autoridad: "lft" as "sat" })).toThrow(
      new RangeError("No hay calendario curado de la LFT: solo de la CNBV y del SAT."),
    );
    expect(() => crearCalendarioCurado({ ...SHARD_SAT, autoridad: "__proto__" as "sat" })).toThrow(
      RangeError,
    );
  });

  it("el error nombra la autoridad", () => {
    expect(() => crearCalendarioCurado(conPlazos({ declaraciones_pagos }))).toThrow(
      "El calendario del SAT no tiene un plazo general que cuente todos los días.",
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
    // Nuevo: el 29 de julio es de vacaciones del SAT (hábil en este plazo): avisa de la prórroga.
    expect(declaraciones).toEqual(
      conAdvertencias(delNucleo(SHARD_SAT, "declaraciones_pagos", "2026-07-15", 10), [
        PRORROGA("2026-07-29", "día de vacaciones del SAT"),
      ]),
    );
    expect(declaraciones).toMatchObject({ resultado: "2026-07-29", inhabiles_saltados: [] });
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
    // Nuevo: en declaraciones_pagos, un resultado en vacaciones del SAT avisa de la prórroga y,
    // después de las vacaciones publicadas (2026-11-30), que puede caer en unas sin publicar.
    const declaraciones = tipo === "declaraciones_pagos";
    const vacaciones = declaraciones && ["2026-07-20", "2026-04-02"].includes(resultado);
    const sinPublicar = declaraciones && resultado > "2026-11-30";
    const nucleo = delNucleo(SHARD_SAT, tipo, desde, 1);
    expect(r).toEqual(
      conAdvertencias(nucleo, [
        ...(vacaciones ? [PRORROGA(resultado, "día de vacaciones del SAT")] : []),
        ...(sinPublicar ? [VACACIONES_SIN_PUBLICAR("2026-11-30", resultado)] : []),
      ]),
    );
  });

  describe("declaraciones_pagos y la prórroga del quinto párrafo del art. 12", () => {
    const bancario = feriadosBancarios(CNBV);
    const decl = (desde: string, feriadoBancario?: (fecha: string) => boolean) =>
      sumarDiasHabilesCurado(SAT, {
        tipoPlazo: "declaraciones_pagos",
        desde,
        dias: 1,
        feriadoBancario,
      });

    it("un resultado en viernes avisa; el resultado no cambia", () => {
      const r = decl("2026-07-16", bancario);
      expect(r).toMatchObject({
        resultado: "2026-07-17",
        advertencias: [PRORROGA("2026-07-17", "viernes")],
      });
    });

    it("un día de cierre bancario según la CNBV avisa, si se tiene su calendario", () => {
      expect(decl("2026-10-30", bancario)).toMatchObject({
        resultado: "2026-11-02",
        advertencias: [PRORROGA("2026-11-02", "día de cierre bancario según la CNBV")],
      });
      // Sin el calendario de la CNBV esa parte no se revisa.
      expect(decl("2026-10-30").advertencias).toEqual([]);
    });

    it("junta los hechos: viernes, vacaciones del SAT y cierre bancario", () => {
      const cierra = (fecha: string) => fecha === "2026-04-03" || bancario(fecha);
      expect(decl("2026-04-02", cierra).advertencias).toEqual([
        PRORROGA(
          "2026-04-03",
          "viernes, día de vacaciones del SAT y día de cierre bancario según la CNBV",
        ),
      ]);
      expect(decl("2026-04-02").advertencias).toEqual([
        PRORROGA("2026-04-03", "viernes y día de vacaciones del SAT"),
      ]);
    });

    it("después de las vacaciones publicadas avisa que el resultado puede caer en unas", () => {
      // Cambio: el segundo periodo de 2026 no está publicado y el 16 de diciembre no se sabe si es
      // de vacaciones. Antes no se avisaba; ahora sí. El resultado es el mismo (lado seguro).
      expect(decl("2026-12-15", bancario)).toMatchObject({
        resultado: "2026-12-16",
        advertencias: [VACACIONES_SIN_PUBLICAR("2026-11-30", "2026-12-16")],
      });
      expect(decl("2026-12-15").advertencias).toEqual([
        VACACIONES_SIN_PUBLICAR("2026-11-30", "2026-12-16"),
      ]);
    });

    it("un viernes después de las vacaciones publicadas: primero la prórroga, luego el aviso", () => {
      expect(decl("2026-12-17", bancario)).toMatchObject({
        resultado: "2026-12-18",
        advertencias: [
          PRORROGA("2026-12-18", "viernes"),
          VACACIONES_SIN_PUBLICAR("2026-11-30", "2026-12-18"),
        ],
      });
    });

    it("hasta el fin de las vacaciones publicadas no avisa, ni con general", () => {
      // 2026-11-30 es lunes: es el último día con las vacaciones publicadas.
      expect(decl("2026-11-27", bancario)).toMatchObject({
        resultado: "2026-11-30",
        advertencias: [],
      });
      const general = sat("general", "2026-12-15", 1, true);
      expect(general.advertencias).toEqual([AVISO_GENERAL]);
    });

    it("un día hábil común no avisa, ni general aunque sea viernes", () => {
      expect(decl("2026-07-14", bancario).advertencias).toEqual([]);
      const general = sumarDiasHabilesCurado(SAT, {
        tipoPlazo: "general",
        desde: "2026-07-16",
        dias: 1,
        feriadoBancario: bancario,
      });
      expect(general).toMatchObject({ resultado: "2026-07-17", advertencias: [] });
    });

    it("va después de las demás advertencias", () => {
      // 2030-10-04 es viernes: primero la transmisión del Poder Ejecutivo, luego la prórroga.
      const r = sumarDiasHabilesCurado(SAT, {
        tipoPlazo: "declaraciones_pagos",
        desde: "2030-09-30",
        dias: 4,
      });
      expect(r.resultado).toBe("2030-10-04");
      // Cambio: al final, que las vacaciones de 2030 no están publicadas.
      expect(r.advertencias).toEqual([
        avisoTransmisionCff(2030).texto,
        PRORROGA("2030-10-04", "viernes"),
        VACACIONES_SIN_PUBLICAR("2026-11-30", "2030-10-04"),
      ]);
    });
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
      expect(error.tipo).toBe("calendario-incompleto");
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
        avisos: [{ codigo: "tipo-plazo-incompleto", texto: AVISO_GENERAL }],
      });
    });

    it("cruzar el 30 de noviembre da el día hábil siguiente con la advertencia", () => {
      expect(sat("general", "2026-11-27", 2, true)).toMatchObject({
        resultado: "2026-12-01",
        inhabiles_saltados: [],
        advertencias: [AVISO_GENERAL],
      });
    });

    it("un rango que llega a 2027 salta el 1 de enero con la regla, sin aviso de 2027", () => {
      // Cambio: antes daba 2027-01-01 con "Calendario incompleto: SAT 2027"; el 1 de enero es
      // inhábil por el art. 12 y el respaldo lo descuenta.
      const r = sat("general", "2026-12-24", 5, true);
      expect(r).toMatchObject({ resultado: "2027-01-04", advertencias: [AVISO_GENERAL] });
      expect(fechas(r.inhabiles_saltados)).toEqual(["2026-12-25", "2027-01-01"]);
    });

    it("dentro de la cobertura de general no hay advertencias", () => {
      expect(sat("general", "2026-07-15", 10, true)).toEqual(
        delNucleo(SHARD_SAT, "general", "2026-07-15", 10),
      );
    });

    it("si empieza después de la cobertura amplia, solo queda la advertencia del núcleo", () => {
      // La cobertura amplia del SAT llega a 2100 (la de la regla del art. 12).
      expect(sat("general", "2100-12-31", 1, true)).toMatchObject({
        resultado: "2101-01-03",
        // Nombra lo que puede faltar después de 2100 (antes, solo "fines de semana").
        advertencias: [
          `Calendario incompleto: SAT 2101; solo se descontaron fines de semana. ${FALTA_ART_12_Y_VACACIONES}`,
        ],
      });
    });

    it("antes de la cobertura amplia, solo la advertencia del núcleo para ese año", () => {
      expect(sat("general", "2025-12-30", 2, true)).toMatchObject({
        resultado: "2026-01-02",
        advertencias: [
          `Calendario incompleto: SAT 2025; solo se descontaron fines de semana. ${FALTA_ART_12_Y_VACACIONES}`,
        ],
      });
    });
  });

  it("declaraciones_pagos antes de 2026, con permitirIncompleto, avisa de las vacaciones", () => {
    // Con los datos del SAT, general y declaraciones_pagos empiezan el mismo día: solo un resultado
    // fuera de toda cobertura (permitirIncompleto) cae antes de las vacaciones publicadas.
    expect(sat("declaraciones_pagos", "2025-12-29", 1, true).advertencias).toEqual([
      `Calendario incompleto: SAT 2025; solo se descontaron fines de semana. ${FALTA_ART_12}`,
      VACACIONES_ANTES("2026-01-01", "2025-12-30"),
    ]);
  });

  it("declaraciones_pagos cruza a 2027 con los días del art. 12 y para en 2100", () => {
    // Cambio: después de las vacaciones publicadas (2026-11-30) avisa que el resultado puede caer
    // en unas sin publicar; antes no había advertencias. El resultado es el mismo.
    expect(sat("declaraciones_pagos", "2026-11-27", 2)).toMatchObject({
      resultado: "2026-12-01",
      advertencias: [VACACIONES_SIN_PUBLICAR("2026-11-30", "2026-12-01")],
    });
    // Plazos que cruzan el 1 de enero de 2027: antes, 422 desde esa fecha, y con permitirIncompleto un
    // vencimiento en el 1 de enero. Ahora, el resultado legal.
    for (const [desde, dias, resultado] of [
      ["2026-12-30", 2, "2027-01-04"],
      ["2026-11-20", 30, "2027-01-05"],
      ["2026-12-15", 15, "2027-01-07"],
      ["2026-12-31", 1, "2027-01-04"],
    ] as const) {
      const r = sat("declaraciones_pagos", desde, dias);
      const advertencias = [VACACIONES_SIN_PUBLICAR("2026-11-30", resultado)];
      expect(r, desde).toMatchObject({ resultado, advertencias });
      expect(fechas(r.inhabiles_saltados)).toContain("2027-01-01");
      expect(r).toEqual(
        conAdvertencias(delNucleo(SHARD_SAT, "declaraciones_pagos", desde, dias), advertencias),
      );
    }
    const error = incompleto(() => sat("declaraciones_pagos", "2100-12-31", 1));
    expect(error).toMatchObject({ fecha: "2101-01-01", cobertura: COBERTURA_DECLARACIONES });
    expect(error.detalle).toBe(
      "El calendario del SAT para tipo_plazo=declaraciones_pagos no cubre 2101-01-01; cubre del 2026-01-01 al 2100-12-31.",
    );
    // Sin respaldo: con permitirIncompleto solo descuenta fines de semana después de 2100.
    expect(sat("declaraciones_pagos", "2100-12-31", 1, true).advertencias).toEqual([
      `Calendario incompleto: SAT 2101; solo se descontaron fines de semana. ${FALTA_ART_12}`,
      VACACIONES_SIN_PUBLICAR("2026-11-30", "2101-01-03"),
    ]);
  });

  it("sumarDiasHabiles con el calendario de un plazo usa su respaldo, como la API", () => {
    // Cambio: el camino de bajo nivel (calendario("sat", "general") en el SDK) daba el 25 de
    // diciembre, inhábil por el art. 12; ahora sigue con el respaldo, con las advertencias de la API.
    const general = sumarDiasHabiles({
      calendario: SAT.general.calendario,
      desde: "2026-12-23",
      dias: 2,
      permitirIncompleto: true,
    });
    expect(general).toMatchObject({ resultado: "2026-12-28", advertencias: [AVISO_GENERAL] });
    expect(general).toEqual(sat("general", "2026-12-23", 2, true));
    // Sin permitirIncompleto no lo usa: fuera de la cobertura lanza, como antes.
    const error = incompleto(() =>
      sumarDiasHabiles({ calendario: SAT.general.calendario, desde: "2026-12-23", dias: 2 }),
    );
    expect(error).toMatchObject({ fecha: "2026-12-24", cobertura: COBERTURA_GENERAL });
    expect(SAT.general.calendario.respaldo?.calendario).toBe(SAT.general.respaldo);
    expect(SAT.plazos.get("declaraciones_pagos")?.calendario.respaldo).toBeUndefined();
    expect(CNBV.general.calendario.respaldo).toBeUndefined();
    expect(SAT.general.calendario.faltaFuera).toBe(FALTA_ART_12_Y_VACACIONES);
    expect(SAT.general.respaldo?.faltaFuera).toBe(FALTA_ART_12_Y_VACACIONES);
    expect(SAT.plazos.get("declaraciones_pagos")?.calendario.faltaFuera).toBe(FALTA_ART_12);
    expect(CNBV.general.calendario.faltaFuera).toBe(
      "Pueden faltar días de cierre bancario, como el 1 de enero.",
    );
  });

  it.each([
    ["2026-07-15", 10],
    ["2026-11-27", 2],
    ["2026-12-24", 5],
    ["2030-09-30", 1],
    ["2100-12-31", 1],
    ["2025-12-30", 2],
    // Empieza antes de 2026 y pasa del fin de general: el aviso del respaldo va antes que el del año.
    ["2025-12-30", 240],
  ] as const)(
    "con permitirIncompleto, el núcleo da lo mismo que sumarDiasHabilesCurado: %s + %i",
    (desde, dias) => {
      const nucleo = sumarDiasHabiles({
        calendario: SAT.general.calendario,
        desde,
        dias,
        permitirIncompleto: true,
      });
      expect(nucleo).toEqual(sat("general", desde, dias, true));
    },
  );

  it("el aviso del respaldo va antes que el del año sin calendario", () => {
    const r = sat("general", "2025-12-30", 240, true);
    expect(r.resultado > "2026-11-30").toBe(true);
    expect(r.advertencias).toEqual([
      AVISO_GENERAL,
      `Calendario incompleto: SAT 2025; solo se descontaron fines de semana. ${FALTA_ART_12_Y_VACACIONES}`,
    ]);
  });

  it("avisa de la transmisión del Poder Ejecutivo al pasar por el 1o. de octubre o de diciembre entre semana", () => {
    const aviso = avisoTransmisionCff(2030).texto;
    // El 1o. de octubre de 2030 (martes) cuenta como hábil: es el lado seguro, y se avisa.
    // Cambio: al final, que las vacaciones de 2030 no están publicadas.
    const sinPublicar = (fecha: string) => VACACIONES_SIN_PUBLICAR("2026-11-30", fecha);
    expect(sat("declaraciones_pagos", "2030-09-30", 1)).toMatchObject({
      resultado: "2030-10-01",
      advertencias: [aviso, sinPublicar("2030-10-01")],
    });
    // Cambio: el 1o. de diciembre de 2030 es domingo, ya inhábil, así que no se avisa.
    expect(sat("declaraciones_pagos", "2030-11-29", 1)).toMatchObject({
      resultado: "2030-12-02",
      advertencias: [sinPublicar("2030-12-02")],
    });
    // El de 2036 es lunes: cuenta como hábil y se avisa.
    expect(sat("declaraciones_pagos", "2036-11-28", 1)).toMatchObject({
      resultado: "2036-12-01",
      advertencias: [avisoTransmisionCff(2036).texto, sinPublicar("2036-12-01")],
    });
    expect(sat("declaraciones_pagos", "2030-10-01", 1).advertencias).toEqual([
      sinPublicar("2030-10-02"),
    ]);
    // Con general, después de las advertencias de cobertura.
    expect(sat("general", "2030-09-30", 1, true).advertencias).toEqual([AVISO_GENERAL, aviso]);
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
    // General es la cobertura amplia y declaraciones_pagos empieza en febrero: en enero lo cubre
    // general, que cuenta todos los tipos de día, así que a declaraciones_pagos no le falta ninguno.
    const generalMasAmplio = conPlazos(
      { cobertura: COBERTURA_DECLARACIONES },
      { cobertura: { desde: "2026-02-01", hasta: "2026-12-31" } },
    );

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
        "El calendario del SAT para tipo_plazo=general no cubre 2026-01-06; cubre del 2026-02-01 al 2026-11-30 porque los días de tipo vacaciones anteriores no están publicados o no se han cargado. Puedes calcular con permitir_incompleto=true: descuenta lo publicado y el resultado puede cambiar cuando se publique lo que falta. Solo si el plazo es para presentar declaraciones o pagar contribuciones, usa tipo_plazo=declaraciones_pagos, que no los cuenta y cubre del 2026-01-01 al 2100-12-31.",
      );
    });

    it("declaraciones_pagos antes de las vacaciones publicadas también avisa", () => {
      // General (las vacaciones publicadas) empieza en febrero; declaraciones_pagos cubre enero.
      expect(sat("declaraciones_pagos", "2026-01-05", 1, false, desdeFebrero)).toMatchObject({
        resultado: "2026-01-06",
        advertencias: [VACACIONES_ANTES("2026-02-01", "2026-01-06")],
      });
    });

    it("si ningún tipo de día puede faltar, ni advertencia ni explicación", () => {
      expect(sat("declaraciones_pagos", "2026-01-05", 1, true, generalMasAmplio)).toMatchObject({
        resultado: "2026-01-06",
        advertencias: [],
      });
      const error = incompleto(() =>
        sat("declaraciones_pagos", "2026-01-05", 1, false, generalMasAmplio),
      );
      expect(error.detalle).toBe(
        "El calendario del SAT para tipo_plazo=declaraciones_pagos no cubre 2026-01-06; cubre del 2026-02-01 al 2026-12-31.",
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
      new RangeError("El calendario de la CNBV no tiene el tipo de plazo declaraciones_pagos."),
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
      // Nombra el riesgo: el resultado cae justo en el 1 de enero, que los bancos suelen cerrar.
      advertencias: [
        "Calendario incompleto: CNBV 2027; solo se descontaron fines de semana. Pueden faltar días de cierre bancario, como el 1 de enero.",
      ],
    });
  });
});

describe("diasInhabilesCurados", () => {
  it("cnbv: los días del año con su cita, sin advertencias", () => {
    expect(diasInhabilesCurados(CNBV, 2026)).toEqual({
      dias: DIAS_CNBV.slice(1),
      advertencias: [],
      avisos: [],
    });
    expect(diasInhabilesCurados(CNBV, 2025).dias).toEqual(DIAS_CNBV.slice(0, 1));
  });

  it("sat 2026: la lista conocida, con la advertencia de las vacaciones que pueden faltar", () => {
    // Los ocho días del art. 12 de 2026 salen de la regla aunque el shard traiga solo tres.
    expect(diasInhabilesCurados(SAT, 2026)).toEqual({
      dias: DIAS_CALENDARIO_SAT.filter((d) => d.fecha.startsWith("2026-")),
      advertencias: [ADVERTENCIA_SAT_2026],
      avisos: [{ codigo: "lista-incompleta", texto: ADVERTENCIA_SAT_2026 }],
    });
    expect(diasInhabilesCurados(SAT, 2026).dias).toHaveLength(22);
  });

  it("sat 2027 y después: los días del art. 12, con la advertencia de las vacaciones", () => {
    // Cambio: antes, 422 desde 2027.
    const lista2027 =
      "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2027 está completa.";
    expect(diasInhabilesCurados(SAT, 2027)).toEqual({
      dias: diasDescansoCff(2027),
      advertencias: [lista2027],
      avisos: [{ codigo: "lista-incompleta", texto: lista2027 }],
    });
    // En un año de transmisión, también el aviso del 1o. de octubre y el 1o. de diciembre.
    const { dias, advertencias } = diasInhabilesCurados(SAT, 2030);
    expect(dias).toEqual(diasDescansoCff(2030));
    expect(advertencias).toHaveLength(2);
    expect(advertencias[1]).toBe(avisoTransmisionCff(2030).texto);
    expect(diasInhabilesCurados(SAT, 2100).dias).toEqual(diasDescansoCff(2100));
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

  it("un plazo que cubre el año y cuenta todos los tipos de día solo puede ser general", () => {
    // Un declaraciones_pagos que cuente las vacaciones va contra PLAZOS: no se arma. Si general
    // cubre el año, no hay advertencias (la prueba anterior).
    const declaraciones = { cobertura: COBERTURA_DECLARACIONES, excluir_tipos: [] };
    expect(() =>
      crearCalendarioCurado({
        ...SHARD_SAT,
        plazos: { ...SHARD_SAT.plazos, declaraciones_pagos: declaraciones },
      }),
    ).toThrow(/excluir_tipos \[\] y la regla del núcleo pide \[vacaciones\]/);
  });

  it.each([
    [SAT, 2025, "2025", COBERTURA_DECLARACIONES, "del SAT"],
    [SAT, 2101, "2101", COBERTURA_DECLARACIONES, "del SAT"],
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
