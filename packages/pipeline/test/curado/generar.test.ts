import { diasDescansoCff } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { jsonCanonico, sha256Hex } from "../../src/canonico.js";
import { shardCalendario } from "../../src/curado/calendario.js";
import { archivosCurado, registrosPublicados } from "../../src/curado/generar.js";
import type { DocumentoCurado } from "../../src/curado/leer.js";
import { interpretarCurado } from "../../src/curado/leer.js";
import type { DefinicionCurado } from "../../src/curado/registro.js";
import { curadoDiasSat, curadoTarifasIsr, curadoUma } from "../../src/curado/registro.js";
import { YAML_ISR, YAML_SAT, YAML_UMA } from "./ejemplos.js";

const LICENCIA_DOF =
  "Texto oficial publicado en el DOF; no es objeto de derecho de autor (LFDA art. 14, fracción VIII)";

// biome-ignore lint/suspicious/noExplicitAny: cada prueba usa un dataset distinto
function documento(def: DefinicionCurado<any>, yaml: string): DocumentoCurado<any> {
  const { documento: doc, problemas } = interpretarCurado(def, yaml);
  expect(problemas).toEqual([]);
  return doc as DocumentoCurado<unknown>;
}

describe("archivosCurado", () => {
  it("escribe los registros ordenados en JSON canónico y su manifiesto", () => {
    const doc = documento(curadoUma, YAML_UMA);
    const archivos = archivosCurado(curadoUma, doc);
    expect([...archivos.keys()]).toEqual(["uma.json", "manifest.json"]);
    const datos = archivos.get("uma.json") as string;
    expect(datos).toBe(jsonCanonico(doc.registros));
    expect(JSON.parse(datos).map((r: { anio: number }) => r.anio)).toEqual([2025, 2026]);
    const manifiesto = JSON.parse(archivos.get("manifest.json") as string);
    expect(archivos.get("manifest.json")).toBe(jsonCanonico(manifiesto));
    expect(manifiesto).toEqual({
      dataset: "constantes.uma",
      schema_version: 1,
      as_of: "2026-01-09",
      fetched_at: "2026-01-09T00:00:00Z",
      data_file: "uma.json",
      data_sha256: sha256Hex(datos),
      records: 2,
      sources: [
        {
          name: "INEGI. Unidad de medida y actualización",
          url: "https://dof.gob.mx/nota_detalle.php?codigo=5746930&fecha=10/01/2025",
          license: "Términos de libre uso de la información del INEGI",
          license_url: "https://www.inegi.org.mx/inegi/terminos.html",
          citation:
            "INEGI. Unidad de medida y actualización. Diario Oficial de la Federación, 10/01/2025. https://dof.gob.mx/nota_detalle.php?codigo=5746930&fecha=10/01/2025",
          published_at: "2025-01-10",
          raw: [],
        },
        {
          name: "INEGI. Unidad de medida y actualización",
          url: "https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026",
          license: "Términos de libre uso de la información del INEGI",
          license_url: "https://www.inegi.org.mx/inegi/terminos.html",
          citation:
            "INEGI. Unidad de medida y actualización. Diario Oficial de la Federación, 09/01/2026. https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026",
          published_at: "2026-01-09",
          raw: [],
        },
      ],
    });
  });

  it("agrupa las fuentes por publicación y cita la ley vigente de diputados.gob.mx", () => {
    const sat = JSON.parse(
      archivosCurado(curadoDiasSat, documento(curadoDiasSat, YAML_SAT)).get(
        "manifest.json",
      ) as string,
    );
    expect(sat.as_of).toBe("2026-07-09");
    // Las 4 vacaciones del YAML y los 8 días del art. 12 de 2026, que agrega la regla.
    expect(sat.records).toBe(12);
    expect(sat.sources.map((s: { published_at: string }) => s.published_at)).toEqual([
      "2025-12-28",
      "2026-04-09",
      "2026-07-09",
    ]);
    expect(sat.sources[1]).toEqual({
      name: "Código Fiscal de la Federación, artículo 12",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      license: LICENCIA_DOF,
      license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      citation:
        "Código Fiscal de la Federación, artículo 12. Texto vigente con la última reforma publicada en el DOF el 09/04/2026. https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      published_at: "2026-04-09",
      raw: [],
    });
    const isr = JSON.parse(
      archivosCurado(curadoTarifasIsr, documento(curadoTarifasIsr, YAML_ISR)).get(
        "manifest.json",
      ) as string,
    );
    expect(isr.sources).toHaveLength(1);
    expect(isr.sources[0].name).toBe("Anexo 8 de la Resolución Miscelánea Fiscal para 2026");
  });

  it("un calendario agrega calendario.json: el shard de la API sin los días", () => {
    const doc = documento(curadoDiasSat, YAML_SAT);
    const archivos = archivosCurado(curadoDiasSat, doc);
    expect([...archivos.keys()]).toEqual([
      "dias-inhabiles.json",
      "manifest.json",
      "calendario.json",
    ]);
    const { dias: _dias, ...sinDias } = shardCalendario("sat", doc.registros, doc.cobertura);
    const texto = archivos.get("calendario.json") as string;
    expect(texto).toBe(jsonCanonico(sinDias));
    expect(Object.keys(JSON.parse(texto))).toEqual([
      "autoridad",
      "plazos",
      "fuentes_fin_de_semana",
    ]);
    // declaraciones_pagos solo cuenta los días del art. 12, que la regla da hasta 2100.
    expect(JSON.parse(texto).plazos).toEqual({
      general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
      declaraciones_pagos: {
        cobertura: { desde: "2026-01-01", hasta: "2100-12-31" },
        excluir_tipos: ["vacaciones"],
      },
    });
    // Los fines de semana del SAT los cita la regla, no el calendario.
    expect(JSON.parse(texto).fuentes_fin_de_semana).toEqual({});
  });

  it("la lista del SAT trae los días del art. 12 de los años del YAML, calculados por la regla", () => {
    const doc = documento(curadoDiasSat, YAML_SAT);
    const dias = JSON.parse(
      archivosCurado(curadoDiasSat, doc).get("dias-inhabiles.json") as string,
    );
    expect(dias).toEqual(registrosPublicados(curadoDiasSat, doc));
    const descanso = dias.filter((d: { tipo: string }) => d.tipo === "descanso");
    expect(descanso).toEqual(
      diasDescansoCff(2026).map(({ fecha, motivo, tipo, fuente }) => ({
        fecha,
        autoridad: "sat",
        motivo,
        tipo,
        fuente: { ...fuente },
      })),
    );
    // El YAML no los trae: solo las vacaciones.
    expect(doc.registros.every((d: { tipo: string }) => d.tipo === "vacaciones")).toBe(true);
    expect(dias.map((d: { fecha: string }) => d.fecha)).toEqual(
      [...dias.map((d: { fecha: string }) => d.fecha)].sort(),
    );
    // Los demás datasets se publican como están en el YAML.
    const uma = documento(curadoUma, YAML_UMA);
    expect(registrosPublicados(curadoUma, uma)).toBe(uma.registros);
  });

  it("es determinista", () => {
    const a = archivosCurado(curadoUma, documento(curadoUma, YAML_UMA));
    const b = archivosCurado(curadoUma, documento(curadoUma, YAML_UMA));
    expect(a).toEqual(b);
  });
});
