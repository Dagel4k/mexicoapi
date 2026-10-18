import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CoberturaCurada, DiaInhabilCurado } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";
import { leerCurado } from "../../../pipeline/src/curado/leer.ts";
import { curadoDiasCnbv, curadoDiasSat } from "../../../pipeline/src/curado/registro.ts";
import { shardCalendario } from "../../../pipeline/src/sitio/calendarios.ts";
import { armarCalendario, coberturaDelYaml } from "../../scripts/calendarios.ts";

const DATA = new URL("../../../../data/", import.meta.url);

const FUENTE = {
  nombre: "Disposiciones 2026",
  url: "https://dof.gob.mx/nota_detalle.php?codigo=1",
  fecha_publicacion: "2025-12-10",
  fragmento: "IX. Los sábados y domingos.",
};

const dia = (
  fecha: string,
  tipo: "descanso" | "vacaciones" = "descanso",
  autoridad: "cnbv" | "sat" = "cnbv",
  fuente = FUENTE,
): DiaInhabilCurado => ({ fecha, autoridad, motivo: `Motivo ${fecha}`, tipo, fuente });

describe("coberturaDelYaml", () => {
  it("lee el bloque cobertura con comentarios, comillas y líneas vacías", () => {
    const texto = [
      "# Calendario de prueba",
      "dataset: dias-inhabiles.sat",
      "cobertura:",
      "  # descanso de todo el año",
      '  descanso: { desde: 2026-01-01, hasta: "2026-12-31" }',
      "",
      "  vacaciones: {desde: '2026-01-01', hasta: 2026-11-30}  # falta diciembre",
      "fuentes:",
      "  cff-12:",
      "    nombre: x",
    ].join("\n");
    expect(coberturaDelYaml(texto, "sat.yaml")).toEqual({
      descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
      vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
    });
  });

  it("da null si el documento no tiene cobertura", () => {
    expect(coberturaDelYaml("dataset: constantes.uma\nregistros: []\n", "uma.yaml")).toBeNull();
  });

  it.each([
    ["cobertura en otra forma", "cobertura:\n  descanso:\n    desde: 2026-01-01\n"],
    [
      "un tipo de día que no existe",
      "cobertura:\n  feriado: { desde: 2026-01-01, hasta: 2026-12-31 }\n",
    ],
    [
      "una fecha que no existe",
      "cobertura:\n  descanso: { desde: 2026-02-30, hasta: 2026-12-31 }\n",
    ],
    ["un rango invertido", "cobertura:\n  descanso: { desde: 2026-12-31, hasta: 2026-01-01 }\n"],
    [
      "un tipo repetido",
      "cobertura:\n  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\n  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\n",
    ],
    ["cobertura vacía", "cobertura:\nfuentes: {}\n"],
    ["cobertura en línea", "cobertura: { descanso: { desde: 2026-01-01, hasta: 2026-12-31 } }\n"],
    [
      "dos bloques",
      "cobertura:\n  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\ncobertura:\n  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }\n",
    ],
  ])("falla con %s", (_caso, texto) => {
    expect(() => coberturaDelYaml(texto, "x.yaml")).toThrow(/x\.yaml/);
  });
});

describe("armarCalendario", () => {
  it("arma los plazos de la CNBV con la fuente de fin de semana de cada año", () => {
    const fuente2025 = { ...FUENTE, nombre: "Disposiciones 2025" };
    const registros = [dia("2025-12-25", "descanso", "cnbv", fuente2025), dia("2026-12-25")];
    const cobertura: CoberturaCurada = { descanso: { desde: "2025-01-01", hasta: "2026-12-31" } };
    expect(armarCalendario(registros, cobertura, "dias-inhabiles.cnbv")).toEqual({
      autoridad: "cnbv",
      plazos: {
        general: { cobertura: { desde: "2025-01-01", hasta: "2026-12-31" }, excluir_tipos: [] },
      },
      fuentes_fin_de_semana: { "2025": fuente2025, "2026": FUENTE },
    });
  });

  it("en el SAT, general se corta donde terminan las vacaciones publicadas", () => {
    const cff = { ...FUENTE, fragmento: "no se contarán los sábados, los domingos ni ..." };
    const registros = [
      dia("2026-07-20", "vacaciones", "sat", FUENTE),
      dia("2026-12-25", "descanso", "sat", cff),
    ];
    const cobertura: CoberturaCurada = {
      descanso: { desde: "2026-01-01", hasta: "2026-12-31" },
      vacaciones: { desde: "2026-01-01", hasta: "2026-11-30" },
    };
    const calendario = armarCalendario(registros, cobertura, "dias-inhabiles.sat");
    expect(calendario.plazos).toEqual({
      general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
      declaraciones_pagos: {
        cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
        excluir_tipos: ["vacaciones"],
      },
    });
    expect(calendario.fuentes_fin_de_semana).toEqual({ "2026": cff });
  });

  it.each([
    ["registros de dos autoridades", [dia("2026-01-01"), dia("2026-01-02", "descanso", "sat")]],
    ["sin registros", []],
    ["un día fuera de la cobertura", [dia("2027-01-01")]],
    ["un año sin días de descanso", [dia("2026-01-01")]],
  ])("falla con %s", (_caso, registros) => {
    const cobertura: CoberturaCurada = { descanso: { desde: "2025-01-01", hasta: "2026-12-31" } };
    expect(() => armarCalendario(registros, cobertura, "dias-inhabiles.cnbv")).toThrow(
      /dias-inhabiles\.cnbv/,
    );
  });

  it("falla si la fuente del fin de semana no menciona sábados y domingos", () => {
    const sinFds = { ...FUENTE, fragmento: "VIII. El 12 y 25 de diciembre." };
    const cobertura: CoberturaCurada = { descanso: { desde: "2026-01-01", hasta: "2026-12-31" } };
    expect(() =>
      armarCalendario([dia("2026-12-25", "descanso", "cnbv", sinFds)], cobertura, "x"),
    ).toThrow(/sábados y domingos/);
  });

  it("falla si un plazo queda sin cobertura o si ninguno contiene a los demás", () => {
    const soloVacaciones: CoberturaCurada = {
      vacaciones: { desde: "2026-01-01", hasta: "2026-12-31" },
    };
    expect(() =>
      armarCalendario([dia("2026-07-20", "vacaciones", "sat")], soloVacaciones, "x"),
    ).toThrow(/declaraciones_pagos/);
    const separadas: CoberturaCurada = {
      descanso: { desde: "2026-01-01", hasta: "2026-03-31" },
      vacaciones: { desde: "2026-06-01", hasta: "2026-12-31" },
    };
    expect(() => armarCalendario([dia("2026-03-02", "descanso", "sat")], separadas, "x")).toThrow(
      /general queda vacía/,
    );
  });
});

describe("con los datos del repositorio", () => {
  it.each([
    ["cnbv", curadoDiasCnbv],
    ["sat", curadoDiasSat],
  ] as const)("arma el calendario %s igual que el pipeline", async (autoridad, def) => {
    const lectura = await leerCurado(def, fileURLToPath(DATA));
    if (lectura === null || lectura.documento === null) throw new Error("No se leyó el YAML");
    const yaml = await readFile(new URL(`curado/${def.yaml}`, DATA), "utf8");
    const cobertura = coberturaDelYaml(yaml, def.yaml);
    expect(cobertura).toEqual(lectura.documento.cobertura);
    const carpeta = new URL(`${def.directorio}/`, DATA);
    const manifiesto = JSON.parse(await readFile(new URL("manifest.json", carpeta), "utf8")) as {
      data_file: string;
      dataset: string;
    };
    const registros = JSON.parse(
      await readFile(new URL(manifiesto.data_file, carpeta), "utf8"),
    ) as DiaInhabilCurado[];
    const esperado = shardCalendario(autoridad, registros, lectura.documento.cobertura);
    const armado = armarCalendario(registros, cobertura as CoberturaCurada, manifiesto.dataset);
    expect(armado).toEqual({
      autoridad: esperado.autoridad,
      plazos: esperado.plazos,
      fuentes_fin_de_semana: esperado.fuentes_fin_de_semana,
    });
  });
});
