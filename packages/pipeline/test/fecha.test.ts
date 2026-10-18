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
  // test:coverage corre la suite con TZ=America/Mexico_City y test:tz, con TZ=UTC, todos los
  // proyectos menos el núcleo; esto confirma que en cada corrida la zona sí cambió. Los dos
  // scripts repiten la zona en TZ_ESPERADA: si TZ se pierde en el camino (Git Bash la quita al
  // lanzar programas de Windows), la prueba falla en vez de saltarse.
  const zona = process.env.TZ_ESPERADA ?? process.env.TZ;
  it.runIf(zona !== undefined)("coincide con TZ", () => {
    // Intl normaliza alias como Etc/UTC a UTC, así que se compara contra el nombre canónico.
    const esperada = new Intl.DateTimeFormat("en", { timeZone: zona }).resolvedOptions().timeZone;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(esperada);
  });
});

describe("anioDe", () => {
  it("da el año de la fecha como número", () => {
    expect(anioDe("2026-10-18")).toBe(2026);
    expect(anioDe("0001-01-01")).toBe(1);
  });
});
