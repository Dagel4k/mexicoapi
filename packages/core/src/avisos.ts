// Las advertencias con código: el catálogo cerrado de códigos estables y el código de cada texto
// que dan el núcleo, la API, el cliente del paquete, mexicoapi/sepomex y el servidor MCP. No
// importa nada: el cliente lo carga al importarse.

/**
 * Una respuesta de una serie que sale de los datos del paquete y no de la API: la publicación más
 * reciente que trae el paquete puede no ser la última que hay. El cliente la da siempre en el
 * último FIX del paquete; el MCP sin red, también en una fecha cerca del final de la serie.
 */
export const AVISO_SIN_API =
  "Respuesta con los datos del paquete mexicoapi, no de la API: pueden faltar publicaciones recientes.";

/**
 * Los códigos de los avisos, para decidir en un programa sin leer el texto. Cada código es un
 * significado; el texto puede cambiar de redacción y llevar fechas, el código no. Dentro de /v1 un
 * código no cambia de significado, pero una versión nueva puede agregar códigos: `otro` es el de un
 * texto que esta versión no conoce (el de un calendario propio de `crearCalendario`, o uno nuevo de
 * la API), y conviene tratar así cualquier código que no se conozca.
 *
 * - `calendario-incompleto`: con permitir_incompleto, el cálculo pasó por un año que el calendario
 *   no cubre y ahí solo descontó los fines de semana.
 * - `tipo-plazo-incompleto`: con permitir_incompleto, el cálculo pasó por fechas fuera de la
 *   cobertura del tipo de plazo; descontó lo publicado, pero pueden faltar días de algún tipo.
 * - `lista-incompleta`: la lista de días inhábiles del año solo está completa para algunos tipos de
 *   plazo.
 * - `lft-art-715`: el calendario de la LFT no tiene los festivos ni las suspensiones de labores.
 * - `transmision-poder-ejecutivo`: el SAT no descuenta el 1o. de octubre ni el 1o. de diciembre de
 *   un año de transmisión del Poder Ejecutivo; el texto nombra los que caen entre semana.
 * - `prorroga-art-12`: el resultado cae en viernes, en vacaciones del SAT o en un cierre bancario;
 *   el quinto párrafo del art. 12 del CFF puede prorrogarlo y el resultado no lo incluye.
 * - `vacaciones-sin-publicar`: el resultado cae fuera de las vacaciones del SAT publicadas.
 * - `api-fallo`: la API falló (sin conexión, tiempo agotado, 5xx, 429 o una respuesta inesperada)
 *   y la respuesta sale de los datos del paquete.
 * - `respuesta-guardada`: la API falló y la respuesta es una guardada en la caché, ya caducada.
 * - `datos-viejos`: la serie del paquete (FIX o UDIS) termina hace más de 7 días.
 * - `datos-del-paquete`: la serie sale del paquete y no de la API: pueden faltar publicaciones.
 *   Con `datos-viejos`, quiere decir lo mismo para un programa: el dato puede no estar al día.
 * - `municipio-sin-inegi`: un código postal de Correos de México con un municipio que no está en
 *   el catálogo de INEGI.
 * - `cp-varios-municipios`: códigos postales que aparecen en más de un municipio.
 * - `aviso-de-uso-sepomex-distinto`: el aviso de uso del archivo de Correos de México no es el
 *   conocido.
 * - `otro`: un texto sin código en esta versión.
 */
export const CODIGOS_AVISO = Object.freeze([
  "calendario-incompleto",
  "tipo-plazo-incompleto",
  "lista-incompleta",
  "lft-art-715",
  "transmision-poder-ejecutivo",
  "prorroga-art-12",
  "vacaciones-sin-publicar",
  "api-fallo",
  "respuesta-guardada",
  "datos-viejos",
  "datos-del-paquete",
  "municipio-sin-inegi",
  "cp-varios-municipios",
  "aviso-de-uso-sepomex-distinto",
  "otro",
] as const);
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

/**
 * Los códigos que da la API (los de días hábiles e inhábiles), en el orden del catálogo. El
 * documento OpenAPI publica `codigo` como texto abierto y los lista aquí; la prueba de contrato
 * exige que la API no dé otros.
 */
export const CODIGOS_AVISO_API = Object.freeze([
  "calendario-incompleto",
  "tipo-plazo-incompleto",
  "lista-incompleta",
  "lft-art-715",
  "transmision-poder-ejecutivo",
  "prorroga-art-12",
  "vacaciones-sin-publicar",
] as const satisfies readonly CodigoAviso[]);

/** Una advertencia con su código: `texto` es el mismo de `advertencias`. */
export interface Aviso {
  codigo: CodigoAviso;
  texto: string;
}

const FECHA = String.raw`\d{4}-\d{2}-\d{2}`;
const CP = String.raw`^\d+ códigos? postal(?:es)? `;

/**
 * El comienzo de cada texto con código, que no cambia con sus fechas ni con sus listas. Las
 * pruebas arman cada texto con la función que lo da y revisan que caiga en su código.
 */
const PATRONES: readonly (readonly [CodigoAviso, RegExp])[] = [
  [
    "calendario-incompleto",
    /^Calendario incompleto: [A-Z]+ \d{4}; solo se descontaron fines de semana\./,
  ],
  ["tipo-plazo-incompleto", /^Calendario incompleto: [A-Z]+ con tipo_plazo=[a-z_]+ cubre del /],
  [
    "lista-incompleta",
    new RegExp(
      `^Los días de tipo .+ solo están completos del ${FECHA} al ${FECHA}; fuera de ese rango pueden faltar\\.`,
    ),
  ],
  [
    "lft-art-715",
    /^Solo descuenta sábados, domingos y los días de descanso obligatorio del art\. 74 de la LFT; /,
  ],
  [
    "transmision-poder-ejecutivo",
    // Con las dos fechas o con la única que cae entre semana.
    /^En \d{4} no se descuentan? el 1o\. de (?:octubre|diciembre)(?: ni el 1o\. de diciembre)?: /,
  ],
  [
    "prorroga-art-12",
    new RegExp(
      `^El resultado \\(${FECHA}\\) es [^.]+\\. El art\\. 12 del CFF, quinto párrafo, prorroga el plazo `,
    ),
  ],
  [
    "vacaciones-sin-publicar",
    new RegExp(
      `^Las vacaciones del SAT (?:posteriores|anteriores) al ${FECHA} no están publicadas: `,
    ),
  ],
  ["api-fallo", /^Respuesta de los datos del paquete porque la API falló/],
  ["respuesta-guardada", /^Respuesta guardada de la API, de hace /],
  [
    "datos-viejos",
    new RegExp(`^Los datos de \\S+ del paquete llegan hasta el ${FECHA}, hace \\d+ días; `),
  ],
  [
    "municipio-sin-inegi",
    new RegExp(
      `(?:^El municipio de este código postal|${CP}tienen? un municipio que) no está en el catálogo de INEGI`,
    ),
  ],
  ["cp-varios-municipios", new RegExp(`${CP}aparecen? en más de un municipio`)],
  [
    "aviso-de-uso-sepomex-distinto",
    /^El aviso de uso del archivo es distinto del que conoce mexicoapi/,
  ],
];

/** El código de una advertencia; `otro` si esta versión no la conoce. */
export function codigoAviso(texto: string): CodigoAviso {
  if (typeof texto !== "string") return "otro";
  if (texto === AVISO_SIN_API) return "datos-del-paquete";
  for (const [codigo, patron] of PATRONES) {
    if (patron.test(texto)) return codigo;
  }
  return "otro";
}

/**
 * Los avisos de unas advertencias que llegan solo como texto: los mismos textos, en el mismo orden,
 * con el código que da `codigoAviso`. Es para lo que no trae código (una respuesta de una API
 * anterior, el texto libre de un calendario propio); lo que da el núcleo ya trae el suyo.
 */
export const avisosDe = (advertencias: readonly string[]): Aviso[] =>
  advertencias.map((texto) => ({ codigo: codigoAviso(texto), texto }));

const CONOCIDOS: ReadonlySet<unknown> = new Set(CODIGOS_AVISO);

/** Si `valor` es un código del catálogo. */
export const esCodigoAviso = (valor: unknown): valor is CodigoAviso => CONOCIDOS.has(valor);

/**
 * Un aviso como `Aviso`: copia uno con un código del catálogo y le pone el de `codigoAviso` a un
 * texto suelto o a uno cuyo código no es del catálogo (un objeto armado en JavaScript).
 */
export function aAviso(aviso: string | Aviso): Aviso {
  if (typeof aviso === "string") return { codigo: codigoAviso(aviso), texto: aviso };
  const { codigo, texto } = aviso;
  return { codigo: esCodigoAviso(codigo) ? codigo : codigoAviso(texto), texto };
}
