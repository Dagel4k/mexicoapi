import { fileURLToPath } from "node:url";
import {
  type AutoridadCurada,
  type Calendario,
  CalendarioIncompletoError,
  COBERTURA_CFF,
  COBERTURA_LFT,
  type DiaInhabilCurado,
  diasDescansoCff,
  diasDescansoLft,
  FUENTE_CFF_12,
  FUENTE_LFT_74,
  type FuenteDof,
  revisarTipoPlazo,
  sumarDias,
  sumarDiasHabiles,
  type TipoPlazo,
  VIGENCIA_LFT,
} from "@mexicoapi/core";
import { crearCalendarioCurado } from "@mexicoapi/core/curados";
import { describe, expect, it } from "vitest";
import {
  coberturasDeLaLista,
  registrosConRegla,
  type ShardCalendario,
  shardCalendario,
} from "../../src/curado/calendario.js";
import type { DocumentoCurado } from "../../src/curado/leer.js";
import { interpretarCurado, leerCurado } from "../../src/curado/leer.js";
import { curadoDiasCnbv, curadoDiasSat, type DefinicionCurado } from "../../src/curado/registro.js";
import { ErrorDatos } from "../../src/errores.js";
import { COBERTURA_LISTA_LFT, coberturasDe, diasLft } from "../../src/sitio/calendarios.js";
import { YAML_CNBV, YAML_SAT } from "../curado/ejemplos.js";

function documento(
  def: DefinicionCurado<DiaInhabilCurado>,
  yaml: string,
): DocumentoCurado<DiaInhabilCurado> {
  const lectura = interpretarCurado(def, yaml);
  if (lectura.documento === null) throw new Error(lectura.problemas.join("; "));
  return lectura.documento;
}

/** Los años de la regla de la LFT. */
const COBERTURA_LFT_ANIOS = [2007, 2100] as const;

const shardDe = (autoridad: AutoridadCurada, d: DocumentoCurado<DiaInhabilCurado>) =>
  shardCalendario(autoridad, d.registros, d.cobertura);

/**
 * Lo que hace el Worker con el shard: lo lee como JSON y lo arma con crearCalendarioCurado del
 * núcleo, que agrega los días de la regla (en el SAT, los del art. 12 hasta 2100).
 */
function calendarioDe(shard: ShardCalendario, tipo: TipoPlazo): Calendario {
  const curado = crearCalendarioCurado(JSON.parse(JSON.stringify(shard)) as ShardCalendario);
  const plazo = curado.plazos.get(tipo);
  if (plazo === undefined) throw new Error(`${shard.autoridad} no tiene el plazo ${tipo}`);
  return plazo.calendario;
}

const fuente = (fragmento: string, fecha_publicacion = "2025-12-10"): FuenteDof => ({
  nombre: "Disposiciones",
  url: "https://dof.gob.mx/x",
  fecha_publicacion,
  fragmento,
});

const dia = (
  fecha: string,
  tipo: DiaInhabilCurado["tipo"],
  f: FuenteDof,
  autoridad: AutoridadCurada = "sat",
): DiaInhabilCurado => ({ fecha, autoridad, motivo: `Motivo ${fecha}`, tipo, fuente: f });

describe("shardCalendario", () => {
  it("SAT: general cubre la intersección con las vacaciones y declaraciones_pagos la regla del art. 12", () => {
    const d = documento(curadoDiasSat, YAML_SAT);
    const shard = shardDe("sat", d);
    expect(Object.keys(shard)).toEqual(["autoridad", "plazos", "fuentes_fin_de_semana", "dias"]);
    expect(shard.autoridad).toBe("sat");
    // Cambio: declaraciones_pagos llega al fin de la regla del art. 12 (antes, 2026-12-31).
    expect(shard.plazos).toEqual({
      general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
      declaraciones_pagos: {
        cobertura: { desde: "2026-01-01", hasta: "2100-12-31" },
        excluir_tipos: ["vacaciones"],
      },
    });
    // Los días van sin autoridad (está arriba) y con la fuente completa.
    expect(shard.dias).toEqual(
      d.registros.map(({ fecha, motivo, tipo, fuente }) => ({ fecha, motivo, tipo, fuente })),
    );
    expect(shard.dias.map((x) => x.fecha)).toEqual([...shard.dias.map((x) => x.fecha)].sort());
    // Los fines de semana los cita la regla (el art. 12 del CFF): el shard no trae ninguno.
    expect(shard.fuentes_fin_de_semana).toEqual({});
    expect(calendarioDe(shard, "general").inhabil("2026-10-17")?.fuente).toEqual(FUENTE_CFF_12);
  });

  it("SAT: el shard puede traer la lista publicada, con los días de la regla", () => {
    const d = documento(curadoDiasSat, YAML_SAT);
    const lista = registrosConRegla("sat", d.registros, d.cobertura);
    expect(lista.filter((r) => r.tipo === "descanso").map((r) => r.fecha)).toEqual(
      diasDescansoCff(2026).map((r) => r.fecha),
    );
    expect(lista.filter((r) => r.tipo === "vacaciones")).toEqual(d.registros);
    const shard = shardCalendario("sat", lista, d.cobertura);
    expect(shard.plazos).toEqual(shardDe("sat", d).plazos);
    expect(shard.dias).toHaveLength(lista.length);
    // Un día de descanso que no es el de la regla lo rechaza el núcleo.
    const cambiado = lista.map((r) =>
      r.fecha === "2026-05-05" ? { ...r, motivo: "Batalla de Puebla" } : r,
    );
    expect(() => shardCalendario("sat", cambiado, d.cobertura)).toThrow(
      /el núcleo rechaza el calendario: .*2026-05-05 distinto del que da la regla/,
    );
  });

  it("coberturasDe da una fila por tipo de plazo, en el orden del shard", () => {
    expect(coberturasDe(shardDe("sat", documento(curadoDiasSat, YAML_SAT)))).toEqual([
      { autoridad: "sat", tipo_plazo: "general", desde: "2026-01-01", hasta: "2026-11-30" },
      {
        autoridad: "sat",
        tipo_plazo: "declaraciones_pagos",
        desde: "2026-01-01",
        hasta: "2100-12-31",
      },
    ]);
  });

  it("coberturasDeLaLista: la lista publicada del SAT solo trae la regla de los años del YAML", () => {
    const d = documento(curadoDiasSat, YAML_SAT);
    const lista = registrosConRegla("sat", d.registros, d.cobertura);
    const plazos = coberturasDeLaLista("sat", lista, d.cobertura);
    expect(coberturasDe({ autoridad: "sat", plazos })).toEqual([
      { autoridad: "sat", tipo_plazo: "general", desde: "2026-01-01", hasta: "2026-11-30" },
      {
        autoridad: "sat",
        tipo_plazo: "declaraciones_pagos",
        desde: "2026-01-01",
        hasta: "2026-12-31",
      },
    ]);
    // Sin regla, la de la lista es la del calendario.
    const cnbv = documento(curadoDiasCnbv, YAML_CNBV);
    expect(coberturasDeLaLista("cnbv", cnbv.registros, cnbv.cobertura)).toEqual(
      shardDe("cnbv", cnbv).plazos,
    );
    expect(() => coberturasDeLaLista("sat", lista, null)).toThrow(/sin cobertura/);
    // Un día después de los años de la lista no cae en ella.
    const fds = fuente("Los sábados y domingos.");
    expect(() =>
      coberturasDeLaLista("sat", [...lista, dia("2027-01-04", "vacaciones", fds)], d.cobertura),
    ).toThrow(/2027-01-04: no cae en la cobertura/);
  });

  it("registrosConRegla: sin regla o sin años en la regla, los del YAML tal cual", () => {
    const cnbv = documento(curadoDiasCnbv, YAML_CNBV);
    expect(registrosConRegla("cnbv", cnbv.registros, cnbv.cobertura)).toEqual(cnbv.registros);
    const vacaciones = [dia("2025-07-20", "vacaciones", fuente("x"))];
    expect(
      registrosConRegla("sat", vacaciones, {
        vacaciones: { desde: "2025-01-01", hasta: "2025-12-31" },
      }),
    ).toEqual(vacaciones);
    expect(registrosConRegla("sat", vacaciones, null)).toEqual(vacaciones);
    expect(registrosConRegla("sat", vacaciones, {})).toEqual(vacaciones);
    // Los años de la lista no pasan de la cobertura de la regla (2100).
    const lejos = registrosConRegla("sat", [], {
      vacaciones: { desde: "2100-03-01", hasta: "2101-06-30" },
    });
    expect(lejos.map((d) => d.fecha)).toEqual(diasDescansoCff(2100).map((d) => d.fecha));
  });

  it("CNBV: solo el plazo general, con la cobertura de descanso", () => {
    const shard = shardDe("cnbv", documento(curadoDiasCnbv, YAML_CNBV));
    expect(shard.autoridad).toBe("cnbv");
    expect(shard.plazos).toEqual({
      general: { cobertura: { desde: "2026-01-01", hasta: "2026-12-31" }, excluir_tipos: [] },
    });
    expect(Object.keys(shard.fuentes_fin_de_semana)).toEqual(["2026"]);
    expect(shard.fuentes_fin_de_semana["2026"]?.fragmento).toContain("IX. Los sábados y domingos.");
    expect(shard.dias).toHaveLength(11);
    for (const d of shard.dias) expect(d).not.toHaveProperty("autoridad");
  });

  it("cada año cita los fines de semana con la fuente de su último día de descanso", () => {
    const de2025 = fuente("2025: IX. Los sábados y domingos.", "2024-12-27");
    const de2026 = fuente("2026: IX. Los sábados y domingos.");
    const otra = fuente("Otra publicación de 2025, sin fines de semana.", "2025-03-01");
    const shard = shardCalendario(
      "cnbv",
      [
        dia("2025-04-17", "descanso", otra, "cnbv"),
        dia("2025-12-25", "descanso", de2025, "cnbv"),
        dia("2026-12-25", "descanso", de2026, "cnbv"),
      ],
      { descanso: { desde: "2025-01-01", hasta: "2026-12-31" } },
    );
    expect(shard.fuentes_fin_de_semana).toEqual({ 2025: de2025, 2026: de2026 });
    // Lo que usa el Worker: un sábado de 2025 cita las disposiciones de 2025.
    const calendario = calendarioDe(shard, "general");
    expect(calendario.inhabil("2025-10-18")?.fuente).toEqual(de2025);
    expect(calendario.inhabil("2026-10-17")?.fuente).toEqual(de2026);
  });

  it("falla con ErrorDatos si un año de la cobertura no tiene días de descanso", () => {
    const fds = fuente("IX. Los sábados y domingos.");
    expect(() =>
      shardCalendario("cnbv", [dia("2026-12-25", "descanso", fds, "cnbv")], {
        descanso: { desde: "2026-01-01", hasta: "2027-01-31" },
      }),
    ).toThrow(/sin días de descanso en 2027/);
  });

  it("falla con ErrorDatos si la fuente de los fines de semana no los menciona", () => {
    const sinFds = fuente("Artículo 1.- [...] VIII. El 12 y 25 de diciembre.");
    expect(() =>
      shardCalendario("cnbv", [dia("2026-12-25", "descanso", sinFds, "cnbv")], {
        descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
      }),
    ).toThrow(/no menciona los sábados y domingos/);
  });

  it("falla con ErrorDatos sin días de descanso, sin cobertura o con una cobertura vacía", () => {
    const fds = fuente("Los sábados y domingos.");
    // La CNBV cita sus fines de semana con sus días de descanso; el SAT, con la regla.
    const casos: [
      AutoridadCurada,
      DiaInhabilCurado[],
      Parameters<typeof shardCalendario>[2],
      RegExp,
    ][] = [
      [
        "cnbv",
        [],
        { descanso: { desde: "2026-01-01", hasta: "2026-12-31" } },
        /sin días de descanso/,
      ],
      ["sat", [dia("2026-07-20", "vacaciones", fds)], null, /sin cobertura/],
      [
        "sat",
        [dia("2025-07-21", "vacaciones", fds)],
        { vacaciones: { desde: "2025-01-01", hasta: "2025-12-31" } },
        /la cobertura del plazo general queda vacía/,
      ],
    ];
    for (const [autoridad, dias, cobertura, mensaje] of casos) {
      let error: unknown;
      try {
        shardCalendario(autoridad, dias, cobertura);
      } catch (e) {
        error = e;
      }
      expect(error, String(mensaje)).toBeInstanceOf(ErrorDatos);
      expect((error as ErrorDatos).dataset).toBe(`dias-inhabiles.${autoridad}`);
      expect((error as ErrorDatos).message).toMatch(mensaje);
    }
  });

  it("la cobertura de general va del desde más tardío al hasta más temprano", () => {
    const fds = fuente("Los sábados y domingos.");
    const shard = shardCalendario("sat", [dia("2026-07-20", "vacaciones", fds)], {
      vacaciones: { desde: "2026-03-01", hasta: "2026-11-30" },
    });
    expect(shard.plazos.general.cobertura).toEqual({ desde: "2026-03-01", hasta: "2026-11-30" });
    expect(shard.plazos.declaraciones_pagos?.cobertura).toEqual(COBERTURA_CFF);
  });

  it("falla con ErrorDatos si un día queda fuera de la cobertura de todos los plazos", () => {
    // El Worker rechaza el shard entero si un día cae fuera de la cobertura amplia, que en el SAT
    // empieza con la regla del art. 12 (2026).
    const fds = fuente("Los sábados y domingos.");
    expect(() =>
      shardCalendario(
        "sat",
        [dia("2025-12-31", "vacaciones", fds), dia("2026-07-20", "vacaciones", fds)],
        { vacaciones: { desde: "2025-12-18", hasta: "2026-11-30" } },
      ),
    ).toThrow(/2025-12-31: no cae en la cobertura de ningún tipo de plazo/);
  });

  it("con la regla, declaraciones_pagos tiene cobertura aunque el YAML solo traiga vacaciones", () => {
    // Antes, sin cobertura de descanso en el YAML, declaraciones_pagos se quedaba sin cobertura.
    const fds = fuente("Los sábados y domingos.");
    const shard = shardCalendario("sat", [dia("2026-07-20", "vacaciones", fds)], {
      vacaciones: { desde: "2026-01-01", hasta: "2026-12-31" },
    });
    expect(shard.plazos.declaraciones_pagos?.cobertura).toEqual(COBERTURA_CFF);
  });
});

describe("calendarios reales de data/curado con crearCalendario y sumarDiasHabiles", async () => {
  const raiz = fileURLToPath(new URL("../../../../data", import.meta.url));
  async function leer(def: DefinicionCurado<DiaInhabilCurado>) {
    const lectura = await leerCurado(def, raiz);
    if (lectura?.documento == null) throw new Error(`no se pudo leer ${def.yaml}`);
    return lectura.documento;
  }
  // La cobertura sale del YAML: las pruebas no fijan la de hoy y siguen valiendo cuando se
  // capture un periodo de vacaciones o un año nuevo.
  const yamlSat = await leer(curadoDiasSat);
  const yamlCnbv = await leer(curadoDiasCnbv);
  const sat = shardDe("sat", yamlSat);
  const cnbv = shardDe("cnbv", yamlCnbv);
  const general = calendarioDe(sat, "general");
  const declaraciones = calendarioDe(sat, "declaraciones_pagos");
  const bancos = calendarioDe(cnbv, "general");
  const sumar = (calendario: Calendario, desde: string, dias: number) =>
    sumarDiasHabiles({ calendario, desde, dias });
  const fechas = (r: { inhabiles_saltados: { fecha: string }[] }) =>
    r.inhabiles_saltados.map((d) => d.fecha);
  const julio = Array.from({ length: 12 }, (_, i) => `2026-07-${20 + i}`);

  it("SAT: un plazo que cruza el 20 al 31 de julio las salta con general y no con declaraciones_pagos", () => {
    const g = sumar(general, "2026-07-15", 10);
    expect(g.resultado).toBe("2026-08-12");
    expect(fechas(g)).toEqual(julio);
    expect(g.inhabiles_saltados.every((d) => d.tipo === "vacaciones")).toBe(true);
    expect(g.inhabiles_saltados[0]?.fuente.url).toBe(
      "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
    );
    const d = sumar(declaraciones, "2026-07-15", 10);
    expect(d.resultado).toBe("2026-07-29");
    expect(d.inhabiles_saltados).toEqual([]);
    expect(sumar(general, "2026-07-17", 1).resultado).toBe("2026-08-03");
    expect(sumar(declaraciones, "2026-07-17", 1).resultado).toBe("2026-07-20");
  });

  it("SAT: el 2 y 3 de abril son inhábiles en general y hábiles en declaraciones y pagos", () => {
    const g = sumar(general, "2026-04-01", 1);
    expect(g.resultado).toBe("2026-04-06");
    expect(fechas(g)).toEqual(["2026-04-02", "2026-04-03"]);
    expect(sumar(declaraciones, "2026-04-01", 1).resultado).toBe("2026-04-02");
    // Los días del art. 12 cuentan en los dos tipos de plazo.
    expect(sumar(declaraciones, "2026-09-15", 1).resultado).toBe("2026-09-17");
  });

  /** El error de sumar un día hábil desde el último día de la cobertura del calendario. */
  function alDiaSiguiente(calendario: Calendario): unknown {
    try {
      sumar(calendario, calendario.cobertura.hasta, 1);
    } catch (e) {
      return e;
    }
    return expect.unreachable();
  }

  it("SAT: general cubre donde se cruzan la regla del art. 12 y las vacaciones; declaraciones y pagos, la regla", () => {
    const { vacaciones } = yamlSat.cobertura ?? {};
    if (vacaciones === undefined) throw new Error("falta la cobertura de vacaciones");
    const descanso = COBERTURA_CFF;
    expect(general.cobertura).toEqual({
      desde: descanso.desde > vacaciones.desde ? descanso.desde : vacaciones.desde,
      hasta: descanso.hasta < vacaciones.hasta ? descanso.hasta : vacaciones.hasta,
    });
    expect(declaraciones.cobertura).toEqual(descanso);
    for (const calendario of [general, declaraciones]) {
      const error = alDiaSiguiente(calendario);
      expect(error).toBeInstanceOf(CalendarioIncompletoError);
      expect(error).toMatchObject({
        autoridad: "sat",
        fecha: sumarDias(calendario.cobertura.hasta, 1),
        cobertura: calendario.cobertura,
      });
    }
    // El 25 de diciembre de 2026 cuenta en los dos plazos.
    const d = sumar(declaraciones, "2026-12-24", 1);
    expect(d.resultado).toBe("2026-12-28");
    expect(fechas(d)).toEqual(["2026-12-25"]);
    // Y el 1 de enero de 2027, que ya no depende de una publicación.
    const enero = sumar(declaraciones, "2026-12-30", 2);
    expect(enero.resultado).toBe("2027-01-04");
    expect(fechas(enero)).toEqual(["2027-01-01"]);
  });

  it("CNBV: salta sus días de 2025 y 2026 y falla al día siguiente de su cobertura", () => {
    expect(bancos.cobertura).toEqual(yamlCnbv.cobertura?.descanso);
    expect(sumar(bancos, "2026-04-01", 1).resultado).toBe("2026-04-06");
    expect(sumar(bancos, "2025-12-11", 1).resultado).toBe("2025-12-15");
    expect(fechas(sumar(bancos, "2025-11-14", 1))).toEqual(["2025-11-17"]);
    // El 2 de noviembre cierran los bancos, aunque no es descanso de la LFT.
    expect(sumar(bancos, "2026-10-30", 1).resultado).toBe("2026-11-03");
    const error = alDiaSiguiente(bancos);
    expect(error).toBeInstanceOf(CalendarioIncompletoError);
    expect(error).toMatchObject({
      autoridad: "cnbv",
      fecha: sumarDias(bancos.cobertura.hasta, 1),
      cobertura: bancos.cobertura,
    });
  });

  it("los fines de semana citan la fuente de cada autoridad y de cada año", () => {
    expect(general.inhabil("2026-10-17")?.fuente.fragmento).toContain("los sábados, los domingos");
    const fuenteDe = (fecha: string) => cnbv.dias.find((d) => d.fecha === fecha)?.fuente;
    expect(bancos.inhabil("2025-10-18")?.fuente).toEqual(fuenteDe("2025-12-25"));
    expect(bancos.inhabil("2025-10-18")?.fuente.fragmento).toContain("del año 2025");
    expect(bancos.inhabil("2026-10-17")?.fuente).toEqual(fuenteDe("2026-12-25"));
    expect(bancos.inhabil("2026-10-17")?.fuente.fragmento).toContain("del año 2026");
    for (const fuente of Object.values(cnbv.fuentes_fin_de_semana)) {
      expect(fuente.fragmento).toContain("IX. Los sábados y domingos.");
    }
  });
});

describe("calendarios de las descargas", () => {
  // La API rechaza tipo_plazo con la CNBV: la descarga no nombra un plazo que no se puede pedir.
  it("coberturasDe deja tipo_plazo en null en las autoridades que no lo aceptan", () => {
    expect(revisarTipoPlazo("cnbv", "general")).not.toBeNull();
    expect(revisarTipoPlazo("cnbv", undefined)).toBeNull();
    const cnbv = documento(curadoDiasCnbv, YAML_CNBV);
    expect(coberturasDe(shardDe("cnbv", cnbv))).toEqual([
      { autoridad: "cnbv", tipo_plazo: null, desde: "2026-01-01", hasta: "2026-12-31" },
    ]);
    // En el SAT se pide: sale con su nombre.
    expect(
      coberturasDe(shardDe("sat", documento(curadoDiasSat, YAML_SAT))).map((c) => c.tipo_plazo),
    ).toEqual(["general", "declaraciones_pagos"]);
  });

  // Cada día cita el texto en vigor ese día, como la API. La fecha de la fuente es la del texto
  // citado: la de la reforma de 2006 en los días anteriores al 2024-10-01 y, en los demás, la de
  // la última reforma de la ley (VIGENCIA_LFT), como los días del art. 12 del CFF en el SAT.
  it("diasLft son los del art. 74 de 2007 a 2100, los mismos que lista la API", () => {
    const dias = diasLft();
    expect(dias).toHaveLength(673);
    const de2007 = diasDescansoLft(2007)[0]?.fuente;
    expect(de2007?.fecha_publicacion).toBe("2006-01-17");
    expect(dias[0]).toEqual({
      fecha: "2007-01-01",
      autoridad: "lft",
      motivo: "1 de enero",
      tipo: "descanso",
      fuente: de2007,
    });
    expect(dias.find((d) => d.fecha === "2026-01-01")?.fuente).toEqual({
      ...FUENTE_LFT_74,
      fecha_publicacion: VIGENCIA_LFT,
    });
    expect(dias.at(-1)?.fecha).toBe("2100-12-25");
    for (let anio = COBERTURA_LFT_ANIOS[0]; anio <= COBERTURA_LFT_ANIOS[1]; anio++) {
      const delAnio = dias.filter((d) => d.fecha.startsWith(`${anio}-`));
      expect(delAnio, String(anio)).toEqual(
        diasDescansoLft(anio).map((d) => ({
          ...d,
          autoridad: "lft",
          fuente: { ...d.fuente, fecha_publicacion: d.fuente.fecha_publicacion ?? VIGENCIA_LFT },
        })),
      );
    }
    // En orden de fecha y con la fuente en el orden de las de los curados.
    expect(dias.map((d) => d.fecha)).toEqual(dias.map((d) => d.fecha).sort());
    expect(Object.keys(dias[0]?.fuente ?? {})).toEqual([
      "nombre",
      "url",
      "fecha_publicacion",
      "fragmento",
    ]);
  });

  it("la cobertura de la lista de la LFT es la de su calendario, sin tipo de plazo", () => {
    expect(COBERTURA_LISTA_LFT).toEqual({
      autoridad: "lft",
      tipo_plazo: null,
      desde: COBERTURA_LFT.desde,
      hasta: COBERTURA_LFT.hasta,
    });
    expect(COBERTURA_LFT).toEqual({ desde: "2007-01-01", hasta: "2100-12-31" });
  });
});
