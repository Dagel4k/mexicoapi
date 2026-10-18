import type { Banco, Estado, Municipio, PeriodoBanco } from "@mexicoapi/core";
import { z } from "zod";

const cveEnt = z.string().regex(/^\d{2}$/);
const cveMun = z.string().regex(/^\d{3}$/);

export const esquemaEstado: z.ZodType<Estado> = z.object({
  cve_ent: cveEnt,
  nombre: z.string().min(1),
  abreviatura: z.string().min(1),
  cvegeo: z.string().regex(/^(\d{2}|\d{5})$/),
});

export const esquemaMunicipio: z.ZodType<Municipio> = z.object({
  cvegeo: z.string().regex(/^(\d{2}|\d{5})$/),
  cve_ent: cveEnt,
  cve_mun: cveMun,
  nombre: z.string().min(1),
  // Las alcaldías de la Ciudad de México no tienen cabecera: null.
  cve_cabecera: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
});

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const codigoSpei = z.string().regex(/^\d{4,5}$/);

const esquemaPeriodoBanco: z.ZodType<PeriodoBanco> = z.object({
  codigo_spei: codigoSpei,
  nombre_corto: z.string().min(1),
  desde: fechaIso,
  hasta: fechaIso.nullable(),
});

export const esquemaBanco: z.ZodType<Banco> = z.object({
  codigo: z.string().regex(/^\d{3}$/),
  codigo_spei: codigoSpei,
  nombre_corto: z.string().min(1),
  razon_social: z.string().min(1).nullable(),
  sector: z.string().min(1).nullable(),
  tipo: z.enum(["banca_multiple", "banca_desarrollo", "otra_entidad", "banco_central"]),
  participacion: z.enum(["directa", "no_confirmada"]),
  activo: z.boolean(),
  baja_detectada: fechaIso.nullable(),
  historial: z.array(esquemaPeriodoBanco),
});
