import { fileURLToPath } from "node:url";
import {
  type AutoridadCurada,
  type Calendario,
  CalendarioIncompletoError,
  crearCalendario,
  type DiaInhabilCurado,
  type FuenteDof,
  sumarDias,
  sumarDiasHabiles,
  type TipoPlazo,
} from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import type { DocumentoCurado } from "../../src/curado/leer.js";
import { interpretarCurado, leerCurado } from "../../src/curado/leer.js";
import { curadoDiasCnbv, curadoDiasSat, type DefinicionCurado } from "../../src/curado/registro.js";
import { ErrorDatos } from "../../src/errores.js";
import {
  coberturasDe,
  type ShardCalendario,
  shardCalendario,
} from "../../src/sitio/calendarios.js";
import { YAML_CNBV, YAML_SAT } from "../curado/ejemplos.js";

function documento(
  def: DefinicionCurado<DiaInhabilCurado>,
  yaml: string,
): DocumentoCurado<DiaInhabilCurado> {
  const lectura = interpretarCurado(def, yaml);
  if (lectura.documento === null) throw new Error(lectura.problemas.join("; "));
  return lectura.documento;
}

const shardDe = (autoridad: AutoridadCurada, d: DocumentoCurado<DiaInhabilCurado>) =>
  shardCalendario(autoridad, d.registros, d.cobertura);

/**
 * Lo que hace el Worker con el shard: lo lee como JSON, toma los días que caen en la cobertura
 * del plazo (crearCalendario rechaza los de afuera) y arma el calendario.
 */
function calendarioDe(shard: ShardCalendario, tipo: TipoPlazo): Calendario {
  const { autoridad, plazos, dias, fuentes_fin_de_semana } = JSON.parse(
    JSON.stringify(shard),
  ) as ShardCalendario;
  const plazo = plazos[tipo];
  if (plazo === undefined) throw new Error(`${autoridad} no tiene el plazo ${tipo}`);
  const { desde, hasta } = plazo.cobertura;
  return crearCalendario({
    autoridad,
    cobertura: plazo.cobertura,
    dias: dias.filter((d) => d.fecha >= desde && d.fecha <= hasta),
    fuenteFinDeSemana: (anio) => fuentes_fin_de_semana[String(anio)] as FuenteDof,
    excluirTipos: plazo.excluir_tipos,
  });
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
  it("SAT: general cubre la intersección y declaraciones_pagos la de descanso, sin vacaciones", () => {
    const d = documento(curadoDiasSat, YAML_SAT);
    const shard = shardDe("sat", d);
    expect(Object.keys(shard)).toEqual(["autoridad", "plazos", "fuentes_fin_de_semana", "dias"]);
    expect(shard.autoridad).toBe("sat");
    expect(shard.plazos).toEqual({
      general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
      declaraciones_pagos: {
        cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
        excluir_tipos: ["vacaciones"],
      },
    });
    // Los días van sin autoridad (está arriba) y con la fuente completa.
    expect(shard.dias).toEqual(
      d.registros.map(({ fecha, motivo, tipo, fuente }) => ({ fecha, motivo, tipo, fuente })),
    );
    expect(shard.dias.map((x) => x.fecha)).toEqual([...shard.dias.map((x) => x.fecha)].sort());
    // Los fines de semana se citan con el CFF art. 12, la fuente de los días de descanso.
    expect(shard.fuentes_fin_de_semana).toEqual({
      2026: d.registros.find((r) => r.fecha === "2026-12-25")?.fuente,
    });
    expect(shard.fuentes_fin_de_semana["2026"]?.nombre).toBe(
      "Código Fiscal de la Federación, artículo 12",
    );
  });

  it("coberturasDe da una fila por tipo de plazo, en el orden del shard", () => {
    expect(coberturasDe(shardDe("sat", documento(curadoDiasSat, YAML_SAT)))).toEqual([
      { autoridad: "sat", tipo_plazo: "general", desde: "2026-01-01", hasta: "2026-11-30" },
      {
        autoridad: "sat",
        tipo_plazo: "declaraciones_pagos",
        desde: "2026-01-01",
        hasta: "2026-12-31",
      },
    ]);
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
    const casos: [DiaInhabilCurado[], Parameters<typeof shardCalendario>[2], RegExp][] = [
      [
        [dia("2026-07-20", "vacaciones", fds)],
        {
          descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
          vacaciones: { desde: "2026-01-01", hasta: "2026-12-31" },
        },
        /sin días de descanso/,
      ],
      [[dia("2026-12-25", "descanso", fds)], null, /sin cobertura/],
      [
        [dia("2026-12-25", "descanso", fds)],
        {
          descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
          vacaciones: { desde: "2025-01-01", hasta: "2025-12-31" },
        },
        /la cobertura del plazo general queda vacía/,
      ],
    ];
    for (const [dias, cobertura, mensaje] of casos) {
      let error: unknown;
      try {
        shardCalendario("sat", dias, cobertura);
      } catch (e) {
        error = e;
      }
      expect(error, String(mensaje)).toBeInstanceOf(ErrorDatos);
      expect((error as ErrorDatos).dataset).toBe("dias-inhabiles.sat");
      expect((error as ErrorDatos).message).toMatch(mensaje);
    }
  });

  it("la cobertura de general va del desde más tardío al hasta más temprano", () => {
    const fds = fuente("Los sábados y domingos.");
    const shard = shardCalendario("sat", [dia("2026-12-25", "descanso", fds)], {
      descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
      vacaciones: { desde: "2026-03-01", hasta: "2026-11-30" },
    });
    expect(shard.plazos.general.cobertura).toEqual({ desde: "2026-03-01", hasta: "2026-11-30" });
    expect(shard.plazos.declaraciones_pagos?.cobertura).toEqual({
      desde: "2026-01-01",
      hasta: "2026-12-31",
    });
  });

  it("falla con ErrorDatos si un día queda fuera de la cobertura de todos los plazos", () => {
    // El Worker rechaza el shard entero si un día cae fuera de la cobertura amplia.
    const fds = fuente("Los sábados y domingos.");
    expect(() =>
      shardCalendario(
        "sat",
        [dia("2026-12-25", "descanso", fds), dia("2027-01-04", "vacaciones", fds)],
        {
          descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
          vacaciones: { desde: "2026-01-01", hasta: "2027-01-04" },
        },
      ),
    ).toThrow(/2027-01-04: no cae en la cobertura de ningún tipo de plazo/);
  });

  it("falla si un plazo no tiene cobertura de ningún tipo de día que cuente", () => {
    // declaraciones_pagos no cuenta las vacaciones y no hay cobertura de descanso.
    const fds = fuente("Los sábados y domingos.");
    expect(() =>
      shardCalendario("sat", [dia("2026-12-25", "descanso", fds)], {
        vacaciones: { desde: "2026-01-01", hasta: "2026-12-31" },
      }),
    ).toThrow(/el plazo declaraciones_pagos no tiene cobertura/);
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

  it("SAT: general cubre donde se cruzan descanso y vacaciones; declaraciones y pagos, donde hay descanso", () => {
    const { descanso, vacaciones } = yamlSat.cobertura ?? {};
    if (descanso === undefined || vacaciones === undefined) throw new Error("faltan coberturas");
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
