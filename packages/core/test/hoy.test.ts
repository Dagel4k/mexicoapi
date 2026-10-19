import { afterEach, describe, expect, it, vi } from "vitest";
import { hoyEnMexico } from "../src/hoy.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("hoyEnMexico", () => {
  it("da el día de la Ciudad de México, no el de UTC", () => {
    // Lunes 19 a la 01:03 en UTC: en la Ciudad de México todavía es domingo 18, 19:03.
    expect(hoyEnMexico(Date.parse("2026-10-19T01:03:00Z"))).toBe("2026-10-18");
    expect(hoyEnMexico(new Date("2026-10-19T05:59:59.999Z"))).toBe("2026-10-18");
    expect(hoyEnMexico(new Date("2026-10-19T06:00:00Z"))).toBe("2026-10-19");
  });

  it("sigue las reglas de la zona, también el horario de verano que hubo hasta 2022", () => {
    // El 1 de julio de 2021 la Ciudad de México estaba en UTC-5: a las 05:30 UTC ya era día 1.
    expect(hoyEnMexico(Date.parse("2021-07-01T05:30:00Z"))).toBe("2021-07-01");
    // Sin horario de verano desde el 30 de octubre de 2022: UTC-6 todo el año.
    expect(hoyEnMexico(Date.parse("2026-07-01T05:30:00Z"))).toBe("2026-06-30");
  });

  it("sin argumento usa el reloj del sistema", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    expect(hoyEnMexico()).toBe("2026-12-31");
    vi.setSystemTime(new Date("2027-01-01T06:30:00Z"));
    expect(hoyEnMexico()).toBe("2027-01-01");
  });

  it("rellena el año con ceros", () => {
    expect(hoyEnMexico(Date.parse("0999-06-15T18:00:00Z"))).toBe("0999-06-15");
  });

  it("el 1 de enero del año 1 en la Ciudad de México es el primer día que da", () => {
    expect(hoyEnMexico(Date.parse("0001-01-01T12:00:00Z"))).toBe("0001-01-01");
  });

  it.each([
    ["una fecha inválida", new Date("no es fecha")],
    ["NaN", Number.NaN],
    ["un año después de 9999", Date.parse("+010000-01-01T12:00:00Z")],
    // Antes de la era común: Intl da el año 1 (1 a. C.) o 101 (101 a. C.), no el 0 ni el -100.
    ["el año 0", Date.parse("0000-06-15T18:00:00Z")],
    ["un año antes de la era común", Date.parse("-000100-06-15T18:00:00Z")],
    // 03:00 UTC del 1 de enero del año 1 todavía es 31 de diciembre de 1 a. C. en la Ciudad de México.
    ["la víspera del año 1 en la Ciudad de México", Date.parse("0001-01-01T03:00:00Z")],
  ])("lanza RangeError con %s", (_nombre, ahora) => {
    expect(() => hoyEnMexico(ahora)).toThrow(RangeError);
  });
});
