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
import { ErrorDatos } from "../errores.js";
import { anioDe } from "../fecha.js";

/** Como la llama la API en `meta.dataset`, aunque no es un dataset de `data/`. */
export const DATASET_LFT = "dias-inhabiles.lft";

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
 * mismos que lista `/v1/dias-inhabiles?autoridad=lft`, cada uno con el texto en vigor ese día. La
 * fecha de la fuente es la del texto citado: la que trae el núcleo (la reforma de 2006 en los días
 * anteriores a la de la fracción VII) o, en el texto vigente, la de la última reforma de la ley,
 * como en los días del art. 12 del CFF.
 */
export function diasLft(): DiaDescargable[] {
  const dias: DiaDescargable[] = [];
  for (let anio = anioDe(COBERTURA_LFT.desde); anio <= anioDe(COBERTURA_LFT.hasta); anio++) {
    for (const { fecha, motivo, tipo, fuente } of diasDescansoLft(anio)) {
      // Todos los del art. 74 son de descanso y traen su fragmento; si no, el núcleo cambió.
      if (tipo !== "descanso" || fuente.fragmento === undefined) {
        throw new ErrorDatos(
          `${fecha}: día de la LFT sin tipo descanso o sin fragmento`,
          DATASET_LFT,
        );
      }
      dias.push({
        fecha,
        autoridad: "lft",
        motivo,
        tipo,
        fuente: {
          nombre: fuente.nombre,
          url: fuente.url,
          fecha_publicacion: fuente.fecha_publicacion ?? VIGENCIA_LFT,
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
