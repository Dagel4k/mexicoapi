// Pruebas de las entradas de datos curados (calendarios de la CNBV y el SAT, constantes) que corren
// igual sobre src y sobre dist. Lo que depende de los datos se toma de data/.
import { readFile } from "node:fs/promises";
import { diasDescansoCff } from "@mexicoapi/core";
import { beforeAll, expect, it } from "vitest";
import type * as Calendarios from "../../src/datos/calendarios.js";
import type * as Constantes from "../../src/datos/constantes.js";
import type {
  CoberturaSerie,
  DiaInhabilCurado,
  SalarioMinimo,
  TarifaIsr,
  TipoPlazo,
  Uma,
} from "../../src/datos/tipos.js";
import type { Modulo } from "../comun.js";
import {
  type DesdeData,
  desdeData,
  esperarCongelado,
  esperarIgualesAData,
  metaEsperada,
} from "./comun.js";

export type ModuloCalendarios = typeof Calendarios;
export type ModuloConstantes = typeof Constantes;

const DATA = new URL("../../../../data/", import.meta.url);

interface CalendarioEnData {
  plazos: Partial<Record<TipoPlazo, { cobertura: CoberturaSerie; excluir_tipos: string[] }>>;
}

/** `data/<directorio>/calendario.json`, el que `curar` escribe y `verificar` compara con el YAML. */
async function calendarioDe(directorio: string): Promise<CalendarioEnData> {
  return JSON.parse(await readFile(new URL(`${directorio}/calendario.json`, DATA), "utf8"));
}

export function probarCalendarios(
  cargar: () => Promise<{ calendarios: ModuloCalendarios; mexicoapi: Modulo }>,
): void {
  let m: ModuloCalendarios;
  let mx: Modulo;
  let cnbv: DesdeData<DiaInhabilCurado>;
  let sat: DesdeData<DiaInhabilCurado>;

  beforeAll(async () => {
    ({ calendarios: m, mexicoapi: mx } = await cargar());
    [cnbv, sat] = await Promise.all([
      desdeData<DiaInhabilCurado>("dias-inhabiles-cnbv"),
      desdeData<DiaInhabilCurado>("dias-inhabiles-sat"),
    ]);
  });

  it("exporta exactamente su API", () => {
    expect(Object.keys(m).sort()).toEqual([
      "calendario",
      "calendarioCurado",
      "feriadoBancario",
      "meta",
    ]);
  });

  it("trae los días de data/ sin la autoridad, con la meta de su manifest", () => {
    for (const [autoridad, d] of [
      ["cnbv", cnbv],
      ["sat", sat],
    ] as const) {
      const curado = m.calendarioCurado(autoridad);
      const ultimo = d.registros.at(-1)?.fecha.slice(0, 4) ?? "";
      // El SAT agrega después los días del art. 12 de los años siguientes, por regla.
      expect(curado.dias.filter((x) => x.fecha.slice(0, 4) <= ultimo)).toEqual(
        d.registros.map(({ autoridad: _a, ...dia }) => dia),
      );
      expect(curado.meta).toEqual(metaEsperada(d));
      expect(m.meta[autoridad]).toBe(curado.meta);
      expect(m.calendarioCurado(autoridad)).toBe(curado);
    }
    expect(m.calendarioCurado("cnbv").dias).toHaveLength(cnbv.registros.length);
  });

  it("los calendarios de cada plazo nombran lo que puede faltar fuera de su cobertura", () => {
    expect(m.calendario("sat", "general").faltaFuera).toBe(
      "Pueden faltar días del art. 12 del CFF, como el 25 de diciembre y el 1 de enero, y vacaciones del SAT.",
    );
    expect(m.calendario("sat", "declaraciones_pagos").faltaFuera).toBe(
      "Pueden faltar días del art. 12 del CFF, como el 25 de diciembre y el 1 de enero.",
    );
    expect(m.calendario("cnbv").faltaFuera).toBe(
      "Pueden faltar días de cierre bancario, como el 1 de enero.",
    );
  });

  it("el SAT calcula los días del art. 12 de cada año hasta 2100", () => {
    const { dias, amplia } = m.calendarioCurado("sat");
    expect(amplia.hasta).toBe("2100-12-31");
    const ultimo = Number(sat.registros.at(-1)?.fecha.slice(0, 4));
    const despues = dias.filter((d) => Number(d.fecha.slice(0, 4)) > ultimo);
    expect(despues).toEqual(
      Array.from({ length: 2100 - ultimo }, (_, i) => diasDescansoCff(ultimo + 1 + i)).flat(),
    );
    expect(despues.find((d) => d.fecha === `${ultimo + 1}-01-01`)?.fuente.nombre).toBe(
      "Código Fiscal de la Federación, artículo 12",
    );
  });

  it("arma los plazos de data/<carpeta>/calendario.json, como la API", async () => {
    const cnbvDatos = await calendarioDe("dias-inhabiles-cnbv");
    const c = m.calendarioCurado("cnbv");
    expect([...c.plazos.keys()]).toEqual(["general"]);
    expect(c.general.cobertura).toEqual(cnbvDatos.plazos.general?.cobertura);
    expect(c.amplia).toEqual(c.general.cobertura);
    expect(c.general.respaldo).toBeUndefined();
    const satDatos = await calendarioDe("dias-inhabiles-sat");
    const s = m.calendarioCurado("sat");
    expect([...s.plazos.keys()]).toEqual(["general", "declaraciones_pagos"]);
    const general = satDatos.plazos.general?.cobertura as CoberturaSerie;
    const pagos = satDatos.plazos.declaraciones_pagos?.cobertura as CoberturaSerie;
    expect(s.general.cobertura).toEqual(general);
    expect(s.general.excluirTipos).toEqual([]);
    expect(s.plazos.get("declaraciones_pagos")?.cobertura).toEqual(pagos);
    expect(s.plazos.get("declaraciones_pagos")?.excluirTipos).toEqual(["vacaciones"]);
    expect(s.amplia).toEqual(pagos);
    // Un plazo más corto que la cobertura amplia trae su respaldo con la amplia.
    const corto = general.hasta < pagos.hasta;
    expect(s.general.respaldo?.cobertura).toEqual(corto ? pagos : undefined);
    expect(s.plazos.get("declaraciones_pagos")?.respaldo).toBeUndefined();
  });

  it("suma días hábiles con cada plazo, como los ejemplos de la API", () => {
    const sumar = (autoridad: "cnbv" | "sat", tipo: TipoPlazo, desde: string, dias: number) =>
      mx.sumarDiasHabiles({ calendario: m.calendario(autoridad, tipo), desde, dias });
    expect(sumar("cnbv", "general", "2026-12-23", 3).resultado).toBe("2026-12-29");
    const general = sumar("sat", "general", "2026-07-17", 3);
    expect(general.resultado).toBe("2026-08-05");
    expect(general.inhabiles_saltados.filter((d) => d.tipo === "vacaciones")).toHaveLength(12);
    const pagos = sumar("sat", "declaraciones_pagos", "2026-07-17", 3);
    expect(pagos.resultado).toBe("2026-07-22");
    expect(pagos.inhabiles_saltados).toEqual([]);
    expect(m.calendario("cnbv")).toBe(m.calendarioCurado("cnbv").general.calendario);
  });

  it("cita los fines de semana con la publicación de su año", () => {
    const c = m.calendario("cnbv");
    const sabado2025 = c.inhabil("2025-01-04");
    const sabado2026 = c.inhabil("2026-01-03");
    expect(sabado2025?.tipo).toBe("fin_de_semana");
    expect(sabado2025?.fuente.nombre).toContain("2025");
    expect(sabado2026?.fuente.nombre).toContain("2026");
  });

  it("feriadoBancario marca los días de descanso de la CNBV dentro de su calendario", () => {
    const curado = m.calendarioCurado("cnbv");
    const descansos = curado.dias.filter((d) => d.tipo === "descanso").map((d) => d.fecha);
    expect(descansos.length).toBeGreaterThan(0);
    for (const fecha of descansos) expect(m.feriadoBancario(fecha), fecha).toBe(true);
    // Un día hábil, un fin de semana y lo que el calendario no cubre no son feriados.
    expect(m.feriadoBancario("2026-07-15")).toBe(false);
    expect(m.feriadoBancario("2026-07-18")).toBe(false);
    const despues = `${Number(curado.amplia.hasta.slice(0, 4)) + 1}-01-01`;
    expect(m.feriadoBancario(despues)).toBe(false);
  });

  it("fuera de la cobertura lanza CalendarioIncompletoError", () => {
    const c = m.calendario("cnbv");
    const despues = `${Number(c.cobertura.hasta.slice(0, 4)) + 1}-01-02`;
    expect(() => c.inhabil(despues)).toThrow(mx.CalendarioIncompletoError);
  });

  it("con el SAT exige el tipo de plazo, con el texto de la API", () => {
    const texto = "Con autoridad=sat falta tipoPlazo: general o declaraciones_pagos.";
    // @ts-expect-error con el SAT el tipo de plazo es obligatorio
    expect(() => m.calendario("sat")).toThrow(TypeError);
    // @ts-expect-error con el SAT el tipo de plazo es obligatorio
    expect(() => m.calendario("sat")).toThrow(texto);
    expect(() => m.calendario("sat", undefined as unknown as TipoPlazo)).toThrow(texto);
    expect(m.calendario("sat", "general")).toBe(m.calendarioCurado("sat").general.calendario);
    // La CNBV solo tiene general: es el de omisión.
    expect(m.calendario("cnbv")).toBe(m.calendario("cnbv", "general"));
  });

  it("rechaza una autoridad o un plazo que no tiene", () => {
    expect(() => m.calendario("lft" as "cnbv")).toThrow(RangeError);
    // El texto del núcleo, el mismo que da quien arma un calendario curado.
    expect(() => m.calendario("lft" as "cnbv")).toThrow(
      "No hay calendario curado de la LFT: solo de la CNBV y del SAT.",
    );
    expect(() => m.calendarioCurado("toString" as "cnbv")).toThrow(RangeError);
    expect(() => m.calendario("cnbv", "declaraciones_pagos")).toThrow(
      "El calendario de la CNBV no tiene el tipo de plazo declaraciones_pagos.",
    );
  });

  it("está congelado", () => {
    for (const autoridad of ["cnbv", "sat"] as const) {
      const curado = m.calendarioCurado(autoridad);
      esperarCongelado(curado.dias, "dias");
      esperarCongelado(curado.meta, "meta");
      expect(Object.isFrozen(curado)).toBe(true);
      expect(Object.isFrozen(curado.plazos)).toBe(true);
      expect(Object.isFrozen(curado.general)).toBe(true);
    }
  });
}

export function probarConstantes(cargar: () => Promise<ModuloConstantes>): void {
  let m: ModuloConstantes;
  let umas: DesdeData<Uma>;
  let salarios: DesdeData<SalarioMinimo>;
  let tarifas: DesdeData<TarifaIsr>;

  beforeAll(async () => {
    m = await cargar();
    [umas, salarios, tarifas] = await Promise.all([
      desdeData<Uma>("constantes-uma"),
      desdeData<SalarioMinimo>("constantes-salario-minimo"),
      desdeData<TarifaIsr>("isr-tarifas"),
    ]);
  });

  it("exporta exactamente su API", () => {
    expect(Object.keys(m).sort()).toEqual([
      "anios",
      "meta",
      "salarioMinimo",
      "salariosMinimos",
      "tarifaIsr",
      "tarifasIsr",
      "uma",
      "umaVigente",
      "umas",
    ]);
  });

  it("trae los datos de data/ tal cual, con la meta de su manifest", () => {
    esperarIgualesAData(m.umas(), umas);
    esperarIgualesAData(m.salariosMinimos(), salarios);
    esperarIgualesAData(m.tarifasIsr(), tarifas);
    expect(m.meta).toEqual({
      uma: metaEsperada(umas),
      salarioMinimo: metaEsperada(salarios),
      isr: metaEsperada(tarifas),
    });
  });

  it("da los años de cada constante", () => {
    const ordenados = (lista: number[]) => [...new Set(lista)].sort((a, b) => a - b);
    expect(m.anios).toEqual({
      uma: ordenados(umas.registros.map((u) => u.anio)),
      salarioMinimo: ordenados(salarios.registros.map((s) => s.anio)),
      isr: {
        mensual: ordenados(
          tarifas.registros.filter((t) => t.periodo === "mensual").map((t) => t.anio),
        ),
        anual: ordenados(tarifas.registros.filter((t) => t.periodo === "anual").map((t) => t.anio)),
      },
    });
  });

  it("busca la UMA por año y la vigente en una fecha", () => {
    const primera = umas.registros[0] as Uma;
    const ultima = umas.registros.at(-1) as Uma;
    expect(m.uma(ultima.anio)).toBe(m.umas().at(-1));
    expect(m.uma(primera.anio - 1)).toBeUndefined();
    expect(m.umaVigente(`${ultima.anio}-02-01`)?.anio).toBe(ultima.anio);
    expect(m.umaVigente(`${ultima.anio}-01-31`)?.anio).toBe(ultima.anio - 1);
    expect(m.umaVigente(`${ultima.anio + 1}-01-31`)?.anio).toBe(ultima.anio);
    expect(m.umaVigente(`${ultima.anio + 1}-02-01`)).toBeUndefined();
    expect(m.umaVigente(`${primera.anio}-01-31`)).toBeUndefined();
    expect(m.umaVigente("2026-01-15")?.anio).toBe(2025);
    expect(() => m.umaVigente("15/01/2026")).toThrow(RangeError);
    // Una fecha con forma pero que no existe tampoco es válida.
    expect(() => m.umaVigente("2026-02-30")).toThrow(RangeError);
  });

  it("da el salario mínimo de un año por zona y la tarifa de ISR por periodo", () => {
    const anio = salarios.registros.at(-1)?.anio as number;
    expect(
      m
        .salarioMinimo(anio)
        .map((s) => s.zona)
        .sort(),
    ).toEqual(["general", "zlfn"]);
    expect(m.salarioMinimo(1900)).toEqual([]);
    for (const t of tarifas.registros) {
      expect(m.tarifaIsr(t.periodo, t.anio)).toEqual(t);
    }
    expect(m.tarifaIsr("mensual", 1900)).toBeUndefined();
  });

  it("está congelado", () => {
    esperarCongelado(m.umas(), "umas");
    esperarCongelado(m.salariosMinimos(), "salarios");
    esperarCongelado(m.tarifasIsr(), "tarifas");
    esperarCongelado(m.anios, "anios");
    esperarCongelado(m.meta, "meta");
    esperarCongelado(m.salarioMinimo(2026), "salario 2026");
  });
}
