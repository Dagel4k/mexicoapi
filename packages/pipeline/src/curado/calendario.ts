// El calendario de una autoridad a partir de su YAML curado: lo que `curar` escribe en
// `calendario.json`, lo que el sitio publica para el Worker y lo que el bot usa para saber qué
// días no hay FIX. Se arma siempre con `crearCalendarioCurado` del núcleo, como el Worker y el
// paquete: un YAML que ellos rechazarían falla aquí con el mismo mensaje. Los días que el núcleo
// calcula por regla (en el SAT, los del art. 12 del CFF) no se capturan: la lista publicada los
// trae de los años que cubre el YAML y el calendario, de todos los años de la regla.
import type {
  AutoridadCurada,
  CoberturaCurada,
  CoberturaSerie,
  DiaInhabilCurado,
  FuenteDof,
} from "@mexicoapi/core";
import {
  type CalendarioCurado,
  coberturaConRegla,
  crearCalendarioCurado,
  type DatosCalendarioCurado,
  PLAZOS,
  type PlazoCalendario,
  REGLAS,
  type ReglaCurada,
  revisarPlazos,
} from "@mexicoapi/core/curados";
import { ordenarPorClave } from "../canonico.js";
import { ErrorDatos } from "../errores.js";
import { anioDe } from "../fecha.js";
import type { FuenteCurada } from "./esquemas.js";

export type { PlazoCalendario } from "@mexicoapi/core/curados";

/**
 * `v1/_internos/calendarios/<autoridad>.json`: lo que el Worker pasa a `crearCalendarioCurado`
 * del núcleo, que arma un calendario por tipo de plazo con los días de su cobertura (en el SAT,
 * el 25 de diciembre queda fuera de `general`). Sin `dias` es el `calendario.json` de `curar`.
 */
export interface ShardCalendario extends DatosCalendarioCurado {
  /** `general` siempre; el SAT agrega `declaraciones_pagos`. */
  plazos: { general: PlazoCalendario; declaraciones_pagos?: PlazoCalendario };
  /**
   * Por año de la cobertura amplia (`"2026"`), la publicación que cita los sábados y domingos
   * de ese año. El Worker toma la del año de cada fecha. Vacío con regla: los cita su fuente.
   */
  fuentes_fin_de_semana: Record<string, FuenteDof>;
  /** Todos los días de la lista publicada, por fecha, sin `autoridad`. */
  dias: Omit<DiaInhabilCurado, "autoridad">[];
}

type Rango = { readonly desde: string; readonly hasta: string };

const reglaDe = (autoridad: AutoridadCurada): ReglaCurada | undefined =>
  Object.hasOwn(REGLAS, autoridad) ? REGLAS[autoridad] : undefined;

/** La licencia de los textos legislativos que cita una regla del núcleo. */
const LICENCIA_DE_REGLA = {
  licencia:
    "Texto oficial publicado en el DOF; no es objeto de derecho de autor (LFDA art. 14, fracción VIII)",
  licencia_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
};

/**
 * La fuente de la regla del núcleo de una autoridad con su licencia, como la cita el manifiesto;
 * undefined si la autoridad no tiene regla.
 */
export function fuenteDeRegla(autoridad: AutoridadCurada): FuenteCurada | undefined {
  const regla = reglaDe(autoridad);
  if (regla === undefined) return undefined;
  const { nombre, url, fecha_publicacion, fragmento } = regla.fuente;
  return { nombre, url, fecha_publicacion, fragmento, ...LICENCIA_DE_REGLA };
}

/**
 * Los años completos que cubre el YAML (del primero al último de sus coberturas), dentro de la
 * cobertura de la regla: en ellos la lista publicada trae los días de la regla.
 */
function aniosDeLaLista(regla: ReglaCurada, cobertura: CoberturaCurada): Rango | undefined {
  const rangos = Object.values(cobertura) as Rango[];
  if (rangos.length === 0) return undefined;
  const primero = Math.min(...rangos.map((r) => anioDe(r.desde)));
  const ultimo = Math.max(...rangos.map((r) => anioDe(r.hasta)));
  const desde = `${String(primero).padStart(4, "0")}-01-01`;
  const hasta = `${String(ultimo).padStart(4, "0")}-12-31`;
  const r = {
    desde: desde > regla.cobertura.desde ? desde : regla.cobertura.desde,
    hasta: hasta < regla.cobertura.hasta ? hasta : regla.cobertura.hasta,
  };
  return r.desde <= r.hasta ? r : undefined;
}

/**
 * Los registros de un calendario como se publican (`dias-inhabiles.json`, descargas y paquete):
 * los del YAML y, con regla del núcleo, los días de la regla de los años que cubre el YAML, en
 * orden de fecha. Sin regla, los del YAML tal cual.
 */
export function registrosConRegla(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): DiaInhabilCurado[] {
  const regla = reglaDe(autoridad);
  const anios =
    regla === undefined || cobertura === null ? undefined : aniosDeLaLista(regla, cobertura);
  if (regla === undefined || anios === undefined) return [...registros];
  const deRegla: DiaInhabilCurado[] = [];
  for (let anio = anioDe(anios.desde); anio <= anioDe(anios.hasta); anio++) {
    for (const { fecha, motivo, tipo } of regla.dias(anio)) {
      const { nombre, url, fecha_publicacion, fragmento } = regla.fuente;
      deRegla.push({
        fecha,
        autoridad,
        motivo,
        tipo: tipo as DiaInhabilCurado["tipo"],
        fuente: { nombre, url, fecha_publicacion, fragmento },
      });
    }
  }
  return ordenarPorClave([...registros, ...deRegla], (r) => r.fecha);
}

/**
 * Los fines de semana de cada año se citan con la fuente del último día de descanso de ese año
 * (las disposiciones del año en la CNBV), que debe mencionarlos. Con regla los cita su fuente y
 * el shard no trae ninguno.
 */
function fuentesFinDeSemana(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  amplia: CoberturaSerie,
  dataset: string,
): Record<string, FuenteDof> {
  const fuentes: Record<string, FuenteDof> = {};
  if (reglaDe(autoridad) !== undefined) return fuentes;
  for (let anio = anioDe(amplia.desde); anio <= anioDe(amplia.hasta); anio++) {
    const ultimo = registros
      .filter((r) => r.tipo === "descanso" && anioDe(r.fecha) === anio)
      .at(-1);
    if (ultimo === undefined) {
      throw new ErrorDatos(
        `el calendario está sin días de descanso en ${anio}, con que se citan sus fines de semana`,
        dataset,
      );
    }
    const { fuente } = ultimo;
    if (!/sábados/i.test(fuente.fragmento) || !/domingos/i.test(fuente.fragmento)) {
      throw new ErrorDatos(
        `la fuente de los fines de semana de ${anio} (${fuente.nombre}) no menciona los sábados y domingos`,
        dataset,
      );
    }
    fuentes[String(anio)] = { ...fuente };
  }
  return fuentes;
}

/**
 * El shard del calendario de una autoridad y el calendario que arma con él el núcleo;
 * `registros` va ordenado por fecha y puede traer los días de la regla (iguales a los de ella).
 * La cobertura del YAML se completa con la de la regla. Lanza ErrorDatos si falta la cobertura,
 * si los plazos no cuadran o si el núcleo rechaza el shard.
 */
function armar(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): { shard: ShardCalendario; calendario: CalendarioCurado } {
  const dataset = `dias-inhabiles.${autoridad}`;
  if (cobertura === null) throw new ErrorDatos("el calendario está sin cobertura", dataset);
  const { plazos, amplia, fallas } = revisarPlazos(
    PLAZOS[autoridad],
    coberturaConRegla(autoridad, cobertura),
    registros,
  );
  if (amplia === null || fallas.length > 0) throw new ErrorDatos(fallas.join("; "), dataset);
  const shard: ShardCalendario = {
    autoridad,
    plazos: plazos as ShardCalendario["plazos"],
    fuentes_fin_de_semana: fuentesFinDeSemana(autoridad, registros, amplia, dataset),
    dias: registros.map(({ fecha, motivo, tipo, fuente }) => ({
      fecha,
      motivo,
      tipo,
      fuente: { ...fuente },
    })),
  };
  try {
    return { shard, calendario: crearCalendarioCurado(shard) };
  } catch (error) {
    throw new ErrorDatos(`el núcleo rechaza el calendario: ${(error as Error).message}`, dataset);
  }
}

/** Arma el shard interno del calendario de una autoridad, revisado por el núcleo. */
export function shardCalendario(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): ShardCalendario {
  return armar(autoridad, registros, cobertura).shard;
}

/** El calendario de una autoridad como lo arman el Worker y el paquete. */
export function calendarioCurado(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): CalendarioCurado {
  return armar(autoridad, registros, cobertura).calendario;
}

/**
 * La cobertura de cada tipo de plazo en la lista publicada (`dias-inhabiles-coberturas` de las
 * descargas). Sin regla es la del calendario. Con regla, la lista solo trae los días de la regla
 * de los años que cubre el YAML (`registrosConRegla`), así que su cobertura llega hasta ahí,
 * aunque el calendario de la API los calcule hasta el fin de la regla.
 */
export function coberturasDeLaLista(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
): ShardCalendario["plazos"] {
  const dataset = `dias-inhabiles.${autoridad}`;
  if (cobertura === null) throw new ErrorDatos("el calendario está sin cobertura", dataset);
  const regla = reglaDe(autoridad);
  const anios = regla === undefined ? undefined : aniosDeLaLista(regla, cobertura);
  const deLaLista =
    regla === undefined || anios === undefined ? cobertura : { ...cobertura, [regla.tipo]: anios };
  const { plazos, amplia, fallas } = revisarPlazos(PLAZOS[autoridad], deLaLista, registros);
  if (amplia === null || fallas.length > 0) throw new ErrorDatos(fallas.join("; "), dataset);
  return plazos as ShardCalendario["plazos"];
}
