import { type Aviso, aAviso, avisosDe } from "../avisos.js";
import { CalendarioIncompletoError } from "../errores.js";
import { aDias, diaSemanaDeDias, esFechaIsoValida, type FechaISO } from "../fechas.js";
import { avisoLft715, COBERTURA_LFT, diasDescansoLft, FUENTE_LFT_715 } from "./lft.js";
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
   * a `resultado`, solo los textos. `sumarDiasHabiles` lo agrega al final de sus advertencias, con
   * el código que dio quien armó el calendario: la LFT avisa siempre que no tiene los festivos ni
   * las suspensiones de labores del art. 715.
   */
  readonly avisos?: (desde: FechaISO, resultado: FechaISO) => readonly string[];
  /**
   * Qué puede faltar fuera de la cobertura. Con `permitirIncompleto`, `sumarDiasHabiles` lo agrega
   * a la advertencia de cada año sin calendario: la CNBV, los días de cierre bancario.
   */
  readonly faltaFuera?: string;
  /**
   * Con `permitirIncompleto`, `sumarDiasHabiles` calcula con este respaldo en vez de descontar
   * solo fines de semana fuera de la cobertura (en el SAT con `general`, el 25 de diciembre
   * después de las vacaciones publicadas). Sin `permitirIncompleto` no se usa.
   */
  readonly respaldo?: RespaldoCalendario;
}

/** El respaldo de un calendario: lo que se sabe más allá de su cobertura y su aviso. */
export interface RespaldoCalendario {
  /** El mismo plazo con una cobertura que contiene a la del calendario. */
  readonly calendario: Calendario;
  /**
   * La advertencia de un cálculo de `desde` (sin contarlo) a `resultado` con el respaldo, con su
   * código o solo el texto, o undefined si no hay nada que avisar. `sumarDiasHabiles` la pone
   * antes que las demás.
   */
  readonly aviso: (desde: FechaISO, resultado: FechaISO) => Aviso | string | undefined;
}

/**
 * Los avisos de un calendario; los que no se dan no quedan como propiedad. Cada aviso puede ir con
 * su código (`{ codigo, texto }`) o solo como texto, y entonces su código es el de `codigoAviso`.
 */
export interface AvisosCalendario {
  avisos?: ((desde: FechaISO, resultado: FechaISO) => readonly (Aviso | string)[]) | undefined;
  faltaFuera?: string | undefined;
  respaldo?: RespaldoCalendario | undefined;
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

/** Una copia congelada del respaldo; RangeError si no es de la autoridad o no cubre lo mismo. */
function copiarRespaldo(
  autoridad: Autoridad,
  cobertura: Cobertura,
  { calendario, aviso }: RespaldoCalendario,
): RespaldoCalendario {
  if (calendario.autoridad !== autoridad) {
    throw new RangeError("El respaldo debe ser un calendario de la misma autoridad.");
  }
  if (
    calendario.cobertura.desde > cobertura.desde ||
    calendario.cobertura.hasta < cobertura.hasta
  ) {
    throw new RangeError("La cobertura del respaldo debe contener la del calendario.");
  }
  return Object.freeze({ calendario, aviso });
}

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

type AvisosConCodigo = (desde: FechaISO, resultado: FechaISO) => Aviso[];

/**
 * Los avisos con su código de cada calendario que arma `construir`: `Calendario.avisos` da solo
 * los textos, como en la 0.1.0, y aquí quedan los códigos que dio quien armó el calendario.
 */
const conCodigo = new WeakMap<Calendario, AvisosConCodigo>();

/**
 * Los avisos de un cálculo de `desde` (sin contarlo) a `resultado` con `calendario`, con su
 * código. Uno armado a mano, que no pasó por `crearCalendario`, solo da textos: su código sale de
 * `codigoAviso`.
 */
export function avisosDelCalendario(
  calendario: Calendario,
  desde: FechaISO,
  resultado: FechaISO,
): Aviso[] {
  const avisos = conCodigo.get(calendario);
  if (avisos !== undefined) return avisos(desde, resultado);
  return avisosDe(calendario.avisos?.(desde, resultado) ?? []);
}

function construir(
  autoridad: Autoridad,
  cobertura: Cobertura,
  // Recibe la fecha ya validada y su número de día (aDias).
  diasDe: (fecha: FechaISO, numero: number) => readonly DiaInhabil[],
  fuenteFinDeSemana: FuenteFinDeSemana,
  excluirTipos: readonly DiaInhabil["tipo"][],
  { avisos, faltaFuera, respaldo }: AvisosCalendario = {},
): Calendario {
  const fija = Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta });
  const fuenteFds = fuentePorAnio(fuenteFinDeSemana);
  const conSuCodigo: AvisosConCodigo | undefined =
    avisos === undefined ? undefined : (desde, resultado) => avisos(desde, resultado).map(aAviso);
  const calendario: Calendario = {
    autoridad,
    cobertura: fija,
    ...(conSuCodigo === undefined
      ? {}
      : { avisos: (desde, resultado) => conSuCodigo(desde, resultado).map((a) => a.texto) }),
    ...(faltaFuera === undefined ? {} : { faltaFuera }),
    ...(respaldo === undefined ? {} : { respaldo: copiarRespaldo(autoridad, fija, respaldo) }),
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
  Object.freeze(calendario);
  if (conSuCodigo !== undefined) conCodigo.set(calendario, conSuCodigo);
  return calendario;
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
    { avisos: opciones.avisos, faltaFuera: opciones.faltaFuera, respaldo: opciones.respaldo },
  );
}

const AVISOS_LFT = (): Aviso[] => [avisoLft715()];

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
