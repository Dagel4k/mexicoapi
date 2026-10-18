import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { diaDeLaSemana, enesimoDiaDeSemana, type FechaISO, sumarDias } from "../src/fechas.js";

// Implementación de referencia con Date (la lógica previa a la aritmética entera).
const MS_POR_DIA = 86_400_000;

function msRef(anio: number, mes: number, dia: number): number {
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return fecha.getTime();
}

function aMsRef(fecha: FechaISO): number {
  return msRef(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10)));
}

function deMsRef(ms: number): FechaISO {
  const fecha = new Date(ms);
  const anio = fecha.getUTCFullYear();
  if (!(anio >= 1 && anio <= 9999)) {
    throw new RangeError("La fecha resultante sale del rango 0001-9999");
  }
  const aa = String(anio).padStart(4, "0");
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getUTCDate()).padStart(2, "0");
  return `${aa}-${mm}-${dd}`;
}

function intentar<T>(f: () => T): { ok: T } | { error: string } {
  try {
    return { ok: f() };
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return { error: e.message };
  }
}

const fechaAzar = fc
  .integer({ min: msRef(1, 1, 1) / MS_POR_DIA, max: msRef(9999, 12, 31) / MS_POR_DIA })
  .map((d) => deMsRef(d * MS_POR_DIA));

const CORRIDAS = 3000;

describe("aritmética de fechas contra referencia con Date", () => {
  it("sumarDias coincide, o ambos lanzan RangeError", () => {
    fc.assert(
      fc.property(fechaAzar, fc.integer({ min: -200_000, max: 200_000 }), (fecha, dias) => {
        const esperado = intentar(() => deMsRef(aMsRef(fecha) + dias * MS_POR_DIA));
        expect(intentar(() => sumarDias(fecha, dias))).toEqual(esperado);
      }),
      { numRuns: CORRIDAS },
    );
  });

  it("sumarDias coincide cerca de los bordes del rango", () => {
    const bordes = fc.constantFrom("0001-01-01", "0001-03-01", "0099-12-31", "9999-12-31");
    fc.assert(
      fc.property(bordes, fc.integer({ min: -800_000, max: 800_000 }), (fecha, dias) => {
        const esperado = intentar(() => deMsRef(aMsRef(fecha) + dias * MS_POR_DIA));
        expect(intentar(() => sumarDias(fecha, dias))).toEqual(esperado);
      }),
      { numRuns: CORRIDAS },
    );
  });

  it("diaDeLaSemana coincide", () => {
    fc.assert(
      fc.property(fechaAzar, (fecha) => {
        expect(diaDeLaSemana(fecha)).toBe(new Date(aMsRef(fecha)).getUTCDay());
      }),
      { numRuns: CORRIDAS },
    );
  });

  it("enesimoDiaDeSemana coincide", () => {
    const diasEnMesRef = (a: number, m: number) => new Date(msRef(a, m + 1, 0)).getUTCDate();
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 6 }),
        (anio, mes, n, dia) => {
          const esperado = intentar(() => {
            const primero = new Date(msRef(anio, mes, 1)).getUTCDay();
            const d = 1 + ((dia - primero + 7) % 7) + (n - 1) * 7;
            if (d > diasEnMesRef(anio, mes)) throw new RangeError("fuera");
            return deMsRef(msRef(anio, mes, d));
          });
          const real = intentar(() =>
            enesimoDiaDeSemana(anio, mes, n, dia as 0 | 1 | 2 | 3 | 4 | 5 | 6),
          );
          if ("error" in esperado) expect("error" in real).toBe(true);
          else expect(real).toEqual(esperado);
        },
      ),
      { numRuns: CORRIDAS },
    );
  });

  it("las entradas que no son fechas ISO lanzan el mismo RangeError", () => {
    const FORMATO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
    const casi = fc.stringMatching(/^[0-9a-z-]{8,12}$/);
    fc.assert(
      fc.property(fc.oneof(fc.string(), casi, fechaAzar), (valor) => {
        const valida =
          FORMATO.test(valor) &&
          valor >= "0001-01-01" &&
          !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
        const real = intentar(() => sumarDias(valor, 0));
        if (!valida) expect(real).toEqual({ error: `Fecha ISO inválida: ${valor}` });
        else expect("ok" in real).toBe(true);
      }),
      { numRuns: CORRIDAS },
    );
  });

  it("rechaza valores que no son texto", () => {
    expect(() => sumarDias(20260115 as unknown as string, 1)).toThrow(RangeError);
    expect(() => diaDeLaSemana(null as unknown as string)).toThrow(RangeError);
  });

  it("rechaza un caracter no dígito en cada una de las 8 posiciones de dígitos", () => {
    const intrusos = ["x", "a", "-", " ", "/", "０", "٠", "+", ":", "/"];
    const posiciones = [0, 1, 2, 3, 5, 6, 8, 9];
    fc.assert(
      fc.property(
        fechaAzar,
        fc.constantFrom(...posiciones),
        fc.constantFrom(...intrusos),
        (fecha, pos, intruso) => {
          const malo = fecha.slice(0, pos) + intruso + fecha.slice(pos + 1);
          expect(intentar(() => sumarDias(malo, 0))).toEqual({
            error: `Fecha ISO inválida: ${malo}`,
          });
          expect(() => diaDeLaSemana(malo)).toThrow(`Fecha ISO inválida: ${malo}`);
        },
      ),
      { numRuns: CORRIDAS },
    );
  });

  it("rechaza separadores distintos de guion y longitudes incorrectas", () => {
    const sep = fc.constantFrom("/", ".", " ", "_", "x", "٠", "");
    fc.assert(
      fc.property(fechaAzar, sep, sep, fc.boolean(), (fecha, s1, s2, alargar) => {
        const base = `${fecha.slice(0, 4)}${s1}${fecha.slice(5, 7)}${s2}${fecha.slice(8)}`;
        const malo = alargar ? `${base}0` : base;
        if (malo === fecha) return;
        expect(intentar(() => sumarDias(malo, 0))).toEqual({
          error: `Fecha ISO inválida: ${malo}`,
        });
      }),
      { numRuns: CORRIDAS },
    );
  });
});
