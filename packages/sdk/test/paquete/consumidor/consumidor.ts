// Un proyecto que usa el paquete publicado: "mexicoapi" se resuelve por su nombre y sus exports
// hacia dist, con los tipos que se publican.
import {
  type Calendario,
  CalendarioIncompletoError,
  type CoberturaSerie,
  type Consulta,
  calendarioLft,
  type DetalleClabe,
  fixParaOperacion,
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

function esIncompleto(error: unknown): string | null {
  return error instanceof CalendarioIncompletoError ? error.cobertura.hasta : null;
}

export const usados = [banco, validos, plazo.resultado, udi.tipo, valorFix, esIncompleto];
