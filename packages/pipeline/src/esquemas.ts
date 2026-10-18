import type { Estado, Municipio } from "@mexicoapi/core";
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
