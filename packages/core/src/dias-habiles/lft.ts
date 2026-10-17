import { enesimoDiaDeSemana, type FechaISO } from "../fechas.js";
import type { DiaInhabil, Fuente } from "./tipos.js";

const URL_LFT = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf";

// Texto vigente según la LFT con última reforma DOF 14-05-2026.
export const FUENTE_LFT_74: Fuente = Object.freeze({
  nombre: "Ley Federal del Trabajo, artículo 74",
  url: URL_LFT,
  fragmento:
    "Artículo 74. Son días de descanso obligatorio: I. El 1o. de enero; II. El primer lunes de febrero en conmemoración del 5 de febrero; III. El tercer lunes de marzo en conmemoración del 21 de marzo; IV. El 1o. de mayo; V. El 16 de septiembre; VI. El tercer lunes de noviembre en conmemoración del 20 de noviembre; VII. El 1o. de octubre de cada seis años, cuando corresponda a la transmisión del Poder Ejecutivo Federal; VIII. El 25 de diciembre, y IX. El que determinen las leyes federales y locales electorales, en el caso de elecciones ordinarias, para efectuar la jornada electoral.",
});

export const FUENTE_LFT_715: Fuente = Object.freeze({
  nombre: "Ley Federal del Trabajo, artículo 715",
  url: URL_LFT,
  fragmento:
    "Artículo 715.- Son días hábiles todos los del año con excepción de los sábados y domingos, los de descanso obligatorio, los festivos que señale el calendario oficial y aquéllos en que las autoridades laborales señaladas en el artículo anterior suspendan sus labores.",
});

export const COBERTURA_LFT: { readonly desde: FechaISO; readonly hasta: FechaISO } = Object.freeze({
  desde: "2007-01-01",
  hasta: "2100-12-31",
});

const ANIO_MIN = 2007;
const ANIO_MAX = 2100;

function dia(fecha: FechaISO, motivo: string): DiaInhabil {
  return { fecha, motivo, tipo: "descanso", fuente: FUENTE_LFT_74 };
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
    throw new RangeError(`El año debe ser un entero entre ${ANIO_MIN} y ${ANIO_MAX}`);
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
