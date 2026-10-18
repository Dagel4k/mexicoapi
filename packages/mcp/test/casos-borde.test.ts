// Respuestas raras pero válidas, con un cliente de prueba: lo que el paquete de hoy no trae y una
// versión futura de la API o de los datos podría traer.
import type { Cliente } from "mexicoapi/cliente";
import { beforeAll, describe, expect, it } from "vitest";
import { crearHerramientas } from "../src/catalogo.js";
import { conectar } from "./ayudas.js";
import { contenido, type Llamador, servidor, texto } from "./ayudas-herramientas.js";

const META = {
  dataset: "prueba",
  as_of: "2026-10-17",
  sources: [
    { name: "Fuente", url: "https://fuente.prueba", license: "", license_url: "", citation: "" },
  ],
  docs: "",
};

const responde = (data: unknown) => async () => ({
  data,
  meta: META,
  origen: "paquete",
  advertencias: [],
});

const BANCO = {
  codigo: "777",
  codigo_spei: "40777",
  nombre_corto: "NUEVO",
  razon_social: null,
  sector: null,
  tipo: "otra_entidad",
  participacion: "indirecta",
  activo: false,
  baja_detectada: null,
  historial: [
    { codigo_spei: "40777", nombre_corto: "ANTERIOR", desde: "2020-01-01", hasta: null },
    { codigo_spei: "40777", nombre_corto: "NUEVO", desde: "2021-01-01", hasta: null },
  ],
};

let llamar: Llamador;

beforeAll(async () => {
  const cliente = {
    banco: (codigo: string) =>
      responde(codigo === "777" ? BANCO : { ...BANCO, codigo, activo: true, historial: [] })(),
    clabe: responde({
      valor: "999010077777777772",
      valido: false,
      formato_valido: false,
      digito_verificador_valido: false,
      errores: ["banco", "digito_verificador"],
      nota: "Nota.",
      detalle: null,
    }),
    municipio: responde({
      cvegeo: "99001",
      cve_ent: "99",
      cve_mun: "001",
      nombre: "Sin estado",
      cve_cabecera: null,
    }),
  } as unknown as Cliente;
  llamar = await servidor(crearHerramientas({ cliente, conApi: false }));
});

describe("respuestas raras", () => {
  it("una CLABE con varios errores los lista todos en el texto", async () => {
    const t = texto(await llamar("validar_clabe", { clabe: "999010077777777772" }));
    expect(t).toContain(
      "CLABE inválida: el código de banco 999 no está en el catálogo, el dígito verificador no coincide.",
    );
  });

  it("un banco inactivo sin fecha de baja, con otra participación y un nombre anterior abierto", async () => {
    const t = texto(await llamar("banco_por_codigo", { codigo: "777" }));
    expect(t).toContain("777 NUEVO\n");
    expect(t).toContain("Ya no aparece en el SPEI; clave SPEI 40777.");
    expect(t).toContain("Nombres anteriores: ANTERIOR (2020-01-01 a hoy).");
    const activo = texto(await llamar("banco_por_codigo", { codigo: "778" }));
    expect(activo).toContain("Activo en el SPEI, indirecta, clave SPEI 40777.");
    expect(activo).not.toContain("Nombres anteriores");
  });

  it("un municipio de un estado que el paquete no conoce queda sin nombre de estado", async () => {
    const r = await llamar("municipio", { cvegeo: "99001" });
    expect(contenido(r).datos).toMatchObject({ estado: "" });
  });
});

describe("defectos del paquete", () => {
  it("un TypeError del cliente es error interno, registrado sin argumentos ni mensaje", async () => {
    const cliente = {
      udi: async () => {
        throw new TypeError("defecto con SECRETO");
      },
    } as unknown as Cliente;
    const conexion = conectar({ herramientas: crearHerramientas({ cliente, conApi: false }) });
    await conexion.inicializar();
    const respuesta = await conexion.pedir("tools/call", {
      name: "udis",
      arguments: { fecha: "2026-10-01" },
    });
    expect(respuesta.error).toEqual({ code: -32603, message: "Error interno" });
    const registros = conexion.registros.join("\n");
    expect(registros).toContain("TypeError");
    expect(registros).not.toContain("SECRETO");
    expect(registros).not.toContain("2026-10-01");
  });
});
