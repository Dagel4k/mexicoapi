import type { TipoCambioFix, Udi } from "../datos/indicadores.js";
import type { Fuente } from "../dias-habiles/tipos.js";
import { SerieIncompletaError } from "../errores.js";
import { aDias, deDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";

/**
 * Rango de fechas de una serie, con los dos extremos incluidos.
 *
 * Como cobertura, va del primer al último registro de la serie completa: está completa hasta
 * `hasta`. Como tramo, son las fechas que cubre la parte de la serie que se pasa a la consulta
 * (con shards por año, del 1 de enero al 31 de diciembre de los años cargados, recortado a la
 * cobertura): el tramo trae todos los registros de esas fechas y ninguno de otras.
 */
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

function validarRango(rango: CoberturaSerie, nombre: "La cobertura" | "El tramo"): void {
  if (!esFechaIsoValida(rango.desde) || !esFechaIsoValida(rango.hasta)) {
    throw new RangeError(`${nombre} debe tener fechas ISO válidas`);
  }
  if (rango.desde > rango.hasta) {
    throw new RangeError(`${nombre} tiene desde posterior a hasta`);
  }
}

function validarEntrada<T>(
  serie: readonly T[],
  fechaDe: (registro: T) => FechaISO,
  tramo: CoberturaSerie,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): void {
  if (!esFechaIsoValida(fecha)) throw new RangeError(`Fecha ISO inválida: ${fecha}`);
  validarRango(cobertura, "La cobertura");
  validarRango(tramo, "El tramo");
  // También atrapa el tramo y la cobertura invertidos, que tienen el mismo tipo.
  if (tramo.desde < cobertura.desde || tramo.hasta > cobertura.hasta) {
    throw new RangeError("El tramo debe estar dentro de la cobertura");
  }
  // La serie está ordenada: basta revisar el primer y el último registro.
  if (
    serie.length > 0 &&
    (fechaDe(serie[0] as T) < tramo.desde || fechaDe(serie[serie.length - 1] as T) > tramo.hasta)
  ) {
    throw new SerieIncompletaError(fecha, tramo, "trae registros fuera de las fechas del tramo");
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

/** Registro del día `fecha`; la entrada ya pasó por `validarEntrada`. */
function registroDelDia<T>(
  serie: readonly T[],
  fechaDe: (registro: T) => FechaISO,
  tramo: CoberturaSerie,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Consulta<T> {
  if (fecha < cobertura.desde) return SIN_DATO;
  if (fecha > cobertura.hasta) return NO_DISPONIBLE;
  if (fecha < tramo.desde || fecha > tramo.hasta) {
    throw new SerieIncompletaError(fecha, tramo, "el tramo no incluye la fecha");
  }
  const registro = serie[primeroDesde(serie, fechaDe, fecha)];
  return registro !== undefined && fechaDe(registro) === fecha
    ? { tipo: "encontrado", registro }
    : SIN_DATO;
}

const fechaFix = (registro: TipoCambioFix) => registro.fecha_publicacion;
const fechaUdi = (registro: Udi) => registro.fecha;

/** Opciones de `fixPublicado` y `fixParaOperacion`. */
export interface OpcionesFix {
  /**
   * Días entre semana en que se sabe que el DOF no publica el FIX, como los días de descanso
   * de la CNBV dentro de su calendario. Solo se pregunta por días posteriores a
   * `cobertura.hasta` y solo cuenta un `true`. Un hueco de más de 31 días después de
   * `cobertura.hasta` da `no_disponible` sin preguntar. Sin esta opción, solo los sábados y
   * domingos cuentan como días sin publicación.
   */
  sinPublicacion?: ((fecha: FechaISO) => boolean) | undefined;
}

type SinPublicacion = OpcionesFix["sinPublicacion"];

function leerOpciones(opciones: OpcionesFix | null | undefined): SinPublicacion {
  const sinPublicacion = opciones?.sinPublicacion;
  if (sinPublicacion !== undefined && typeof sinPublicacion !== "function") {
    throw new TypeError("sinPublicacion debe ser una función");
  }
  return sinPublicacion;
}

/**
 * FIX publicado en el DOF exactamente en `fecha`. `serie` es un tramo ordenado de la serie y
 * `tramo` las fechas que cubre, dentro de `cobertura`. Si la fecha cae en la cobertura pero no
 * en el tramo, lanza SerieIncompletaError.
 *
 * Después de `cobertura.hasta`, una fecha sin publicación (sábado, domingo o un día que marque
 * `opciones.sinPublicacion`) con solo días sin publicación de por medio da `sin_dato`: el mismo
 * supuesto de `fixParaOperacion`.
 */
export function fixPublicado(
  serie: readonly TipoCambioFix[],
  tramo: CoberturaSerie,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
  opciones?: OpcionesFix,
): Consulta<TipoCambioFix> {
  validarEntrada(serie, fechaFix, tramo, cobertura, fecha);
  const sinPublicacion = leerOpciones(opciones);
  if (
    fecha > cobertura.hasta &&
    sinPublicacionEntre(aDias(cobertura.hasta), aDias(fecha) + 1, sinPublicacion)
  ) {
    return SIN_DATO;
  }
  return registroDelDia(serie, fechaFix, tramo, cobertura, fecha);
}

/**
 * FIX aplicable a una operación del día `fecha` (CFF art. 20): el publicado el día anterior
 * o, si ese día no hubo, el último publicado antes. Solo responde si es seguro que no falta
 * una publicación posterior: si la víspera pasa de `cobertura.hasta` y el hueco tiene un día
 * entre semana que `opciones.sinPublicacion` no marca, da `no_disponible` en vez de un valor
 * viejo.
 *
 * `tramo` debe llegar a la víspera (o a `cobertura.hasta`, si la serie termina antes) y
 * empezar antes de la publicación aplicable. Con shards por año basta el de la víspera y, si
 * ese año no tiene publicaciones antes de `fecha`, también el anterior. Si el tramo no
 * alcanza, lanza SerieIncompletaError en vez de responder.
 */
export function fixParaOperacion(
  serie: readonly TipoCambioFix[],
  tramo: CoberturaSerie,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
  opciones?: OpcionesFix,
): Consulta<TipoCambioFix> {
  validarEntrada(serie, fechaFix, tramo, cobertura, fecha);
  const sinPublicacion = leerOpciones(opciones);
  if (fecha <= cobertura.desde) return SIN_DATO;
  const dia = aDias(fecha);
  if (!sinPublicacionEntre(aDias(cobertura.hasta), dia, sinPublicacion)) return NO_DISPONIBLE;
  const vispera = deDias(dia - 1);
  const necesario = vispera < cobertura.hasta ? vispera : cobertura.hasta;
  if (tramo.hasta < necesario) {
    throw new SerieIncompletaError(fecha, tramo, `el tramo debe llegar hasta ${necesario}`);
  }
  const i = primeroDesde(serie, fechaFix, fecha);
  if (i > 0) return { tipo: "encontrado", registro: serie[i - 1] as TipoCambioFix };
  // Sin publicación anterior en el tramo: es definitivo solo si el tramo empieza con la serie.
  if (tramo.desde > cobertura.desde) {
    throw new SerieIncompletaError(
      fecha,
      tramo,
      `el tramo no incluye la última publicación anterior; faltan fechas antes de ${tramo.desde}`,
    );
  }
  return SIN_DATO;
}

/**
 * Días sin publicación seguidos que se aceptan después del último dato. Los reales son unos
 * cuantos (un feriado pegado al fin de semana, o jueves y viernes santos); un hueco más largo da
 * no_disponible sin recorrerlo, aunque `sinPublicacion` diga otra cosa.
 */
const HUECO_MAXIMO = 31;

// El DOF no publica el FIX en sábado ni en domingo, ni en los días que marque `sinPublicacion`:
// un hueco de solo esos días después del último dato no cambia la respuesta. Revisa los días de
// (ultimo, fin), a lo más HUECO_MAXIMO, y se detiene en el primero que pudo tener publicación;
// sin `sinPublicacion`, a lo más tres.
function sinPublicacionEntre(ultimo: number, fin: number, sinPublicacion: SinPublicacion): boolean {
  if (fin - ultimo - 1 > HUECO_MAXIMO) return false;
  for (let d = ultimo + 1; d < fin; d++) {
    const semana = diaSemanaDeDias(d);
    if (semana === 0 || semana === 6) continue;
    if (sinPublicacion === undefined || sinPublicacion(deDias(d)) !== true) return false;
  }
  return true;
}

/**
 * UDI del día `fecha`. `serie` es un tramo ordenado y `tramo` las fechas que cubre, dentro de
 * `cobertura`. La serie es diaria: un día que falta dentro del tramo da `sin_dato`; si la fecha
 * cae en la cobertura pero no en el tramo, lanza SerieIncompletaError.
 */
export function udiDeFecha(
  serie: readonly Udi[],
  tramo: CoberturaSerie,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Consulta<Udi> {
  validarEntrada(serie, fechaUdi, tramo, cobertura, fecha);
  return registroDelDia(serie, fechaUdi, tramo, cobertura, fecha);
}
