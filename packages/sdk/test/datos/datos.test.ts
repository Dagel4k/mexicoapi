import { describe, expect, expectTypeOf, it } from "vitest";
import * as fix from "../../src/datos/fix.js";
import type {
  BancoCatalogo,
  FuenteDatos,
  MetaDatos,
  OpcionesBancos,
  OpcionesBusquedaMunicipio,
} from "../../src/datos/index.js";
import * as datos from "../../src/datos/index.js";
import { coberturaDe } from "../../src/datos/serie.js";
import { normalizarBusqueda } from "../../src/datos/texto.js";
import * as udis from "../../src/datos/udis.js";
import type {
  Banco,
  BancoClabe,
  CoberturaSerie,
  Estado,
  Municipio,
  TipoCambioFix,
  Udi,
} from "../../src/index.js";
import * as mexicoapi from "../../src/index.js";
import { probarDatos, probarFix, probarUdis } from "./comun.js";

describe("mexicoapi/datos desde src", () => {
  probarDatos(async () => ({ datos, mexicoapi }));
});

describe("mexicoapi/datos/fix desde src", () => {
  probarFix(async () => ({ fix, mexicoapi }));
});

describe("mexicoapi/datos/udis desde src", () => {
  probarUdis(async () => ({ udis, mexicoapi }));
});

describe("normalizarBusqueda", () => {
  it.each([
    ["Culiacán", "culiacan"],
    ["  CULIACÁN  ", "culiacan"],
    ["Peñón Blanco", "penon blanco"],
    ["Francisco I. Madero", "francisco i madero"],
    [
      "Heroica Villa Tezoatlán de Segura y Luna, Cuna de la Independencia de Oaxaca",
      "heroica villa tezoatlan de segura y luna cuna de la independencia de oaxaca",
    ],
    ["Ahualulco del Sonido 13", "ahualulco del sonido 13"],
    ["Güémez", "guemez"],
    ["Ñ".normalize("NFD"), "n"],
    ["¿...?", ""],
    ["", ""],
  ])("%j queda %j", (texto, esperado) => {
    expect(normalizarBusqueda(texto)).toBe(esperado);
  });
});

describe("coberturaDe", () => {
  const fecha = (r: { f: string }) => r.f;

  it("va del primer al último registro y está congelada", () => {
    const c = coberturaDe([{ f: "2026-01-01" }, { f: "2026-01-02" }, { f: "2026-02-01" }], fecha);
    expect(c).toEqual({ desde: "2026-01-01", hasta: "2026-02-01" });
    expect(Object.isFrozen(c)).toBe(true);
    expect(coberturaDe([{ f: "2026-01-01" }], fecha)).toEqual({
      desde: "2026-01-01",
      hasta: "2026-01-01",
    });
  });

  it("falla con una serie vacía", () => {
    expect(() => coberturaDe([], fecha)).toThrow(/vacía/);
  });

  it.each([[["2026-01-02", "2026-01-01"]], [["2026-01-01", "2026-01-01"]]])(
    "falla si la serie no va en orden estricto por fecha: %j",
    (fechas) => {
      expect(() =>
        coberturaDe(
          fechas.map((f) => ({ f })),
          fecha,
        ),
      ).toThrow(/orden/);
    },
  );
});

describe("tipos de mexicoapi/datos", () => {
  it("devuelve registros de solo lectura con los tipos del núcleo", () => {
    expectTypeOf(datos.estados).returns.toEqualTypeOf<readonly Estado[]>();
    expectTypeOf(datos.estado).returns.toEqualTypeOf<Estado | undefined>();
    expectTypeOf(datos.municipios).returns.toEqualTypeOf<readonly Municipio[]>();
    expectTypeOf(datos.municipios).parameter(0).toEqualTypeOf<string | undefined>();
    expectTypeOf(datos.municipio).returns.toEqualTypeOf<Municipio | undefined>();
    expectTypeOf(datos.buscarMunicipio).returns.toEqualTypeOf<readonly Municipio[]>();
    expectTypeOf(datos.buscarMunicipio)
      .parameter(1)
      .toEqualTypeOf<OpcionesBusquedaMunicipio | undefined>();
    expectTypeOf(datos.bancos).returns.toEqualTypeOf<readonly Banco[]>();
    expectTypeOf(datos.bancos).parameter(0).toEqualTypeOf<OpcionesBancos | undefined>();
    expectTypeOf(datos.banco).returns.toEqualTypeOf<Banco | undefined>();
    expectTypeOf(datos.catalogoClabe).returns.toEqualTypeOf<ReadonlyMap<string, BancoCatalogo>>();
    expectTypeOf<BancoCatalogo>().toExtend<BancoClabe>();
    expectTypeOf<BancoCatalogo["activo"]>().toEqualTypeOf<boolean>();
    expectTypeOf(datos.meta.municipios).toEqualTypeOf<MetaDatos>();
    expectTypeOf<MetaDatos["sources"]>().toEqualTypeOf<readonly FuenteDatos[]>();
  });

  it("acepta undefined en las opciones, como pide exactOptionalPropertyTypes", () => {
    expectTypeOf<{ estado: undefined; limite: undefined }>().toExtend<OpcionesBusquedaMunicipio>();
    expectTypeOf<{ activos: undefined }>().toExtend<OpcionesBancos>();
  });

  it("el catálogo sirve para validarClabe", () => {
    expectTypeOf(datos.catalogoClabe()).toExtend<
      NonNullable<NonNullable<Parameters<typeof mexicoapi.validarClabe>[1]>["bancos"]>
    >();
  });

  it("las series dan lo que piden las consultas del núcleo", () => {
    expectTypeOf(fix.serie).toEqualTypeOf<readonly TipoCambioFix[]>();
    expectTypeOf(udis.serie).toEqualTypeOf<readonly Udi[]>();
    expectTypeOf(fix.cobertura).toEqualTypeOf<CoberturaSerie>();
    expectTypeOf(fix.tramo).toEqualTypeOf<CoberturaSerie>();
    expectTypeOf(udis.cobertura).toEqualTypeOf<CoberturaSerie>();
    expectTypeOf(udis.tramo).toEqualTypeOf<CoberturaSerie>();
    expectTypeOf(fix.meta).toEqualTypeOf<MetaDatos>();
    expectTypeOf(udis.meta).toEqualTypeOf<MetaDatos>();
  });
});
