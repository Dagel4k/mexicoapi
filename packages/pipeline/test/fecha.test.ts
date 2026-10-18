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

describe("anioDe", () => {
  it("da el año de la fecha como número", () => {
    expect(anioDe("2026-10-18")).toBe(2026);
    expect(anioDe("0001-01-01")).toBe(1);
  });
});
