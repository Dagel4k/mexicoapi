import { describe, expect, expectTypeOf, it } from "vitest";
import { TIPOS_DIA_CURADO, type TipoDiaCurado } from "../../src/datos/curados.js";
import { calendarioLft } from "../../src/dias-habiles/calendario.js";
import { diasDescansoCff } from "../../src/dias-habiles/cff.js";
import {
  crearCalendarioCurado,
  exigirCurada,
  plazoDe,
  sumarDiasHabilesCurado,
} from "../../src/dias-habiles/curados.js";
import { diasDescansoLft } from "../../src/dias-habiles/lft.js";
import { sumarDiasHabiles } from "../../src/dias-habiles/sumar.js";
import {
  AUTORIDADES,
  type Autoridad,
  DE_AUTORIDAD,
  NOMBRE_AUTORIDAD,
  nombreDe,
  SIGLAS_AUTORIDAD,
  TIPOS_PLAZO,
  type TipoPlazo,
} from "../../src/dias-habiles/tipos.js";
import { CalendarioIncompletoError } from "../../src/errores.js";
import * as core from "../../src/index.js";
import { FUENTE_CNBV_2025, SHARD_CNBV } from "./ejemplos-curados.js";

describe("catálogos de los calendarios", () => {
  it("las autoridades, los tipos de plazo y los tipos de día van en un arreglo congelado", () => {
    expect(AUTORIDADES).toEqual(["lft", "cnbv", "sat"]);
    expect(TIPOS_PLAZO).toEqual(["general", "declaraciones_pagos"]);
    expect(TIPOS_DIA_CURADO).toEqual(["descanso", "vacaciones"]);
    for (const lista of [AUTORIDADES, TIPOS_PLAZO, TIPOS_DIA_CURADO]) {
      expect(Object.isFrozen(lista)).toBe(true);
    }
  });

  it("los tipos salen de los arreglos", () => {
    expectTypeOf<Autoridad>().toEqualTypeOf<"lft" | "cnbv" | "sat">();
    expectTypeOf<TipoPlazo>().toEqualTypeOf<"general" | "declaraciones_pagos">();
    expectTypeOf<TipoDiaCurado>().toEqualTypeOf<"descanso" | "vacaciones">();
  });

  it("el índice exporta los catálogos y el nombre de cada autoridad", () => {
    expect(core.AUTORIDADES).toBe(AUTORIDADES);
    expect(core.TIPOS_PLAZO).toBe(TIPOS_PLAZO);
    expect(core.TIPOS_DIA_CURADO).toBe(TIPOS_DIA_CURADO);
    expect(core.NOMBRE_AUTORIDAD).toBe(NOMBRE_AUTORIDAD);
  });
});

describe("nombres de las autoridades", () => {
  it("con artículo, con de y en siglas, de un solo mapa", () => {
    expect(NOMBRE_AUTORIDAD).toEqual({ lft: "la LFT", cnbv: "la CNBV", sat: "el SAT" });
    expect(DE_AUTORIDAD).toEqual({ lft: "de la LFT", cnbv: "de la CNBV", sat: "del SAT" });
    expect(SIGLAS_AUTORIDAD).toEqual({ lft: "LFT", cnbv: "CNBV", sat: "SAT" });
    for (const mapa of [NOMBRE_AUTORIDAD, DE_AUTORIDAD, SIGLAS_AUTORIDAD]) {
      expect(Object.isFrozen(mapa)).toBe(true);
    }
  });

  it("nombreDe da el nombre de una autoridad conocida y el texto tal cual de otra", () => {
    expect(nombreDe("sat")).toBe("el SAT");
    expect(nombreDe("imss")).toBe("imss");
    expect(nombreDe("toString")).toBe("toString");
  });
});

// Las autoridades y los rangos se nombran igual en todos los mensajes (antes: "de sat",
// "entre 1 y 3650").
describe("mensajes del núcleo", () => {
  it("CalendarioIncompletoError nombra la autoridad y el rango como el detalle", () => {
    const error = new CalendarioIncompletoError("sat", "2031-02-03", {
      desde: "2030-01-01",
      hasta: "2031-01-31",
    });
    expect(error.message).toBe(
      "Calendario incompleto: el calendario del SAT no cubre 2031-02-03; cubre del 2030-01-01 al 2031-01-31.",
    );
  });

  it("los rangos de los parámetros se escriben de X a Y", () => {
    const lft = calendarioLft();
    expect(() => sumarDiasHabiles({ calendario: lft, desde: "2026-01-01", dias: 0 })).toThrow(
      new RangeError("Los días deben ser un entero de 1 a 3650: 0"),
    );
    expect(() => diasDescansoLft(2006)).toThrow(
      new RangeError("El año debe ser un entero de 2007 a 2100: 2006"),
    );
    expect(() => diasDescansoCff(2025)).toThrow(
      new RangeError("El año debe ser un entero de 2026 a 2100: 2025"),
    );
  });

  it("la advertencia de un año sin calendario usa las siglas", () => {
    const r = sumarDiasHabiles({
      calendario: calendarioLft(),
      desde: "2100-12-31",
      dias: 1,
      permitirIncompleto: true,
    });
    expect(r.advertencias[0]).toBe(
      "Calendario incompleto: LFT 2101; solo se descontaron fines de semana.",
    );
  });

  it("un calendario curado de otra autoridad nombra las que sí tienen", () => {
    const datos = {
      autoridad: "lft",
      plazos: {},
      fuentes_fin_de_semana: {},
      dias: [],
    } as unknown as Parameters<typeof crearCalendarioCurado>[0];
    expect(() => crearCalendarioCurado(datos)).toThrow(
      new RangeError("No hay calendario curado de la LFT: solo de la CNBV y del SAT."),
    );
  });

  it("los datos que no cumplen las reglas nombran la autoridad con su artículo", () => {
    const sinCitas = { ...SHARD_CNBV, fuentes_fin_de_semana: { 2025: FUENTE_CNBV_2025 } };
    expect(() => crearCalendarioCurado(sinCitas)).toThrow(
      new RangeError("El calendario de la CNBV no cita los fines de semana de 2026."),
    );
    expect(() =>
      sumarDiasHabilesCurado(crearCalendarioCurado(SHARD_CNBV), {
        tipoPlazo: "declaraciones_pagos",
        desde: "2026-07-15",
        dias: 1,
      }),
    ).toThrow(
      new RangeError("El calendario de la CNBV no tiene el tipo de plazo declaraciones_pagos."),
    );
  });

  it("exigirCurada y plazoDe dan los mismos textos a quien arma un calendario", () => {
    expect(() => exigirCurada("lft")).toThrow(
      new RangeError("No hay calendario curado de la LFT: solo de la CNBV y del SAT."),
    );
    expect(() => exigirCurada("__proto__")).toThrow(RangeError);
    expect(() => exigirCurada("sat")).not.toThrow();
    const cnbv = crearCalendarioCurado(SHARD_CNBV);
    expect(plazoDe(cnbv, "general")).toBe(cnbv.general);
    expect(() => plazoDe(cnbv, "declaraciones_pagos")).toThrow(
      new RangeError("El calendario de la CNBV no tiene el tipo de plazo declaraciones_pagos."),
    );
  });
});
