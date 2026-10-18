import { describe, expect, it } from "vitest";
import { ErrorDatos } from "../../src/errores.js";
import { partirPorAnio } from "../../src/sitio/series.js";

interface Registro {
  fecha: string;
  valor: string;
}

const r = (fecha: string): Registro => ({ fecha, valor: "1.000000" });
const fechaDe = (registro: Registro) => registro.fecha;

describe("partirPorAnio", () => {
  it("da la cobertura y un shard por año con su tramo recortado a la cobertura", () => {
    const serie = [r("2024-12-30"), r("2024-12-31"), r("2025-06-01"), r("2026-01-02")];
    expect(partirPorAnio(serie, fechaDe, "udis")).toEqual({
      cobertura: { desde: "2024-12-30", hasta: "2026-01-02" },
      shards: [
        {
          anio: "2024",
          tramo: { desde: "2024-12-30", hasta: "2024-12-31" },
          datos: [r("2024-12-30"), r("2024-12-31")],
        },
        {
          anio: "2025",
          tramo: { desde: "2025-01-01", hasta: "2025-12-31" },
          datos: [r("2025-06-01")],
        },
        {
          anio: "2026",
          tramo: { desde: "2026-01-01", hasta: "2026-01-02" },
          datos: [r("2026-01-02")],
        },
      ],
    });
  });

  it("un año sin registros dentro de la cobertura lleva datos vacíos", () => {
    const { shards } = partirPorAnio([r("2023-12-31"), r("2025-01-01")], fechaDe, "udis");
    expect(shards.map((s) => s.anio)).toEqual(["2023", "2024", "2025"]);
    expect(shards[1]).toEqual({
      anio: "2024",
      tramo: { desde: "2024-01-01", hasta: "2024-12-31" },
      datos: [],
    });
  });

  it("con un solo registro, cobertura y tramo son ese día", () => {
    expect(partirPorAnio([r("2026-10-16")], fechaDe, "udis")).toEqual({
      cobertura: { desde: "2026-10-16", hasta: "2026-10-16" },
      shards: [
        {
          anio: "2026",
          tramo: { desde: "2026-10-16", hasta: "2026-10-16" },
          datos: [r("2026-10-16")],
        },
      ],
    });
  });

  it("falla con ErrorDatos si la serie está vacía", () => {
    expect(() => partirPorAnio([], fechaDe, "udis")).toThrow(ErrorDatos);
    expect(() => partirPorAnio([], fechaDe, "udis")).toThrow(/no tiene registros/);
  });

  it.each([
    ["desordenada", [r("2026-01-02"), r("2026-01-01")]],
    ["con una fecha repetida", [r("2026-01-01"), r("2026-01-01")]],
  ])("falla con ErrorDatos si la serie está %s", (_, serie) => {
    expect(() => partirPorAnio(serie, fechaDe, "udis")).toThrow(
      expect.objectContaining({
        name: "ErrorDatos",
        dataset: "udis",
        message: expect.stringContaining("orden"),
      }),
    );
  });

  it("falla con ErrorDatos ante una fecha que no existe", () => {
    expect(() => partirPorAnio([r("2026-01-01"), r("2026-02-30")], fechaDe, "udis")).toThrow(
      /fecha inválida: 2026-02-30/,
    );
  });
});
