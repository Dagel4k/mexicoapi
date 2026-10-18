import { describe, expect, it } from "vitest";
import { anioDe, fechaEnMexico } from "../src/fecha.js";

describe("fechaEnMexico", () => {
  it("usa la fecha civil de Ciudad de Mexico", () => {
    expect(fechaEnMexico(new Date("2026-10-18T05:30:00Z"))).toBe("2026-10-17");
  });
  it("cambia de dia pasada la medianoche local", () => {
    expect(fechaEnMexico(new Date("2026-10-18T06:30:00Z"))).toBe("2026-10-18");
  });
});

describe("zona horaria del proceso", () => {
  // test:coverage corre la suite con TZ=America/Mexico_City y test:tz corre con TZ=UTC los
  // proyectos que usan fechas del sistema, este incluido; esto confirma que en cada corrida la
  // zona sí cambió.
  it.runIf(process.env.TZ !== undefined)("coincide con TZ", () => {
    // Intl normaliza alias como Etc/UTC a UTC, así que se compara contra el nombre canónico.
    const esperada = new Intl.DateTimeFormat("en", { timeZone: process.env.TZ }).resolvedOptions()
      .timeZone;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(esperada);
  });
});

describe("anioDe", () => {
  it("da el año de la fecha como número", () => {
    expect(anioDe("2026-10-18")).toBe(2026);
    expect(anioDe("0001-01-01")).toBe(1);
  });
});
