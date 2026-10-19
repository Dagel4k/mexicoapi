import type { Aviso } from "../avisos.js";
import type { FuenteDof } from "../datos/curados.js";
import { enesimoDiaDeSemana, type FechaISO } from "../fechas.js";
import type { DiaInhabil } from "./tipos.js";

/** Fecha de la última reforma del CFF en el DOF; el texto de abajo es el de esa versión. */
export const VIGENCIA_CFF: FechaISO = "2026-04-09";

// Primer párrafo del art. 12, texto vigente según el CFF con última reforma DOF 09-04-2026.
export const FUENTE_CFF_12: FuenteDof = Object.freeze({
  nombre: "Código Fiscal de la Federación, artículo 12",
  url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
  fecha_publicacion: VIGENCIA_CFF,
  fragmento:
    "Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; el primer lunes de febrero en conmemoración del 5 de febrero; el tercer lunes de marzo en conmemoración del 21 de marzo; el 1o. y 5 de mayo; el 16 de septiembre; el tercer lunes de noviembre en conmemoración del 20 de noviembre; el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo y el 25 de diciembre.",
});

/**
 * Años en que se calculan los días del art. 12: desde el primero que tiene calendario del SAT y
 * con el texto vigente, que no cambia por año, hasta 2100 como la LFT.
 */
export const COBERTURA_CFF: { readonly desde: FechaISO; readonly hasta: FechaISO } = Object.freeze({
  desde: "2026-01-01",
  hasta: "2100-12-31",
});

const ANIO_MIN = 2026;
const ANIO_MAX = 2100;

function dia(fecha: FechaISO, motivo: string): DiaInhabil {
  return { fecha, motivo, tipo: "descanso", fuente: FUENTE_CFF_12 };
}

/**
 * Días del primer párrafo del art. 12 del CFF para un año, ordenados por fecha.
 *
 * El 1o. de diciembre de cada 6 años no se descuenta: el art. 12 lo liga a la transmisión del
 * Poder Ejecutivo, que desde 2024 es el 1o. de octubre, y el 1o. de octubre no está en la lista.
 * Descontar cualquiera de los dos haría vencer el plazo después; sin ellos vence antes, y
 * `avisosTransmisionCff` lo advierte.
 */
export function diasDescansoCff(anio: number): DiaInhabil[] {
  if (!Number.isInteger(anio) || anio < ANIO_MIN || anio > ANIO_MAX) {
    throw new RangeError(`El año debe ser un entero de ${ANIO_MIN} a ${ANIO_MAX}: ${anio}`);
  }
  return [
    dia(`${anio}-01-01`, "1o. de enero"),
    dia(
      enesimoDiaDeSemana(anio, 2, 1, 1),
      "Primer lunes de febrero, en conmemoración del 5 de febrero",
    ),
    dia(
      enesimoDiaDeSemana(anio, 3, 3, 1),
      "Tercer lunes de marzo, en conmemoración del 21 de marzo",
    ),
    dia(`${anio}-05-01`, "1o. de mayo"),
    dia(`${anio}-05-05`, "5 de mayo"),
    dia(`${anio}-09-16`, "16 de septiembre"),
    dia(
      enesimoDiaDeSemana(anio, 11, 3, 1),
      "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
    ),
    dia(`${anio}-12-25`, "25 de diciembre"),
  ];
}

/** El aviso de un año de transmisión del Poder Ejecutivo: qué no se descuenta y por qué. */
export function avisoTransmisionCff(anio: number): Aviso {
  const texto = `En ${anio} no se descuentan el 1o. de octubre ni el 1o. de diciembre: el art. 12 del CFF no cuenta el 1o. de diciembre de cada 6 años cuando corresponde a la transmisión del Poder Ejecutivo, que desde 2024 es el 1o. de octubre. Si el SAT declara inhábil alguno de los dos, el plazo que lo cruce vence un día hábil después.`;
  return { codigo: "transmision-poder-ejecutivo", texto };
}

/**
 * Los avisos de un cálculo que pasa por el 1o. de octubre o el 1o. de diciembre de un año de
 * transmisión (cada seis años desde 2024) dentro de la cobertura: de `desde`, sin contarlo, a
 * `hasta`. Uno por año, en orden; vacío si no pasa por ninguno.
 */
export function avisosTransmisionCff(desde: FechaISO, hasta: FechaISO): Aviso[] {
  const avisos: Aviso[] = [];
  const primero = Math.max(Number(desde.slice(0, 4)), ANIO_MIN);
  const ultimo = Math.min(Number(hasta.slice(0, 4)), ANIO_MAX);
  for (let anio = primero; anio <= ultimo; anio++) {
    if ((anio - 2024) % 6 !== 0) continue;
    const cruza = [`${anio}-10-01`, `${anio}-12-01`].some((f) => f > desde && f <= hasta);
    if (cruza) avisos.push(avisoTransmisionCff(anio));
  }
  return avisos;
}
