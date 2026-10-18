import { describe, expect, it } from "vitest";
import { CURADOS } from "../../../src/curado/registro.js";
import { DATASETS } from "../../../src/registro.js";
import { documentoOpenApi } from "../../../src/sitio/openapi.js";
import { CATALOGO, describir } from "../../../src/sitio/paginas/catalogo.js";

interface Operacion {
  parameters?: { name: string }[];
}

const rutas = documentoOpenApi().paths as Record<string, { get: Operacion }>;

describe("catálogo de datasets", () => {
  it("describe exactamente los datasets registrados", () => {
    const registrados = [...DATASETS.keys(), ...CURADOS.map((c) => c.id)].sort();
    expect(Object.keys(CATALOGO).sort()).toEqual(registrados);
  });

  it.each(Object.entries(CATALOGO))("la ruta de %s existe en el OpenAPI", (_, { ruta }) => {
    const [camino, consulta] = ruta.split("?") as [string, string | undefined];
    expect(Object.keys(rutas)).toContain(camino);
    const declarados = (rutas[camino]?.get.parameters ?? []).map((p) => p.name);
    for (const nombre of new URLSearchParams(consulta ?? "").keys()) {
      expect(declarados, `${camino}?${nombre}`).toContain(nombre);
    }
  });

  it("un dataset que el catálogo no conoce se muestra con su id y sin ruta", () => {
    expect(describir("nuevo.dataset")).toEqual({ nombre: "nuevo.dataset", ruta: null });
    expect(describir("inegi.estados")).toEqual({ nombre: "Estados", ruta: "/v1/estados" });
  });
});
