import { esFechaIsoValida, type FechaISO } from "./fechas.js";

// Las fechas de MéxicoAPI (un día del DOF, una operación, un plazo) son días de la Ciudad de
// México. El formateador se arma la primera vez que hace falta: importar el núcleo no lo crea.
let formato: Intl.DateTimeFormat | undefined;

/**
 * La fecha de hoy (AAAA-MM-DD) en la Ciudad de México (America/Mexico_City), con las reglas de la
 * zona de `Intl`. Un servidor en UTC va un día adelante de las 18:00 a las 24:00 de la Ciudad de
 * México: `new Date().toISOString().slice(0, 10)` daría la fecha equivocada para el FIX de un pago
 * de hoy. `ahora` (un `Date` o milisegundos desde 1970) fija el reloj; por omisión, `Date.now()`.
 * Lanza RangeError si `ahora` no es una fecha válida o cae fuera de los años 0001 a 9999.
 */
export function hoyEnMexico(ahora: Date | number = Date.now()): FechaISO {
  const ms = Number(ahora);
  if (!Number.isFinite(ms)) throw new RangeError("ahora debe ser una fecha válida.");
  formato ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    // Antes de la era común Intl da el año contado hacia atrás (1 a. C. es "1"): la era lo dice.
    era: "short",
  });
  const partes = formato.formatToParts(ms);
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  const fecha = `${parte("year").padStart(4, "0")}-${parte("month")}-${parte("day")}`;
  if (parte("era") !== "AD" || !esFechaIsoValida(fecha)) {
    throw new RangeError("ahora cae fuera de los años 0001 a 9999 en la Ciudad de México.");
  }
  return fecha;
}
