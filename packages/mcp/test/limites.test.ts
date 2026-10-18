// Entradas válidas para el esquema pero en los extremos: cada una debe dar un resultado o un error
// de la herramienta, nunca un error interno (-32603). Un TypeError o RangeError del paquete con
// argumentos ya validados sería un defecto, y `servidor` falla si la respuesta es un error JSON-RPC.
import { beforeAll, describe, expect, it } from "vitest";
import { herramientasSinRed, type Llamador, servidor } from "./ayudas-herramientas.js";

const CASOS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["tipo_de_cambio_fix", { publicado: "0001-01-01" }],
  ["tipo_de_cambio_fix", { publicado: "9999-12-31" }],
  ["tipo_de_cambio_fix", { operacion: "0001-01-01" }],
  ["tipo_de_cambio_fix", { operacion: "2020-01-02" }],
  ["tipo_de_cambio_fix", { operacion: "9999-12-31" }],
  ["udis", { fecha: "0001-01-01" }],
  ["udis", { fecha: "9999-12-31" }],
  ["dias_inhabiles", { autoridad: "lft", anio: 1000 }],
  ["dias_inhabiles", { autoridad: "lft", anio: 9999 }],
  ["dias_inhabiles", { autoridad: "cnbv", anio: 1000 }],
  ["dias_inhabiles", { autoridad: "sat", anio: 9999 }],
  ["sumar_dias_habiles", { autoridad: "lft", desde: "0001-01-01", dias: 1 }],
  ["sumar_dias_habiles", { autoridad: "lft", desde: "9999-12-31", dias: 1 }],
  [
    "sumar_dias_habiles",
    { autoridad: "lft", desde: "9999-12-31", dias: 3650, permitir_incompleto: true },
  ],
  [
    "sumar_dias_habiles",
    { autoridad: "lft", desde: "0001-01-01", dias: 3650, permitir_incompleto: true },
  ],
  [
    "sumar_dias_habiles",
    { autoridad: "cnbv", desde: "9999-12-30", dias: 3650, permitir_incompleto: true },
  ],
  [
    "sumar_dias_habiles",
    {
      autoridad: "sat",
      tipo_plazo: "general",
      desde: "0001-01-01",
      dias: 1,
      permitir_incompleto: true,
    },
  ],
  [
    "sumar_dias_habiles",
    {
      autoridad: "sat",
      tipo_plazo: "declaraciones_pagos",
      desde: "9999-12-31",
      dias: 3650,
      permitir_incompleto: true,
    },
  ],
  ["constantes", { tipo: "uma", anio: 1000 }],
  ["constantes", { tipo: "uma", anio: 9999 }],
  ["constantes", { tipo: "uma", fecha: "0001-01-01" }],
  ["constantes", { tipo: "uma", fecha: "9999-12-31" }],
  ["constantes", { tipo: "salario_minimo", anio: 1000 }],
  ["constantes", { tipo: "salario_minimo", anio: 9999 }],
  ["constantes", { tipo: "isr", periodo: "mensual", anio: 1000 }],
  ["constantes", { tipo: "isr", periodo: "anual", anio: 9999 }],
  ["municipio", { cvegeo: "00000" }],
  ["banco_por_codigo", { codigo: "000" }],
  ["validar_clabe", { clabe: "000000000000000000" }],
  ["validar_rfc", { rfc: "ÑÑÑÑ010101AAA" }],
  ["validar_rfc", { rfc: "​XAXX010101000" }],
  ["validar_curp", { curp: "１２３" }],
  ["validar_nss", { nss: "00000000000" }],
  ["buscar_municipio", { texto: "́́a" }],
  ["buscar_municipio", { texto: "😀 1" }],
];

let llamar: Llamador;

beforeAll(async () => {
  llamar = await servidor(herramientasSinRed());
});

describe("entradas en los extremos", () => {
  it.each(CASOS)("%s %j da resultado o error de la herramienta", async (nombre, args) => {
    const r = await llamar(nombre, args);
    expect(r.content.length).toBeGreaterThan(0);
  });
});
