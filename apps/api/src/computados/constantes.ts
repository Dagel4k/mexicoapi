import { anioDeConstante, umaVigente } from "@mexicoapi/core/constantes";
import { aniosConstantes, listaUma } from "../cargas.js";
import { servirShard } from "../estaticos.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto, Parametros } from "../rutas.js";

const DOCS_CONSTANTES = `${URL_DOCS}/api/README.md#constantes`;

/**
 * `GET /v1/constantes/uma?fecha=`: la UMA vigente ese día, con las reglas del núcleo. Cada una
 * rige del 1 de febrero de su año al 31 de enero del siguiente (Ley para Determinar el Valor de
 * la UMA, art. 5): en enero aplica la del año anterior.
 */
export async function consultarUma(c: Contexto): Promise<Response> {
  const fecha = requerido(c.consulta, "fecha");
  const { umas, meta } = await listaUma(c.entorno);
  const consulta = umaVigente(umas, fecha);
  if (consulta.tipo !== "encontrado") {
    return respuestaProblema(
      consulta.tipo === "sin_dato" ? "no-encontrado" : "dato-no-disponible",
      consulta.detalle,
      { fecha, cobertura: consulta.cobertura },
      c.url.pathname,
    );
  }
  return respuestaJson(
    { data: consulta.registro, meta: { ...meta, docs: DOCS_CONSTANTES } },
    { cache: CACHE_DATOS },
  );
}

/** Una carpeta de constantes por año (`constantes/uma`) y cómo se nombra lo que guarda. */
export interface Constante {
  carpeta: string;
  /** Con artículo: "la UMA", "el salario mínimo". */
  nombre: string;
}

/**
 * El 404 de un año sin shard, con el texto del núcleo. Antes del primer año cargado (o en un
 * hueco) no existe en los datos; después del último, todavía no se carga y puede llegar con la
 * siguiente actualización.
 */
async function anioSinShard(c: Contexto, { carpeta, nombre }: Constante, anio: string) {
  const anios = (await aniosConstantes(c.entorno)).get(carpeta);
  const consulta = anios === undefined ? undefined : anioDeConstante(anios, Number(anio), nombre);
  if (consulta === undefined || consulta.tipo === "encontrado") {
    throw new Error(`El índice de años no cuadra con los shards de ${carpeta}.`);
  }
  return respuestaProblema(
    consulta.tipo === "sin_dato" ? "no-encontrado" : "dato-no-disponible",
    consulta.detalle,
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
