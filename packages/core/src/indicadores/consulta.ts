import type { TipoCambioFix, Udi } from "../datos/indicadores.js";
import type { Fuente } from "../dias-habiles/tipos.js";
import { aDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";

/** Fechas del primer y del último registro de la serie completa, aunque se consulte un tramo. */
export interface CoberturaSerie {
  desde: FechaISO;
  hasta: FechaISO;
}

/**
 * `sin_dato` es definitivo: ese día no hubo publicación, o la fecha es anterior a la serie.
 * `no_disponible` puede cambiar: todavía no se carga lo necesario para responder con certeza.
 */
export type Consulta<T> =
  | { tipo: "encontrado"; registro: T }
  | { tipo: "sin_dato" }
  | { tipo: "no_disponible" };

// Texto vigente según el CFF con última reforma publicada DOF 09-04-2026.
export const FUENTE_CFF_20: Fuente = Object.freeze({
  nombre: "Código Fiscal de la Federación, artículo 20, tercer párrafo",
  url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
  fragmento:
    "Para determinar las contribuciones y sus accesorios se considerará el tipo de cambio a que se haya adquirido la moneda extranjera de que se trate y no habiendo adquisición, se estará al tipo de cambio que el Banco de México publique en el Diario Oficial de la Federación el día anterior a aquél en que se causen las contribuciones. Los días en que el Banco de México no publique dicho tipo de cambio se aplicará el último tipo de cambio publicado con anterioridad al día en que se causen las contribuciones.",
});

const SIN_DATO: Consulta<never> = Object.freeze({ tipo: "sin_dato" });
const NO_DISPONIBLE: Consulta<never> = Object.freeze({ tipo: "no_disponible" });

function validarEntrada(cobertura: CoberturaSerie, fecha: FechaISO): void {
  if (!esFechaIsoValida(fecha)) throw new RangeError(`Fecha ISO inválida: ${fecha}`);
  if (!esFechaIsoValida(cobertura.desde) || !esFechaIsoValida(cobertura.hasta)) {
    throw new RangeError("La cobertura debe tener fechas ISO válidas");
  }
  if (cobertura.desde > cobertura.hasta) {
    throw new RangeError("La cobertura tiene desde posterior a hasta");
  }
}

/** Índice del primer registro con fecha >= `fecha` (búsqueda binaria), o `serie.length`. */
function primeroDesde<T>(
  serie: readonly T[],
  fechaDe: (registro: T) => FechaISO,
  fecha: FechaISO,
): number {
  let bajo = 0;
  let alto = serie.length;
  while (bajo < alto) {
    const medio = (bajo + alto) >>> 1;
    if (fechaDe(serie[medio] as T) < fecha) bajo = medio + 1;
    else alto = medio;
  }
  return bajo;
}

function delDia<T>(
  serie: readonly T[],
  fechaDe: (registro: T) => FechaISO,
  fecha: FechaISO,
): T | undefined {
  const registro = serie[primeroDesde(serie, fechaDe, fecha)];
  return registro !== undefined && fechaDe(registro) === fecha ? registro : undefined;
}

const fechaFix = (registro: TipoCambioFix) => registro.fecha_publicacion;
const fechaUdi = (registro: Udi) => registro.fecha;

/**
 * FIX publicado en el DOF exactamente en `fecha`. `serie` ordenada por `fecha_publicacion`;
 * puede ser solo un tramo, siempre que incluya la fecha (por ejemplo, el año completo).
 */
export function fixPublicado(
  serie: readonly TipoCambioFix[],
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Consulta<TipoCambioFix> {
  validarEntrada(cobertura, fecha);
  if (fecha < cobertura.desde) return SIN_DATO;
  if (fecha > cobertura.hasta) return NO_DISPONIBLE;
  const registro = delDia(serie, fechaFix, fecha);
  return registro ? { tipo: "encontrado", registro } : SIN_DATO;
}

/**
 * FIX aplicable a una operación del día `fecha` (CFF art. 20): el publicado el día anterior
 * o, si ese día no hubo, el último publicado antes. Solo responde si es seguro que no falta
 * una publicación posterior: si la víspera pasa de `cobertura.hasta` y el hueco tiene un día
 * entre semana, da `no_disponible` en vez de un valor viejo.
 *
 * `serie` ordenada; puede ser un tramo, pero debe traer todas las publicaciones desde la
 * aplicable hasta la víspera. Con años completos basta el de la víspera y, si ese año no tiene
 * publicaciones antes de `fecha`, también el anterior. Si se nota que falta la publicación
 * aplicable, lanza RangeError.
 */
export function fixParaOperacion(
  serie: readonly TipoCambioFix[],
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Consulta<TipoCambioFix> {
  validarEntrada(cobertura, fecha);
  if (fecha <= cobertura.desde) return SIN_DATO;
  if (!hayCertezaHastaLaVispera(aDias(fecha), aDias(cobertura.hasta))) return NO_DISPONIBLE;
  const i = primeroDesde(serie, fechaFix, fecha);
  const registro = i > 0 ? serie[i - 1] : undefined;
  // Si la serie completa termina antes de la fecha, la aplicable es su último registro.
  if (
    registro === undefined ||
    (cobertura.hasta < fecha && registro.fecha_publicacion !== cobertura.hasta)
  ) {
    throw new RangeError(
      `El tramo de la serie no incluye la última publicación anterior a ${fecha}`,
    );
  }
  return { tipo: "encontrado", registro };
}

// El DOF no publica el FIX en sábado ni en domingo: un hueco de solo fin de semana entre
// el último dato y la víspera no cambia la respuesta. Revisa a lo más tres días.
function hayCertezaHastaLaVispera(dia: number, ultimo: number): boolean {
  for (let d = ultimo + 1; d < dia; d++) {
    const semana = diaSemanaDeDias(d);
    if (semana !== 0 && semana !== 6) return false;
  }
  return true;
}

/**
 * UDI del día `fecha`. `serie` ordenada; puede ser un tramo que incluya la fecha. La serie es
 * diaria y sin huecos: si falta un día dentro del tramo, da `sin_dato`; si el tramo no llega
 * a la fecha, lanza RangeError.
 */
export function udiDeFecha(
  serie: readonly Udi[],
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Consulta<Udi> {
  validarEntrada(cobertura, fecha);
  if (fecha < cobertura.desde) return SIN_DATO;
  if (fecha > cobertura.hasta) return NO_DISPONIBLE;
  const registro = delDia(serie, fechaUdi, fecha);
  if (registro) return { tipo: "encontrado", registro };
  const primero = serie[0];
  const ultimo = serie[serie.length - 1];
  if (
    primero === undefined ||
    ultimo === undefined ||
    fecha < primero.fecha ||
    fecha > ultimo.fecha
  ) {
    throw new RangeError(`El tramo de la serie no incluye ${fecha}`);
  }
  return SIN_DATO;
}
