import { beforeAll, describe, expect, it } from "vitest";
import {
  contenido,
  esError,
  herramientasSinTocarRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";

const VALIDADORES = {
  nombre: "MéxicoAPI, validadores de formato y dígito verificador",
  url: "https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#validadores",
};

const PROCEDENCIA = {
  as_of: null,
  fuente: VALIDADORES,
  fuentes: [VALIDADORES],
  origen: "paquete",
  advertencias: [],
};

let llamar: Llamador;
let urls: string[];

beforeAll(async () => {
  const conApi = herramientasSinTocarRed();
  urls = conApi.urls;
  llamar = await servidor(conApi.herramientas);
});

describe("validar_rfc", () => {
  it("valida un RFC genérico, sin fecha de datos porque es un algoritmo", async () => {
    const r = await llamar("validar_rfc", { rfc: "xaxx010101000" });
    expect(contenido(r)).toEqual({
      datos: {
        valor: "XAXX010101000",
        valido: true,
        formato_valido: true,
        digito_verificador_valido: true,
        errores: [],
        nota: expect.stringContaining("no confirma que exista"),
        detalle: { tipo: "generico", fecha_yymmdd: "010101", homoclave: "000" },
      },
      ...PROCEDENCIA,
    });
    expect(texto(r)).toContain("RFC válido: genérico, fecha 010101 (AAMMDD), homoclave 000.");
    expect(texto(r)).toContain("as_of: no aplica (validación por algoritmo, sin datos publicados)");
    expect(urls).toEqual([]);
  });

  it("el dígito verificador del RFC es informativo: se reporta sin invalidarlo", async () => {
    const r = await llamar("validar_rfc", { rfc: "GODE561231GR9" });
    expect(contenido(r).datos).toMatchObject({
      valido: true,
      digito_verificador_valido: false,
      errores: ["digito_verificador"],
      detalle: { tipo: "fisica" },
    });
    expect(texto(r)).toContain("RFC válido: persona física");
    expect(texto(r)).toContain(
      "El dígito verificador no coincide; en el RFC es informativo y no lo invalida.",
    );
  });

  it("una fecha imposible da valido: false con el motivo", async () => {
    const r = await llamar("validar_rfc", { rfc: "GODE561331GR8" });
    expect(contenido(r).datos).toMatchObject({ valido: false, errores: ["fecha"] });
    expect(texto(r)).toContain("RFC inválido: la fecha no existe.");
  });

  it("un RFC vacío o solo con espacios es error", async () => {
    esError(await llamar("validar_rfc", { rfc: "   " }), "El RFC está vacío.");
    esError(await llamar("validar_rfc", { rfc: "" }), /^Argumentos inválidos para validar_rfc: /);
    esError(await llamar("validar_rfc", {}), /^Argumentos inválidos para validar_rfc: /);
  });
});

describe("validar_curp", () => {
  it("valida estructura, fecha, sexo, entidad y dígito", async () => {
    const r = await llamar("validar_curp", { curp: "HEGG560427MVZRRL04" });
    expect(contenido(r)).toMatchObject({
      datos: {
        valido: true,
        detalle: {
          fecha: "1956-04-27",
          sexo: "M",
          entidad: "VZ",
          nombre_entidad: "Veracruz",
          diferenciador: "0",
        },
      },
      ...PROCEDENCIA,
    });
    expect(texto(r)).toContain(
      "CURP válida: nacimiento 1956-04-27, sexo M, entidad VZ (Veracruz).",
    );
  });

  it("un dígito incorrecto da valido: false", async () => {
    const r = await llamar("validar_curp", { curp: "HEGG560427MVZRRL05" });
    expect(contenido(r).datos).toMatchObject({ valido: false, errores: ["digito_verificador"] });
    expect(texto(r)).toContain("CURP inválida: el dígito verificador no coincide.");
  });

  it("una CURP vacía es error", async () => {
    esError(await llamar("validar_curp", { curp: " \t" }), "La CURP está vacía.");
  });
});

describe("validar_nss", () => {
  it("valida los 11 dígitos y el dígito de Luhn", async () => {
    const r = await llamar("validar_nss", { nss: "1234567890-3" });
    expect(contenido(r)).toMatchObject({
      datos: { valor: "12345678903", valido: true, detalle: null },
      ...PROCEDENCIA,
    });
    expect(texto(r)).toContain("NSS válido.");
  });

  it("letras o longitud incorrecta dan valido: false con el motivo", async () => {
    const letras = await llamar("validar_nss", { nss: "1234567890A" });
    expect(contenido(letras).datos).toMatchObject({ valido: false, errores: ["caracteres"] });
    expect(texto(letras)).toContain("NSS inválido: tiene caracteres no permitidos.");
    const corto = await llamar("validar_nss", { nss: "123" });
    expect(texto(corto)).toContain("NSS inválido: no tiene la longitud correcta.");
  });

  it("un NSS vacío es error", async () => {
    esError(await llamar("validar_nss", { nss: "--" }), "El NSS está vacío.");
  });
});
