import { describe, expect, it } from "vitest";
import {
  crearRegistro,
  ErrorHerramienta,
  type Herramienta,
  resultadoError,
  SIN_CONEXION,
  textoDeError,
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
    [
      { inputSchema: { type: "object", additionalProperties: false, anyOf: [] } },
      "eco: inputSchema: #: palabra clave no soportada: anyOf",
    ],
    [
      { inputSchema: { type: "object" } },
      "eco: inputSchema debe tener additionalProperties: false",
    ],
    [
      { inputSchema: { type: "object", additionalProperties: true } },
      "eco: inputSchema debe tener additionalProperties: false",
    ],
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

// Todo error de herramienta empieza con su tipo de problema, como los de la API: así el modelo
// distingue sin leer el español un dato que llegará después de uno que no existe.
describe("ErrorHerramienta", () => {
  it("es un Error con nombre propio, su tipo y el texto con el tipo al inicio", () => {
    const error = new ErrorHerramienta("parametro-invalido", "CLABE con letras.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ErrorHerramienta");
    expect(error.tipo).toBe("parametro-invalido");
    expect(error.detalle).toBe("CLABE con letras.");
    expect(error.message).toBe("[parametro-invalido] CLABE con letras.");
  });
});

describe("resultadoError", () => {
  it("arma un resultado de herramienta con isError y el tipo al inicio del texto", () => {
    expect(resultadoError("parametro-invalido", "Fecha imposible: 2024-02-30.")).toEqual({
      content: [{ type: "text", text: "[parametro-invalido] Fecha imposible: 2024-02-30." }],
      isError: true,
    });
  });
});

describe("textoDeError", () => {
  it("pone el detalle en una línea, después del tipo", () => {
    expect(textoDeError("no-encontrado", "No existe\nel banco.")).toBe(
      "[no-encontrado] No existe el banco.",
    );
  });

  it("sin tipo, o con uno de otra forma, usa error-interno", () => {
    expect(textoDeError(undefined, "La respuesta no es JSON.")).toBe(
      "[error-interno] La respuesta no es JSON.",
    );
    expect(textoDeError("raro tipo]", "Detalle.")).toBe("[error-interno] Detalle.");
  });

  it("sin conexión con la API usa su propio tipo, que no es de la API", () => {
    expect(SIN_CONEXION).toBe("sin-conexion");
    expect(textoDeError(SIN_CONEXION, "No se pudo conectar con la API.")).toBe(
      "[sin-conexion] No se pudo conectar con la API.",
    );
  });
});
