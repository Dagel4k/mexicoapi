import { describe, expect, it } from "vitest";
import { calendarioLft, crearCalendario } from "../../src/dias-habiles/calendario.js";
import { FUENTE_LFT_715 } from "../../src/dias-habiles/lft.js";
import type { DiaInhabil, Fuente } from "../../src/dias-habiles/tipos.js";
import { CalendarioIncompletoError } from "../../src/errores.js";

const fuenteFds: Fuente = { nombre: "Fin de semana", url: "https://example.com/fds" };
const fuenteDia: Fuente = { nombre: "Día", url: "https://example.com/dia" };
const cobertura = { desde: "2026-01-01", hasta: "2026-12-31" };

const dia = (fecha: string, tipo: DiaInhabil["tipo"], motivo: string = tipo): DiaInhabil => ({
  fecha,
  motivo,
  tipo,
  fuente: fuenteDia,
});

function calendario(dias: DiaInhabil[], excluirTipos?: DiaInhabil["tipo"][]) {
  return crearCalendario({
    autoridad: "sat",
    cobertura,
    dias,
    fuenteFinDeSemana: fuenteFds,
    ...(excluirTipos ? { excluirTipos } : {}),
  });
}

describe("crearCalendario", () => {
  it("expone autoridad y cobertura", () => {
    const c = calendario([]);
    expect(c.autoridad).toBe("sat");
    expect(c.cobertura).toEqual(cobertura);
  });

  it("devuelve sábado y domingo como fin_de_semana con su fuente", () => {
    const c = calendario([]);
    expect(c.inhabil("2026-10-17")).toEqual({
      fecha: "2026-10-17",
      motivo: "Sábado",
      tipo: "fin_de_semana",
      fuente: fuenteFds,
    });
    expect(c.inhabil("2026-10-18")).toMatchObject({ motivo: "Domingo", tipo: "fin_de_semana" });
  });

  it("devuelve null en un día hábil", () => {
    expect(calendario([]).inhabil("2026-10-19")).toBeNull();
  });

  it("devuelve el día listado", () => {
    const d = dia("2026-03-18", "descanso", "Natalicio");
    expect(calendario([d]).inhabil("2026-03-18")).toEqual(d);
  });

  it("un día listado tiene prioridad sobre el fin de semana", () => {
    const d = dia("2026-10-17", "descanso", "Sábado festivo");
    expect(calendario([d]).inhabil("2026-10-17")?.tipo).toBe("descanso");
  });

  it("con excluirTipos vacaciones, un lunes de vacaciones es hábil", () => {
    const d = dia("2026-07-20", "vacaciones");
    expect(calendario([d], ["vacaciones"]).inhabil("2026-07-20")).toBeNull();
    expect(calendario([d]).inhabil("2026-07-20")).toEqual(d);
  });

  it("un descanso dentro de un periodo de vacaciones sigue siendo inhábil al excluir vacaciones", () => {
    const vac = dia("2026-12-25", "vacaciones");
    const desc = dia("2026-12-25", "descanso", "Navidad");
    expect(calendario([vac, desc], ["vacaciones"]).inhabil("2026-12-25")).toEqual(desc);
    expect(calendario([vac, desc]).inhabil("2026-12-25")).toEqual(vac);
  });

  it("un día de vacaciones excluido en sábado cae en fin_de_semana", () => {
    const d = dia("2026-10-17", "vacaciones");
    expect(calendario([d], ["vacaciones"]).inhabil("2026-10-17")?.tipo).toBe("fin_de_semana");
  });

  it("lanza CalendarioIncompletoError fuera de cobertura", () => {
    const c = calendario([]);
    for (const f of ["2025-12-31", "2027-01-01"]) {
      try {
        c.inhabil(f);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(CalendarioIncompletoError);
        const err = e as CalendarioIncompletoError;
        expect(err.name).toBe("CalendarioIncompletoError");
        expect(err.codigo).toBe("calendario-incompleto");
        expect(err.autoridad).toBe("sat");
        expect(err.fecha).toBe(f);
        expect(err.cobertura).toEqual(cobertura);
        expect(err.message).toContain("sat");
        expect(err.message).toContain(f);
        expect(err.message).toContain("2026-01-01");
        expect(err.message).toContain("2026-12-31");
        // El texto para quien consulta, como el `detail` de la API.
        expect(err.detalle).toBe(
          `El calendario del SAT no cubre ${f}; cubre del 2026-01-01 al 2026-12-31.`,
        );
      }
    }
  });

  it("lanza RangeError con una fecha inválida al consultar", () => {
    expect(() => calendario([]).inhabil("2026-02-30")).toThrow(RangeError);
  });

  it("lanza RangeError con cobertura inválida", () => {
    const base = { autoridad: "sat", dias: [], fuenteFinDeSemana: fuenteFds } as const;
    expect(() =>
      crearCalendario({ ...base, cobertura: { desde: "2026-02-30", hasta: "2026-12-31" } }),
    ).toThrow(RangeError);
    expect(() =>
      crearCalendario({ ...base, cobertura: { desde: "2026-01-01", hasta: "nada" } }),
    ).toThrow(RangeError);
    expect(() =>
      crearCalendario({ ...base, cobertura: { desde: "2026-12-31", hasta: "2026-01-01" } }),
    ).toThrow(RangeError);
  });

  it("lanza RangeError con días inválidos o fuera de cobertura", () => {
    expect(() => calendario([dia("2026-02-30", "descanso")])).toThrow(RangeError);
    expect(() => calendario([dia("2025-12-31", "descanso")])).toThrow(RangeError);
    expect(() => calendario([dia("2027-01-01", "descanso")])).toThrow(RangeError);
  });

  it("no deja que el llamador altere el calendario", () => {
    const entrada = dia("2026-03-18", "descanso", "Natalicio");
    const c = calendario([entrada]);
    entrada.motivo = "alterado";
    const salida = c.inhabil("2026-03-18");
    expect(salida?.motivo).toBe("Natalicio");
    expect(() => {
      if (salida) salida.motivo = "alterado";
    }).toThrow(TypeError);
    expect(c.inhabil("2026-03-18")?.motivo).toBe("Natalicio");
    const fds = c.inhabil("2026-10-17");
    expect(() => {
      if (fds) fds.motivo = "alterado";
    }).toThrow(TypeError);
    expect(c.inhabil("2026-10-17")?.motivo).toBe("Sábado");
    expect(() => {
      (c.cobertura as { hasta: string }).hasta = "2030-01-01";
    }).toThrow(TypeError);
  });

  it("con una función, cita los fines de semana con la fuente de su año", () => {
    const de2025: Fuente = { nombre: "Disposiciones 2025", url: "https://example.com/2025" };
    const de2026: Fuente = { nombre: "Disposiciones 2026", url: "https://example.com/2026" };
    const pedidos: number[] = [];
    const c = crearCalendario({
      autoridad: "cnbv",
      cobertura: { desde: "2025-01-01", hasta: "2026-12-31" },
      dias: [],
      fuenteFinDeSemana: (anio) => {
        pedidos.push(anio);
        return anio === 2025 ? de2025 : de2026;
      },
    });
    expect(pedidos).toEqual([]);
    const sabado = c.inhabil("2025-10-18");
    expect(sabado).toEqual({
      fecha: "2025-10-18",
      motivo: "Sábado",
      tipo: "fin_de_semana",
      fuente: de2025,
    });
    expect(c.inhabil("2026-10-17")?.fuente).toEqual(de2026);
    expect(c.inhabil("2026-10-19")).toBeNull();
    // Una copia congelada por año: la función se llama una vez y alterar su valor no cambia nada.
    expect(c.inhabil("2025-10-19")?.fuente).toBe(sabado?.fuente);
    expect(Object.isFrozen(sabado?.fuente)).toBe(true);
    de2025.nombre = "alterado";
    expect(c.inhabil("2025-12-27")?.fuente.nombre).toBe("Disposiciones 2025");
    expect(pedidos).toEqual([2025, 2026]);
  });
});

describe("Calendario congelado", () => {
  it.each([
    ["crearCalendario", () => calendario([])],
    ["calendarioLft", () => calendarioLft()],
  ])("%s devuelve un objeto congelado", (_nombre, crear) => {
    const c = crear();
    expect(Object.isFrozen(c)).toBe(true);
    const cobertura = c.cobertura;
    expect(() => {
      (c as { cobertura: unknown }).cobertura = { desde: "2000-01-01", hasta: "2200-12-31" };
    }).toThrow(TypeError);
    expect(() => {
      (c as { autoridad: string }).autoridad = "cnbv";
    }).toThrow(TypeError);
    expect(() => {
      (c as { inhabil: unknown }).inhabil = () => null;
    }).toThrow(TypeError);
    expect(c.cobertura).toBe(cobertura);
    expect(c.inhabil("2026-10-17")?.tipo).toBe("fin_de_semana");
  });
});

describe("calendarioLft", () => {
  const c = calendarioLft();

  it("tiene autoridad lft y cobertura 2007-2100", () => {
    expect(c.autoridad).toBe("lft");
    expect(c.cobertura).toEqual({ desde: "2007-01-01", hasta: "2100-12-31" });
  });

  it("incluye el primer lunes de febrero", () => {
    expect(c.inhabil("2026-02-02")?.motivo).toContain("febrero");
  });

  it("usa el artículo 715 para los fines de semana", () => {
    expect(c.inhabil("2026-10-17")?.fuente).toEqual(FUENTE_LFT_715);
  });

  it("devuelve null en un día hábil y sigue consistente al repetir la consulta", () => {
    expect(c.inhabil("2026-10-19")).toBeNull();
    expect(c.inhabil("2026-02-02")).toEqual(c.inhabil("2026-02-02"));
  });

  it("lanza fuera de cobertura", () => {
    expect(() => c.inhabil("2101-01-01")).toThrow(CalendarioIncompletoError);
    expect(() => c.inhabil("2006-12-31")).toThrow(CalendarioIncompletoError);
    try {
      c.inhabil("2101-01-01");
    } catch (e) {
      expect((e as CalendarioIncompletoError).detalle).toBe(
        "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
      );
    }
  });

  it("un detalle propio reemplaza al de omisión", () => {
    const error = new CalendarioIncompletoError("cnbv", "2027-01-01", cobertura, "Otro texto.");
    expect(error.detalle).toBe("Otro texto.");
    expect(new CalendarioIncompletoError("cnbv", "2027-01-01", cobertura).detalle).toBe(
      "El calendario de la CNBV no cubre 2027-01-01; cubre del 2026-01-01 al 2026-12-31.",
    );
  });
});
