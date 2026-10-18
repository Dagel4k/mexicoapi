import { CalendarioIncompletoError } from "../errores.js";
import { aDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";
import { AVISO_LFT_715, COBERTURA_LFT, diasDescansoLft, FUENTE_LFT_715 } from "./lft.js";
import type { Autoridad, DiaInhabil, Fuente } from "./tipos.js";

type Cobertura = { readonly desde: FechaISO; readonly hasta: FechaISO };

/** `crearCalendario` y `calendarioLft` lo devuelven congelado. */
export interface Calendario {
  readonly autoridad: Autoridad;
  readonly cobertura: { readonly desde: FechaISO; readonly hasta: FechaISO };
  /** Incluye fines de semana; lanza CalendarioIncompletoError fuera de cobertura. */
  readonly inhabil: (fecha: FechaISO) => DiaInhabil | null;
  /**
   * Lo que el calendario no descuenta y conviene revisar en un cálculo de `desde` (sin contarlo)
   * a `resultado`. `sumarDiasHabiles` lo agrega al final de sus advertencias: la LFT avisa siempre
   * que no tiene las suspensiones de labores del art. 715.
   */
  readonly avisos?: (desde: FechaISO, resultado: FechaISO) => readonly string[];
  /**
   * Qué puede faltar fuera de la cobertura. Con `permitirIncompleto`, `sumarDiasHabiles` lo agrega
   * a la advertencia de cada año sin calendario: la CNBV, los días de cierre bancario.
   */
  readonly faltaFuera?: string;
}

/** Los avisos de un calendario; los que no se dan no quedan como propiedad. */
export interface AvisosCalendario {
  avisos?: ((desde: FechaISO, resultado: FechaISO) => readonly string[]) | undefined;
  faltaFuera?: string | undefined;
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

/**
 * Quién dice que los sábados y domingos son inhábiles: una sola fuente, o una por año cuando
 * cada año tiene su publicación (las disposiciones anuales de la CNBV).
 */
export type FuenteFinDeSemana = Fuente | ((anio: number) => Fuente);

/** Una copia congelada de la fuente de cada año, pedida la primera vez que hace falta. */
function fuentePorAnio(fuente: FuenteFinDeSemana): (anio: number) => Fuente {
  if (typeof fuente !== "function") {
    const fija = Object.freeze({ ...fuente });
    return () => fija;
  }
  const porAnio = new Map<number, Fuente>();
  return (anio) => {
    let copia = porAnio.get(anio);
    if (copia === undefined) {
      copia = Object.freeze({ ...fuente(anio) });
      porAnio.set(anio, copia);
    }
    return copia;
  };
}

function construir(
  autoridad: Autoridad,
  cobertura: Cobertura,
  // Recibe la fecha ya validada y su número de día (aDias).
  diasDe: (fecha: FechaISO, numero: number) => readonly DiaInhabil[],
  fuenteFinDeSemana: FuenteFinDeSemana,
  excluirTipos: readonly DiaInhabil["tipo"][],
  { avisos, faltaFuera }: AvisosCalendario = {},
): Calendario {
  const fija = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
  const fuenteFds = fuentePorAnio(fuenteFinDeSemana);
  const calendario: Calendario = {
    autoridad,
    cobertura: fija,
    ...(avisos === undefined ? {} : { avisos }),
    ...(faltaFuera === undefined ? {} : { faltaFuera }),
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
          fuente: fuenteFds(Number(fecha.slice(0, 4))),
        });
      }
      return null;
    },
  };
  return Object.freeze(calendario);
}

export function crearCalendario(
  opciones: {
    autoridad: Autoridad;
    cobertura: { desde: FechaISO; hasta: FechaISO };
    dias: readonly DiaInhabil[];
    fuenteFinDeSemana: FuenteFinDeSemana;
    excluirTipos?: readonly DiaInhabil["tipo"][];
  } & AvisosCalendario,
): Calendario {
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
    { avisos: opciones.avisos, faltaFuera: opciones.faltaFuera },
  );
}

const AVISOS_LFT = (): readonly string[] => [AVISO_LFT_715];

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
  return construir("lft", COBERTURA_LFT, diasDe, FUENTE_LFT_715, [], { avisos: AVISOS_LFT });
}
