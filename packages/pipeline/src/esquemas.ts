import type { Banco, Estado, Municipio, PeriodoBanco, TipoCambioFix, Udi } from "@mexicoapi/core";
import { z } from "zod";

const cveEnt = z.string().regex(/^\d{2}$/);
const cveMun = z.string().regex(/^\d{3}$/);

export const esquemaEstado: z.ZodType<Estado> = z.object({
  cve_ent: cveEnt.describe("Clave de entidad de INEGI (2 dígitos)."),
  nombre: z.string().min(1).describe("Nombre oficial de la entidad."),
  abreviatura: z.string().min(1).describe("Abreviatura de la entidad."),
  cvegeo: z
    .string()
    .regex(/^(\d{2}|\d{5})$/)
    .describe("Clave geoestadística (2 dígitos para un estado)."),
});

export const esquemaMunicipio: z.ZodType<Municipio> = z.object({
  cvegeo: z
    .string()
    .regex(/^(\d{2}|\d{5})$/)
    .describe("Clave geoestadística del municipio (5 dígitos)."),
  cve_ent: cveEnt.describe("Clave de la entidad a la que pertenece (2 dígitos)."),
  cve_mun: cveMun.describe("Clave del municipio dentro de su entidad (3 dígitos)."),
  nombre: z.string().min(1).describe("Nombre oficial del municipio."),
  // Las alcaldías de la Ciudad de México no tienen cabecera: null.
  cve_cabecera: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .describe("Clave de la localidad cabecera (4 dígitos); null en las alcaldías de la CDMX."),
});

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const codigoSpei = z.string().regex(/^\d{4,5}$/);

export const esquemaPeriodoBanco: z.ZodType<PeriodoBanco> = z.object({
  codigo_spei: codigoSpei.describe("Código SPEI vigente en el periodo."),
  nombre_corto: z.string().min(1).describe("Nombre corto vigente en el periodo."),
  desde: fechaIso.describe("Primer día del periodo (AAAA-MM-DD)."),
  hasta: fechaIso.nullable().describe("Último día del periodo; null si sigue vigente."),
});

export const esquemaBanco: z.ZodType<Banco> = z.object({
  codigo: z
    .string()
    .regex(/^\d{3}$/)
    .describe("Código de banco de 3 dígitos, el de la CLABE."),
  codigo_spei: codigoSpei.describe("Código SPEI actual."),
  nombre_corto: z.string().min(1).describe("Nombre corto actual."),
  razon_social: z.string().min(1).nullable().describe("Razón social; null si no se conoce."),
  sector: z.string().min(1).nullable().describe("Sector según la fuente; null si no se conoce."),
  tipo: z
    .enum(["banca_multiple", "banca_desarrollo", "otra_entidad", "banco_central"])
    .describe("Tipo de institución."),
  participacion: z
    .enum(["directa", "no_confirmada"])
    .describe("Participación en el SPEI según la fuente."),
  activo: z.boolean().describe("Si la institución sigue en el catálogo vigente."),
  baja_detectada: fechaIso.nullable().describe("Fecha en que se detectó la baja; null si activo."),
  historial: z.array(esquemaPeriodoBanco).describe("Periodos con código SPEI y nombre."),
});

export const esquemaTipoCambioFix: z.ZodType<TipoCambioFix> = z.object({
  fecha_publicacion: fechaIso.describe("Fecha de publicación en el DOF (AAAA-MM-DD)."),
  valor: z
    .string()
    .regex(/^\d+\.\d{4}$/)
    .describe("Pesos por dólar, con 4 decimales, como lo publica el DOF."),
});

export const esquemaUdi: z.ZodType<Udi> = z.object({
  fecha: fechaIso.describe("Día al que aplica el valor (AAAA-MM-DD)."),
  valor: z
    .string()
    .regex(/^\d+\.\d{6}$/)
    .describe("Valor de la UDI en pesos, con 6 decimales, como lo publica el DOF."),
});
