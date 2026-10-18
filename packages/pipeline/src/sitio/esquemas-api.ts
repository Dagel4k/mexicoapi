import { z } from "zod";

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instante = z.iso.datetime();

export const esquemaFuenteMeta = z.object({
  name: z.string().describe("Nombre de la fuente."),
  url: z.string().describe("Dirección de la fuente."),
  license: z.string().describe("Licencia de los datos de la fuente."),
  license_url: z.string().describe("Dirección del texto de la licencia."),
  citation: z.string().describe("Cita sugerida."),
});

export const esquemaMeta = z.object({
  dataset: z.string().describe("Identificador del dataset."),
  as_of: fechaIso.describe("Fecha de los datos (AAAA-MM-DD)."),
  sources: z.array(esquemaFuenteMeta).describe("Fuentes y licencias de los datos."),
  docs: z.string().describe("Documentación del dataset."),
});

export const esquemaProblema = z.object({
  type: z.string().describe("URI del tipo de problema."),
  title: z.string().describe("Título corto del tipo de problema."),
  status: z.number().int().describe("Código HTTP de la respuesta."),
  detail: z.string().describe("Explicación para este caso."),
  instance: z.string().optional().describe("Ruta pedida."),
  parametro: z.string().optional().describe("Parámetro que causó el problema."),
  autoridad: z.string().optional().describe("Autoridad del calendario consultado."),
  fecha: fechaIso.optional().describe("Fecha pedida que el calendario o la serie no cubre."),
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

const autoridad = z.enum(["lft", "cnbv", "sat"]).describe("Autoridad del calendario.");

export const esquemaDiaInhabil = z.object({
  fecha: fechaIso.describe("Día inhábil (AAAA-MM-DD)."),
  motivo: z.string().describe("Motivo del día inhábil."),
  tipo: z.enum(["descanso", "vacaciones", "fin_de_semana"]).describe("Tipo de día inhábil."),
  fuente: esquemaFuente.describe("Fuente que lo establece."),
});

export const esquemaResultadoDiasHabiles = z.object({
  autoridad,
  desde: fechaIso.describe("Fecha de partida; no se cuenta."),
  dias: z.number().int().describe("Días hábiles sumados."),
  resultado: fechaIso.describe("Fecha resultante."),
  inhabiles_saltados: z
    .array(esquemaDiaInhabil)
    .describe("Días inhábiles saltados, sin los fines de semana."),
  advertencias: z.array(z.string()).describe("Avisos, como un calendario incompleto."),
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

const codigoError = z.enum([
  "vacio",
  "longitud",
  "caracteres",
  "estructura",
  "fecha",
  "entidad",
  "banco",
  "digito_verificador",
]);

export const esquemaResultadoClabe = z.object({
  valor: z.string().describe("Valor normalizado que se validó."),
  valido: z.boolean().describe("Si el valor es una CLABE válida."),
  formato_valido: z.boolean().describe("Si la longitud y los caracteres son correctos."),
  digito_verificador_valido: z
    .boolean()
    .nullable()
    .describe("Si el dígito de control coincide; null si el formato es inválido."),
  errores: z.array(codigoError).describe("Códigos de los errores encontrados."),
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
        .describe("Plaza del catálogo; null si no se encontró."),
    })
    .nullable()
    .describe("Partes de la CLABE; null si el formato es inválido."),
});

export const esquemaEstadoDataset = z.object({
  dataset: z.string().describe("Identificador del dataset."),
  as_of: fechaIso.describe("Fecha de los datos (AAAA-MM-DD)."),
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
});

/** Sobre de las respuestas de datos: `{ data, meta }`. */
export function sobre<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: esquemaMeta });
}
