// Cómo responden las rutas de la API lo que no es un dato: la meta de la LFT, los errores del
// núcleo y las consultas sin registro como problemas, el FIX con los feriados bancarios y la lista
// de la LFT. Los usan la API y el cliente del paquete, que responden igual.
import { conTextos, type DiasInhabilesCurados, exigirAnio } from "../dias-habiles/curados.js";
import {
  avisoLft715,
  COBERTURA_LFT,
  diasDescansoLft,
  FUENTE_LFT_74,
  VIGENCIA_LFT,
} from "../dias-habiles/lft.js";
import { esErrorDelNucleo } from "../errores.js";
import { esFechaIsoValida, type FechaISO } from "../fechas.js";
import type { Consulta, OpcionesFix } from "../indicadores/consulta.js";
import type { ProblemaConsulta } from "./parametros.js";
import { URL_DOCS } from "./problemas.js";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** "14 de mayo de 2026", como en las citas. Lanza RangeError si la fecha no existe. */
export function fechaEnTexto(fecha: FechaISO): string {
  if (!esFechaIsoValida(fecha)) throw new RangeError(`Fecha ISO inválida: ${fecha}`);
  const mes = MESES[Number(fecha.slice(5, 7)) - 1] as string;
  return `${Number(fecha.slice(8, 10))} de ${mes} de ${Number(fecha.slice(0, 4))}`;
}

/** La cita de una fuente en `meta.sources`, con los nombres en inglés de la API. */
export interface FuenteMetaRuta {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
}

/** El `meta` de una respuesta de la API. */
export interface MetaRuta {
  dataset: string;
  as_of: FechaISO;
  sources: FuenteMetaRuta[];
  docs: string;
}

const metasLft = new Map<string, MetaRuta>();

/**
 * La meta de los días de la LFT, que salen del núcleo y no de un dataset: dice qué se aplica de
 * cada artículo y cita la reforma de `VIGENCIA_LFT`. `seccion` es la de la ruta en la guía de la
 * API. Está congelada.
 */
export function metaLft(seccion: "dias-habiles" | "dias-inhabiles"): MetaRuta {
  let meta = metasLft.get(seccion);
  if (meta === undefined) {
    const fuente: FuenteMetaRuta = Object.freeze({
      name: "Ley Federal del Trabajo, artículos 74 (descanso obligatorio) y 715 (sábados y domingos)",
      url: FUENTE_LFT_74.url,
      license:
        "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
      license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      citation: `Ley Federal del Trabajo: del artículo 74, los días de descanso obligatorio; del artículo 715, solo los sábados y domingos. Texto vigente con última reforma publicada en el DOF el ${fechaEnTexto(VIGENCIA_LFT)}.`,
    });
    meta = Object.freeze({
      dataset: "dias-inhabiles.lft",
      as_of: VIGENCIA_LFT,
      sources: Object.freeze([fuente]) as FuenteMetaRuta[],
      docs: `${URL_DOCS}/api/README.md#${seccion}`,
    });
    metasLft.set(seccion, meta);
  }
  return meta;
}

/**
 * El problema de la API para un error del núcleo al responder una consulta: un calendario que no
 * cubre la fecha es 422 con la autoridad, la fecha, la cobertura y el texto del núcleo; un
 * resultado que pasaría del año 9999 es 400 en `desde`. Cualquier otro error da null: es un
 * defecto y la API lo responde como error interno. Compara el `tipo` del error, no su clase.
 */
export function problemaDeError(error: unknown): ProblemaConsulta | null {
  if (esErrorDelNucleo(error, "calendario-incompleto")) {
    const { autoridad, fecha, cobertura, detalle } = error;
    return {
      tipo: "calendario-incompleto",
      detalle,
      extras: { autoridad, fecha, cobertura: { desde: cobertura.desde, hasta: cobertura.hasta } },
    };
  }
  if (esErrorDelNucleo(error, "fecha-fuera-de-rango")) {
    return {
      tipo: "parametro-invalido",
      detalle: "Con estos días, el resultado pasaría del año 9999.",
      extras: { parametro: "desde" },
    };
  }
  return null;
}

/**
 * El problema de una consulta de una serie o una constante sin registro: `sin_dato` es definitivo
 * (404 no-encontrado); `no_disponible` puede cambiar cuando se carguen los datos (404
 * dato-no-disponible).
 */
export function problemaSinRegistro(
  tipo: "sin_dato" | "no_disponible",
  detalle: string,
  extras?: Readonly<Record<string, unknown>>,
): ProblemaConsulta {
  const problema = tipo === "sin_dato" ? "no-encontrado" : "dato-no-disponible";
  return extras === undefined ? { tipo: problema, detalle } : { tipo: problema, detalle, extras };
}

/**
 * `detail` del FIX de un día sin publicación en el DOF (`publicado` en fin de semana o feriado
 * bancario), con la consulta que da el FIX que aplica a un pago de ese día. Lo usan la API y el
 * cliente del paquete.
 */
export function sinPublicacionFix(fecha: FechaISO): string {
  return `No hubo publicación del FIX en el DOF el ${fecha}. Para el FIX que aplica a una operación de ese día, usa operacion=${fecha}.`;
}

/**
 * Una consulta del FIX con solo los fines de semana y, si da no_disponible, otra vez con los
 * feriados bancarios: el DOF no publica el FIX esos días, así que solo vuelven cierta una
 * respuesta que sin ellos es no_disponible y se piden solo entonces. Si `feriados` da undefined
 * (el calendario de la CNBV no cargó), se queda con la consulta sin ellos: menos respuestas, pero
 * ninguna vieja.
 */
export async function consultarConFeriados<T>(
  consultar: (opciones?: OpcionesFix) => Consulta<T>,
  feriados: () => Promise<OpcionesFix["sinPublicacion"]>,
): Promise<Consulta<T>> {
  const consulta = consultar();
  if (consulta.tipo !== "no_disponible") return consulta;
  const sinPublicacion = await feriados();
  return sinPublicacion === undefined ? consulta : consultar({ sinPublicacion });
}

/**
 * Los días inhábiles de la LFT de un año, como `diasInhabilesCurados`: se calculan por regla, así
 * que la lista siempre está completa, pero no tiene las suspensiones de labores del art. 715 y lo
 * advierte. Fuera de la cobertura de la LFT lanza CalendarioIncompletoError.
 */
export function diasInhabilesLft(anio: number): DiasInhabilesCurados {
  exigirAnio("lft", anio, COBERTURA_LFT);
  return { dias: diasDescansoLft(anio), ...conTextos([avisoLft715()]) };
}
