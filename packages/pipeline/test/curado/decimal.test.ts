import { describe, expect, it } from "vitest";
import {
  aCentavos,
  conMiles,
  deCentavos,
  dividirRedondeando,
  esMonto,
} from "../../src/curado/decimal.js";

describe("montos en centavos", () => {
  it("convierte montos con dos decimales a centavos y de regreso", () => {
    expect(aCentavos("117.31")).toBe(11731n);
    expect(aCentavos("0.01")).toBe(1n);
    expect(aCentavos("5107703.92")).toBe(510770392n);
    expect(deCentavos(11731n)).toBe("117.31");
    expect(deCentavos(5n)).toBe("0.05");
    expect(deCentavos(0n)).toBe("0.00");
    expect(deCentavos(-2n)).toBe("-0.02");
  });

  it("solo acepta enteros sin ceros a la izquierda y exactamente dos decimales", () => {
    for (const bueno of ["0.00", "0.01", "35.00", "1601862.46"]) expect(esMonto(bueno)).toBe(true);
    for (const malo of [
      "117.3",
      "117",
      "0117.31",
      "1,000.00",
      "-1.00",
      " 1.00",
      "1.000",
      ".50",
      "",
    ]) {
      expect(esMonto(malo)).toBe(false);
      expect(() => aCentavos(malo)).toThrow(RangeError);
    }
  });

  it("redondea a la mitad hacia arriba", () => {
    expect(dividirRedondeando(3566224n, 10n)).toBe(356622n);
    expect(dividirRedondeando(25n, 10n)).toBe(3n);
    expect(dividirRedondeando(24n, 10n)).toBe(2n);
    expect(dividirRedondeando(0n, 7n)).toBe(0n);
    expect(() => dividirRedondeando(-1n, 10n)).toThrow(RangeError);
    expect(() => dividirRedondeando(1n, 0n)).toThrow(RangeError);
  });

  it("agrega comas de miles como el DOF", () => {
    expect(conMiles("117.31")).toBe("117.31");
    expect(conMiles("3566.22")).toBe("3,566.22");
    expect(conMiles("42794.64")).toBe("42,794.64");
    expect(conMiles("1601862.46")).toBe("1,601,862.46");
    expect(conMiles("0.00")).toBe("0.00");
  });
});
