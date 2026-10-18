import { calendarioCurado } from "mexicoapi/datos/calendarios";
import { beforeAll, describe, expect, it } from "vitest";
import {
  apiOk,
  apiProblema,
  BASE,
  contenido,
  esError,
  herramientasConApi,
  herramientasSinRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";

const LFT_74 = {
  nombre: "Ley Federal del Trabajo, artículo 74",
  url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
};

// Sin API el servidor responde con los calendarios del paquete. Lo que depende de su cobertura
// (conteos, años y fechas del borde) sale de esos datos: capturar el segundo periodo de
// vacaciones del SAT o el año siguiente no rompe estas pruebas.
const SAT = calendarioCurado("sat");
const SAT_2026 = SAT.dias.filter((d) => d.fecha.startsWith("2026-"));
/** Mientras falten vacaciones del SAT de 2026, general termina antes y la lista lo advierte. */
const SAT_GENERAL_CORTO = SAT.general.cobertura.hasta < "2026-12-31";
const siguiente = (fecha: string): string =>
  new Date(Date.parse(fecha) + 86_400_000).toISOString().slice(0, 10);

/** El aviso fijo de toda respuesta lft, el mismo que da la API. */
const AVISO_LFT =
  "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; no incluye los días en que las autoridades laborales suspenden labores (art. 715), como la Semana Santa o sus vacaciones. Revisa el calendario del tribunal o del centro de conciliación.";

let llamar: Llamador;

beforeAll(async () => {
  llamar = await servidor(herramientasSinRed());
});

describe("dias_inhabiles", () => {
  it("lista los de la LFT de un año, con la fuente de cada día", async () => {
    const r = await llamar("dias_inhabiles", { autoridad: "lft", anio: 2026 });
    const c = contenido(r);
    const dias = c.datos as Array<{ fecha: string; tipo: string }>;
    expect(dias.map((d) => d.fecha)).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
    expect(c).toMatchObject({ fuente: LFT_74, fuentes: [LFT_74], origen: "paquete" });
    // Sin API los calendarios no avisan de antigüedad (fuera de su cobertura responden error, no
    // un dato viejo); la LFT sí da su aviso fijo de lo que no incluye (art. 715).
    expect(c.advertencias).toEqual([AVISO_LFT]);
    const t = texto(r);
    expect(t).toContain(`Advertencia: ${AVISO_LFT}`);
    expect(t).toContain("7 días inhábiles de 2026 según la LFT, sin contar sábados y domingos:");
    expect(t).toContain("- 2026-12-25 25 de diciembre (descanso)");
  });

  it("del SAT trae las fuentes de sus días y la advertencia de la lista incompleta", async () => {
    const r = await llamar("dias_inhabiles", { autoridad: "sat", anio: 2026 });
    const c = contenido(r);
    expect(SAT_2026.length).toBeGreaterThan(0);
    expect(c.datos).toEqual(SAT_2026);
    const fuentes = c.fuentes as Array<{ nombre: string }>;
    expect(fuentes.length).toBeGreaterThan(1);
    expect(fuentes.map((f) => f.nombre)).toContain("Código Fiscal de la Federación, artículo 12");
    const { desde, hasta } = SAT.general.cobertura;
    const aviso = `Los días de tipo vacaciones del SAT solo están completos del ${desde} al ${hasta}; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa.`;
    expect(c.advertencias).toEqual(SAT_GENERAL_CORTO ? [aviso] : []);
    const t = texto(r);
    expect(t.includes(`Advertencia: ${aviso}`)).toBe(SAT_GENERAL_CORTO);
    expect(t).toContain(`${SAT_2026.length} días inhábiles de 2026 según el SAT`);
    expect(t).toContain("(vacaciones)");
  });

  it("un año fuera del calendario es error con el texto de la API", async () => {
    const { amplia } = SAT;
    const fuera = Number(amplia.hasta.slice(0, 4)) + 1;
    esError(
      await llamar("dias_inhabiles", { autoridad: "sat", anio: fuera }),
      `El calendario del SAT no cubre el año ${fuera}; cubre del ${amplia.desde} al ${amplia.hasta}.`,
    );
    for (const args of [
      { autoridad: "lft" },
      { anio: 2026 },
      { autoridad: "imss", anio: 2026 },
      { autoridad: "lft", anio: 0 },
      { autoridad: "lft", anio: 999 },
      { autoridad: "lft", anio: 10000 },
      { autoridad: "lft", anio: "2026" },
    ]) {
      esError(await llamar("dias_inhabiles", args), /^Argumentos inválidos para dias_inhabiles: /);
    }
  });

  it("con la API usa sus días y sus advertencias de primer nivel", async () => {
    const dia = {
      fecha: "2027-01-01",
      motivo: "1 de enero",
      tipo: "descanso",
      fuente: { nombre: "Fuente del día", url: "https://dia.prueba" },
    };
    const { herramientas, urls } = herramientasConApi(() =>
      apiOk([dia], { advertencias: ["Lista incompleta según la API."] }),
    );
    const c = contenido(
      await (await servidor(herramientas))("dias_inhabiles", { autoridad: "cnbv", anio: 2027 }),
    );
    expect(c).toMatchObject({
      datos: [dia],
      fuentes: [{ nombre: "Fuente del día", url: "https://dia.prueba" }],
      origen: "api",
      advertencias: ["Lista incompleta según la API."],
    });
    expect(urls).toEqual([`${BASE}/v1/dias-inhabiles?autoridad=cnbv&anio=2027`]);
  });

  it("sin días en la respuesta, cita las fuentes del meta", async () => {
    const { herramientas } = herramientasConApi(() => apiOk([]));
    const r = await (await servidor(herramientas))("dias_inhabiles", {
      autoridad: "cnbv",
      anio: 2027,
    });
    expect(contenido(r).fuentes).toEqual([
      { nombre: "Fuente según la API", url: "https://fuente.prueba" },
    ]);
    expect(texto(r)).toContain(
      "Ningún día inhábil de 2027 según la CNBV, sin contar sábados y domingos.",
    );
  });
});

describe("sumar_dias_habiles", () => {
  it("suma días hábiles de la LFT y lista los inhábiles saltados", async () => {
    const r = await llamar("sumar_dias_habiles", {
      autoridad: "lft",
      desde: "2026-12-23",
      dias: 3,
    });
    const c = contenido(r);
    expect(c.datos).toMatchObject({
      autoridad: "lft",
      desde: "2026-12-23",
      dias: 3,
      resultado: "2026-12-29",
      inhabiles_saltados: [{ fecha: "2026-12-25", tipo: "descanso" }],
      advertencias: [AVISO_LFT],
    });
    // Sin API los calendarios no avisan de antigüedad; la LFT sí da su aviso fijo (art. 715).
    expect(c.advertencias).toEqual([AVISO_LFT]);
    const t = texto(r);
    expect(t).toContain(`Advertencia: ${AVISO_LFT}`);
    expect(t).toContain("2026-12-23 + 3 días hábiles según la LFT: 2026-12-29.");
    expect(t).toContain("Inhábiles saltados (sin contar sábados y domingos):");
    expect(t).toContain("- 2026-12-25 25 de diciembre (descanso)");
  });

  it("sin inhábiles de por medio lo dice", async () => {
    const r = await llamar("sumar_dias_habiles", {
      autoridad: "lft",
      desde: "2026-12-18",
      dias: 1,
    });
    expect(contenido(r).datos).toMatchObject({ resultado: "2026-12-21", inhabiles_saltados: [] });
    expect(texto(r)).toContain("2026-12-18 + 1 día hábil según la LFT: 2026-12-21.");
    expect(texto(r)).toContain("No hubo días inhábiles de por medio, salvo sábados y domingos.");
  });

  it("con el SAT exige tipo_plazo y lo distingue", async () => {
    const general = await llamar("sumar_dias_habiles", {
      autoridad: "sat",
      tipo_plazo: "general",
      desde: "2026-07-17",
      dias: 3,
    });
    expect(contenido(general).datos).toMatchObject({ resultado: "2026-08-05" });
    expect(texto(general)).toContain(
      "2026-07-17 + 3 días hábiles según el SAT (tipo_plazo general): 2026-08-05.",
    );
    const pagos = await llamar("sumar_dias_habiles", {
      autoridad: "sat",
      tipo_plazo: "declaraciones_pagos",
      desde: "2026-07-17",
      dias: 3,
    });
    expect(contenido(pagos).datos).toMatchObject({
      resultado: "2026-07-22",
      inhabiles_saltados: [],
    });
    esError(
      await llamar("sumar_dias_habiles", { autoridad: "sat", desde: "2026-07-17", dias: 3 }),
      "Con autoridad=sat falta el parámetro tipo_plazo: general o declaraciones_pagos.",
    );
    esError(
      await llamar("sumar_dias_habiles", {
        autoridad: "cnbv",
        tipo_plazo: "general",
        desde: "2026-07-17",
        dias: 3,
      }),
      "El parámetro tipo_plazo solo se acepta con autoridad=sat.",
    );
  });

  it("fuera de la cobertura es error, salvo con permitir_incompleto, que lo advierte", async () => {
    const desde = SAT.general.cobertura.hasta;
    const args = { autoridad: "sat", tipo_plazo: "general", desde, dias: 20 };
    esError(
      await llamar("sumar_dias_habiles", args),
      new RegExp(`^El calendario del SAT para tipo_plazo=general no cubre ${siguiente(desde)}; `),
    );
    const r = await llamar("sumar_dias_habiles", { ...args, permitir_incompleto: true });
    const c = contenido(r);
    const datos = c.datos as { resultado: string; advertencias: string[] };
    // Con permitir_incompleto también descuenta los días publicados después de la cobertura (el
    // respaldo). Lo esperado se cuenta aquí, sin el núcleo: 20 días después de `desde` que no son
    // sábado, domingo ni un día publicado del SAT (general los cuenta todos).
    const publicados = new Set(SAT.dias.map((d) => d.fecha));
    let esperado = desde;
    for (let contados = 0; contados < 20; ) {
      esperado = siguiente(esperado);
      const dia = new Date(`${esperado}T00:00:00Z`).getUTCDay();
      if (dia !== 0 && dia !== 6 && !publicados.has(esperado)) contados++;
    }
    expect(datos.resultado).toBe(esperado);
    expect(datos.advertencias).toHaveLength(1);
    expect(c.advertencias).toEqual([datos.advertencias[0]]);
    expect(texto(r)).toContain(`Advertencia: ${datos.advertencias[0]}`);
    esError(
      await llamar("sumar_dias_habiles", { autoridad: "lft", desde: "2100-12-30", dias: 3 }),
      "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
    );
  });

  it("rechaza argumentos mal formados", async () => {
    for (const args of [
      { autoridad: "lft", desde: "2026-02-30", dias: 3 },
      { autoridad: "lft", desde: "2026-12-18", dias: 0 },
      { autoridad: "lft", desde: "2026-12-18", dias: 3651 },
      { autoridad: "lft", desde: "2026-12-18" },
      { desde: "2026-12-18", dias: 3 },
      { autoridad: "lft", desde: "2026-12-18", dias: 3, permitir_incompleto: "sí" },
      { autoridad: "sat", tipo_plazo: "anual", desde: "2026-12-18", dias: 3 },
    ]) {
      esError(
        await llamar("sumar_dias_habiles", args),
        /^Argumentos inválidos para sumar_dias_habiles: /,
      );
    }
  });

  it("con la API manda los nombres de la API y cita el calendario", async () => {
    const calculo = {
      autoridad: "sat",
      desde: "2026-07-17",
      dias: 3,
      resultado: "2026-08-05",
      inhabiles_saltados: [],
      advertencias: [],
    };
    const { herramientas, urls } = herramientasConApi(() => apiOk(calculo));
    const c = contenido(
      await (await servidor(herramientas))("sumar_dias_habiles", {
        autoridad: "sat",
        tipo_plazo: "general",
        desde: "2026-07-17",
        dias: 3,
        permitir_incompleto: false,
      }),
    );
    expect(c).toMatchObject({ datos: calculo, origen: "api", advertencias: [] });
    expect(urls).toEqual([
      `${BASE}/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-17&dias=3&permitir_incompleto=false`,
    ]);
  });

  it("un 422 de la API queda como error con su detalle", async () => {
    const { herramientas } = herramientasConApi(() =>
      apiProblema(422, "calendario-incompleto", "El calendario de la CNBV no cubre 2027-01-01."),
    );
    esError(
      await (await servidor(herramientas))("sumar_dias_habiles", {
        autoridad: "cnbv",
        desde: "2026-12-30",
        dias: 3,
      }),
      "El calendario de la CNBV no cubre 2027-01-01.",
    );
  });
});
