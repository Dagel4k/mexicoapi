import { meta } from "mexicoapi/datos";
import { beforeAll, describe, expect, it } from "vitest";
import {
  contenido,
  esError,
  herramientasSinTocarRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";

const BANXICO = meta.bancos.sources.map((f) => ({ nombre: f.name, url: f.url }));
const VALIDADORES = {
  nombre: "MéxicoAPI, validadores de formato y dígito verificador",
  url: "https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#validadores",
};

let llamar: Llamador;
let urls: string[];

beforeAll(async () => {
  // La CLABE y los bancos nunca salen a la red, aunque haya base.
  const conApi = herramientasSinTocarRed();
  urls = conApi.urls;
  llamar = await servidor(conApi.herramientas);
});

describe("validar_clabe", () => {
  it("valida dígito de control y banco con el catálogo del paquete, sin red", async () => {
    const r = await llamar("validar_clabe", { clabe: "002010077777777771" });
    const c = contenido(r);
    expect(c.datos).toMatchObject({
      valor: "002010077777777771",
      valido: true,
      formato_valido: true,
      digito_verificador_valido: true,
      errores: [],
      detalle: {
        codigo_banco: "002",
        codigo_plaza: "010",
        cuenta: "07777777777",
        digito_control: "1",
        banco: { codigo: "002", nombre_corto: "BANAMEX", activo: true },
        plaza: null,
      },
    });
    expect(c).toMatchObject({
      as_of: meta.bancos.as_of,
      fuente: BANXICO[0],
      fuentes: [...BANXICO, VALIDADORES],
      origen: "paquete",
      advertencias: [],
    });
    expect(texto(r)).toContain(
      "CLABE válida: banco 002 BANAMEX (activo en el SPEI), plaza 010, cuenta 07777777777, dígito de control 1.",
    );
    expect(texto(r)).toContain("Valida formato y dígito verificador");
    expect(urls).toEqual([]);
  });

  it("acepta espacios y guiones entre los dígitos", async () => {
    const r = contenido(await llamar("validar_clabe", { clabe: " 002 010-07777777777 1 " }));
    expect(r.datos).toMatchObject({ valor: "002010077777777771", valido: true });
  });

  it("un dígito de control incorrecto da valido: false, no error", async () => {
    const r = await llamar("validar_clabe", { clabe: "002010077777777772" });
    expect(contenido(r).datos).toMatchObject({
      valido: false,
      formato_valido: true,
      digito_verificador_valido: false,
      errores: ["digito_verificador"],
    });
    expect(texto(r)).toContain("CLABE inválida: el dígito verificador no coincide.");
  });

  it("un banco que no existe da valido: false con el motivo", async () => {
    const r = await llamar("validar_clabe", { clabe: "999010077777777771" });
    expect(contenido(r).datos).toMatchObject({ valido: false, errores: ["banco"], detalle: null });
    expect(texto(r)).toContain("CLABE inválida: el código de banco 999 no está en el catálogo.");
  });

  it("un banco dado de baja sigue siendo válido y lo dice", async () => {
    // 032 (IXE) ya no participa en el SPEI.
    const r = await llamar("validar_clabe", { clabe: "032180000118359719" });
    const datos = contenido(r).datos as {
      valido: boolean;
      detalle: { banco: { activo: boolean } };
    };
    expect(datos.detalle.banco.activo).toBe(false);
    expect(texto(r)).toContain("(ya no aparece en el SPEI)");
  });

  it("una CLABE con letras o de otra longitud es error de la herramienta y no la repite", async () => {
    for (const clabe of ["00201007777777777A", "0020100777777777", "0020100777777777711", "---"]) {
      const r = await llamar("validar_clabe", { clabe });
      esError(
        r,
        // La regla de la API, la misma del cliente (antes el MCP tenía su propio texto).
        "[parametro-invalido] La CLABE debe tener 18 dígitos.",
      );
    }
    for (const args of [
      {},
      { clabe: "" },
      { clabe: 2010077777777771 },
      { clabe: "1".repeat(65) },
    ]) {
      esError(
        await llamar("validar_clabe", args),
        /^\[parametro-invalido\] Argumentos inválidos para validar_clabe: /,
      );
    }
  });
});

describe("banco_por_codigo", () => {
  it("devuelve el banco con su historial, del paquete y sin red", async () => {
    const r = await llamar("banco_por_codigo", { codigo: "012" });
    const c = contenido(r);
    expect(c.datos).toMatchObject({
      codigo: "012",
      nombre_corto: "BBVA MEXICO",
      activo: true,
      participacion: "directa",
    });
    expect(c).toMatchObject({
      as_of: meta.bancos.as_of,
      fuente: BANXICO[0],
      fuentes: BANXICO,
      origen: "paquete",
    });
    const t = texto(r);
    expect(t).toContain("012 BBVA MEXICO: BBVA México, S.A.");
    expect(t).toContain("Activo en el SPEI, participante directo, clave SPEI 40012.");
    expect(t).toContain("Nombres anteriores: BBVA BANCOMER (2010-01-01 a 2021-12-01).");
    expect(urls).toEqual([]);
  });

  it("dice si un banco ya no está activo", async () => {
    const t = texto(await llamar("banco_por_codigo", { codigo: "032" }));
    expect(t).toMatch(/Ya no aparece en el SPEI/);
  });

  it("un código que no existe es error; uno mal formado, de argumentos", async () => {
    esError(
      await llamar("banco_por_codigo", { codigo: "999" }),
      "[no-encontrado] No existe el banco 999.",
    );
    for (const codigo of ["12", "0123", "abc"]) {
      esError(
        await llamar("banco_por_codigo", { codigo }),
        /^\[parametro-invalido\] Argumentos inválidos para banco_por_codigo: /,
      );
    }
  });
});
