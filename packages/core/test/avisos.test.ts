import { describe, expect, it } from "vitest";
import {
  AVISO_SIN_API,
  type Aviso,
  avisosDe,
  CODIGOS_AVISO,
  CODIGOS_AVISO_API,
  type CodigoAviso,
  codigoAviso,
} from "../src/avisos.js";
import { calendarioLft, crearCalendario } from "../src/dias-habiles/calendario.js";
import { avisoTransmisionCff } from "../src/dias-habiles/cff.js";
import {
  avisoRespaldo,
  avisoVacacionesSinPublicar,
  crearCalendarioCurado,
  diasInhabilesCurados,
  feriadosBancarios,
  sumarDiasHabilesCurado,
} from "../src/dias-habiles/curados.js";
import { AVISO_LFT_715 } from "../src/dias-habiles/lft.js";
import { sumarDiasHabiles } from "../src/dias-habiles/sumar.js";
import { TIPOS_PLAZO } from "../src/dias-habiles/tipos.js";
import { sumarDias } from "../src/fechas.js";
import { diasInhabilesLft } from "../src/rutas/respuestas.js";
import { SHARD_CNBV, SHARD_SAT } from "./dias-habiles/ejemplos-curados.js";

const sat = crearCalendarioCurado(SHARD_SAT);
const cnbv = crearCalendarioCurado(SHARD_CNBV);
const feriadoBancario = feriadosBancarios(cnbv);

/** Los avisos de un resultado deben ser sus advertencias, en el mismo orden, con su código. */
function revisarParidad(r: { advertencias: readonly string[]; avisos: readonly Aviso[] }): void {
  expect(r.avisos.map((a) => a.texto)).toEqual(r.advertencias);
  for (const a of r.avisos) expect(a.codigo).toBe(codigoAviso(a.texto));
}

const codigos = (r: { avisos: readonly Aviso[] }): CodigoAviso[] => r.avisos.map((a) => a.codigo);

describe("CODIGOS_AVISO", () => {
  it("es una lista congelada, sin repetidos, en kebab-case y con otro al final", () => {
    expect(Object.isFrozen(CODIGOS_AVISO)).toBe(true);
    expect(new Set(CODIGOS_AVISO).size).toBe(CODIGOS_AVISO.length);
    for (const codigo of CODIGOS_AVISO) expect(codigo).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(CODIGOS_AVISO.at(-1)).toBe("otro");
  });

  it("es el catálogo de esta versión: cambiarlo es cambiar el contrato", () => {
    expect(CODIGOS_AVISO).toEqual([
      "calendario-incompleto",
      "tipo-plazo-incompleto",
      "lista-incompleta",
      "lft-art-715",
      "transmision-poder-ejecutivo",
      "prorroga-art-12",
      "vacaciones-sin-publicar",
      "api-fallo",
      "respuesta-guardada",
      "datos-viejos",
      "datos-del-paquete",
      "municipio-sin-inegi",
      "cp-varios-municipios",
      "aviso-de-uso-sepomex-distinto",
      "otro",
    ]);
  });
});

describe("CODIGOS_AVISO_API", () => {
  it("son los códigos que da la API: del catálogo, sin otro, congelados", () => {
    expect(Object.isFrozen(CODIGOS_AVISO_API)).toBe(true);
    expect(CODIGOS_AVISO_API).toEqual([
      "calendario-incompleto",
      "tipo-plazo-incompleto",
      "lista-incompleta",
      "lft-art-715",
      "transmision-poder-ejecutivo",
      "prorroga-art-12",
      "vacaciones-sin-publicar",
    ]);
    for (const codigo of CODIGOS_AVISO_API) expect(CODIGOS_AVISO).toContain(codigo);
  });
});

describe("codigoAviso con los textos que da el núcleo", () => {
  it("calendario-incompleto: un año sin calendario, con y sin lo que puede faltar", () => {
    const lft = sumarDiasHabiles({
      calendario: calendarioLft(),
      desde: "2100-12-30",
      dias: 3,
      permitirIncompleto: true,
    });
    expect(lft.advertencias[0]).toMatch(/^Calendario incompleto: LFT 2101;/);
    expect(codigos(lft)).toEqual(["calendario-incompleto", "lft-art-715"]);

    const deCnbv = sumarDiasHabilesCurado(cnbv, {
      tipoPlazo: "general",
      desde: "2026-12-30",
      dias: 3,
      permitirIncompleto: true,
    });
    expect(deCnbv.advertencias[0]).toContain("Pueden faltar días de cierre bancario");
    expect(codigos(deCnbv)).toEqual(["calendario-incompleto"]);

    const propio = sumarDiasHabiles({
      calendario: crearCalendario({
        autoridad: "sat",
        cobertura: { desde: "2026-01-01", hasta: "2026-12-31" },
        dias: [],
        fuenteFinDeSemana: { nombre: "SAT", url: "https://example.com/sat" },
      }),
      desde: "2026-12-30",
      dias: 3,
      permitirIncompleto: true,
    });
    expect(propio.advertencias).toEqual([
      "Calendario incompleto: SAT 2027; solo se descontaron fines de semana.",
    ]);
    expect(codigos(propio)).toEqual(["calendario-incompleto"]);
  });

  it("los que dan los cálculos y las listas llevan su código desde quien los da", () => {
    // Cada productor del núcleo devuelve { codigo, texto }: el código no sale del texto.
    expect(avisoTransmisionCff(2030)).toEqual({
      codigo: "transmision-poder-ejecutivo",
      texto: expect.stringMatching(/^En 2030 no se descuenta el 1o\. de octubre:/),
    });
    expect(
      avisoRespaldo("sat", "general", { desde: "2026-01-01", hasta: "2026-11-30" }, ["vacaciones"]),
    ).toEqual({
      codigo: "tipo-plazo-incompleto",
      texto: expect.stringMatching(/^Calendario incompleto: SAT con tipo_plazo=general/),
    });
    const publicadas = { desde: "2026-01-01", hasta: "2026-11-30" };
    expect(avisoVacacionesSinPublicar(publicadas, "2026-12-30")?.codigo).toBe(
      "vacaciones-sin-publicar",
    );
    expect(avisoVacacionesSinPublicar(publicadas, "2026-07-30")).toBeUndefined();
    const lista = diasInhabilesCurados(sat, 2030);
    expect(lista.avisos.map((a) => a.codigo)).toEqual([
      "lista-incompleta",
      "transmision-poder-ejecutivo",
    ]);
    expect(lista.advertencias).toEqual(lista.avisos.map((a) => a.texto));
    const lft = diasInhabilesLft(2026);
    expect(lft.avisos).toEqual([{ codigo: "lft-art-715", texto: AVISO_LFT_715 }]);
    expect(lft.advertencias).toEqual([AVISO_LFT_715]);
  });

  it("un calendario propio puede dar sus avisos con código, que se conserva", () => {
    const tribunal = {
      codigo: "lft-art-715" as const,
      texto: "Revisa las suspensiones del tribunal.",
    };
    const calendario = crearCalendario({
      autoridad: "lft",
      cobertura: { desde: "2026-01-01", hasta: "2027-12-31" },
      dias: [],
      fuenteFinDeSemana: { nombre: "Tribunal", url: "https://example.com/t" },
      avisos: () => [tribunal, "Un texto suelto."],
      respaldo: undefined,
    });
    const r = sumarDiasHabiles({ calendario, desde: "2026-12-18", dias: 1 });
    expect(r.avisos).toEqual([tribunal, { codigo: "otro", texto: "Un texto suelto." }]);
    expect(r.advertencias).toEqual([tribunal.texto, "Un texto suelto."]);
    // calendario.avisos sigue dando solo los textos, como en la 0.1.0.
    expect(calendario.avisos?.("2026-12-18", "2026-12-21")).toEqual([
      tribunal.texto,
      "Un texto suelto.",
    ]);
  });

  it("un código que no es del catálogo (desde JavaScript) sale del texto", () => {
    const calendario = crearCalendario({
      autoridad: "lft",
      cobertura: { desde: "2026-01-01", hasta: "2027-12-31" },
      dias: [],
      fuenteFinDeSemana: { nombre: "Tribunal", url: "https://example.com/t" },
      avisos: () =>
        [
          { codigo: "inventado", texto: AVISO_LFT_715 },
          { codigo: 5, texto: "Un texto suelto." },
          { texto: "Sin código." },
          { codigo: "otro", texto: AVISO_LFT_715 },
        ] as never,
    });
    const r = sumarDiasHabiles({ calendario, desde: "2026-12-18", dias: 1 });
    expect(r.avisos).toEqual([
      { codigo: "lft-art-715", texto: AVISO_LFT_715 },
      { codigo: "otro", texto: "Un texto suelto." },
      { codigo: "otro", texto: "Sin código." },
      // otro es del catálogo: se conserva.
      { codigo: "otro", texto: AVISO_LFT_715 },
    ]);
    const respaldo = crearCalendario({
      autoridad: "lft",
      cobertura: { desde: "2026-01-01", hasta: "2026-06-30" },
      dias: [],
      fuenteFinDeSemana: { nombre: "Tribunal", url: "https://example.com/t" },
      respaldo: {
        calendario,
        aviso: () => ({ codigo: "nuevo-codigo", texto: AVISO_LFT_715 }) as never,
      },
    });
    const conRespaldo = sumarDiasHabiles({
      calendario: respaldo,
      desde: "2026-06-30",
      dias: 1,
      permitirIncompleto: true,
    });
    expect(conRespaldo.avisos[0]).toEqual({ codigo: "lft-art-715", texto: AVISO_LFT_715 });
  });

  it("tipo-plazo-incompleto: el respaldo de un plazo más corto", () => {
    const r = sumarDiasHabilesCurado(sat, {
      tipoPlazo: "general",
      desde: "2026-11-30",
      dias: 2,
      permitirIncompleto: true,
    });
    expect(r.advertencias[0]).toMatch(/^Calendario incompleto: SAT con tipo_plazo=general/);
    expect(codigos(r)).toEqual(["tipo-plazo-incompleto"]);
    const cobertura = { desde: "2026-01-01", hasta: "2026-11-30" };
    for (const tipos of [["vacaciones"], ["descanso", "vacaciones"]] as const) {
      const { texto } = avisoRespaldo("sat", "general", cobertura, tipos);
      expect(codigoAviso(texto), texto).toBe("tipo-plazo-incompleto");
    }
  });

  it("lft-art-715: en cada cálculo y en cada lista de la LFT", () => {
    expect(codigoAviso(AVISO_LFT_715)).toBe("lft-art-715");
    const lista = diasInhabilesLft(2026);
    expect(avisosDe(lista.advertencias)).toEqual([{ codigo: "lft-art-715", texto: AVISO_LFT_715 }]);
  });

  it("transmision-poder-ejecutivo: en un cálculo y en la lista del SAT", () => {
    // Cada variante del texto: solo octubre (2030), las dos fechas (2036) y solo diciembre (2072).
    for (let anio = 2030; anio <= 2096; anio += 6) {
      const { texto } = avisoTransmisionCff(anio);
      expect(codigoAviso(texto), texto).toBe("transmision-poder-ejecutivo");
    }
    const r = sumarDiasHabilesCurado(sat, {
      tipoPlazo: "declaraciones_pagos",
      desde: "2030-09-30",
      dias: 3,
    });
    expect(codigos(r)).toContain("transmision-poder-ejecutivo");
    const lista = diasInhabilesCurados(sat, 2030);
    expect(avisosDe(lista.advertencias).map((a) => a.codigo)).toEqual([
      "lista-incompleta",
      "transmision-poder-ejecutivo",
    ]);
  });

  it("lista-incompleta: un año que el plazo general no cubre", () => {
    const { advertencias } = diasInhabilesCurados(sat, 2026);
    expect(advertencias).toHaveLength(1);
    expect(codigoAviso(advertencias[0] as string)).toBe("lista-incompleta");
  });

  it("prorroga-art-12: viernes, vacaciones del SAT y cierre bancario", () => {
    // 2026-07-16 + 1 es viernes; 2026-07-19 + 1, día de vacaciones; 2026-10-30 + 1, el 2 de
    // noviembre, cierre bancario.
    const casos = [
      ["2026-07-16", 1],
      ["2026-07-19", 1],
      ["2026-10-30", 1],
    ] as const;
    for (const [desde, dias] of casos) {
      const r = sumarDiasHabilesCurado(sat, {
        tipoPlazo: "declaraciones_pagos",
        desde,
        dias,
        feriadoBancario,
      });
      expect(codigos(r), desde).toEqual(["prorroga-art-12"]);
    }
  });

  it("vacaciones-sin-publicar: después y antes de las vacaciones publicadas", () => {
    const publicadas = { desde: "2026-01-01", hasta: "2026-11-30" };
    for (const fecha of ["2026-12-30", "2025-12-30"]) {
      const texto = avisoVacacionesSinPublicar(publicadas, fecha)?.texto as string;
      expect(codigoAviso(texto), fecha).toBe("vacaciones-sin-publicar");
    }
    const r = sumarDiasHabilesCurado(sat, {
      tipoPlazo: "declaraciones_pagos",
      desde: "2026-12-29",
      dias: 1,
    });
    expect(codigos(r)).toEqual(["vacaciones-sin-publicar"]);
  });

  it("datos-del-paquete: AVISO_SIN_API", () => {
    expect(codigoAviso(AVISO_SIN_API)).toBe("datos-del-paquete");
  });
});

describe("codigoAviso con otros textos", () => {
  it("da otro para un texto que no conoce, sin confundir uno parecido", () => {
    expect(codigoAviso("Revisa el calendario del tribunal.")).toBe("otro");
    expect(codigoAviso("")).toBe("otro");
    expect(codigoAviso(`  ${AVISO_SIN_API}`)).toBe("otro");
    expect(codigoAviso(AVISO_LFT_715.slice(1))).toBe("otro");
    expect(codigoAviso("Calendario incompleto: el mío.")).toBe("otro");
  });

  it("no lanza con algo que no es texto", () => {
    expect(codigoAviso(undefined as never)).toBe("otro");
    expect(codigoAviso(12 as never)).toBe("otro");
  });

  it("un calendario propio puede dar avisos que no tienen código", () => {
    const calendario = crearCalendario({
      autoridad: "lft",
      cobertura: { desde: "2026-01-01", hasta: "2027-12-31" },
      dias: [],
      fuenteFinDeSemana: { nombre: "Tribunal", url: "https://example.com/t" },
      avisos: () => ["Revisa las suspensiones del tribunal.", AVISO_LFT_715],
    });
    const r = sumarDiasHabiles({ calendario, desde: "2026-12-18", dias: 1 });
    expect(r.avisos).toEqual([
      { codigo: "otro", texto: "Revisa las suspensiones del tribunal." },
      { codigo: "lft-art-715", texto: AVISO_LFT_715 },
    ]);
  });
});

describe("avisos de los resultados del núcleo", () => {
  it("van justo después de advertencias, con los mismos textos en el mismo orden", () => {
    const r = sumarDiasHabiles({ calendario: calendarioLft(), desde: "2026-01-30", dias: 1 });
    expect(Object.keys(r)).toEqual([
      "autoridad",
      "desde",
      "dias",
      "resultado",
      "inhabiles_saltados",
      "advertencias",
      "avisos",
    ]);
    expect(r.avisos).toEqual([{ codigo: "lft-art-715", texto: AVISO_LFT_715 }]);
    const curado = sumarDiasHabilesCurado(sat, {
      tipoPlazo: "declaraciones_pagos",
      desde: "2026-12-29",
      dias: 1,
    });
    expect(Object.keys(curado).slice(-2)).toEqual(["advertencias", "avisos"]);
    revisarParidad(curado);
  });

  it("vacíos sin advertencias", () => {
    const r = sumarDiasHabilesCurado(cnbv, { tipoPlazo: "general", desde: "2026-10-30", dias: 1 });
    expect(r.advertencias).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("todo aviso que dan los cálculos y las listas tiene un código del catálogo", () => {
    // Fechas de partida a lo largo de las coberturas y sus bordes, con plazos cortos y largos.
    const desdes: string[] = [];
    for (let fecha = "2005-12-20"; fecha <= "2101-01-10"; fecha = sumarDias(fecha, 173)) {
      desdes.push(fecha);
    }
    desdes.push("2026-11-27", "2026-12-24", "2030-09-27", "2100-12-29", "2024-12-31");
    const vistos = new Set<CodigoAviso>();
    const revisar = (r: { advertencias: string[]; avisos: Aviso[] }) => {
      revisarParidad(r);
      for (const a of r.avisos) {
        expect(a.codigo, a.texto).not.toBe("otro");
        vistos.add(a.codigo);
      }
    };
    const calcular = (calcular: () => { advertencias: string[]; avisos: Aviso[] }) => {
      try {
        revisar(calcular());
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "CalendarioIncompletoError") throw error;
      }
    };
    for (const desde of desdes) {
      for (const dias of [1, 5, 40, 400]) {
        for (const permitirIncompleto of [false, true]) {
          calcular(() =>
            sumarDiasHabiles({ calendario: calendarioLft(), desde, dias, permitirIncompleto }),
          );
          calcular(() =>
            sumarDiasHabilesCurado(cnbv, { tipoPlazo: "general", desde, dias, permitirIncompleto }),
          );
          for (const tipoPlazo of TIPOS_PLAZO) {
            calcular(() =>
              sumarDiasHabilesCurado(sat, {
                tipoPlazo,
                desde,
                dias,
                permitirIncompleto,
                feriadoBancario,
              }),
            );
          }
        }
      }
    }
    for (let anio = 2007; anio <= 2100; anio++) {
      revisar(diasInhabilesLft(anio));
      if (anio >= 2026) revisar(diasInhabilesCurados(sat, anio));
    }
    expect([...vistos].sort()).toEqual(
      [
        "calendario-incompleto",
        "tipo-plazo-incompleto",
        "lista-incompleta",
        "lft-art-715",
        "transmision-poder-ejecutivo",
        "prorroga-art-12",
        "vacaciones-sin-publicar",
      ].sort(),
    );
  });
});
