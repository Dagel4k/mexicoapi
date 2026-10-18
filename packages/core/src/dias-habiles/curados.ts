// Reglas de los calendarios curados de la CNBV y el SAT: los tipos de plazo, la cobertura de
// cada uno, los días que da una regla del núcleo (en el SAT, los del art. 12 del CFF), el
// respaldo y los textos de lo que falta. Las usan la API y el paquete; entra por
// `@mexicoapi/core/curados` y no por el índice, para no pesar en quien solo valida.
import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabilCurado,
  FuenteDof,
  TipoDiaCurado,
} from "../datos/curados.js";
import { CalendarioIncompletoError, DEL_CALENDARIO } from "../errores.js";
import { esFechaIsoValida, type FechaISO, sumarDias } from "../fechas.js";
import { type Calendario, crearCalendario } from "./calendario.js";
import { avisosTransmisionCff, COBERTURA_CFF, diasDescansoCff, FUENTE_CFF_12 } from "./cff.js";
import { type ResultadoDiasHabiles, sumarDiasHabiles } from "./sumar.js";
import type { Autoridad, DiaInhabil, TipoPlazo } from "./tipos.js";

type Rango = { readonly desde: FechaISO; readonly hasta: FechaISO };

/** Tipo de plazo → tipos de día que no cuentan en él. */
export type TablaPlazos = Readonly<Partial<Record<TipoPlazo, readonly TipoDiaCurado[]>>>;

/**
 * Tipos de plazo de cada autoridad y los tipos de día que no cuentan en cada uno. En los plazos
 * para presentar declaraciones y pagar contribuciones no se cuentan las vacaciones generales
 * del SAT como inhábiles (CFF art. 12, segundo párrafo).
 */
export const PLAZOS: Readonly<Record<AutoridadCurada, TablaPlazos>> = Object.freeze({
  cnbv: Object.freeze({ general: Object.freeze([]) }),
  sat: Object.freeze({
    general: Object.freeze([]),
    declaraciones_pagos: Object.freeze(["vacaciones"] as const),
  }),
});

/**
 * Días que el núcleo calcula por regla en un calendario curado, en lugar de transcribirlos del
 * DOF. Son de un tipo de día, tienen la cobertura de la regla y su fuente cita también los
 * sábados y domingos.
 */
export interface ReglaCurada {
  readonly tipo: TipoDiaCurado;
  readonly cobertura: Rango;
  /** Los días de un año de la cobertura, en orden; RangeError fuera de ella. */
  readonly dias: (anio: number) => DiaInhabil[];
  readonly fuente: FuenteDof;
  /** Lo que la regla no resuelve en un cálculo de `desde` (sin contarlo) a `resultado`. */
  readonly avisos: (desde: FechaISO, resultado: FechaISO) => string[];
}

/**
 * Las reglas de cada autoridad. El SAT toma los días de descanso del primer párrafo del art. 12
 * del CFF, que fija la ley y no una publicación anual: su YAML solo trae las vacaciones.
 */
export const REGLAS: Readonly<Partial<Record<AutoridadCurada, ReglaCurada>>> = Object.freeze({
  sat: Object.freeze({
    tipo: "descanso",
    cobertura: COBERTURA_CFF,
    dias: diasDescansoCff,
    fuente: FUENTE_CFF_12,
    avisos: avisosTransmisionCff,
  }),
});

const reglaDe = (autoridad: string): ReglaCurada | undefined =>
  Object.hasOwn(REGLAS, autoridad) ? REGLAS[autoridad as AutoridadCurada] : undefined;

/**
 * Qué puede faltar fuera de la cobertura de cada autoridad (`faltaFuera` de sus calendarios):
 * con `permitirIncompleto`, la advertencia de cada año sin calendario lo nombra. Sin las
 * disposiciones de un año, la CNBV puede cerrar días que no son fin de semana.
 */
const FALTA_FUERA: Readonly<Partial<Record<AutoridadCurada, string>>> = Object.freeze({
  cnbv: "Pueden faltar días de cierre bancario, como el 1 de enero.",
});

/**
 * La cobertura por tipo de día con la de la regla de la autoridad, si tiene: con el SAT,
 * `descanso` es la del art. 12 (hasta 2100). Es la que se pasa a `revisarPlazos`.
 */
export function coberturaConRegla(
  autoridad: AutoridadCurada,
  cobertura: CoberturaCurada,
): CoberturaCurada {
  const regla = reglaDe(autoridad);
  return regla === undefined ? cobertura : { ...cobertura, [regla.tipo]: regla.cobertura };
}

/** Un tipo de plazo de un calendario curado, como lo escribe el build. */
export interface PlazoCalendario {
  /** Rango en que la lista está completa para este tipo de plazo. */
  readonly cobertura: Rango;
  /** Tipos de día que en este plazo no cuentan como inhábiles (`excluirTipos` del núcleo). */
  readonly excluir_tipos: readonly TipoDiaCurado[];
}

export interface RevisionPlazos {
  /** Vacío si un plazo queda sin cobertura o ninguno contiene a los demás. */
  plazos: Partial<Record<TipoPlazo, { cobertura: Rango; excluir_tipos: TipoDiaCurado[] }>>;
  /** La cobertura del plazo que contiene a los demás. */
  amplia: Rango | null;
  fallas: string[];
}

const contiene = (a: Rango, b: Rango): boolean => a.desde <= b.desde && b.hasta <= a.hasta;
const dentro = (fecha: FechaISO, { desde, hasta }: Rango): boolean =>
  fecha >= desde && fecha <= hasta;
const cubre = ({ desde, hasta }: Rango): string => `cubre del ${desde} al ${hasta}`;

/**
 * Los plazos de un calendario a partir de la cobertura de cada tipo de día. La cobertura de un
 * plazo es la intersección de las coberturas de los tipos de día que cuentan en él (con `general`
 * del SAT, hasta donde están publicadas las vacaciones); un plazo debe contener a los demás (la
 * cobertura amplia) y cada día debe caer en ella. Las fallas dicen qué no cumple.
 */
export function revisarPlazos(
  tabla: TablaPlazos,
  cobertura: CoberturaCurada,
  dias: readonly { fecha: FechaISO }[],
): RevisionPlazos {
  const fallas: string[] = [];
  const plazos: RevisionPlazos["plazos"] = {};
  for (const [tipo, excluir] of Object.entries(tabla) as [TipoPlazo, TipoDiaCurado[]][]) {
    const [primero, ...resto] = (Object.keys(cobertura) as TipoDiaCurado[])
      .filter((t) => !excluir.includes(t))
      .map((t) => cobertura[t] as Rango);
    if (primero === undefined) {
      fallas.push(`el plazo ${tipo} no tiene cobertura de un tipo de día que cuente`);
      continue;
    }
    let { desde, hasta } = primero;
    for (const r of resto) {
      if (r.desde > desde) desde = r.desde;
      if (r.hasta < hasta) hasta = r.hasta;
    }
    if (desde > hasta) {
      fallas.push(`la cobertura del plazo ${tipo} queda vacía`);
      continue;
    }
    plazos[tipo] = { cobertura: { desde, hasta }, excluir_tipos: [...excluir] };
  }
  if (fallas.length > 0) return { plazos: {}, amplia: null, fallas };
  const coberturas = Object.values(plazos).map((p) => p.cobertura);
  const amplia = coberturas.find((c) => coberturas.every((otra) => contiene(c, otra)));
  if (amplia === undefined) {
    return {
      plazos: {},
      amplia: null,
      fallas: ["ningún tipo de plazo contiene la cobertura de los demás"],
    };
  }
  const lista = Object.entries(plazos)
    .map(([tipo, p]) => `${tipo} del ${p.cobertura.desde} al ${p.cobertura.hasta}`)
    .join("; ");
  for (const { fecha } of dias) {
    if (!dentro(fecha, amplia)) {
      fallas.push(`${fecha}: no cae en la cobertura de ningún tipo de plazo (${lista})`);
    }
  }
  return { plazos, amplia, fallas };
}

/**
 * El calendario de una autoridad como lo escribe el build (`calendarios/<autoridad>.json` de la
 * API y `data/dias-inhabiles-<autoridad>/calendario.json` más los días).
 */
export interface DatosCalendarioCurado {
  readonly autoridad: AutoridadCurada;
  /** `general` siempre; el SAT agrega `declaraciones_pagos`. */
  readonly plazos: Readonly<Partial<Record<TipoPlazo, PlazoCalendario>>>;
  /**
   * Por año de la cobertura amplia (`"2026"`), la publicación que cita sus sábados y domingos.
   * Vacío en una autoridad con regla (el SAT): los cita la fuente de la regla.
   */
  readonly fuentes_fin_de_semana: Readonly<Record<string, FuenteDof>>;
  /**
   * Los días publicados, en orden de fecha, sin `autoridad`. Con regla, los días de su tipo son
   * opcionales y deben ser iguales a los de la regla: el calendario los toma de ella.
   */
  readonly dias: readonly Omit<DiaInhabilCurado, "autoridad">[];
}

export interface PlazoCurado {
  readonly cobertura: Rango;
  /** Tipos de día que no son inhábiles en este plazo. */
  readonly excluirTipos: readonly TipoDiaCurado[];
  readonly calendario: Calendario;
  /**
   * Solo si la cobertura del plazo es más corta que la amplia: el mismo plazo con la cobertura
   * amplia y todos los días publicados en ella. Con `permitirIncompleto` calcula con lo conocido
   * fuera de la cobertura del plazo (el 25 de diciembre del SAT) en vez de descontar solo fines
   * de semana.
   */
  readonly respaldo?: Calendario;
}

/** El calendario de una autoridad con un `Calendario` por tipo de plazo. Está congelado. */
export interface CalendarioCurado {
  readonly autoridad: AutoridadCurada;
  /**
   * Los plazos de los datos, todos de `PLAZOS` para la autoridad, en orden fijo: `general` y, en
   * el SAT, `declaraciones_pagos`. `plazos.get(tipo)` da undefined si el calendario no tiene ese
   * plazo (la CNBV solo tiene `general`). En JSON sale como un objeto por tipo de plazo.
   */
  readonly plazos: ReadonlyMap<TipoPlazo, PlazoCurado>;
  /** Cuenta todos los tipos de día: en su cobertura la lista está completa. */
  readonly general: PlazoCurado;
  /** La cobertura del plazo que contiene a las de los demás. */
  readonly amplia: Rango;
  /**
   * Los días inhábiles en la cobertura amplia, en orden, sin los fines de semana: los publicados
   * y, con regla, los de la regla (en el SAT, los del art. 12 de cada año hasta 2100).
   */
  readonly dias: readonly DiaInhabil[];
}

const mayor = (a: FechaISO, b: FechaISO): FechaISO => (a > b ? a : b);
const menor = (a: FechaISO, b: FechaISO): FechaISO => (a < b ? a : b);

/** Lo que usa `util.inspect` de Node; se pide por su nombre para no depender de `node:`. */
const INSPECCIONAR: unique symbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * Vista de solo lectura de un Map: no tiene `set`, `delete` ni `clear`, y como no es un Map,
 * `Map.prototype.set.call(vista, …)` lanza TypeError. En JSON es un objeto por llave y al
 * inspeccionarla en Node se ve como el Map que guarda. La usan los calendarios curados y las
 * cargas del Worker que viven entre peticiones.
 */
export class MapaCongelado<K extends string, V> implements ReadonlyMap<K, V> {
  readonly #mapa: Map<K, V>;

  constructor(mapa: Map<K, V>) {
    this.#mapa = mapa;
    Object.freeze(this);
  }

  get size(): number {
    return this.#mapa.size;
  }

  get(clave: K): V | undefined {
    return this.#mapa.get(clave);
  }

  has(clave: K): boolean {
    return this.#mapa.has(clave);
  }

  forEach(fn: (valor: V, clave: K, mapa: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [clave, valor] of this.#mapa) fn.call(thisArg, valor, clave, this);
  }

  entries(): MapIterator<[K, V]> {
    return this.#mapa.entries();
  }

  keys(): MapIterator<K> {
    return this.#mapa.keys();
  }

  values(): MapIterator<V> {
    return this.#mapa.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#mapa.entries();
  }

  toJSON(): Record<K, V> {
    return Object.fromEntries(this.#mapa) as Record<K, V>;
  }

  [INSPECCIONAR](): Map<K, V> {
    return new Map(this.#mapa);
  }
}

/** Todos los tipos de plazo, en el orden en que salen en `plazos`. */
const TIPOS_PLAZO: readonly string[] = ["general", "declaraciones_pagos"];
const TIPOS_DIA: readonly string[] = ["descanso", "vacaciones"];

const lista = (tipos: readonly string[]): string => `[${tipos.join(", ")}]`;
const mismosTipos = (a: readonly string[], b: readonly string[]): boolean =>
  lista([...a].sort()) === lista([...b].sort());

/** Una copia congelada de la cita con solo sus campos: cambiar la entrada después no la toca. */
const copiarFuente = ({ nombre, url, fecha_publicacion, fragmento }: FuenteDof): FuenteDof =>
  Object.freeze({ nombre, url, fecha_publicacion, fragmento });

const esRango = (r: Rango): boolean =>
  esFechaIsoValida(r.desde) && esFechaIsoValida(r.hasta) && r.desde <= r.hasta;

const mismaFuente = (a: FuenteDof, b: FuenteDof): boolean =>
  a.nombre === b.nombre &&
  a.url === b.url &&
  a.fecha_publicacion === b.fecha_publicacion &&
  a.fragmento === b.fragmento;

/** Los días de la regla dentro de `rango`, por fecha. */
function diasDeRegla(regla: ReglaCurada, rango: Rango): Map<FechaISO, DiaInhabil> {
  const dias = new Map<FechaISO, DiaInhabil>();
  const desde = mayor(rango.desde, regla.cobertura.desde);
  const hasta = menor(rango.hasta, regla.cobertura.hasta);
  for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) {
    for (const dia of regla.dias(anio)) {
      if (dentro(dia.fecha, rango)) dias.set(dia.fecha, Object.freeze({ ...dia }));
    }
  }
  return dias;
}

/**
 * Arma el calendario de una autoridad: un `Calendario` por tipo de plazo con los días de su
 * cobertura y, si el plazo es más corto que la cobertura amplia, su respaldo. Lanza RangeError si
 * los datos no cumplen las reglas: cada plazo es de `PLAZOS` para su autoridad y trae sus mismos
 * `excluir_tipos` (si falta uno distinto de `general`, solo ese plazo no existe); `general`
 * cuenta todos los tipos de día, un plazo contiene las coberturas de los demás, cada año de esa
 * cobertura cita sus fines de semana (y ningún otro) y los días van en orden estricto y dentro de
 * ella. Con regla (`REGLAS`), los plazos que cuentan su tipo de día caen en su cobertura, los
 * fines de semana los cita la regla, un día de su tipo debe ser igual al de la regla y un día de
 * otro tipo no puede caer en uno de la regla. Copia y congela lo que recibe, con solo los campos
 * de cada cita.
 */
export function crearCalendarioCurado(datos: DatosCalendarioCurado): CalendarioCurado {
  const { autoridad } = datos;
  const tabla = Object.hasOwn(PLAZOS, autoridad) ? PLAZOS[autoridad] : undefined;
  if (tabla === undefined) {
    throw new RangeError(
      `No hay calendario curado de ${String(autoridad)}: solo de ${Object.keys(PLAZOS).join(" y ")}.`,
    );
  }
  const falla = (motivo: string) => new RangeError(`El calendario de ${autoridad} ${motivo}.`);
  const leidos: [TipoPlazo, Rango, readonly TipoDiaCurado[]][] = [];
  for (const [tipo, plazo] of Object.entries(datos.plazos)) {
    if (!TIPOS_PLAZO.includes(tipo) || plazo === undefined) {
      throw falla(`tiene un tipo de plazo inesperado: ${tipo}`);
    }
    const { cobertura, excluir_tipos } = plazo;
    if (!esRango(cobertura) || !excluir_tipos.every((t) => TIPOS_DIA.includes(t))) {
      throw falla(`tiene una cobertura o tipos de día inesperados en ${tipo}`);
    }
    leidos.push([
      tipo as TipoPlazo,
      Object.freeze({ desde: cobertura.desde, hasta: cobertura.hasta }),
      Object.freeze([...excluir_tipos]),
    ]);
  }
  const general = leidos.find(([tipo]) => tipo === "general");
  if (general === undefined || general[2].length > 0) {
    throw falla("no tiene un plazo general que cuente todos los días");
  }
  for (const [tipo, , excluir] of leidos) {
    const pide = tabla[tipo];
    if (pide === undefined) {
      throw falla(
        `trae el tipo de plazo ${tipo}, que no es suyo (solo ${Object.keys(tabla).join(" y ")})`,
      );
    }
    if (!mismosTipos(excluir, pide)) {
      throw falla(
        `tiene en ${tipo} excluir_tipos ${lista(excluir)} y la regla del núcleo pide ${lista(pide)}`,
      );
    }
  }
  leidos.sort(([a], [b]) => TIPOS_PLAZO.indexOf(a) - TIPOS_PLAZO.indexOf(b));
  const coberturas = leidos.map(([, cobertura]) => cobertura);
  const amplia = coberturas.find((c) => coberturas.every((otra) => contiene(c, otra)));
  if (amplia === undefined) throw falla("no tiene un plazo que contenga a los demás");

  const regla = reglaDe(autoridad);
  const citadas = datos.fuentes_fin_de_semana;
  let fuenteFinDeSemana: (anio: number) => FuenteDof;
  const nombreRegla = `la regla del núcleo (${regla?.fuente.nombre})`;
  if (regla !== undefined) {
    const { desde, hasta } = regla.cobertura;
    for (const [tipo, cobertura, excluir] of leidos) {
      if (!excluir.includes(regla.tipo) && !contiene(regla.cobertura, cobertura)) {
        throw falla(
          `tiene en ${tipo} una cobertura fuera de la de la regla del núcleo (del ${desde} al ${hasta})`,
        );
      }
    }
    if (Object.keys(citadas).length > 0) {
      throw falla(`cita fines de semana, que cita ${nombreRegla}`);
    }
    fuenteFinDeSemana = () => regla.fuente;
  } else {
    const fuentes = new Map<number, FuenteDof>();
    const primero = Number(amplia.desde.slice(0, 4));
    const ultimo = Number(amplia.hasta.slice(0, 4));
    for (let anio = primero; anio <= ultimo; anio++) {
      const fuente = Object.hasOwn(citadas, String(anio)) ? citadas[String(anio)] : undefined;
      if (fuente === undefined) throw falla(`no cita los fines de semana de ${anio}`);
      fuentes.set(anio, copiarFuente(fuente));
    }
    if (Object.keys(citadas).length !== fuentes.size) {
      throw falla("cita fines de semana de años fuera de su cobertura");
    }
    // La cobertura de cada plazo cae en la amplia: todos sus años tienen fuente.
    fuenteFinDeSemana = (anio) => fuentes.get(anio) as FuenteDof;
  }

  const deRegla =
    regla === undefined ? new Map<FechaISO, DiaInhabil>() : diasDeRegla(regla, amplia);
  const publicados: DiaInhabil[] = [];
  let anterior = "";
  for (const { fecha, motivo, tipo, fuente } of datos.dias) {
    if (
      !esFechaIsoValida(fecha) ||
      fecha <= anterior ||
      !dentro(fecha, amplia) ||
      !TIPOS_DIA.includes(tipo)
    ) {
      throw falla(`tiene un día inesperado, repetido o fuera de orden: ${fecha}`);
    }
    anterior = fecha;
    const delaRegla = deRegla.get(fecha);
    if (regla !== undefined && tipo === regla.tipo) {
      if (delaRegla === undefined) {
        throw falla(`trae el día de ${tipo} ${fecha}, que no da ${nombreRegla}`);
      }
      if (delaRegla.motivo !== motivo || !mismaFuente(delaRegla.fuente as FuenteDof, fuente)) {
        throw falla(`trae el día de ${tipo} ${fecha} distinto del que da ${nombreRegla}`);
      }
      // El calendario lo toma de la regla.
      continue;
    }
    if (delaRegla !== undefined) {
      throw falla(
        `trae como ${tipo} el ${fecha}, que ya es de ${delaRegla.tipo} por ${nombreRegla}`,
      );
    }
    publicados.push(Object.freeze({ fecha, motivo, tipo, fuente: copiarFuente(fuente) }));
  }
  const dias = [...deRegla.values(), ...publicados].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  const armar = (cobertura: Rango, excluirTipos: readonly TipoDiaCurado[]) =>
    crearCalendario({
      autoridad,
      cobertura,
      dias: dias.filter((d) => dentro(d.fecha, cobertura)),
      fuenteFinDeSemana,
      excluirTipos,
      avisos: regla?.avisos,
      faltaFuera: FALTA_FUERA[autoridad],
    });
  const plazos = new Map<TipoPlazo, PlazoCurado>();
  for (const [tipo, cobertura, excluirTipos] of leidos) {
    const calendario = armar(cobertura, excluirTipos);
    plazos.set(
      tipo,
      Object.freeze(
        contiene(cobertura, amplia)
          ? { cobertura, excluirTipos, calendario }
          : { cobertura, excluirTipos, calendario, respaldo: armar(amplia, excluirTipos) },
      ),
    );
  }
  return Object.freeze({
    autoridad,
    plazos: new MapaCongelado(plazos),
    general: plazos.get("general") as PlazoCurado,
    amplia,
    dias: Object.freeze(dias),
  });
}

/**
 * Los tipos de día que cuenta `plazo` y que excluyen todos los plazos que cumplen `cubren`: los
 * que pueden faltar donde solo esos plazos están completos.
 */
function faltan(
  calendario: CalendarioCurado,
  plazo: PlazoCurado,
  cubren: (p: PlazoCurado) => boolean,
): TipoDiaCurado[] {
  const otros = [...calendario.plazos.values()].filter(cubren);
  return (TIPOS_DIA as TipoDiaCurado[]).filter(
    (t) => !plazo.excluirTipos.includes(t) && otros.every((p) => p.excluirTipos.includes(t)),
  );
}

/**
 * El texto de una fecha que el plazo no cubre. Si otro plazo sí la cubre, dice por qué este no
 * (qué tipos de día faltan) y hasta dónde llega el otro: con el SAT 2026, general termina el 30
 * de noviembre porque falta el segundo periodo de vacaciones, y declaraciones_pagos llega al 31
 * de diciembre.
 */
function detalleCurado(
  calendario: CalendarioCurado,
  tipo: TipoPlazo,
  plazo: PlazoCurado,
  { fecha, cobertura }: CalendarioIncompletoError,
): string {
  const cual = calendario.plazos.size > 1 ? ` para tipo_plazo=${tipo}` : "";
  const base = `El calendario ${DEL_CALENDARIO[calendario.autoridad]}${cual} no cubre ${fecha}; ${cubre(cobertura)}`;
  const otros = [...calendario.plazos].filter(([, p]) => dentro(fecha, p.cobertura));
  const tipos = faltan(calendario, plazo, (p) => dentro(fecha, p.cobertura));
  if (otros.length === 0 || tipos.length === 0) return `${base}.`;
  const lado = fecha > cobertura.hasta ? "posteriores" : "anteriores";
  return [
    `${base} porque los días de tipo ${tipos.join(" y ")} ${lado} no están publicados o no se han cargado.`,
    ...otros.map(([t, p]) => `Con tipo_plazo=${t}, que no los cuenta, ${cubre(p.cobertura)}.`),
  ].join(" ");
}

/**
 * El primer día contado (de `desde` + 1 a `resultado`) que cae en la cobertura amplia pero fuera
 * de la del plazo, o undefined si el cálculo no pasó por ahí.
 */
function primerDiaFueraDelPlazo(
  { desde, resultado }: ResultadoDiasHabiles,
  plazo: Rango,
  amplia: Rango,
): FechaISO | undefined {
  const inicio = mayor(sumarDias(desde, 1), amplia.desde);
  const fin = menor(resultado, amplia.hasta);
  if (inicio > fin) return undefined;
  if (!dentro(inicio, plazo)) return inicio;
  return fin > plazo.hasta ? sumarDias(plazo.hasta, 1) : undefined;
}

export interface ConsultaDiasHabilesCurado {
  tipoPlazo: TipoPlazo;
  desde: FechaISO;
  /** De 1 a 3650. */
  dias: number;
  /**
   * Calcula fuera de la cobertura con advertencia: con el respaldo del plazo, si lo tiene, y más
   * allá de la cobertura amplia contando solo fines de semana.
   */
  permitirIncompleto?: boolean | undefined;
}

/**
 * Suma días hábiles con un tipo de plazo del calendario, como la API. Fuera de la cobertura del
 * plazo lanza CalendarioIncompletoError con un `detalle` que dice por qué no la cubre. Con
 * `permitirIncompleto`, un plazo con respaldo descuenta también los días publicados fuera de su
 * cobertura y, si el cálculo pasa por ahí, lo advierte antes que las advertencias del núcleo.
 * Lanza RangeError si el calendario no tiene ese plazo o los parámetros no son válidos, y
 * FechaFueraDeRangoError si el resultado pasaría de 9999.
 */
export function sumarDiasHabilesCurado(
  calendario: CalendarioCurado,
  consulta: ConsultaDiasHabilesCurado,
): ResultadoDiasHabiles {
  const { tipoPlazo, desde, dias, permitirIncompleto = false } = consulta;
  const plazo = calendario.plazos.get(tipoPlazo);
  if (plazo === undefined) {
    throw new RangeError(
      `El calendario de ${calendario.autoridad} no tiene el tipo de plazo ${tipoPlazo}.`,
    );
  }
  const { respaldo } = plazo;
  let resultado: ResultadoDiasHabiles;
  try {
    resultado = sumarDiasHabiles({
      calendario: permitirIncompleto && respaldo !== undefined ? respaldo : plazo.calendario,
      desde,
      dias,
      permitirIncompleto,
    });
  } catch (error) {
    if (!(error instanceof CalendarioIncompletoError)) throw error;
    const { autoridad, fecha, cobertura } = error;
    const detalle = detalleCurado(calendario, tipoPlazo, plazo, error);
    throw new CalendarioIncompletoError(autoridad, fecha, cobertura, detalle);
  }
  if (!permitirIncompleto || respaldo === undefined) return resultado;
  const fuera = primerDiaFueraDelPlazo(resultado, plazo.cobertura, calendario.amplia);
  if (fuera === undefined) return resultado;
  const tipos = faltan(calendario, plazo, (p) => dentro(fuera, p.cobertura));
  if (tipos.length === 0) return resultado;
  const aviso = `Calendario incompleto: ${calendario.autoridad.toUpperCase()} con tipo_plazo=${tipoPlazo} ${cubre(plazo.cobertura)}; fuera de ese rango pueden faltar días de tipo ${tipos.join(" y ")}, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana.`;
  return { ...resultado, advertencias: [aviso, ...resultado.advertencias] };
}

/** El año con 4 cifras (`"0001"`); lanza RangeError si no es un entero de 1 a 9999. */
function textoAnio(anio: number): string {
  if (!Number.isInteger(anio) || anio < 1 || anio > 9999) {
    throw new RangeError(`El año debe ser un entero de 1 a 9999: ${anio}`);
  }
  return String(anio).padStart(4, "0");
}

const cubreAnio = (anio: string, { desde, hasta }: Rango): boolean =>
  `${anio}-01-01` >= desde && `${anio}-12-31` <= hasta;

/**
 * Lanza CalendarioIncompletoError si `cobertura` no tiene completo el año `anio`, con la primera
 * fecha del año que falta (el 1 de enero, o el día siguiente al fin de la cobertura si el año
 * empieza dentro de ella) y el texto de la API. Sirve para listar los días de un año de cualquier
 * calendario, también el de la LFT.
 */
export function exigirAnio(autoridad: Autoridad, anio: number, cobertura: Rango): void {
  const texto = textoAnio(anio);
  if (cubreAnio(texto, cobertura)) return;
  const inicio = `${texto}-01-01`;
  const fecha = dentro(inicio, cobertura) ? sumarDias(cobertura.hasta, 1) : inicio;
  const detalle = `El calendario ${DEL_CALENDARIO[autoridad]} no cubre el año ${texto}; ${cubre(cobertura)}.`;
  throw new CalendarioIncompletoError(autoridad, fecha, cobertura, detalle);
}

/**
 * Qué puede faltar en la lista de `anio` cuando el plazo general no cubre todo el año. Un tipo de
 * día está completo en el año si lo cuenta algún plazo que lo cubre; los que todos esos plazos
 * excluyen solo están completos en la cobertura de general. Al final, lo que la regla de la
 * autoridad no resuelve en el año (en el SAT, la transmisión del Poder Ejecutivo).
 */
function advertencias(calendario: CalendarioCurado, anio: string): string[] {
  const { autoridad, general, plazos } = calendario;
  const regla = reglaDe(autoridad);
  // El año ya está en la cobertura amplia: el día anterior a su 1 de enero existe.
  const deRegla = regla?.avisos(sumarDias(`${anio}-01-01`, -1), `${anio}-12-31`) ?? [];
  // Con los plazos de PLAZOS, si general no cubre el año lo cubre un plazo que excluye algo.
  const tipos = cubreAnio(anio, general.cobertura)
    ? []
    : faltan(calendario, general, (p) => cubreAnio(anio, p.cobertura));
  if (tipos.length === 0) return deRegla;
  const { desde, hasta } = general.cobertura;
  const completas = [...plazos]
    .filter(([, p]) => cubreAnio(anio, p.cobertura))
    .map(
      ([tipo]) => `Para tipo_plazo=${tipo}, que no los cuenta, la lista de ${anio} está completa.`,
    );
  return [
    [
      `Los días de tipo ${tipos.join(" y ")} ${DEL_CALENDARIO[autoridad]} solo están completos del ${desde} al ${hasta}; fuera de ese rango pueden faltar.`,
      ...completas,
    ].join(" "),
    ...deRegla,
  ];
}

export interface DiasInhabilesCurados {
  /** Los días publicados del año, sin fines de semana. */
  dias: DiaInhabil[];
  /** Vacío si la lista está completa para todos los tipos de plazo. */
  advertencias: string[];
}

/**
 * Los días inhábiles de un año. Se responde si un plazo lo cubre completo (la cobertura amplia);
 * si el plazo general no lo cubre, con advertencias de lo que puede faltar: así el SAT 2026 lista
 * lo publicado aunque falte su segundo periodo de vacaciones. Si el año no está completo en la
 * cobertura amplia, lanza CalendarioIncompletoError como `exigirAnio`.
 */
export function diasInhabilesCurados(
  calendario: CalendarioCurado,
  anio: number,
): DiasInhabilesCurados {
  exigirAnio(calendario.autoridad, anio, calendario.amplia);
  const texto = textoAnio(anio);
  return {
    dias: calendario.dias.filter((d) => d.fecha.startsWith(`${texto}-`)),
    advertencias: advertencias(calendario, texto),
  };
}

/**
 * Los días de descanso de la CNBV, dentro de su cobertura, como días sin publicación del FIX
 * (`sinPublicacion` de fixPublicado y fixParaOperacion): el DOF no lo publica en los feriados
 * bancarios. Unas vacaciones administrativas no cierran los bancos, y fuera de la cobertura no se
 * sabe: ahí solo cuentan los fines de semana.
 */
export function feriadosBancarios(cnbv: CalendarioCurado): (fecha: FechaISO) => boolean {
  if (cnbv.autoridad !== "cnbv") {
    throw new RangeError(
      `Los feriados bancarios salen del calendario de la CNBV, no de ${cnbv.autoridad}.`,
    );
  }
  const { cobertura, calendario } = cnbv.general;
  return (fecha) => dentro(fecha, cobertura) && calendario.inhabil(fecha)?.tipo === "descanso";
}
