import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiaInhabilCurado, SalarioMinimo, TarifaIsr, Uma } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { interpretarCurado, leerCurado } from "../../src/curado/leer.js";
import {
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
} from "../../src/curado/registro.js";
import {
  EXCEPCIONES_OFICIALES,
  YAML_CNBV,
  YAML_ISR,
  YAML_SALARIO,
  YAML_SAT,
  YAML_UMA,
} from "./ejemplos.js";

/** Problemas de interpretar el YAML de la UMA tras aplicar `cambio`. */
const problemasUma = (cambio: (yaml: string) => string): string[] =>
  interpretarCurado(curadoUma, cambio(YAML_UMA)).problemas;

describe("interpretarCurado", () => {
  it("lee la UMA: fuente expandida, registros ordenados y sin licencia en el registro", () => {
    const { documento, problemas } = interpretarCurado(curadoUma, YAML_UMA);
    expect(problemas).toEqual([]);
    const registros = documento?.registros as Uma[];
    expect(registros.map((r) => r.anio)).toEqual([2025, 2026]);
    expect(registros[1]).toEqual({
      anio: 2026,
      diaria: "117.31",
      mensual: "3566.22",
      anual: "42794.64",
      vigencia_desde: "2026-02-01",
      fuente: {
        nombre: "INEGI. Unidad de medida y actualización",
        url: "https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026",
        fecha_publicacion: "2026-01-09",
        fragmento: expect.stringContaining("$42,794.64"),
      },
    });
    expect(Object.keys(registros[1] as Uma)).toEqual([
      "anio",
      "diaria",
      "mensual",
      "anual",
      "vigencia_desde",
      "fuente",
    ]);
    expect(documento?.cobertura).toBeNull();
    expect(documento?.fuentes.get("uma-2026")?.licencia).toBe(
      "Términos de libre uso de la información del INEGI",
    );
  });

  it("lee el salario mínimo, las tarifas de ISR y los días de la CNBV y el SAT", () => {
    const salario = interpretarCurado(curadoSalarioMinimo, YAML_SALARIO);
    expect(salario.problemas).toEqual([]);
    const salarios = salario.documento?.registros as SalarioMinimo[];
    expect(salarios.map((r) => `${r.anio}${r.zona}`)).toEqual([
      "2025general",
      "2025zlfn",
      "2026general",
      "2026zlfn",
    ]);
    const isr = interpretarCurado(curadoTarifasIsr, YAML_ISR);
    expect(isr.problemas).toEqual([]);
    const tarifas = isr.documento?.registros as TarifaIsr[];
    expect(tarifas.map((t) => `${t.anio} ${t.periodo}`)).toEqual([
      "2025 anual",
      "2026 anual",
      "2026 mensual",
    ]);
    expect(tarifas[1]?.tramos[0]).toEqual({
      limite_inferior: "0.01",
      limite_superior: "10135.11",
      cuota_fija: "0.00",
      tasa_excedente: "1.92",
    });
    expect(tarifas[2]?.tramos.at(-1)?.limite_superior).toBeNull();
    expect(isr.documento?.excepciones).toEqual(EXCEPCIONES_OFICIALES);
    expect(salario.documento?.excepciones).toEqual([]);
    const cnbv = interpretarCurado(curadoDiasCnbv, YAML_CNBV);
    expect(cnbv.problemas).toEqual([]);
    expect(cnbv.documento?.registros).toHaveLength(11);
    expect(cnbv.documento?.cobertura).toEqual({
      descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
    });
    const sat = interpretarCurado(curadoDiasSat, YAML_SAT);
    expect(sat.problemas).toEqual([]);
    const dias = sat.documento?.registros as DiaInhabilCurado[];
    expect(dias.filter((d) => d.tipo === "vacaciones").map((d) => d.fecha)).toEqual([
      "2026-01-02",
      "2026-04-02",
      "2026-04-03",
      "2026-07-20",
    ]);
  });

  it("rechaza una fuente sin fragmento, con fragmento vacío o sin fecha de publicación", () => {
    expect(
      problemasUma((y) => y.replace(/ {4}fragmento: "\[\.\.\.\] es de \$117[^\n]*\n/, "")),
    ).toEqual(["fuentes.uma-2026.fragmento: falta"]);
    expect(
      problemasUma((y) => y.replace(/fragmento: "\[\.\.\.\] es de \$117[^\n]*/, 'fragmento: ""')),
    ).toEqual(["fuentes.uma-2026.fragmento: no puede estar vacío"]);
    expect(problemasUma((y) => y.replace("    fecha_publicacion: 2026-01-09\n", ""))).toEqual([
      "fuentes.uma-2026.fecha_publicacion: falta",
    ]);
    expect(problemasUma((y) => y.replace("2026-01-09", "2026-02-30"))).toEqual([
      "fuentes.uma-2026.fecha_publicacion: no es una fecha válida (AAAA-MM-DD)",
    ]);
  });

  it("rechaza URL fuera del DOF, el SIDOF y diputados.gob.mx", () => {
    const original = "https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026";
    for (const mala of [
      "http://dof.gob.mx/nota_detalle.php?codigo=5778072",
      "https://www.dof.gob.mx/nota_detalle.php?codigo=5778072",
      "https://dof.gob.mx.ejemplo.com/nota",
      "https://ejemplo.com/?u=https://dof.gob.mx/",
      "https://usuario@dof.gob.mx/nota",
      "https://dof.gob.mx:8443/nota",
      "https://diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      "https://www.sat.gob.mx/",
      "dof.gob.mx/nota",
    ]) {
      expect(
        problemasUma((y) => y.replace(original, mala)),
        mala,
      ).toEqual([
        "fuentes.uma-2026.url: debe estar en https://dof.gob.mx/, https://sidof.segob.gob.mx/ o https://www.diputados.gob.mx/",
      ]);
    }
    for (const buena of [
      "https://sidof.segob.gob.mx/notas/5778072",
      "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
    ]) {
      expect(
        problemasUma((y) => y.replace(original, buena)),
        buena,
      ).toEqual([]);
    }
  });

  it("exige montos como texto con dos decimales y tipos exactos", () => {
    expect(problemasUma((y) => y.replace('diaria: "117.31"', "diaria: 117.31"))).toEqual([
      'registros.0.diaria: debe ser un monto entre comillas con dos decimales, por ejemplo "117.31"',
    ]);
    expect(problemasUma((y) => y.replace('diaria: "117.31"', 'diaria: "117.3"'))).toEqual([
      'registros.0.diaria: debe ser un monto entre comillas con dos decimales, por ejemplo "117.31"',
    ]);
    expect(problemasUma((y) => y.replace("anio: 2026", 'anio: "2026"'))).toEqual([
      "registros.0.anio: debe ser un año entero",
    ]);
    // Una etiqueta de YAML 1.1 no convierte la fecha en Date: es un error.
    expect(
      problemasUma((y) => y.replace("vigencia_desde: 2026", "vigencia_desde: !!timestamp 2026"))[0],
    ).toMatch(/^YAML: Unresolved tag: tag:yaml\.org,2002:timestamp at line \d+/);
  });

  it("rechaza YAML con llaves repetidas, alias, varios documentos o raíz que no es un mapa", () => {
    expect(
      problemasUma((y) => y.replace("  - anio: 2026\n", "  - anio: 2026\n    anio: 2027\n"))[0],
    ).toMatch(/^YAML: Map keys must be unique at line \d+/);
    expect(
      problemasUma((y) =>
        y
          .replace('diaria: "117.31"', 'diaria: &d "117.31"')
          .replace('diaria: "113.14"', "diaria: *d"),
      ),
    ).toEqual(["YAML: no se permiten anclas ni alias (&, *)"]);
    expect(problemasUma((y) => `${y}---\ndataset: otro\n`)).toEqual([
      "YAML: el archivo debe tener un solo documento",
    ]);
    expect(problemasUma(() => "")).toEqual(["YAML: el archivo debe tener un solo documento"]);
    expect(problemasUma(() => "- a\n- b\n")[0]).toMatch(/^\(raíz\): /);
    expect(
      problemasUma((y) => y.replace("registros:\n  - anio: 2026", "registros:\n\t- anio: 2026"))[0],
    ).toMatch(/^YAML: /);
  });

  it("rechaza llaves desconocidas, dataset equivocado y cobertura donde no aplica", () => {
    expect(
      problemasUma((y) => y.replace("  - anio: 2026\n", "  - anio: 2026\n    mensuall: x\n")),
    ).toEqual(['registros.0: llave no permitida: "mensuall"']);
    expect(problemasUma((y) => `${y}extra: 1\n`)).toEqual(['(raíz): llave no permitida: "extra"']);
    expect(
      problemasUma((y) =>
        y.replace("dataset: constantes.uma", "dataset: constantes.salario-minimo"),
      ),
    ).toEqual(["dataset: se esperaba constantes.uma"]);
    expect(
      problemasUma((y) =>
        y.replace(
          "fuentes:",
          "cobertura:\n  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\nfuentes:",
        ),
      ),
    ).toEqual(['(raíz): llave no permitida: "cobertura"']);
    expect(
      interpretarCurado(curadoDiasCnbv, YAML_CNBV.replace(/cobertura:\n.*\n/, "")).problemas,
    ).toEqual(["cobertura: falta"]);
    const invertida = YAML_CNBV.replace(
      "{ desde: 2026-01-01, hasta: 2026-12-31 }",
      "{ desde: 2026-12-31, hasta: 2026-01-01 }",
    );
    expect(interpretarCurado(curadoDiasCnbv, invertida).problemas[0]).toBe(
      "cobertura.descanso: desde es posterior a hasta",
    );
    expect(
      interpretarCurado(curadoDiasCnbv, YAML_CNBV.replace(/cobertura:\n.*\n/, "cobertura: {}\n"))
        .problemas,
    ).toEqual(["cobertura: debe declarar al menos un tipo de día"]);
    const soloVacaciones = YAML_SAT.replace(
      "  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\n",
      "",
    );
    expect(interpretarCurado(curadoDiasSat, soloVacaciones).problemas).toContain(
      "invariante: 2026-01-01: no hay cobertura para el tipo descanso",
    );
  });

  it("valida las excepciones de cuota fija y solo las acepta en las tarifas de ISR", () => {
    const isr = (cambio: (yaml: string) => string) =>
      interpretarCurado(curadoTarifasIsr, cambio(YAML_ISR)).problemas;
    expect(isr((y) => y.replace("    tramo: 10\n", "    tramo: 1\n"))).toEqual([
      "excepciones_cuota_fija.0.tramo: debe ser un tramo de 2 en adelante",
    ]);
    expect(isr((y) => y.replace('publicada: "392294.17"', "publicada: 392294.17"))).toEqual([
      'excepciones_cuota_fija.0.publicada: debe ser un monto entre comillas con dos decimales, por ejemplo "117.31"',
    ]);
    expect(isr((y) => y.replace(/ {4}motivo: "El SAT[^\n]*\n/, ""))).toEqual([
      "excepciones_cuota_fija.0.motivo: falta",
    ]);
    expect(isr((y) => y.replace(/excepciones_cuota_fija:\n(.*\n){6}/, ""))).toEqual([
      "invariante: 2025 anual, tramo 10: cuota_fija es 392294.17, se esperaba 392294.19 ± 0.01",
    ]);
    expect(isr((y) => y.replace("    tramo: 10\n", "    tramo: 9\n"))).toContain(
      "invariante: 2025 anual, tramo 9: la excepción dice publicada 392294.17 y calculada 392294.19; el YAML trae 271981.99 y se calcula 271981.99",
    );
    const conExcepciones = YAML_UMA.replace("registros:", "excepciones_cuota_fija: []\nregistros:");
    expect(interpretarCurado(curadoUma, conExcepciones).problemas).toEqual([
      '(raíz): llave no permitida: "excepciones_cuota_fija"',
    ]);
  });

  it("rechaza merge keys, con y sin alias", () => {
    expect(
      problemasUma((y) => y.replace("  - anio: 2025\n", "  - <<: { anio: 2025 }\n")),
    ).toContain('registros.1: llave no permitida: "<<"');
    expect(
      problemasUma((y) =>
        y
          .replace("registros:\n  - anio: 2026\n", "registros:\n  - &base\n    anio: 2026\n")
          .replace("  - anio: 2025\n", "  - <<: *base\n    anio: 2025\n"),
      ),
    ).toEqual(["YAML: no se permiten anclas ni alias (&, *)"]);
  });

  it("cruza la fecha de una nota del DOF con fecha_publicacion", () => {
    expect(
      problemasUma((y) =>
        y.replace("fecha_publicacion: 2026-01-09", "fecha_publicacion: 2026-01-10"),
      ),
    ).toEqual([
      "fuentes.uma-2026.fecha_publicacion: no coincide con la fecha de la URL (09/01/2026)",
    ]);
    expect(problemasUma((y) => y.replace("fecha=09/01/2026", "fecha=2026-01-09"))).toEqual([
      "fuentes.uma-2026.url: la fecha de la URL debe tener la forma DD/MM/AAAA",
    ]);
    // Sin fecha en la URL (o en el SIDOF) no hay nada que cruzar.
    expect(problemasUma((y) => y.replace("&fecha=09/01/2026", ""))).toEqual([]);
  });

  it("valida las referencias a fuentes", () => {
    expect(problemasUma((y) => y.replace("    fuente: uma-2025\n", ""))).toEqual([
      "registros.1.fuente: falta",
      "fuentes.uma-2025: no la usa ningún registro",
    ]);
    expect(problemasUma((y) => y.replace("registros:\n", "registros:\n  - 5\n"))).toEqual([
      "registros.0: debe ser un mapa de campos",
    ]);
    expect(problemasUma((y) => y.replace("fuente: uma-2025", "fuente: uma-2024"))).toEqual([
      "registros.1.fuente: fuente no declarada: uma-2024",
      "fuentes.uma-2025: no la usa ningún registro",
    ]);
    expect(problemasUma((y) => y.replace("fuente: uma-2025", "fuente: 2025"))).toEqual([
      "registros.1.fuente: debe ser la clave de una fuente declarada",
      "fuentes.uma-2025: no la usa ningún registro",
    ]);
    expect(
      problemasUma((y) =>
        y.replace("  uma-2025:", "  UMA 2025:").replace("fuente: uma-2025", "fuente: UMA 2025"),
      ),
    ).toEqual(["fuentes.UMA 2025: la clave debe usar minúsculas, dígitos, puntos y guiones"]);
  });

  it("exige que las fuentes con la misma URL describan la misma publicación", () => {
    const yaml = YAML_SAT.replace(
      '    nombre: "Resolución Miscelánea Fiscal para 2026"\n    url: https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025\n    fecha_publicacion: 2025-12-28\n    fragmento: "II.',
      '    nombre: "RMF 2026"\n    url: https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025\n    fecha_publicacion: 2025-12-28\n    fragmento: "II.',
    );
    expect(interpretarCurado(curadoDiasSat, yaml).problemas).toEqual([
      "fuentes.rmf-2026-2.1.6-ii: comparte URL con rmf-2026-2.1.6-i pero su nombre no coincide",
    ]);
  });

  it("rechaza claves duplicadas, textos con espacios de más y aplica los invariantes", () => {
    expect(problemasUma((y) => y.replace("  - anio: 2025", "  - anio: 2026"))).toContain(
      "registros: clave duplicada: 2026",
    );
    expect(
      problemasUma((y) => y.replace('nombre: "INEGI. Unidad', 'nombre: "INEGI.  Unidad')),
    ).toEqual([
      "fuentes.uma-2026.nombre: tiene espacios de más, saltos de línea o espacios especiales",
    ]);
    expect(problemasUma((y) => y.replace('mensual: "3566.22"', 'mensual: "3566.23"'))).toContain(
      "invariante: 2026: mensual es 3566.23, se esperaba 3566.22 (diaria × 30.4)",
    );
    const sinRegistros = `${YAML_UMA.slice(0, YAML_UMA.indexOf("registros:"))}registros: []\n`;
    expect(interpretarCurado(curadoUma, sinRegistros).problemas).toEqual([
      "registros: debe tener al menos un registro",
    ]);
  });

  it("normaliza los textos a NFC", () => {
    const nfd = YAML_UMA.replace("actualización", "actualizacio\u0301n");
    const { documento, problemas } = interpretarCurado(curadoUma, nfd);
    expect(problemas).toEqual([]);
    expect(documento?.registros[1]?.fuente.nombre).toBe("INEGI. Unidad de medida y actualización");
  });
});

describe("leerCurado", () => {
  it("lee data/curado/<yaml> y devuelve null si no existe", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "leer-curado-"));
    try {
      expect(await leerCurado(curadoUma, raiz)).toBeNull();
      await mkdir(join(raiz, "curado"));
      await writeFile(join(raiz, "curado", curadoUma.yaml), YAML_UMA);
      expect((await leerCurado(curadoUma, raiz))?.problemas).toEqual([]);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
