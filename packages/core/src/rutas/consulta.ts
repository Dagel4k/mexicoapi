// La query de cada ruta de la API: qué parámetros acepta, en qué orden se revisan y con qué
// reglas y textos. La usan la API y el cliente del paquete, que responden igual.
import { DIAS_MAX } from "../dias-habiles/sumar.js";
import { AUTORIDADES, TIPOS_PLAZO } from "../dias-habiles/tipos.js";
import { esFechaIsoValida } from "../fechas.js";
import {
  cumpleRegla,
  enLista,
  enumeracion,
  type ProblemaConsulta,
  REGLAS_RUTA,
  type ReglaConsulta,
  type ReglaParametro,
} from "./parametros.js";

const deConsulta = (regla: ReglaParametro, obligatorio: boolean): ReglaConsulta =>
  Object.freeze({ ...regla, obligatorio });

/** Una fecha real con formato AAAA-MM-DD. */
const fecha = (detalle: string, obligatorio: boolean): ReglaConsulta =>
  deConsulta({ patron: /^\d{4}-\d{2}-\d{2}$/, cumple: esFechaIsoValida, detalle }, obligatorio);

const AUTORIDAD = deConsulta(
  enumeracion(AUTORIDADES, `Autoridades disponibles: ${enLista(AUTORIDADES)}.`),
  true,
);
// Con sat es obligatorio y con las demás autoridades no se acepta: revisarTipoPlazo.
const TIPO_PLAZO = deConsulta(
  enumeracion(TIPOS_PLAZO, `El tipo de plazo (tipo_plazo) debe ser ${TIPOS_PLAZO.join(" o ")}.`),
  false,
);
// De 1 a DIAS_MAX (3650) en el patrón, que es el `pattern` del OpenAPI: 1-999, 1000-2999,
// 3000-3599, 3600-3649 y 3650. Una prueba lo compara con DIAS_MAX.
const DIAS = deConsulta(
  {
    patron: /^(?:[1-9]\d{0,2}|[12]\d{3}|3[0-5]\d{2}|36[0-4]\d|3650)$/,
    detalle: `Los días hábiles (dias) deben ser un entero de 1 a ${DIAS_MAX}, sin ceros a la izquierda.`,
  },
  true,
);
const PERMITIR_INCOMPLETO = deConsulta(
  enumeracion(["true", "false"], "El parámetro permitir_incompleto debe ser true o false."),
  false,
);

/** Las rutas que tienen query. Las demás no aceptan ningún parámetro en ella. */
export type RutaConConsulta =
  | "/v1/dias-habiles"
  | "/v1/dias-inhabiles"
  | "/v1/tipo-cambio/fix"
  | "/v1/udis"
  | "/v1/constantes/uma";

/** Los parámetros de la query de cada ruta, en el orden en que se revisan. */
export const CONSULTAS: Readonly<Record<RutaConConsulta, Readonly<Record<string, ReglaConsulta>>>> =
  Object.freeze({
    "/v1/dias-habiles": Object.freeze({
      autoridad: AUTORIDAD,
      tipo_plazo: TIPO_PLAZO,
      desde: fecha(
        "La fecha de partida (desde) debe ser una fecha válida con formato AAAA-MM-DD.",
        true,
      ),
      dias: DIAS,
      permitir_incompleto: PERMITIR_INCOMPLETO,
    }),
    "/v1/dias-inhabiles": Object.freeze({
      autoridad: AUTORIDAD,
      anio: deConsulta(REGLAS_RUTA.anio, true),
    }),
    // revisarFix exige exactamente uno de los dos.
    "/v1/tipo-cambio/fix": Object.freeze({
      publicado: fecha(
        "La fecha de publicación (publicado) debe ser una fecha válida con formato AAAA-MM-DD.",
        false,
      ),
      operacion: fecha(
        "La fecha de la operación (operacion) debe ser una fecha válida con formato AAAA-MM-DD.",
        false,
      ),
    }),
    "/v1/udis": Object.freeze({
      fecha: fecha(
        "La fecha del valor (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
        true,
      ),
    }),
    "/v1/constantes/uma": Object.freeze({
      fecha: fecha(
        "La fecha que se consulta (fecha) debe ser una fecha válida con formato AAAA-MM-DD.",
        true,
      ),
    }),
  });

// URLSearchParams existe en Node, en los navegadores y en los Workers; el núcleo no carga los
// tipos de ninguno de ellos.
declare const URLSearchParams: new (
  texto: string,
) => { keys(): Iterable<string>; getAll(nombre: string): string[] };

const conParametro = (
  tipo: ProblemaConsulta["tipo"],
  detalle: string,
  parametro: string,
): ProblemaConsulta => ({ tipo, detalle, extras: { parametro } });

/**
 * Revisa la query (`search`, con o sin el `?`) contra `reglas` en el orden de la API: un segmento
 * sin nombre (`?&`, `?=1`), que URLSearchParams ignora o deja con nombre vacío; un parámetro que
 * la ruta no acepta; y, en el orden de `reglas`, uno que falta, que se repite, que está vacío o
 * que no cumple su regla. Devuelve los valores de los parámetros declarados y presentes, o el
 * primer problema.
 */
export function revisarConsulta(
  reglas: Readonly<Record<string, ReglaConsulta>>,
  search: string,
): { consulta: Readonly<Record<string, string>> } | ProblemaConsulta {
  const texto = search.startsWith("?") ? search.slice(1) : search;
  if (texto !== "" && texto.split("&").some((s) => s === "" || s.startsWith("="))) {
    return { tipo: "parametro-invalido", detalle: "La query tiene un parámetro sin nombre." };
  }
  const query = new URLSearchParams(texto);
  for (const nombre of query.keys()) {
    if (!Object.hasOwn(reglas, nombre)) {
      const detalle = `Esta ruta no acepta el parámetro ${nombre}.`;
      return conParametro("parametro-desconocido", detalle, nombre);
    }
  }
  const valores: Record<string, string> = {};
  for (const [nombre, regla] of Object.entries(reglas)) {
    const [valor, ...repetidos] = query.getAll(nombre);
    if (valor === undefined) {
      if (regla.obligatorio !== true) continue;
      return conParametro("parametro-faltante", `Falta el parámetro ${nombre}.`, nombre);
    }
    const detalle =
      repetidos.length > 0
        ? `El parámetro ${nombre} aparece más de una vez.`
        : valor === ""
          ? `El parámetro ${nombre} está vacío.`
          : cumpleRegla(regla, valor)
            ? undefined
            : regla.detalle;
    if (detalle !== undefined) return conParametro("parametro-invalido", detalle, nombre);
    valores[nombre] = valor;
  }
  return { consulta: valores };
}
