// Un proyecto que usa el paquete publicado: "mexicoapi" se resuelve por su nombre y sus exports
// hacia dist, con los tipos que se publican.
import {
  type Calendario,
  type CalendarioIncompletoError,
  type CoberturaSerie,
  type Consulta,
  calendarioLft,
  type DetalleClabe,
  fixParaOperacion,
  type OpcionesFix,
  type ResultadoDiasHabiles,
  type ResultadoValidacion,
  sumarDiasHabiles,
  type TipoCambioFix,
  type Udi,
  udiDeFecha,
  validarClabe,
  validarCurp,
  validarNss,
  validarRfc,
} from "mexicoapi";
import {
  type BancoCatalogo,
  buscarMunicipio,
  catalogoClabe,
  estado,
  type MetaDatos,
  type Municipio,
  meta,
  municipios,
} from "mexicoapi/datos";
import * as datosFix from "mexicoapi/datos/fix";
import * as datosUdis from "mexicoapi/datos/udis";

const clabe: ResultadoValidacion<DetalleClabe> = validarClabe("002010077777777771");
const banco: string | undefined = clabe.detalle?.codigo_banco;
const validos: boolean[] = [
  validarRfc("GODE561231GR8").valido,
  validarCurp("BOXW310820HNERXN09").valido,
  validarNss("12345678903").valido,
];

const calendario: Calendario = calendarioLft();
const plazo: ResultadoDiasHabiles = sumarDiasHabiles({ calendario, desde: "2026-11-13", dias: 3 });

const cobertura: CoberturaSerie = { desde: "2026-10-14", hasta: "2026-10-16" };
const fix: Consulta<TipoCambioFix> = fixParaOperacion([], cobertura, cobertura, "2026-10-15");
const udi: Consulta<Udi> = udiDeFecha([], cobertura, cobertura, "2026-10-15");
const valorFix: string | null = fix.tipo === "encontrado" ? fix.registro.valor : null;

// Por tipo y name, como dice el README: instanceof falla con dos copias del paquete, y un
// MexicoApiError trae el mismo tipo con otra forma.
function esIncompleto(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as Partial<CalendarioIncompletoError>;
  const delNucleo = e.tipo === "calendario-incompleto" && e.name === "CalendarioIncompletoError";
  return delNucleo && e.cobertura !== undefined ? e.cobertura.hasta : null;
}

const catalogo: ReadonlyMap<string, BancoCatalogo> = catalogoClabe();
const conCatalogo: ResultadoValidacion<DetalleClabe> = validarClabe("002010077777777771", {
  bancos: catalogo,
});
const culiacan: Municipio | undefined = buscarMunicipio("culiacan", {
  cve_ent: "25",
  limite: 1,
})[0];
const sinaloa: readonly Municipio[] = municipios(estado("25")?.cve_ent);
const asOf: string = meta.municipios.as_of;
const fuentes: MetaDatos["sources"] = datosFix.meta.sources;
const sinFeriados: OpcionesFix = { sinPublicacion: () => false };
const fixPaquete: Consulta<TipoCambioFix> = fixParaOperacion(
  datosFix.serie,
  datosFix.tramo,
  datosFix.cobertura,
  "2026-10-19",
  sinFeriados,
);
const udiPaquete: Consulta<Udi> = udiDeFecha(
  datosUdis.serie,
  datosUdis.tramo,
  datosUdis.cobertura,
  datosUdis.cobertura.hasta,
);

export const usados = [
  banco,
  validos,
  plazo.resultado,
  udi.tipo,
  valorFix,
  esIncompleto,
  conCatalogo.detalle?.banco?.nombre_corto,
  culiacan?.cvegeo,
  sinaloa.length,
  asOf,
  fuentes[0]?.license,
  fixPaquete.tipo,
  udiPaquete.tipo,
];
