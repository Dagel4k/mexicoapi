import { describe, expect, it } from "vitest";
import { diferenciar, hayDiferencias } from "../src/diferencias.js";

interface Reg {
  id: string;
  nombre: string;
  otro?: number;
}

describe("diferenciar", () => {
  it("detecta altas, bajas y cambios", () => {
    const antes: Reg[] = [
      { id: "1", nombre: "Uno" },
      { id: "2", nombre: "Dos" },
      { id: "3", nombre: "Tres", otro: 1 },
    ];
    const despues: Reg[] = [
      { id: "1", nombre: "Uno" },
      { id: "3", nombre: "Tres bis", otro: 1 },
      { id: "4", nombre: "Cuatro" },
    ];
    const d = diferenciar(antes, despues, (r) => r.id);
    expect(d.altas).toEqual([{ id: "4", nombre: "Cuatro" }]);
    expect(d.bajas).toEqual([{ id: "2", nombre: "Dos" }]);
    expect(d.cambios).toEqual([
      {
        clave: "3",
        antes: { id: "3", nombre: "Tres", otro: 1 },
        despues: { id: "3", nombre: "Tres bis", otro: 1 },
        campos: ["nombre"],
      },
    ]);
    expect(hayDiferencias(d)).toBe(true);
  });

  it("lista campos en orden alfabetico, incluidos los ausentes", () => {
    const d = diferenciar<Reg>(
      [{ id: "1", nombre: "A", otro: 1 }],
      [{ id: "1", nombre: "B" }],
      (r) => r.id,
    );
    expect(d.cambios[0]?.campos).toEqual(["nombre", "otro"]);
  });

  it("listas iguales no tienen diferencias", () => {
    const l: Reg[] = [{ id: "1", nombre: "Uno" }];
    expect(hayDiferencias(diferenciar(l, [{ ...l[0] } as Reg], (r) => r.id))).toBe(false);
  });
});
