import { CalendarioIncompletoError } from "../errores.js";
import { diaDeLaSemana, esFechaIsoValida, type FechaISO } from "../fechas.js";
import { COBERTURA_LFT, diasDescansoLft, FUENTE_LFT_715 } from "./lft.js";
import type { Autoridad, DiaInhabil, Fuente } from "./tipos.js";

type Cobertura = { readonly desde: FechaISO; readonly hasta: FechaISO };

export interface Calendario {
  autoridad: Autoridad;
  cobertura: { desde: FechaISO; hasta: FechaISO };
  /** Incluye fines de semana; lanza CalendarioIncompletoError fuera de cobertura. */
  inhabil(fecha: FechaISO): DiaInhabil | null;
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
  diasDe: (fecha: FechaISO) => readonly DiaInhabil[],
  fuenteFinDeSemana: Fuente,
  excluirTipos: readonly DiaInhabil["tipo"][],
): Calendario {
  const fija = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
  const fuenteFds = Object.freeze({ ...fuenteFinDeSemana });
  return {
    autoridad,
    cobertura: fija,
    inhabil(fecha) {
      if (!esFechaIsoValida(fecha)) {
        throw new RangeError(`Fecha ISO inválida: ${fecha}`);
      }
      if (fecha < fija.desde || fecha > fija.hasta) {
        throw new CalendarioIncompletoError(autoridad, fecha, fija);
      }
      const listado = diasDe(fecha).find((d) => !excluirTipos.includes(d.tipo));
      if (listado) return listado;
      const semana = diaDeLaSemana(fecha);
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
  const porFecha = new Map<FechaISO, DiaInhabil[]>();
  for (const dia of dias) {
    if (!esFechaIsoValida(dia.fecha)) {
      throw new RangeError(`Fecha ISO inválida en dias: ${dia.fecha}`);
    }
    if (dia.fecha < cobertura.desde || dia.fecha > cobertura.hasta) {
      throw new RangeError(`El día ${dia.fecha} está fuera de la cobertura`);
    }
    const lista = porFecha.get(dia.fecha) ?? [];
    lista.push(congelar(dia));
    porFecha.set(dia.fecha, lista);
  }
  return construir(autoridad, cobertura, (fecha) => porFecha.get(fecha) ?? [], fuenteFinDeSemana, [
    ...excluirTipos,
  ]);
}

export function calendarioLft(): Calendario {
  const porAnio = new Map<number, Map<FechaISO, DiaInhabil[]>>();
  const diasDe = (fecha: FechaISO): readonly DiaInhabil[] => {
    const anio = Number(fecha.slice(0, 4));
    let mapa = porAnio.get(anio);
    if (!mapa) {
      mapa = new Map();
      for (const dia of diasDescansoLft(anio)) mapa.set(dia.fecha, [congelar(dia)]);
      porAnio.set(anio, mapa);
    }
    return mapa.get(fecha) ?? [];
  };
  return construir("lft", COBERTURA_LFT, diasDe, FUENTE_LFT_715, []);
}
