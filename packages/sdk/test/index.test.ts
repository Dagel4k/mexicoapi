import { describe, expectTypeOf, it } from "vitest";
import type {
  Autoridad,
  Banco,
  BancoClabe,
  Calendario,
  CoberturaSerie,
  CodigoError,
  Consulta,
  DetalleClabe,
  DetalleCurp,
  DetalleRfc,
  DiaInhabil,
  Estado,
  FechaISO,
  Fuente,
  Municipio,
  OpcionesFix,
  PeriodoBanco,
  Plaza,
  ResultadoDiasHabiles,
  ResultadoValidacion,
  TipoBanco,
  TipoCambioFix,
  TipoRfc,
  Udi,
} from "../src/index.js";
import * as mexicoapi from "../src/index.js";
import { probarModulo } from "./comun.js";

describe("mexicoapi desde src", () => {
  probarModulo(async () => mexicoapi);
});

describe("tipos públicos", () => {
  it("exporta los tipos de los validadores", () => {
    expectTypeOf(mexicoapi.validarClabe).returns.toEqualTypeOf<ResultadoValidacion<DetalleClabe>>();
    expectTypeOf(mexicoapi.validarCurp).returns.toEqualTypeOf<ResultadoValidacion<DetalleCurp>>();
    expectTypeOf(mexicoapi.validarRfc).returns.toEqualTypeOf<ResultadoValidacion<DetalleRfc>>();
    expectTypeOf<DetalleRfc["tipo"]>().toEqualTypeOf<TipoRfc>();
    expectTypeOf<ResultadoValidacion<null>["errores"]>().toEqualTypeOf<CodigoError[]>();
    expectTypeOf<DetalleClabe["banco"]>().toEqualTypeOf<BancoClabe | null>();
    expectTypeOf<DetalleClabe["plaza"]>().toEqualTypeOf<Plaza | null>();
  });

  it("exporta los tipos de días hábiles", () => {
    expectTypeOf(mexicoapi.calendarioLft).returns.toEqualTypeOf<Calendario>();
    expectTypeOf(mexicoapi.sumarDiasHabiles).returns.toEqualTypeOf<ResultadoDiasHabiles>();
    expectTypeOf<Calendario["autoridad"]>().toEqualTypeOf<Autoridad>();
    expectTypeOf<DiaInhabil["fuente"]>().toEqualTypeOf<Fuente>();
    expectTypeOf<DiaInhabil["fecha"]>().toEqualTypeOf<FechaISO>();
  });

  it("exporta los tipos de FIX y UDIS", () => {
    expectTypeOf(mexicoapi.fixPublicado).returns.toEqualTypeOf<Consulta<TipoCambioFix>>();
    expectTypeOf(mexicoapi.udiDeFecha).returns.toEqualTypeOf<Consulta<Udi>>();
    expectTypeOf(mexicoapi.udiDeFecha).parameter(1).toEqualTypeOf<CoberturaSerie>();
    expectTypeOf(mexicoapi.fixParaOperacion).parameter(4).toEqualTypeOf<OpcionesFix | undefined>();
    expectTypeOf<OpcionesFix["sinPublicacion"]>().toEqualTypeOf<
      ((fecha: FechaISO) => boolean) | undefined
    >();
  });

  it("exporta los tipos de los datos", () => {
    expectTypeOf<Banco["tipo"]>().toEqualTypeOf<TipoBanco>();
    expectTypeOf<Banco["historial"]>().toEqualTypeOf<PeriodoBanco[]>();
    expectTypeOf<Municipio["cve_ent"]>().toEqualTypeOf<Estado["cve_ent"]>();
  });
});
