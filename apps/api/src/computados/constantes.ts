import { anioDe, aniosConstantes, listaUma } from "../cargas.js";
import { servirShard } from "../estaticos.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto, Parametros } from "../rutas.js";

const DOCS_CONSTANTES = `${URL_DOCS}/api/README.md#constantes`;

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
  return respuestaJson({ data, meta: { ...meta, docs: DOCS_CONSTANTES } }, { cache: CACHE_DATOS });
}

/** Una carpeta de constantes por año (`constantes/uma`) y cómo se nombra lo que guarda. */
export interface Constante {
  carpeta: string;
  /** Con artículo: "la UMA", "el salario mínimo". */
  nombre: string;
}

/**
 * El 404 de un año sin shard. Antes del primer año cargado (o en un hueco) no existe en los
 * datos; después del último, todavía no se carga y puede llegar con la siguiente actualización.
 */
async function anioSinShard(c: Contexto, { carpeta, nombre }: Constante, anio: string) {
  const anios = (await aniosConstantes(c.entorno)).get(carpeta);
  const numero = Number(anio);
  if (anios === undefined || anios.includes(numero)) {
    throw new Error(`El índice de años no cuadra con los shards de ${carpeta}.`);
  }
  const primero = anios[0] as number;
  const ultimo = anios[anios.length - 1] as number;
  const cargados =
    primero === ultimo
      ? `el único año cargado es ${primero}`
      : `los años cargados van de ${primero} a ${ultimo}`;
  return numero > ultimo
    ? respuestaProblema(
        "dato-no-disponible",
        `Todavía no se carga ${nombre} de ${anio}; ${cargados}.`,
        undefined,
        c.url.pathname,
      )
    : respuestaProblema(
        "no-encontrado",
        `No existe ${nombre} de ${anio} en los datos; ${cargados}.`,
        undefined,
        c.url.pathname,
      );
}

/** Manejador del shard de un año de constantes: `v1/{carpeta}/{anio}.json`. */
export function shardConstante(constante: (p: Parametros) => Constante) {
  return (c: Contexto): Promise<Response> => {
    const anio = requerido(c.parametros, "anio");
    const definicion = constante(c.parametros);
    return servirShard(c, `/v1/${definicion.carpeta}/${anio}.json`, () =>
      anioSinShard(c, definicion, anio),
    );
  };
}
