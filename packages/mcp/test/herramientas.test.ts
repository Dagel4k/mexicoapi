import { describe, expect, it } from "vitest";
import {
  crearRegistro,
  ErrorHerramienta,
  type Herramienta,
  resultadoError,
} from "../src/herramientas.js";
import { eco, rechaza } from "./ayudas.js";

function variante(cambios: Record<string, unknown>): Herramienta {
  return { ...eco, ...cambios } as Herramienta;
}

describe("crearRegistro", () => {
  it("registra las herramientas por nombre con sus validadores", () => {
    const registro = crearRegistro([eco, rechaza]);
    expect([...registro.keys()]).toEqual(["eco", "rechaza"]);
    const registrada = registro.get("eco");
    expect(registrada?.definicion).toBe(eco);
    expect(registrada?.validarEntrada({ texto: "hola" })).toEqual([]);
    expect(registrada?.validarEntrada({})).toEqual(['falta "texto"']);
    expect(registrada?.validarSalida?.({ texto: 1 })).toEqual(['"texto" debe ser texto']);
  });

  it("no exige esquema de salida", () => {
    const registro = crearRegistro([variante({ outputSchema: undefined })]);
    expect(registro.get("eco")?.validarSalida).toBeNull();
  });

  it("acepta nombres de 1 a 128 caracteres con letras, dígitos, _, - y punto", () => {
    for (const name of ["a", "x".repeat(128), "getUser", "DATA_EXPORT_v2", "admin.tools-list"]) {
      expect(() => crearRegistro([variante({ name })])).not.toThrow();
    }
  });

  it.each([
    [{ name: "" }, 'nombre de herramienta inválido: ""'],
    [{ name: "x".repeat(129) }, "nombre de herramienta inválido"],
    [{ name: "con espacio" }, 'nombre de herramienta inválido: "con espacio"'],
    [{ name: "coma,no" }, "nombre de herramienta inválido"],
    [{ name: "ñandú" }, "nombre de herramienta inválido"],
    [{ title: "" }, "eco: falta title"],
    [{ description: " " }, "eco: falta description"],
    [
      { annotations: { readOnlyHint: false, openWorldHint: false } },
      "eco: debe ser de solo lectura",
    ],
    [
      { annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: true } },
      "eco: destructiveHint debe ser false o no estar",
    ],
    [
      { annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: "sí" } },
      "eco: idempotentHint debe ser booleano",
    ],
    [{ annotations: { readOnlyHint: true } }, "eco: openWorldHint debe ser booleano"],
    [{ inputSchema: { type: "string" } }, 'eco: inputSchema debe tener type "object"'],
    [{ inputSchema: { type: "object", oneOf: [] } }, "eco: inputSchema: #: palabra clave"],
    [{ outputSchema: { type: "array" } }, 'eco: outputSchema debe tener type "object"'],
    [{ outputSchema: { type: "object", $ref: "#" } }, "eco: outputSchema: #: palabra clave"],
    [{ ejecutar: "no" }, "eco: falta ejecutar"],
  ])("rechaza una definición inválida: %j", (cambios, mensaje) => {
    expect(() => crearRegistro([variante(cambios)])).toThrow(mensaje);
  });

  it("rechaza nombres repetidos", () => {
    expect(() => crearRegistro([eco, eco])).toThrow("herramienta repetida: eco");
  });
});

describe("ErrorHerramienta", () => {
  it("es un Error con nombre propio y el mensaje tal cual", () => {
    const error = new ErrorHerramienta("CLABE con letras.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ErrorHerramienta");
    expect(error.message).toBe("CLABE con letras.");
  });
});

describe("resultadoError", () => {
  it("arma un resultado de herramienta con isError", () => {
    expect(resultadoError("Fecha imposible: 2024-02-30.")).toEqual({
      content: [{ type: "text", text: "Fecha imposible: 2024-02-30." }],
      isError: true,
    });
  });
});
