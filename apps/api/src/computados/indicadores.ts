import {
  type CoberturaSerie,
  type Consulta,
  type FechaISO,
  FUENTE_CFF_20,
  fixParaOperacion,
  fixPublicado,
  type OpcionesFix,
  sumarDias,
  type TipoCambioFix,
  udiDeFecha,
} from "@mexicoapi/core";
import {
  anioDe,
  type CalendarioCurado,
  calendarioCurado,
  type Meta,
  metaInterna,
  type ShardSerie,
  shardFix,
  shardUdis,
} from "../cargas.js";
import type { Entorno } from "../entorno.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_DATOS, CACHE_ULTIMO, respuestaJson, respuestaProblema } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

const DOCS_FIX = `${URL_DOCS}/api/README.md#tipo-de-cambio-fix`;
const DOCS_UDIS = `${URL_DOCS}/api/README.md#udis`;

interface Serie {
  meta: Meta;
  cobertura: CoberturaSerie;
}

/** La meta del dataset (con el enlace a la sección de la API) y la cobertura de la serie. */
async function serieDe(entorno: Entorno, dataset: string, docs: string): Promise<Serie> {
  const interno = (await metaInterna(entorno)).datasets[dataset];
  if (interno?.cobertura === undefined) {
    throw new Error(`El meta interno no tiene la cobertura de ${dataset}.`);
  }
  return { meta: { ...interno.meta, docs }, cobertura: interno.cobertura };
}

/**
 * `fecha` llevada a la cobertura. El año que se carga sale de aquí: una fecha fuera de la
 * serie la resuelve el núcleo sin pedir años que no existen. Antes de la serie es sin_dato;
 * después, no_disponible, salvo un día sin publicación del FIX (fin de semana o feriado
 * bancario) con solo días sin publicación desde el último dato, que es sin_dato.
 */
const acotar = (fecha: FechaISO, { desde, hasta }: CoberturaSerie): FechaISO =>
  fecha < desde ? desde : fecha > hasta ? hasta : fecha;

/**
 * Une shards de años consecutivos, del más antiguo al más reciente. Sus tramos deben ser
 * contiguos: un hueco entre años escondería publicaciones y la consulta podría responder una
 * anterior.
 */
function unir<T>(shards: readonly ShardSerie<T>[]): ShardSerie<T> {
  for (let i = 1; i < shards.length; i++) {
    const anterior = shards[i - 1] as ShardSerie<T>;
    const siguiente = shards[i] as ShardSerie<T>;
    if (sumarDias(anterior.tramo.hasta, 1) !== siguiente.tramo.desde) {
      throw new Error("Los tramos de los años cargados no son contiguos.");
    }
  }
  const primero = shards[0] as ShardSerie<T>;
  const ultimo = shards[shards.length - 1] as ShardSerie<T>;
  return {
    tramo: { desde: primero.tramo.desde, hasta: ultimo.tramo.hasta },
    datos: shards.flatMap((s) => s.datos),
  };
}

/**
 * Los años que necesita una operación del día `fecha`: el de la víspera (o el del último
 * dato, si la víspera todavía no se carga) y, mientras lo cargado no tenga una publicación
 * anterior a `fecha`, el año previo, hasta el inicio de la serie.
 */
async function tramoParaOperacion(
  entorno: Entorno,
  cobertura: CoberturaSerie,
  fecha: FechaISO,
): Promise<ShardSerie<TipoCambioFix>> {
  // Con `fecha` <= desde no hay víspera que buscar (y en 0001-01-01 no existe).
  const referencia = acotar(fecha > cobertura.desde ? sumarDias(fecha, -1) : fecha, cobertura);
  let anio = anioDe(referencia);
  const shards = [await shardFix(entorno, anio, cobertura)];
  const hayAnterior = () =>
    shards.some((s) => s.datos[0] !== undefined && s.datos[0].fecha_publicacion < fecha);
  while (!hayAnterior() && (shards[0] as ShardSerie<TipoCambioFix>).tramo.desde > cobertura.desde) {
    anio -= 1;
    shards.unshift(await shardFix(entorno, anio, cobertura));
  }
  return unir(shards);
}

/**
 * `detail` de una fecha anterior a la serie: el dato existe en el DOF, pero la serie no lo
 * trae, así que no se dice que no hubo publicación.
 */
const fueraDeLaSerie = ({ desde }: CoberturaSerie, queFalta: string): string =>
  `La serie empieza el ${desde}; no incluye ${queFalta}.`;

interface Textos {
  /** `detail` del 404 definitivo: no hubo dato ese día o la fecha es anterior a la serie. */
  sinDato: string;
  /** `detail` del 404 que puede cambiar: nombra el último dato cargado. */
  noDisponible: string;
}

/** 200 con el registro, o el 404 que corresponde, con la fecha pedida y la cobertura. */
function responder<T>(
  c: Contexto,
  consulta: Consulta<T>,
  serie: Serie,
  fecha: FechaISO,
  textos: Textos,
  data: (registro: T) => unknown = (registro) => registro,
): Response {
  if (consulta.tipo === "encontrado") {
    return respuestaJson(
      { data: data(consulta.registro), meta: serie.meta },
      { cache: CACHE_DATOS },
    );
  }
  const { desde, hasta } = serie.cobertura;
  return respuestaProblema(
    consulta.tipo === "sin_dato" ? "no-encontrado" : "dato-no-disponible",
    consulta.tipo === "sin_dato" ? textos.sinDato : textos.noDisponible,
    { fecha, cobertura: { desde, hasta } },
    c.url.pathname,
  );
}

const AVISO_SIN_CNBV =
  "mexicoapi: aviso: el calendario de la CNBV no cargó; el FIX solo salta fines de semana";

/**
 * Los días de descanso de la CNBV, dentro de su cobertura, como días sin publicación del FIX:
 * el DOF no lo publica en los feriados bancarios. Si el calendario no carga, undefined y un
 * aviso: la consulta sigue solo con los fines de semana, que da menos respuestas pero ninguna
 * vieja, en vez de un 500. La falla no se recuerda.
 */
async function feriadosBancarios(entorno: Entorno): Promise<OpcionesFix["sinPublicacion"]> {
  let cnbv: CalendarioCurado;
  try {
    cnbv = await calendarioCurado(entorno, "cnbv");
  } catch {
    console.warn(AVISO_SIN_CNBV);
    return undefined;
  }
  // Fuera de su cobertura el calendario lanza; ahí solo cuentan los fines de semana.
  const { cobertura, calendario } = cnbv.general;
  return (fecha) =>
    fecha >= cobertura.desde && fecha <= cobertura.hasta && calendario.inhabil(fecha) !== null;
}

/**
 * La consulta con solo los fines de semana y, si da no_disponible, otra vez con los feriados
 * bancarios. Los feriados solo vuelven cierta una respuesta que sin ellos es no_disponible, así
 * que el calendario se pide solo entonces.
 */
async function conFeriados(
  entorno: Entorno,
  consultar: (opciones?: OpcionesFix) => Consulta<TipoCambioFix>,
): Promise<Consulta<TipoCambioFix>> {
  const consulta = consultar();
  if (consulta.tipo !== "no_disponible") return consulta;
  const sinPublicacion = await feriadosBancarios(entorno);
  return sinPublicacion === undefined ? consulta : consultar({ sinPublicacion });
}

async function fixDelDia(c: Contexto, fecha: FechaISO): Promise<Response> {
  const serie = await serieDe(c.entorno, "tipo-cambio.fix", DOCS_FIX);
  const { cobertura } = serie;
  const { tramo, datos } = await shardFix(c.entorno, anioDe(acotar(fecha, cobertura)), cobertura);
  const consulta = await conFeriados(c.entorno, (opciones) =>
    fixPublicado(datos, tramo, cobertura, fecha, opciones),
  );
  return responder(c, consulta, serie, fecha, {
    sinDato:
      fecha < cobertura.desde
        ? fueraDeLaSerie(cobertura, `el ${fecha}`)
        : `No hubo publicación del FIX en el DOF el ${fecha}.`,
    noDisponible: `El FIX del ${fecha} todavía no está cargado; la última publicación cargada es del ${cobertura.hasta}.`,
  });
}

async function fixDeOperacion(c: Contexto, fecha: FechaISO): Promise<Response> {
  const serie = await serieDe(c.entorno, "tipo-cambio.fix", DOCS_FIX);
  const { cobertura } = serie;
  const { tramo, datos } = await tramoParaOperacion(c.entorno, cobertura, fecha);
  const consulta = await conFeriados(c.entorno, (opciones) =>
    fixParaOperacion(datos, tramo, cobertura, fecha, opciones),
  );
  return responder(
    c,
    consulta,
    serie,
    fecha,
    {
      // La cobertura empieza en una publicación: solo antes de ella no hay anterior.
      sinDato: fueraDeLaSerie(cobertura, `la publicación que aplica a una operación del ${fecha}`),
      noDisponible: `Todavía no está cargado el FIX que aplica a una operación del ${fecha}; la última publicación cargada es del ${cobertura.hasta}.`,
    },
    (registro) => ({
      fecha_operacion: fecha,
      fecha_publicacion: registro.fecha_publicacion,
      valor: registro.valor,
      fundamento: FUENTE_CFF_20,
    }),
  );
}

/**
 * `GET /v1/tipo-cambio/fix`: con `publicado`, el FIX publicado en el DOF ese día; con
 * `operacion`, el que aplica a una operación de ese día (CFF art. 20). Exactamente uno.
 */
export function consultarFix(c: Contexto): Promise<Response> | Response {
  const { publicado, operacion } = c.consulta;
  if (publicado !== undefined) {
    if (operacion !== undefined) {
      return respuestaProblema(
        "parametro-invalido",
        "Indica solo uno de publicado u operacion.",
        undefined,
        c.url.pathname,
      );
    }
    return fixDelDia(c, publicado);
  }
  if (operacion === undefined) {
    return respuestaProblema(
      "parametro-faltante",
      "Indica publicado u operacion.",
      undefined,
      c.url.pathname,
    );
  }
  return fixDeOperacion(c, operacion);
}

/** `GET /v1/tipo-cambio/fix/ultimo`: la publicación más reciente de la serie. */
export async function ultimoFix(c: Contexto): Promise<Response> {
  const { meta, cobertura } = await serieDe(c.entorno, "tipo-cambio.fix", DOCS_FIX);
  const { tramo, datos } = await shardFix(c.entorno, anioDe(cobertura.hasta), cobertura);
  const ultimo = fixPublicado(datos, tramo, cobertura, cobertura.hasta);
  // La cobertura termina en el último registro: si no está, el meta y el shard no cuadran.
  if (ultimo.tipo !== "encontrado") {
    throw new Error("El shard del último año no tiene la última publicación de la cobertura.");
  }
  return respuestaJson({ data: ultimo.registro, meta }, { cache: CACHE_ULTIMO });
}

/** `GET /v1/udis`: el valor de la UDI del día `fecha`. */
export async function consultarUdi(c: Contexto): Promise<Response> {
  const fecha = requerido(c.consulta, "fecha");
  const serie = await serieDe(c.entorno, "udis", DOCS_UDIS);
  const { cobertura } = serie;
  const { tramo, datos } = await shardUdis(c.entorno, anioDe(acotar(fecha, cobertura)), cobertura);
  return responder(c, udiDeFecha(datos, tramo, cobertura, fecha), serie, fecha, {
    sinDato:
      fecha < cobertura.desde
        ? fueraDeLaSerie(cobertura, `el ${fecha}`)
        : `No hay valor de la UDI para el ${fecha}.`,
    noDisponible: `El valor de la UDI del ${fecha} todavía no está cargado; el último cargado es del ${cobertura.hasta}.`,
  });
}
