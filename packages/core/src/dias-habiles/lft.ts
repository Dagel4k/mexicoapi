import type { Aviso } from "../avisos.js";
import { enesimoDiaDeSemana, type FechaISO } from "../fechas.js";
import type { DiaInhabil, Fuente } from "./tipos.js";

const URL_LFT = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf";

/** Fecha de la última reforma de la LFT en el DOF; los textos de abajo son los de esa versión. */
export const VIGENCIA_LFT: FechaISO = "2026-05-14";

// Texto vigente según la LFT con última reforma DOF 14-05-2026.
export const FUENTE_LFT_74: Fuente = Object.freeze({
  nombre: "Ley Federal del Trabajo, artículo 74",
  url: URL_LFT,
  fragmento:
    "Artículo 74. Son días de descanso obligatorio: I. El 1o. de enero; II. El primer lunes de febrero en conmemoración del 5 de febrero; III. El tercer lunes de marzo en conmemoración del 21 de marzo; IV. El 1o. de mayo; V. El 16 de septiembre; VI. El tercer lunes de noviembre en conmemoración del 20 de noviembre; VII. El 1o. de octubre de cada seis años, cuando corresponda a la transmisión del Poder Ejecutivo Federal; VIII. El 25 de diciembre, y IX. El que determinen las leyes federales y locales electorales, en el caso de elecciones ordinarias, para efectuar la jornada electoral.",
});

/**
 * Primer día en vigor de la fracción VII vigente ("1o. de octubre"): la reforma se publicó en el
 * DOF el 30-09-2024 y entró en vigor al día siguiente. Los días anteriores citan
 * `FUENTE_LFT_74_2006`.
 */
export const INICIO_LFT_74_VIGENTE: FechaISO = "2024-10-01";

// Texto del art. 74 de la reforma publicada en el DOF el 17-01-2006, en vigor de 2007 (inicio de
// la cobertura) al 30-09-2024; transcrito de la copia del decreto de la Cámara de Diputados.
export const FUENTE_LFT_74_2006: Fuente = Object.freeze({
  nombre: "Ley Federal del Trabajo, artículo 74",
  url: "https://www.diputados.gob.mx/LeyesBiblio/ref/lft/LFT_ref24_17ene06.pdf",
  fecha_publicacion: "2006-01-17",
  fragmento:
    "Artículo 74. Son días de descanso obligatorio: I. El 1o. de enero; II. El primer lunes de febrero en conmemoración del 5 de febrero; III. El tercer lunes de marzo en conmemoración del 21 de marzo; IV. El 1o. de mayo; V. El 16 de septiembre; VI. El tercer lunes de noviembre en conmemoración del 20 de noviembre; VII. El 1o. de diciembre de cada seis años, cuando corresponda a la transmisión del Poder Ejecutivo Federal; VIII. El 25 de diciembre, y IX. El que determinen las leyes federales y locales electorales, en el caso de elecciones ordinarias, para efectuar la jornada electoral.",
});

export const FUENTE_LFT_715: Fuente = Object.freeze({
  nombre: "Ley Federal del Trabajo, artículo 715",
  url: URL_LFT,
  fragmento:
    "Artículo 715.- Son días hábiles todos los del año con excepción de los sábados y domingos, los de descanso obligatorio, los festivos que señale el calendario oficial y aquéllos en que las autoridades laborales señaladas en el artículo anterior suspendan sus labores.",
});

/**
 * El calendario de la LFT aplica del art. 715 solo los sábados y domingos y los días de descanso
 * obligatorio del art. 74: no tiene los festivos del calendario oficial ni los días en que las
 * autoridades laborales suspenden labores, que publica cada tribunal o centro de conciliación. Lo
 * dice en cada cálculo y en cada lista.
 */
export const AVISO_LFT_715 =
  "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715), como la Semana Santa o sus vacaciones. Revisa el calendario del tribunal o del centro de conciliación.";

/** `AVISO_LFT_715` con su código, nuevo en cada llamada. */
export const avisoLft715 = (): Aviso => ({ codigo: "lft-art-715", texto: AVISO_LFT_715 });

export const COBERTURA_LFT: { readonly desde: FechaISO; readonly hasta: FechaISO } = Object.freeze({
  desde: "2007-01-01",
  hasta: "2100-12-31",
});

const ANIO_MIN = 2007;
const ANIO_MAX = 2100;

/** Cada día cita el texto del art. 74 que estaba en vigor ese día. */
function dia(fecha: FechaISO, motivo: string): DiaInhabil {
  const fuente = fecha < INICIO_LFT_74_VIGENTE ? FUENTE_LFT_74_2006 : FUENTE_LFT_74;
  return { fecha, motivo, tipo: "descanso", fuente };
}

/**
 * Días de descanso obligatorio del art. 74 de la LFT para un año, ordenados por fecha.
 *
 * La fracción IX (jornada electoral) no se calcula: las elecciones ordinarias
 * se celebran en domingo, que ya es inhábil.
 *
 * La regla del 1 de diciembre (2012, 2018) corresponde a las transmisiones del
 * Poder Ejecutivo anteriores a la reforma constitucional de 2014, que movió la
 * toma de protesta al 1 de octubre a partir de 2024.
 */
export function diasDescansoLft(anio: number): DiaInhabil[] {
  if (!Number.isInteger(anio) || anio < ANIO_MIN || anio > ANIO_MAX) {
    throw new RangeError(`El año debe ser un entero de ${ANIO_MIN} a ${ANIO_MAX}: ${anio}`);
  }
  const dias: DiaInhabil[] = [
    dia(`${anio}-01-01`, "1 de enero"),
    dia(
      enesimoDiaDeSemana(anio, 2, 1, 1),
      "Primer lunes de febrero, en conmemoración del 5 de febrero",
    ),
    dia(
      enesimoDiaDeSemana(anio, 3, 3, 1),
      "Tercer lunes de marzo, en conmemoración del 21 de marzo",
    ),
    dia(`${anio}-05-01`, "1 de mayo"),
    dia(`${anio}-09-16`, "16 de septiembre"),
  ];
  if (anio >= 2024 && (anio - 2024) % 6 === 0) {
    dias.push(
      dia(
        `${anio}-10-01`,
        "1 de octubre de cada seis años, transmisión del Poder Ejecutivo Federal",
      ),
    );
  }
  dias.push(
    dia(
      enesimoDiaDeSemana(anio, 11, 3, 1),
      "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
    ),
  );
  if (anio <= 2018 && (2018 - anio) % 6 === 0) {
    dias.push(
      dia(
        `${anio}-12-01`,
        "1 de diciembre de cada seis años, transmisión del Poder Ejecutivo Federal",
      ),
    );
  }
  dias.push(dia(`${anio}-12-25`, "25 de diciembre"));
  return dias;
}
