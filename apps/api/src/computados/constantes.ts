import { anioDe, listaUma } from "../cargas.js";
import { requerido } from "../parametros.js";
import { CACHE_DATOS, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

/**
 * `GET /v1/constantes/uma?fecha=`: la UMA vigente ese día. Cada una rige del 1 de febrero de su
 * año al 31 de enero del siguiente (Ley para Determinar el Valor de la UMA, art. 5): en enero
 * aplica la del año anterior. La lista viene en años consecutivos, así que la vigente es la de
 * ese año o la del anterior.
 */
export async function consultarUma(c: Contexto): Promise<Response> {
  const fecha = requerido(c.consulta, "fecha");
  const { umas, meta } = await listaUma(c.entorno);
  // La lista nunca está vacía.
  const primera = umas[0] as (typeof umas)[number];
  const ultima = umas[umas.length - 1] as (typeof umas)[number];
  const cobertura = { desde: primera.vigencia_desde, hasta: `${ultima.anio + 1}-01-31` };
  if (fecha < cobertura.desde || fecha > cobertura.hasta) {
    const antes = fecha < cobertura.desde;
    return respuestaProblema(
      antes ? "no-encontrado" : "dato-no-disponible",
      antes
        ? `Los datos empiezan con la UMA de ${primera.anio}, vigente desde el ${cobertura.desde}; no incluyen la UMA vigente el ${fecha}.`
        : `La UMA vigente el ${fecha} todavía no está cargada; la última cargada es la de ${ultima.anio}, vigente hasta el ${cobertura.hasta}.`,
      { fecha, cobertura },
      c.url.pathname,
    );
  }
  const anio = anioDe(fecha) - (fecha.slice(5) < "02-01" ? 1 : 0);
  const data = umas[anio - primera.anio];
  return respuestaJson({ data, meta }, { cache: CACHE_DATOS });
}
