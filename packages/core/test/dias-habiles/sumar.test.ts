import { describe, expect, it } from "vitest";
import { calendarioLft, crearCalendario } from "../../src/dias-habiles/calendario.js";
import { sumarDiasHabiles } from "../../src/dias-habiles/sumar.js";
import { CalendarioIncompletoError } from "../../src/errores.js";

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
    expect(r.advertencias).toEqual([]);
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
    // 2026-12-24 (jueves) + 3: salta 25 (vie, descanso), 26-27 (fds), 1 ene (jue) queda fuera.
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
      expect((e as CalendarioIncompletoError).codigo).toBe("calendario-incompleto");
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
      "Calendario incompleto: sat 2027; solo se descontaron fines de semana.",
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
      "Calendario incompleto: sat 2027; solo se descontaron fines de semana.",
    ]);
    const r2 = sumarDiasHabiles({
      calendario: sat2026,
      desde: "2026-12-30",
      dias: 400,
      permitirIncompleto: true,
    });
    expect(r2.advertencias).toEqual([
      "Calendario incompleto: sat 2027; solo se descontaron fines de semana.",
      "Calendario incompleto: sat 2028; solo se descontaron fines de semana.",
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
    expect(
      sumarDiasHabiles({ calendario: lft, desde: "2026-10-16", dias: 3650 }).resultado,
    ).toMatch(/^2041-/);
  });

  it("lanza RangeError con desde inválido", () => {
    expect(() => sumarDiasHabiles({ calendario: lft, desde: "2026-02-30", dias: 1 })).toThrow(
      RangeError,
    );
  });
});
