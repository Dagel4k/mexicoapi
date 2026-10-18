import type { AutoridadCurada, FechaISO, TipoPlazo } from "@mexicoapi/core";
import type { PlazoCalendario, ShardCalendario } from "../curado/calendario.js";

/**
 * Un renglón de `dias-inhabiles-coberturas` y de la tabla `coberturas_calendario`: el rango en
 * que la lista de una autoridad está completa para un tipo de plazo.
 */
export interface CoberturaCalendario {
  autoridad: AutoridadCurada;
  tipo_plazo: TipoPlazo;
  desde: FechaISO;
  hasta: FechaISO;
}

/** Las coberturas de los plazos de un shard, en su orden (`general` primero). */
export function coberturasDe(shard: ShardCalendario): CoberturaCalendario[] {
  return (Object.entries(shard.plazos) as [TipoPlazo, PlazoCalendario][]).map(
    ([tipo_plazo, { cobertura }]) => ({
      autoridad: shard.autoridad,
      tipo_plazo,
      desde: cobertura.desde,
      hasta: cobertura.hasta,
    }),
  );
}
