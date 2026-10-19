import { describe, expect, it } from "vitest";
import { CURADOS } from "../../../src/curado/registro.js";
import { DATASETS } from "../../../src/registro.js";
import { documentoOpenApi } from "../../../src/sitio/openapi.js";
import { CATALOGO, describir, rutasDe } from "../../../src/sitio/paginas/catalogo.js";

interface Parametro {
  name: string;
  in: string;
  required?: boolean;
  $ref?: string;
}

interface Documento {
  paths: Record<string, { get: { parameters?: Parametro[] } }>;
  components: { parameters?: Record<string, Parametro> };
}

const doc = documentoOpenApi() as unknown as Documento;

/** Los parámetros de ruta y de query de una operación, con los `$ref` resueltos. */
function parametrosDe(camino: string): Parametro[] {
  return (doc.paths[camino]?.get.parameters ?? [])
    .map((p) =>
      p.$ref === undefined ? p : (doc.components.parameters?.[p.$ref.split("/").at(-1) ?? ""] ?? p),
    )
    .filter((p) => p.in === "path" || p.in === "query");
}

describe("catálogo de datasets", () => {
  it("describe exactamente los datasets registrados", () => {
    expect(Object.keys(CATALOGO).sort()).toEqual(
      [...DATASETS.keys(), ...CURADOS.map((c) => c.id)].sort(),
    );
  });

  // llms.txt reusa estas rutas: quien arme una petición con ellas no debe adivinar parámetros.
  it.each(
    Object.entries(CATALOGO).flatMap(([id, entrada]) => rutasDe(entrada).map((r) => [id, r])),
  )("la ruta de %s (%s) existe en el OpenAPI y trae todo parámetro obligatorio", (_, ruta) => {
    const [camino, consulta = ""] = ruta.split("?") as [string, string?];
    expect(Object.keys(doc.paths)).toContain(camino);
    const parametros = parametrosDe(camino);
    const enRuta = [...camino.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const enQuery = [...new URLSearchParams(consulta).keys()];
    for (const p of parametros.filter((p) => p.required === true)) {
      expect(p.in === "path" ? enRuta : enQuery, `${ruta}: falta ${p.name}`).toContain(p.name);
    }
    const declarados = parametros.filter((p) => p.in === "query").map((p) => p.name);
    for (const nombre of enQuery) expect(declarados, `${ruta}: ${nombre}`).toContain(nombre);
    expect(new Set(enQuery).size, ruta).toBe(enQuery.length);
  });

  it("las fechas, años y valores por llenar van entre llaves", () => {
    expect(CATALOGO.udis?.ruta).toBe("/v1/udis?fecha={fecha}");
    expect(CATALOGO["constantes.uma"]?.ruta).toBe("/v1/constantes/uma?fecha={fecha}");
    expect(CATALOGO["dias-inhabiles.cnbv"]?.ruta).toBe(
      "/v1/dias-inhabiles?autoridad=cnbv&anio={anio}",
    );
  });

  // Para un pago, la ruta que aplica es operacion; publicado en un fin de semana da 404.
  it("el FIX lleva primero operacion, con lo que responde, y después /ultimo y publicado", () => {
    const fix = CATALOGO["tipo-cambio.fix"];
    expect(fix?.ruta).toBe("/v1/tipo-cambio/fix?operacion={fecha}");
    expect(fix?.nota).toBe("el que aplica a un pago o una operación de esa fecha");
    expect(fix?.otras).toEqual([
      { ruta: "/v1/tipo-cambio/fix/ultimo", nota: "la publicación más reciente" },
      { ruta: "/v1/tipo-cambio/fix?publicado={fecha}", nota: "el que publicó el DOF ese día" },
    ]);
    expect(rutasDe(fix as NonNullable<typeof fix>)).toHaveLength(3);
    expect(rutasDe({ nombre: "UDIS", ruta: "/v1/udis?fecha={fecha}" })).toEqual([
      "/v1/udis?fecha={fecha}",
    ]);
  });

  it("un dataset que el catálogo no conoce se muestra con su id y sin ruta", () => {
    expect(describir("nuevo.dataset")).toEqual({ nombre: "nuevo.dataset", ruta: null });
    expect(describir("inegi.estados")).toEqual({ nombre: "Estados", ruta: "/v1/estados" });
  });
});
