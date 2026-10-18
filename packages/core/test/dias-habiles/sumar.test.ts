import { describe, expect, it } from "vitest";
import { calendarioLft, crearCalendario } from "../../src/dias-habiles/calendario.js";
import { AVISO_LFT_715 } from "../../src/dias-habiles/lft.js";
import { sumarDiasHabiles } from "../../src/dias-habiles/sumar.js";
import type { DiaInhabil, Fuente } from "../../src/dias-habiles/tipos.js";
import { CalendarioIncompletoError, FechaFueraDeRangoError } from "../../src/errores.js";

const lft = calendarioLft();
const sat2026 = crearCalendario({
  autoridad: "sat",
  cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
  dias: [],
  fuenteFinDeSemana: { nombre: "SAT", url: "https://example.com/sat" },
});

describe("sumarDiasHabiles", () => {
  it("salta el primer lunes de febrero", () => {
    const r = sumarDiasHabiles({ calendario: lft, desde: "2026-01-30", dias: 1 });
    expect(r.resultado).toBe("2026-02-03");
    expect(r.autoridad).toBe("lft");
    expect(r.desde).toBe("2026-01-30");
    expect(r.dias).toBe(1);
    expect(r.inhabiles_saltados.map((d) => d.fecha)).toEqual(["2026-02-02"]);
    expect(r.advertencias).toEqual([AVISO_LFT_715]);
  });

  it("suma 5 días hábiles desde un viernes", () => {
    const r = sumarDiasHabiles({ calendario: lft, desde: "2026-10-16", dias: 5 });
    expect(r.resultado).toBe("2026-10-23");
    expect(r.inhabiles_saltados).toEqual([]);
  });

  it("empieza a contar el día siguiente a desde, aunque desde sea sábado", () => {
    const r = sumarDiasHabiles({ calendario: lft, desde: "2026-10-17", dias: 1 });
    expect(r.resultado).toBe("2026-10-19");
  });

  it("lista los inhábiles saltados en orden cronológico sin fines de semana", () => {
    // 2026-12-24 (jueves) + 3: salta 25 (vie, descanso), 26-27 (fds), 1 ene (vie) queda fuera.
    const r = sumarDiasHabiles({ calendario: lft, desde: "2026-12-24", dias: 3 });
    expect(r.resultado).toBe("2026-12-30");
    expect(r.inhabiles_saltados.map((d) => d.fecha)).toEqual(["2026-12-25"]);
    expect(r.inhabiles_saltados.every((d) => d.tipo !== "fin_de_semana")).toBe(true);
  });

  it("devuelve objetos nuevos en cada llamada", () => {
    const a = sumarDiasHabiles({ calendario: lft, desde: "2026-01-30", dias: 1 });
    const b = sumarDiasHabiles({ calendario: lft, desde: "2026-01-30", dias: 1 });
    expect(a.inhabiles_saltados).not.toBe(b.inhabiles_saltados);
    expect(a.advertencias).not.toBe(b.advertencias);
    a.inhabiles_saltados.length = 0;
    expect(lft.inhabil("2026-02-02")).not.toBeNull();
  });

  it("lanza CalendarioIncompletoError al salir de la cobertura", () => {
    try {
      sumarDiasHabiles({ calendario: sat2026, desde: "2026-12-30", dias: 5 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CalendarioIncompletoError);
      expect((e as CalendarioIncompletoError).tipo).toBe("calendario-incompleto");
      expect((e as CalendarioIncompletoError).fecha.startsWith("2027")).toBe(true);
    }
  });

  it("con permitirIncompleto da resultado y una advertencia por año", () => {
    const r = sumarDiasHabiles({
      calendario: sat2026,
      desde: "2026-12-30",
      dias: 5,
      permitirIncompleto: true,
    });
    // 31 dic (jue) = 1; 1 ene (vie) = 2; 4, 5, 6 ene = 5.
    expect(r.resultado).toBe("2027-01-06");
    expect(r.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
    ]);
  });

  it("con permitirIncompleto avisa una vez por cada año fuera de cobertura", () => {
    const r = sumarDiasHabiles({
      calendario: sat2026,
      desde: "2026-12-30",
      dias: 200,
      permitirIncompleto: true,
    });
    expect(r.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
    ]);
    const r2 = sumarDiasHabiles({
      calendario: sat2026,
      desde: "2026-12-30",
      dias: 400,
      permitirIncompleto: true,
    });
    expect(r2.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
      "Calendario incompleto: SAT 2028; solo se descontaron fines de semana.",
    ]);
  });

  it("agrega al final los avisos del calendario, con desde y el resultado", () => {
    const pedidos: string[][] = [];
    const conAvisos = crearCalendario({
      autoridad: "sat",
      cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
      dias: [],
      fuenteFinDeSemana: { nombre: "SAT", url: "https://example.com/sat" },
      avisos: (desde, resultado) => {
        pedidos.push([desde, resultado]);
        return [`Aviso de ${desde} a ${resultado}.`];
      },
    });
    const r = sumarDiasHabiles({
      calendario: conAvisos,
      desde: "2026-12-30",
      dias: 5,
      permitirIncompleto: true,
    });
    expect(pedidos).toEqual([["2026-12-30", "2027-01-06"]]);
    expect(r.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
      "Aviso de 2026-12-30 a 2027-01-06.",
    ]);
  });

  it("con permitirIncompleto, la advertencia de cada año dice qué puede faltar si el calendario lo sabe", () => {
    const bancario = crearCalendario({
      autoridad: "cnbv",
      cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
      dias: [],
      fuenteFinDeSemana: { nombre: "CNBV", url: "https://example.com/cnbv" },
      faltaFuera: "Pueden faltar días de cierre bancario, como el 1 de enero.",
    });
    const r = sumarDiasHabiles({
      calendario: bancario,
      desde: "2026-12-30",
      dias: 400,
      permitirIncompleto: true,
    });
    expect(r.advertencias).toEqual([
      "Calendario incompleto: CNBV 2027; solo se descontaron fines de semana. Pueden faltar días de cierre bancario, como el 1 de enero.",
      "Calendario incompleto: CNBV 2028; solo se descontaron fines de semana. Pueden faltar días de cierre bancario, como el 1 de enero.",
    ]);
  });

  it("permitirIncompleto false se comporta como omitido", () => {
    expect(() =>
      sumarDiasHabiles({
        calendario: sat2026,
        desde: "2026-12-30",
        dias: 5,
        permitirIncompleto: false,
      }),
    ).toThrow(CalendarioIncompletoError);
  });

  it("lanza RangeError con días inválidos", () => {
    for (const dias of [0, -1, 1.5, 3651, Number.NaN]) {
      expect(() => sumarDiasHabiles({ calendario: lft, desde: "2026-10-16", dias })).toThrow(
        RangeError,
      );
    }
  });

  it("acepta los límites 1 y 3650", () => {
    // 2026-10-16 es viernes: un día hábil después es el lunes 19.
    expect(sumarDiasHabiles({ calendario: lft, desde: "2026-10-16", dias: 1 }).resultado).toBe(
      "2026-10-19",
    );
    expect(
      sumarDiasHabiles({ calendario: lft, desde: "2026-10-16", dias: 3650 }).resultado,
    ).toMatch(/^2041-/);
  });

  it("con permitirIncompleto, un resultado después de 9999-12-31 lanza FechaFueraDeRangoError", () => {
    expect(() =>
      sumarDiasHabiles({ calendario: lft, desde: "9999-12-31", dias: 1, permitirIncompleto: true }),
    ).toThrow(FechaFueraDeRangoError);
  });

  it("lanza RangeError con desde inválido", () => {
    expect(() => sumarDiasHabiles({ calendario: lft, desde: "2026-02-30", dias: 1 })).toThrow(
      RangeError,
    );
  });
});

describe("sumarDiasHabiles con el calendario del SAT 2026", () => {
  // Las vacaciones del 20 al 31 de julio y el 25 de diciembre, con sus fuentes en el DOF.
  const rm: Fuente = {
    nombre: "Primera Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
    fecha_publicacion: "2026-07-09",
    fragmento:
      "2.1.6. ... I. ... II. ... III. El primer periodo general de vacaciones de 2026, comprende del 20 al 31 de julio de 2026.",
  };
  const cff12: Fuente = {
    nombre: "Código Fiscal de la Federación, artículo 12",
    url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
    fecha_publicacion: "2026-04-09",
    fragmento:
      "Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; [...] y el 25 de diciembre.",
  };
  const julio: DiaInhabil[] = Array.from({ length: 12 }, (_, i) => ({
    fecha: `2026-07-${20 + i}`,
    motivo: "Primer periodo general de vacaciones de 2026",
    tipo: "vacaciones",
    fuente: rm,
  }));
  const navidad: DiaInhabil = {
    fecha: "2026-12-25",
    motivo: "25 de diciembre",
    tipo: "descanso",
    fuente: cff12,
  };
  // general: las vacaciones cuentan y la cobertura llega hasta donde están publicadas.
  const general = crearCalendario({
    autoridad: "sat",
    cobertura: { desde: "2026-01-01", hasta: "2026-11-30" },
    dias: julio,
    fuenteFinDeSemana: cff12,
  });
  // declaraciones y pagos: las vacaciones no cuentan (CFF art. 12, segundo párrafo).
  const declaraciones = crearCalendario({
    autoridad: "sat",
    cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
    dias: [...julio, navidad],
    fuenteFinDeSemana: cff12,
    excluirTipos: ["vacaciones"],
  });

  it("un plazo que cruza el 20 al 31 de julio salta las vacaciones solo en general", () => {
    const r = sumarDiasHabiles({ calendario: general, desde: "2026-07-15", dias: 10 });
    expect(r.resultado).toBe("2026-08-12");
    expect(r.inhabiles_saltados.map((d) => d.fecha)).toEqual(julio.map((d) => d.fecha));
    // El sábado 25 y el domingo 26 son parte del periodo publicado: se saltan como vacaciones.
    expect(r.inhabiles_saltados.every((d) => d.tipo === "vacaciones")).toBe(true);
    expect(r.inhabiles_saltados[0]).toEqual(julio[0]);
    const d = sumarDiasHabiles({ calendario: declaraciones, desde: "2026-07-15", dias: 10 });
    expect(d.resultado).toBe("2026-07-29");
    expect(d.inhabiles_saltados).toEqual([]);
  });

  it("desde el viernes antes del periodo, un día hábil cae el 3 de agosto o el 20 de julio", () => {
    expect(sumarDiasHabiles({ calendario: general, desde: "2026-07-17", dias: 1 }).resultado).toBe(
      "2026-08-03",
    );
    expect(
      sumarDiasHabiles({ calendario: declaraciones, desde: "2026-07-17", dias: 1 }).resultado,
    ).toBe("2026-07-20");
  });

  it("general no cubre diciembre; declaraciones y pagos sí y salta el 25", () => {
    try {
      sumarDiasHabiles({ calendario: general, desde: "2026-11-27", dias: 2 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CalendarioIncompletoError);
      expect(e).toMatchObject({
        autoridad: "sat",
        fecha: "2026-12-01",
        cobertura: { desde: "2026-01-01", hasta: "2026-11-30" },
      });
    }
    const r = sumarDiasHabiles({ calendario: declaraciones, desde: "2026-12-24", dias: 1 });
    expect(r.resultado).toBe("2026-12-28");
    expect(r.inhabiles_saltados).toEqual([navidad]);
  });
});
