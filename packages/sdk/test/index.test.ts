import { describe, expectTypeOf, it } from "vitest";
import type {
  Autoridad,
  Aviso,
  Banco,
  BancoClabe,
  Calendario,
  CoberturaSerie,
  CodigoAviso,
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
  ProblemaConsulta,
  ResultadoDiasHabiles,
  ResultadoValidacion,
  ResultadoValidacionClabe,
  TipoBanco,
  TipoCambioFix,
  TipoPlazo,
  TipoProblema,
  TipoRfc,
  Udi,
} from "../src/index.js";
import * as mexicoapi from "../src/index.js";
import { probarModulo } from "./comun.js";

describe("mexicoapi desde src", () => {
  probarModulo(async () => mexicoapi);
});

describe("tipos públicos", () => {
  it("revisarTipoPlazo solo recibe la autoridad y el tipo de plazo", () => {
    // @ts-expect-error los nombres de cada superficie son internos: no se publican
    type NoPublicado = mexicoapi.NombresTipoPlazo;
    expectTypeOf<NoPublicado>().toBeAny();
    expectTypeOf<ProblemaConsulta["tipo"]>().toEqualTypeOf<TipoProblema>();
    expectTypeOf<"dato-no-disponible">().toExtend<TipoProblema>();
    expectTypeOf(mexicoapi.revisarTipoPlazo).parameters.toEqualTypeOf<
      [autoridad: Autoridad, tipoPlazo: TipoPlazo | undefined]
    >();
  });

  it("exporta los tipos de los validadores", () => {
    // Cambio: la CLABE agrega banco_revisado.
    expectTypeOf(mexicoapi.validarClabe).returns.toEqualTypeOf<ResultadoValidacionClabe>();
    expectTypeOf<ResultadoValidacionClabe>().toExtend<ResultadoValidacion<DetalleClabe>>();
    expectTypeOf<ResultadoValidacionClabe["banco_revisado"]>().toEqualTypeOf<boolean>();
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
    expectTypeOf<ResultadoDiasHabiles["avisos"]>().toEqualTypeOf<Aviso[]>();
    expectTypeOf<Aviso["codigo"]>().toEqualTypeOf<CodigoAviso>();
    expectTypeOf<(typeof mexicoapi.CODIGOS_AVISO)[number]>().toEqualTypeOf<CodigoAviso>();
    expectTypeOf(mexicoapi.codigoAviso).returns.toEqualTypeOf<CodigoAviso>();
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
