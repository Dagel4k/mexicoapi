import { CalendarioIncompletoError } from "../errores.js";
import { aDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";
import { COBERTURA_LFT, diasDescansoLft, FUENTE_LFT_715 } from "./lft.js";
import type { Autoridad, DiaInhabil, Fuente } from "./tipos.js";

type Cobertura = { readonly desde: FechaISO; readonly hasta: FechaISO };

/** `crearCalendario` y `calendarioLft` lo devuelven congelado. */
export interface Calendario {
  readonly autoridad: Autoridad;
  readonly cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO };
  /** Incluye fines de semana; lanza CalendarioIncompletoError fuera de cobertura. */
  readonly inhabil: (fecha: FechaISO) => DiaInhabil | null;
}

function congelar(dia: DiaInhabil): DiaInhabil {
  return Object.freeze({ ...dia, fuente: Object.freeze({ ...dia.fuente }) });
}

function validarCobertura(cobertura: Cobertura): void {
  if (!esFechaIsoValida(cobertura.desde) || !esFechaIsoValida(cobertura.hasta)) {
    throw new RangeError("La cobertura debe tener fechas ISO válidas");
  }
  if (cobertura.desde > cobertura.hasta) {
    throw new RangeError("La cobertura tiene desde posterior a hasta");
  }
}

function construir(
  autoridad: Autoridad,
  cobertura: Cobertura,
  // Recibe la fecha ya validada y su número de día (aDias).
  diasDe: (fecha: FechaISO, numero: number) => readonly DiaInhabil[],
  fuenteFinDeSemana: Fuente,
  excluirTipos: readonly DiaInhabil["tipo"][],
): Calendario {
  const fija = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
  const fuenteFds = Object.freeze({ ...fuenteFinDeSemana });
  const calendario: Calendario = {
    autoridad,
    cobertura: fija,
    inhabil(fecha) {
      // aDias valida una sola vez y deja el número de día para el fin de semana.
      const numero = aDias(fecha);
      if (fecha < fija.desde || fecha > fija.hasta) {
        throw new CalendarioIncompletoError(autoridad, fecha, fija);
      }
      const delDia = diasDe(fecha, numero);
      for (let i = 0; i < delDia.length; i++) {
        const d = delDia[i] as DiaInhabil;
        if (!excluirTipos.includes(d.tipo)) return d;
      }
      const semana = diaSemanaDeDias(numero);
      if (semana === 0 || semana === 6) {
        return Object.freeze({
          fecha,
          motivo: semana === 0 ? "Domingo" : "Sábado",
          tipo: "fin_de_semana",
          fuente: fuenteFds,
        });
      }
      return null;
    },
  };
  return Object.freeze(calendario);
}

export function crearCalendario(opciones: {
  autoridad: Autoridad;
  cobertura: { desde: FechaISO; hasta: FechaISO };
  dias: readonly DiaInhabil[];
  fuenteFinDeSemana: Fuente;
  excluirTipos?: readonly DiaInhabil["tipo"][];
}): Calendario {
  const { autoridad, cobertura, dias, fuenteFinDeSemana, excluirTipos = [] } = opciones;
  validarCobertura(cobertura);
  const porNumero = new Map<number, DiaInhabil[]>();
  for (const dia of dias) {
    if (!esFechaIsoValida(dia.fecha)) {
      throw new RangeError(`Fecha ISO inválida en dias: ${dia.fecha}`);
    }
    if (dia.fecha < cobertura.desde || dia.fecha > cobertura.hasta) {
      throw new RangeError(`El día ${dia.fecha} está fuera de la cobertura`);
    }
    const numero = aDias(dia.fecha);
    const lista = porNumero.get(numero) ?? [];
    lista.push(congelar(dia));
    porNumero.set(numero, lista);
  }
  return construir(
    autoridad,
    cobertura,
    (_fecha, numero) => porNumero.get(numero) ?? [],
    fuenteFinDeSemana,
    [...excluirTipos],
  );
}

export function calendarioLft(): Calendario {
  const porAnio = new Map<number, Map<number, DiaInhabil[]>>();
  const diasDe = (fecha: FechaISO, numero: number): readonly DiaInhabil[] => {
    // La fecha ya está validada: los cuatro primeros caracteres son dígitos.
    const anio =
      (fecha.charCodeAt(0) - 48) * 1000 +
      (fecha.charCodeAt(1) - 48) * 100 +
      (fecha.charCodeAt(2) - 48) * 10 +
      (fecha.charCodeAt(3) - 48);
    let mapa = porAnio.get(anio);
    if (!mapa) {
      mapa = new Map();
      for (const dia of diasDescansoLft(anio)) mapa.set(aDias(dia.fecha), [congelar(dia)]);
      porAnio.set(anio, mapa);
    }
    return mapa.get(numero) ?? [];
  };
  return construir("lft", COBERTURA_LFT, diasDe, FUENTE_LFT_715, []);
}
