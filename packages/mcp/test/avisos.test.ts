// Cada herramienta da en structuredContent `avisos`: sus advertencias con su código estable, en el
// mismo orden, como la API y el cliente de mexicoapi. El texto no cambia.
import { codigoAviso } from "mexicoapi";
import { beforeAll, describe, expect, it } from "vitest";
import { contenido, herramientasSinRed, type Llamador, servidor } from "./ayudas-herramientas.js";

let llamar: Llamador;

beforeAll(async () => {
  llamar = await servidor(herramientasSinRed());
});

const LLAMADAS: readonly [string, Record<string, unknown>][] = [
  ["dias_inhabiles", { autoridad: "lft", anio: 2026 }],
  ["dias_inhabiles", { autoridad: "sat", anio: 2027 }],
  ["dias_inhabiles", { autoridad: "sat", anio: 2030 }],
  ["dias_inhabiles", { autoridad: "cnbv", anio: 2026 }],
  [
    "sumar_dias_habiles",
    { autoridad: "lft", desde: "2100-12-30", dias: 2, permitir_incompleto: true },
  ],
  [
    "sumar_dias_habiles",
    { autoridad: "sat", tipo_plazo: "declaraciones_pagos", desde: "2026-07-17", dias: 3 },
  ],
  [
    "sumar_dias_habiles",
    { autoridad: "sat", tipo_plazo: "declaraciones_pagos", desde: "2030-09-27", dias: 3 },
  ],
  [
    "sumar_dias_habiles",
    {
      autoridad: "sat",
      tipo_plazo: "general",
      desde: "2026-11-27",
      dias: 5,
      permitir_incompleto: true,
    },
  ],
  ["tipo_de_cambio_fix", {}],
  ["udis", { fecha: "2026-01-05" }],
  ["constantes", { tipo: "uma", anio: 2026 }],
  ["validar_clabe", { clabe: "002010077777777771" }],
  ["validar_nss", { nss: "12345678901" }],
  ["banco_por_codigo", { codigo: "002" }],
  ["municipio", { cvegeo: "25006" }],
  ["buscar_municipio", { texto: "Culiacán" }],
];

describe("avisos en structuredContent", () => {
  it("son las advertencias con su código, en el mismo orden, y ninguna sin código", async () => {
    const vistos = new Set<string>();
    for (const [nombre, args] of LLAMADAS) {
      const c = contenido(await llamar(nombre, args));
      const advertencias = c.advertencias as string[];
      expect(c.avisos, nombre).toEqual(
        advertencias.map((texto) => ({ codigo: codigoAviso(texto), texto })),
      );
      for (const texto of advertencias) {
        expect(codigoAviso(texto), `${nombre}: ${texto}`).not.toBe("otro");
        vistos.add(codigoAviso(texto));
      }
      // Los datos de un cálculo traen los suyos, como en el cliente.
      const datos = c.datos as { advertencias?: string[]; avisos?: unknown };
      if (Array.isArray(datos.advertencias)) {
        expect(datos.avisos, nombre).toEqual(
          datos.advertencias.map((texto) => ({ codigo: codigoAviso(texto), texto })),
        );
      }
    }
    // datos-viejos depende de la fecha de hoy.
    vistos.delete("datos-viejos");
    expect([...vistos].sort()).toEqual(
      [
        "calendario-incompleto",
        "datos-del-paquete",
        "lft-art-715",
        "lista-incompleta",
        "prorroga-art-12",
        "tipo-plazo-incompleto",
        "transmision-poder-ejecutivo",
        "vacaciones-sin-publicar",
      ].sort(),
    );
  });
});
