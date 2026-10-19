import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sumarDias, type TarifaIsr, type Uma } from "@mexicoapi/core";
import { coberturaAnual, coberturaUma } from "@mexicoapi/core/constantes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Entorno, principal } from "../src/cli.js";
import { type Cobertura, leerCoberturas, porVencer } from "../src/coberturas.js";
import { ErrorDatos } from "../src/errores.js";

const REAL = fileURLToPath(new URL("../../../data", import.meta.url));

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "coberturas-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const leerReal = async <T>(ruta: string): Promise<T> =>
  JSON.parse(await readFile(join(REAL, ruta), "utf8")) as T;

async function escribir(ruta: string, valor: unknown): Promise<void> {
  await mkdir(join(raiz, ruta, ".."), { recursive: true });
  await writeFile(join(raiz, ruta), `${JSON.stringify(valor, null, 2)}\n`);
}

const calendario = (autoridad: string, plazos: Record<string, string>) => ({
  autoridad,
  plazos: Object.fromEntries(
    Object.entries(plazos).map(([tipo, hasta]) => [
      tipo,
      { cobertura: { desde: "2025-01-01", hasta }, excluir_tipos: [] },
    ]),
  ),
  fuentes_fin_de_semana: {},
});

/**
 * Los datos de hoy, fijos: los calendarios como están y las constantes reales hasta 2026. Así
 * las fechas de las pruebas no cambian cuando se capture una publicación nueva.
 */
async function datosDeHoy(): Promise<void> {
  await escribir(
    "dias-inhabiles-cnbv/calendario.json",
    calendario("cnbv", { general: "2026-12-31" }),
  );
  await escribir(
    "dias-inhabiles-sat/calendario.json",
    calendario("sat", { general: "2026-11-30", declaraciones_pagos: "2100-12-31" }),
  );
  const hasta2026 = <T extends { anio: number }>(lista: T[]) => lista.filter((r) => r.anio <= 2026);
  await escribir(
    "constantes-uma/uma.json",
    hasta2026(await leerReal<Uma[]>("constantes-uma/uma.json")),
  );
  await escribir(
    "constantes-salario-minimo/salario-minimo.json",
    hasta2026(await leerReal<{ anio: number }[]>("constantes-salario-minimo/salario-minimo.json")),
  );
  await escribir(
    "isr-tarifas/tarifas.json",
    hasta2026(await leerReal<TarifaIsr[]>("isr-tarifas/tarifas.json")),
  );
}

interface Corrida {
  codigo: number;
  salida: string;
  errores: string;
}

async function correr(argumentos: string[], ahora = new Date("2026-10-18T18:00:00Z")) {
  let salida = "";
  let errores = "";
  const entorno: Entorno = {
    crearCliente: () => {
      throw new Error("coberturas no usa la red");
    },
    raizDatos: raiz,
    ahora: () => ahora,
    escribir: (t) => {
      salida += t;
    },
    escribirError: (t) => {
      errores += t;
    },
  };
  const codigo = await principal(argumentos, entorno);
  return { codigo, salida, errores } satisfies Corrida;
}

describe("leerCoberturas", () => {
  it("lee la cobertura de cada plazo de los calendarios y de cada constante", async () => {
    await datosDeHoy();
    const coberturas = await leerCoberturas(raiz);
    expect(coberturas.map(({ id, dataset, hasta }) => ({ id, dataset, hasta }))).toEqual([
      { id: "dias-inhabiles.sat general", dataset: "dias-inhabiles.sat", hasta: "2026-11-30" },
      {
        id: "constantes.salario-minimo",
        dataset: "constantes.salario-minimo",
        hasta: "2026-12-31",
      },
      { id: "dias-inhabiles.cnbv general", dataset: "dias-inhabiles.cnbv", hasta: "2026-12-31" },
      { id: "isr.tarifas", dataset: "isr.tarifas", hasta: "2026-12-31" },
      { id: "constantes.uma", dataset: "constantes.uma", hasta: "2027-01-31" },
      {
        id: "dias-inhabiles.sat declaraciones_pagos",
        dataset: "dias-inhabiles.sat",
        hasta: "2100-12-31",
      },
    ]);
    const detalle = Object.fromEntries(coberturas.map((c) => [c.id, c.detalle]));
    expect(detalle["dias-inhabiles.sat general"]).toBe(
      "Después de ese día, /v1/dias-habiles con autoridad=sat y tipo_plazo=general responde 422 calendario-incompleto. Hay que capturar en data/curado/dias-inhabiles-sat.yaml la publicación que extiende la cobertura.",
    );
    expect(detalle["dias-inhabiles.cnbv general"]).toBe(
      "Después de ese día, /v1/dias-habiles con autoridad=cnbv responde 422 calendario-incompleto. Hay que capturar en data/curado/dias-inhabiles-cnbv.yaml la publicación que extiende la cobertura.",
    );
    expect(detalle["constantes.uma"]).toBe(
      "La última UMA cargada es la de 2026. Después de ese día, /v1/constantes/uma responde dato-no-disponible hasta capturar la UMA de 2027 en data/curado/constantes-uma.yaml.",
    );
    expect(detalle["constantes.salario-minimo"]).toBe(
      "El último salario mínimo cargado es el de 2026. /v1/constantes/salario-minimo/2027 responde dato-no-disponible hasta capturarlo en data/curado/constantes-salario-minimo.yaml.",
    );
    expect(detalle["isr.tarifas"]).toBe(
      "Las últimas tarifas cargadas son la anual de 2026 y la mensual de 2026. /v1/isr/tarifa/{periodo}/2027 responde dato-no-disponible hasta capturarlas en data/curado/isr-tarifas.yaml.",
    );
  });

  it("con un periodo de ISR atrasado, la cobertura termina con el que va atrás", async () => {
    await datosDeHoy();
    const tarifas = (await leerReal<TarifaIsr[]>("isr-tarifas/tarifas.json")).filter(
      (t) => t.anio <= 2026 && !(t.periodo === "anual" && t.anio === 2026),
    );
    await escribir("isr-tarifas/tarifas.json", tarifas);
    const isr = (await leerCoberturas(raiz)).find((c) => c.id === "isr.tarifas");
    expect(isr?.hasta).toBe("2025-12-31");
    expect(isr?.detalle).toContain("la anual de 2025 y la mensual de 2026");
  });

  it("con los datos reales coincide con el calendario.json y con el núcleo", async () => {
    const coberturas = await leerCoberturas(REAL);
    const de = (id: string): Cobertura | undefined => coberturas.find((c) => c.id === id);
    const sat = await leerReal<{ plazos: Record<string, { cobertura: { hasta: string } }> }>(
      "dias-inhabiles-sat/calendario.json",
    );
    for (const [tipo, { cobertura }] of Object.entries(sat.plazos)) {
      expect(de(`dias-inhabiles.sat ${tipo}`)?.hasta, tipo).toBe(cobertura.hasta);
    }
    expect(de("constantes.uma")?.hasta).toBe(
      coberturaUma(await leerReal<Uma[]>("constantes-uma/uma.json")).hasta,
    );
    const salarios = await leerReal<{ anio: number }[]>(
      "constantes-salario-minimo/salario-minimo.json",
    );
    expect(de("constantes.salario-minimo")?.hasta).toBe(
      coberturaAnual([...new Set(salarios.map((s) => s.anio))]).hasta,
    );
    expect(coberturas.map((c) => c.id).sort()).toEqual(
      [
        "constantes.salario-minimo",
        "constantes.uma",
        "dias-inhabiles.cnbv general",
        "isr.tarifas",
        ...Object.keys(sat.plazos).map((t) => `dias-inhabiles.sat ${t}`),
      ].sort(),
    );
  });

  it("si falta un archivo o tiene otra forma, ErrorDatos con el dataset", async () => {
    await datosDeHoy();
    await rm(join(raiz, "constantes-uma", "uma.json"));
    await expect(leerCoberturas(raiz)).rejects.toThrow(ErrorDatos);
    await expect(leerCoberturas(raiz)).rejects.toThrow(/constantes-uma\/uma\.json/);
    await datosDeHoy();
    await escribir("dias-inhabiles-sat/calendario.json", { autoridad: "sat", plazos: {} });
    await expect(leerCoberturas(raiz)).rejects.toThrow(/dias-inhabiles-sat\/calendario\.json/);
    await datosDeHoy();
    await escribir("isr-tarifas/tarifas.json", [{ anio: 2026 }]);
    await expect(leerCoberturas(raiz)).rejects.toThrow(/isr-tarifas\/tarifas\.json/);
  });

  it("un error de lectura que no es un archivo ausente sale tal cual", async () => {
    await datosDeHoy();
    await rm(join(raiz, "constantes-uma", "uma.json"));
    await mkdir(join(raiz, "constantes-uma", "uma.json"));
    const error = await leerCoberturas(raiz).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ErrorDatos);
    expect((error as NodeJS.ErrnoException).code).toBe("EISDIR");
  });
});

describe("porVencer", () => {
  const coberturas: Cobertura[] = [
    { id: "a", dataset: "a", hasta: "2026-11-30", detalle: "A." },
    { id: "b", dataset: "b", hasta: "2026-12-31", detalle: "B." },
  ];

  it("con días, solo las que terminan en ese plazo o ya terminaron, con su resumen", () => {
    expect(porVencer(coberturas, "2026-10-30", 30)).toEqual([]);
    expect(porVencer(coberturas, "2026-10-31", 30)).toEqual([
      {
        id: "a",
        dataset: "a",
        hasta: "2026-11-30",
        dias_restantes: 30,
        titulo: "Cobertura por vencer: a",
        resumen: "La cobertura de `a` termina el 2026-11-30: faltan 30 días.",
        detalle: "A.",
      },
    ]);
    const resumenes = (fecha: string) =>
      porVencer(coberturas, fecha, 30).map((c) => [c.id, c.dias_restantes, c.resumen]);
    expect(resumenes("2026-11-29")).toEqual([
      ["a", 1, "La cobertura de `a` termina el 2026-11-30: falta 1 día."],
    ]);
    expect(resumenes("2026-11-30")).toEqual([
      ["a", 0, "La cobertura de `a` termina hoy, 2026-11-30."],
    ]);
    expect(resumenes("2026-12-01")).toEqual([
      ["a", -1, "La cobertura de `a` terminó el 2026-11-30, hace 1 día."],
      ["b", 30, "La cobertura de `b` termina el 2026-12-31: faltan 30 días."],
    ]);
    expect(resumenes("2027-01-02")[0]).toEqual([
      "a",
      -33,
      "La cobertura de `a` terminó el 2026-11-30, hace 33 días.",
    ]);
  });

  it("sin días, todas; de 0 días, solo las que terminan hoy o ya terminaron", () => {
    expect(porVencer(coberturas, "2026-10-18").map((c) => c.dias_restantes)).toEqual([43, 74]);
    expect(porVencer(coberturas, "2026-11-30", 0).map((c) => c.id)).toEqual(["a"]);
  });

  it("cuenta los días con años bisiestos y de un año a otro", () => {
    const lejana: Cobertura = { id: "x", dataset: "x", hasta: "2100-12-31", detalle: "X." };
    expect(porVencer([lejana], "2100-01-01")[0]?.dias_restantes).toBe(364);
    // 307 días hasta el fin de 2028 y 72 años más, 17 de ellos bisiestos (2100 no lo es).
    expect(porVencer([lejana], "2028-02-28")[0]?.dias_restantes).toBe(307 + 365 * 72 + 17);
    expect(porVencer([{ ...lejana, hasta: "2028-03-01" }], "2028-02-28")[0]?.dias_restantes).toBe(
      2,
    );
  });
});

describe("comando coberturas", () => {
  it("--dias 30: el día de hoy no hay ninguna; el 31 de octubre de 2026, la del SAT general", async () => {
    await datosDeHoy();
    expect(await correr(["coberturas", "--dias", "30"])).toEqual({
      codigo: 0,
      salida: "Ninguna cobertura termina en los próximos 30 días (al 2026-10-18).\n",
      errores: "",
    });
    const antes = await correr(["coberturas", "--dias", "30", "--fecha", "2026-10-30"]);
    expect(antes.salida).toBe(
      "Ninguna cobertura termina en los próximos 30 días (al 2026-10-30).\n",
    );
    const primera = await correr(["coberturas", "--dias", "30", "--fecha", "2026-10-31"]);
    expect(primera).toEqual({
      codigo: 0,
      salida:
        "Coberturas que terminan en los próximos 30 días (al 2026-10-31):\n" +
        "  dias-inhabiles.sat general  hasta 2026-11-30  (faltan 30 días)\n",
      errores: "",
    });
  });

  it("el 1 de diciembre de 2026 entran la CNBV, el salario mínimo y el ISR; en enero, la UMA", async () => {
    await datosDeHoy();
    const ids = async (fecha: string) =>
      (
        JSON.parse(
          (await correr(["coberturas", "--dias", "30", "--fecha", fecha, "--json"])).salida,
        ) as { id: string }[]
      ).map((c) => c.id);
    expect(await ids("2026-12-01")).toEqual([
      "dias-inhabiles.sat general",
      "constantes.salario-minimo",
      "dias-inhabiles.cnbv general",
      "isr.tarifas",
    ]);
    expect(await ids("2027-01-01")).toContain("constantes.uma");
    expect(await ids("2026-12-31")).not.toContain("constantes.uma");
  });

  it("--json imprime la lista con título, resumen y detalle de cada una", async () => {
    await datosDeHoy();
    const { codigo, salida } = await correr([
      "coberturas",
      "--dias",
      "30",
      "--fecha",
      "2026-10-31",
      "--json",
    ]);
    expect(codigo).toBe(0);
    expect(JSON.parse(salida)).toEqual([
      {
        id: "dias-inhabiles.sat general",
        dataset: "dias-inhabiles.sat",
        hasta: "2026-11-30",
        dias_restantes: 30,
        titulo: "Cobertura por vencer: dias-inhabiles.sat general",
        resumen:
          "La cobertura de `dias-inhabiles.sat general` termina el 2026-11-30: faltan 30 días.",
        detalle: expect.stringContaining("data/curado/dias-inhabiles-sat.yaml"),
      },
    ]);
    expect(salida.endsWith("]\n")).toBe(true);
    const vacia = await correr(["coberturas", "--dias", "30", "--json"]);
    expect(vacia.salida).toBe("[]\n");
  });

  it("sin --dias lista todas con los días que faltan, y una ya vencida lo dice", async () => {
    await datosDeHoy();
    const { codigo, salida } = await correr(["coberturas", "--fecha", "2026-12-02"]);
    expect(codigo).toBe(0);
    expect(salida).toBe(
      "Coberturas de los datos curados (al 2026-12-02):\n" +
        "  dias-inhabiles.sat general              hasta 2026-11-30  (terminó hace 2 días)\n" +
        "  constantes.salario-minimo               hasta 2026-12-31  (faltan 29 días)\n" +
        "  dias-inhabiles.cnbv general             hasta 2026-12-31  (faltan 29 días)\n" +
        "  isr.tarifas                             hasta 2026-12-31  (faltan 29 días)\n" +
        "  constantes.uma                          hasta 2027-01-31  (faltan 60 días)\n" +
        "  dias-inhabiles.sat declaraciones_pagos  hasta 2100-12-31  (faltan 27057 días)\n",
    );
    const hoy = await correr(["coberturas", "--dias", "1", "--fecha", "2026-11-30"]);
    expect(hoy.salida).toContain("  dias-inhabiles.sat general  hasta 2026-11-30  (termina hoy)\n");
    const manana = await correr(["coberturas", "--dias", "1", "--fecha", "2026-11-29"]);
    expect(manana.salida).toContain("hasta 2026-11-30  (falta 1 día)\n");
    const ayer = await correr(["coberturas", "--dias", "0", "--fecha", "2026-12-01"]);
    expect(ayer.salida).toContain("hasta 2026-11-30  (terminó hace 1 día)\n");
  });

  it("usa la fecha civil de México por omisión", async () => {
    await datosDeHoy();
    // 03:00 UTC del 1 de noviembre es todavía el 31 de octubre en la Ciudad de México.
    const { salida } = await correr(
      ["coberturas", "--dias", "30"],
      new Date("2026-11-01T03:00:00Z"),
    );
    expect(salida).toContain("(al 2026-10-31)");
    expect(salida).toContain("dias-inhabiles.sat general");
  });

  it("rechaza --dias y --fecha inválidos y las opciones de otros comandos", async () => {
    await datosDeHoy();
    for (const dias of ["-1", "x", "1.5", "030", "100000", ""]) {
      const c = await correr(["coberturas", `--dias=${dias}`]);
      expect(c.codigo, dias).toBe(1);
      expect(c.errores, dias).toContain(`--dias inválido: ${dias}`);
    }
    const fecha = await correr(["coberturas", "--fecha", "2026-02-30"]);
    expect(fecha).toMatchObject({ codigo: 1, errores: "Fecha inválida: 2026-02-30\n" });
    const otra = await correr(["coberturas", "--seco"]);
    expect(otra.codigo).toBe(1);
    expect(otra.errores).toContain("Opciones que no aplican a coberturas: --seco");
    const sobra = await correr(["coberturas", "x"]);
    expect(sobra.errores).toContain("Argumentos de más para coberturas: x");
    // --json solo vale en coberturas.
    expect((await correr(["verificar", "--json"])).codigo).toBe(1);
  });

  it("con datos rotos sale con 1 y dice qué archivo", async () => {
    const { codigo, errores } = await correr(["coberturas"]);
    expect(codigo).toBe(1);
    expect(errores).toMatch(/^coberturas: .*dias-inhabiles-cnbv\/calendario\.json/);
  });

  it("con los datos reales y --dias 30 nombra la del SAT general 30 días antes", async () => {
    const sat = await leerReal<{ plazos: { general: { cobertura: { hasta: string } } } }>(
      "dias-inhabiles-sat/calendario.json",
    );
    const { hasta } = sat.plazos.general.cobertura;
    const argumentos = (fecha: string) => [
      "coberturas",
      "--dias",
      "30",
      "--fecha",
      fecha,
      "--json",
      "--datos",
      REAL,
    ];
    const ids = async (fecha: string) =>
      (JSON.parse((await correr(argumentos(fecha))).salida) as { id: string }[]).map((c) => c.id);
    expect(await ids(sumarDias(hasta, -30))).toContain("dias-inhabiles.sat general");
    expect(await ids(sumarDias(hasta, -31))).not.toContain("dias-inhabiles.sat general");
  });
});
