import {
  type Autoridad,
  COBERTURA_LFT,
  type DiaInhabilCurado,
  diasDescansoLft,
  type FechaISO,
  revisarTipoPlazo,
  type TipoPlazo,
  VIGENCIA_LFT,
} from "@mexicoapi/core";
import type { PlazoCalendario, ShardCalendario } from "../curado/calendario.js";
import { anioDe } from "../fecha.js";

/**
 * Un renglón de `dias-inhabiles-coberturas` y de la tabla `coberturas_calendario`: el rango en
 * que la lista de una autoridad está completa para un tipo de plazo.
 */
export interface CoberturaCalendario {
  autoridad: Autoridad;
  /**
   * El plazo como se pide a la API; `null` en las autoridades con un solo plazo (la LFT y la CNBV),
   * que no aceptan `tipo_plazo`.
   */
  tipo_plazo: TipoPlazo | null;
  desde: FechaISO;
  hasta: FechaISO;
}

/** Un día de una lista de las descargas: los curados y, además, los de la LFT. */
export type DiaDescargable = Omit<DiaInhabilCurado, "autoridad"> & { autoridad: Autoridad };

/** Las coberturas de los plazos de un calendario, en su orden (`general` primero). */
export function coberturasDe(
  shard: Pick<ShardCalendario, "autoridad" | "plazos">,
): CoberturaCalendario[] {
  return (Object.entries(shard.plazos) as [TipoPlazo, PlazoCalendario][]).map(
    ([tipo, { cobertura }]) => ({
      autoridad: shard.autoridad,
      tipo_plazo: revisarTipoPlazo(shard.autoridad, tipo) === null ? tipo : null,
      desde: cobertura.desde,
      hasta: cobertura.hasta,
    }),
  );
}

/**
 * Los días de descanso obligatorio del art. 74 de la LFT de todos los años de su calendario, los
 * mismos que lista `/v1/dias-inhabiles?autoridad=lft`. Como en los días del art. 12 del CFF, la
 * fecha de la fuente es la de la última reforma de la ley: la de la versión del texto citado.
 */
export function diasLft(): DiaDescargable[] {
  const dias: DiaDescargable[] = [];
  for (let anio = anioDe(COBERTURA_LFT.desde); anio <= anioDe(COBERTURA_LFT.hasta); anio++) {
    for (const { fecha, motivo, tipo, fuente } of diasDescansoLft(anio)) {
      if (fuente.fragmento === undefined) throw new Error(`${fecha}: la LFT sin fragmento`);
      dias.push({
        fecha,
        autoridad: "lft",
        motivo,
        tipo: tipo as DiaInhabilCurado["tipo"],
        fuente: {
          nombre: fuente.nombre,
          url: fuente.url,
          fecha_publicacion: VIGENCIA_LFT,
          fragmento: fuente.fragmento,
        },
      });
    }
  }
  return dias;
}

/** La lista de la LFT se calcula por regla: está completa en toda la cobertura de su calendario. */
export const COBERTURA_LISTA_LFT: CoberturaCalendario = Object.freeze({
  autoridad: "lft",
  tipo_plazo: null,
  desde: COBERTURA_LFT.desde,
  hasta: COBERTURA_LFT.hasta,
});
