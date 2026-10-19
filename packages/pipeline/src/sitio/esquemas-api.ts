import {
  AUTORIDADES,
  CODIGOS_AVISO_API,
  type FuenteDof,
  type SalarioMinimo,
  type TarifaIsr,
  TIPOS_DIA_CURADO,
  type TramoIsr,
  type Uma,
} from "@mexicoapi/core";
import { z } from "zod";
import { MONTO } from "../curado/decimal.js";

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instante = z.iso.datetime();

const asOf = fechaIso.describe(
  "Fecha de la última corrida que cambió los datos (AAAA-MM-DD); no es la última fecha de la serie.",
);

export const esquemaFuenteMeta = z.object({
  name: z.string().describe("Nombre de la fuente."),
  url: z.string().describe("Dirección de la fuente."),
  license: z.string().describe("Licencia de los datos de la fuente."),
  license_url: z.string().describe("Dirección del texto de la licencia."),
  citation: z.string().describe("Cita sugerida."),
});

export const esquemaMeta = z.object({
  dataset: z.string().describe("Identificador del dataset."),
  as_of: asOf,
  sources: z.array(esquemaFuenteMeta).describe("Fuentes y licencias de los datos."),
  docs: z.string().describe("Documentación del dataset."),
});

/** Lo que dice docs/api/problemas.md del `type`, con las mismas palabras. */
export const TIPO_ESTABLE =
  "Es un identificador estable: dentro de /v1 no cambia, aunque la API llegue a un dominio propio. Para distinguir un error, compara el type completo o la parte después de #.";

export const esquemaProblema = z.object({
  type: z.string().describe(`URI del tipo de problema. ${TIPO_ESTABLE}`),
  title: z.string().describe("Título corto del tipo de problema."),
  status: z.number().int().describe("Código HTTP de la respuesta."),
  detail: z.string().describe("Explicación para este caso."),
  instance: z.string().optional().describe("Ruta pedida."),
  parametro: z.string().optional().describe("Parámetro que causó el problema."),
  autoridad: z.string().optional().describe("Autoridad del calendario consultado."),
  fecha: fechaIso
    .optional()
    .describe(
      "En un 422 calendario-incompleto, el primer día del cálculo que el calendario no cubre (puede ser posterior a la fecha de partida). En un 404 del FIX, las UDIS o la UMA, la fecha de la consulta (publicado, operacion o fecha), que puede estar dentro de la cobertura de la serie: por ejemplo, un día en que no hubo publicación.",
    ),
  cobertura: z
    .object({
      desde: fechaIso.describe("Primer día cubierto."),
      hasta: fechaIso.describe("Último día cubierto."),
    })
    .optional()
    .describe("Rango que cubre el calendario o la serie."),
});

export const esquemaFuente = z.object({
  nombre: z.string().describe("Nombre de la fuente."),
  url: z.string().describe("Dirección de la fuente."),
  fecha_publicacion: fechaIso.optional().describe("Fecha de publicación (AAAA-MM-DD)."),
  fragmento: z.string().optional().describe("Texto de la fuente que lo respalda."),
});

const autoridad = z.enum(AUTORIDADES).describe("Autoridad del calendario.");

export const esquemaDiaInhabil = z.object({
  fecha: fechaIso.describe("Día inhábil (AAAA-MM-DD)."),
  motivo: z.string().describe("Motivo del día inhábil."),
  // La API no lista los fines de semana: solo los tipos curados.
  tipo: z
    .enum(TIPOS_DIA_CURADO)
    .describe(
      "Tipo de día inhábil: descanso (de ley) o vacaciones (del SAT). El tipo DiaInhabil del paquete mexicoapi admite además fin_de_semana, que la API nunca da.",
    ),
  fuente: esquemaFuente.describe("Fuente que lo establece."),
});

/** Lo que dicen los avisos, en la descripción de cada campo `avisos`. */
export const AVISOS_PARALELOS =
  "Las mismas advertencias, en el mismo orden, cada una con su código estable: avisos[i].texto es advertencias[i]. Para decidir en un programa, usa codigo; texto es para mostrarlo.";

export const esquemaAviso = z.object({
  codigo: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .describe(
      "Código estable del aviso, en kebab-case: dentro de /v1 no cambia de significado aunque cambie la redacción del texto. Los que da la API están en x-extensible-enum; qué significa cada uno y qué hacer: docs/api/README.md#avisos. Es un texto abierto porque una versión nueva puede agregar códigos: trata uno que no conozcas como otro, el de un aviso sin código conocido.",
    )
    .meta({
      "x-extensible-enum": [...CODIGOS_AVISO_API],
      examples: ["lft-art-715", "prorroga-art-12"],
    }),
  texto: z.string().describe("El texto de la advertencia, el mismo que en advertencias."),
});

export const esquemaResultadoDiasHabiles = z.object({
  autoridad,
  desde: fechaIso.describe(
    "Fecha de partida; no se cuenta. En un plazo que corre desde una notificación, el día en que surte efectos.",
  ),
  dias: z.number().int().describe("Días hábiles sumados."),
  resultado: fechaIso.describe("Fecha resultante."),
  inhabiles_saltados: z
    .array(esquemaDiaInhabil)
    .describe(
      "Días inhábiles saltados. Los fines de semana no se listan por serlo; un día publicado que cae en fin de semana sí.",
    ),
  advertencias: z
    .array(z.string())
    .describe(
      "Avisos: un calendario incompleto, lo que el calendario no descuenta (con lft, los festivos y las suspensiones de labores del art. 715) o la prórroga del art. 12 del CFF que el resultado no aplica.",
    ),
  avisos: z.array(esquemaAviso).describe(AVISOS_PARALELOS),
});

export const esquemaFixOperacion = z.object({
  fecha_operacion: fechaIso.describe("Fecha de la operación consultada (AAAA-MM-DD)."),
  fecha_publicacion: fechaIso.describe(
    "Fecha de publicación en el DOF del FIX que aplica: la última antes de la operación.",
  ),
  valor: z
    .string()
    .regex(/^\d+\.\d{4}$/)
    .describe("Pesos por dólar, con 4 decimales, como lo publica el DOF."),
  fundamento: esquemaFuente.describe("Regla que fija qué publicación aplica (CFF art. 20)."),
});

const monto = (descripcion: string) =>
  z
    .string()
    .regex(MONTO)
    .describe(`${descripcion} Texto con dos decimales, como lo publica el DOF.`);
const anio = (descripcion: string) => z.number().int().min(1900).max(2100).describe(descripcion);

export const esquemaFuenteDof: z.ZodType<FuenteDof> = z.object({
  nombre: z.string().min(1).describe("Nombre de la publicación."),
  url: z
    .string()
    .describe("Dirección de la publicación en el DOF o de la ley en diputados.gob.mx."),
  fecha_publicacion: fechaIso.describe("Fecha de publicación en el DOF (AAAA-MM-DD)."),
  fragmento: z.string().min(1).describe("Texto oficial que respalda el valor, citado tal cual."),
});

export const esquemaUma: z.ZodType<Uma> = z.object({
  anio: anio("Año de la UMA."),
  diaria: monto("Valor diario en pesos."),
  mensual: monto("Valor mensual en pesos (diaria × 30.4)."),
  anual: monto("Valor anual en pesos (mensual × 12)."),
  vigencia_desde: fechaIso.describe(
    "Primer día de vigencia, el 1 de febrero; rige hasta el 31 de enero del año siguiente.",
  ),
  fuente: esquemaFuenteDof.describe("Publicación del INEGI en el DOF."),
});

export const esquemaSalarioMinimo: z.ZodType<SalarioMinimo> = z.object({
  anio: anio("Año del salario mínimo."),
  zona: z
    .enum(["general", "zlfn"])
    .describe("Zona: general o Zona Libre de la Frontera Norte (zlfn)."),
  diario: monto("Salario mínimo diario en pesos."),
  vigencia_desde: fechaIso.describe("Primer día de vigencia, el 1 de enero."),
  fuente: esquemaFuenteDof.describe("Resolución de la CONASAMI publicada en el DOF."),
});

export const esquemaTramoIsr: z.ZodType<TramoIsr> = z.object({
  limite_inferior: monto("Límite inferior en pesos."),
  limite_superior: z
    .string()
    .regex(MONTO)
    .nullable()
    .describe('Límite superior en pesos; null en el último tramo ("En adelante").'),
  cuota_fija: monto("Cuota fija en pesos."),
  tasa_excedente: monto("Porcentaje que se aplica sobre el excedente del límite inferior."),
});

export const esquemaTarifaIsr: z.ZodType<TarifaIsr> = z.object({
  anio: anio("Año de la tarifa."),
  periodo: z.enum(["mensual", "anual"]).describe("Periodo de la tarifa."),
  tramos: z.array(esquemaTramoIsr).min(1).describe("Tramos, del menor al mayor."),
  fuente: esquemaFuenteDof.describe(
    "Anexo 8 de la Resolución Miscelánea Fiscal publicado en el DOF.",
  ),
});

// La ruta rechaza con 400 una CLABE vacía, de otra longitud o con otros caracteres: aquí solo
// llegan los errores que se revisan con 18 dígitos.
const codigoError = z.enum(["banco", "digito_verificador"]);

export const esquemaResultadoClabe = z.object({
  valor: z.string().describe("Valor normalizado que se validó."),
  valido: z.boolean().describe("Si el valor es una CLABE válida."),
  formato_valido: z
    .boolean()
    .describe(
      "Si la longitud, los caracteres y el código de banco son correctos: false si el banco no está en el catálogo (activo o no). La ruta ya rechaza con 400 una longitud o unos caracteres que no son de una CLABE, así que en la API false solo significa un banco que no existe.",
    ),
  digito_verificador_valido: z
    .boolean()
    .nullable()
    .describe("Si el dígito de control coincide; null si el formato es inválido."),
  banco_revisado: z
    .boolean()
    .describe(
      "Si el código de banco se revisó contra el catálogo de bancos. En la API siempre es true. validarClabe del paquete mexicoapi da false si se llama sin el catálogo: entonces valido no garantiza que el banco exista.",
    ),
  errores: z
    .array(codigoError)
    .describe(
      "Códigos de los errores encontrados: banco (el código de banco no está en el catálogo) o digito_verificador. validarClabe del paquete mexicoapi, que valida sin pasar por la ruta, también da vacio, caracteres o longitud.",
    ),
  nota: z.string().describe("Alcance de la validación."),
  detalle: z
    .object({
      codigo_banco: z.string().describe("Código de banco (3 dígitos)."),
      codigo_plaza: z.string().describe("Código de plaza (3 dígitos)."),
      cuenta: z.string().describe("Número de cuenta (11 dígitos)."),
      digito_control: z.string().describe("Dígito de control."),
      banco: z
        .object({
          codigo: z.string().describe("Código de banco."),
          nombre_corto: z.string().describe("Nombre corto del banco."),
          activo: z.boolean().describe("Si el banco sigue en el catálogo vigente."),
        })
        .nullable()
        .describe("Banco del catálogo; null si no se encontró."),
      plaza: z
        .object({
          codigo: z.string().describe("Código de plaza."),
          plaza: z.string().describe("Nombre de la plaza."),
          estado: z.string().describe("Estado de la plaza."),
        })
        .nullable()
        .describe(
          "Plaza del catálogo; null si no se encontró. Por ahora es siempre null: el catálogo de plazas de la CLABE está pendiente (v1.1).",
        ),
    })
    .nullable()
    .describe("Partes de la CLABE; null si el formato es inválido."),
});

export const esquemaEstadoDataset = z.object({
  dataset: z.string().describe("Identificador del dataset."),
  as_of: asOf,
  records: z.number().int().describe("Número de registros."),
  data_sha256: z.string().describe("SHA-256 de los datos."),
  cobertura: z
    .object({
      desde: fechaIso.describe("Fecha del primer registro."),
      hasta: fechaIso.describe("Fecha del último registro."),
    })
    .optional()
    .describe(
      "Solo en las series (tipo-cambio.fix y udis): primera y última fecha de la serie publicada.",
    ),
  status: z.enum(["ok", "stale", "unknown"]).describe("Estado de frescura del dataset."),
  last_attempt: instante.nullable().describe("Último intento de actualización."),
  last_success: instante.nullable().describe("Última actualización exitosa."),
  frescura_horas: z.number().int().describe("Horas que puede pasar sin actualizarse."),
});

export const esquemaIndice = z.object({
  nombre: z.string().describe("Nombre de la API."),
  version: z.string().describe("Versión de la API."),
  documentacion: z.string().describe("Documentación de la API."),
  openapi: z.string().describe("Ruta del documento OpenAPI."),
  status: z.string().describe("Ruta del estado de los datasets."),
  descargas: z.string().describe("Ruta de las sumas de verificación de las descargas."),
  sitio: z.string().describe("Ruta de la página de inicio del sitio."),
  llms: z.string().describe("Ruta del resumen para herramientas que leen llms.txt."),
});

/** Sobre de las respuestas de datos: `{ data, meta }`. */
export function sobre<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: esquemaMeta });
}
