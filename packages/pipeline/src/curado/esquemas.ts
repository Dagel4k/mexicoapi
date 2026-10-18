import type {
  CoberturaCurada,
  DiaInhabilCurado,
  FuenteDof,
  SalarioMinimo,
  TarifaIsr,
  TramoIsr,
  Uma,
} from "@mexicoapi/core";
import { esFechaIsoValida } from "@mexicoapi/core";
import { z } from "zod";
import { limpiarTexto } from "../canonico.js";
import { esMonto } from "./decimal.js";

/** Sitios oficiales que pueden respaldar un dato curado. */
const SITIOS_OFICIALES = ["dof.gob.mx", "sidof.segob.gob.mx", "www.diputados.gob.mx"] as const;

const MENSAJE_URL_OFICIAL =
  "debe estar en https://dof.gob.mx/, https://sidof.segob.gob.mx/ o https://www.diputados.gob.mx/";
const MENSAJE_MONTO = 'debe ser un monto entre comillas con dos decimales, por ejemplo "117.31"';
const MENSAJE_FECHA = "no es una fecha válida (AAAA-MM-DD)";

/** Mensaje para un valor del tipo equivocado; una llave ausente dice "falta". */
const mensaje = (texto: string) => ({
  error: (problema: { input?: unknown }) => (problema.input === undefined ? "falta" : texto),
});

function esUrlHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:" && url.startsWith("https://") && !/\s/.test(url);
  } catch {
    return false;
  }
}

/** URL https en uno de los sitios oficiales, sin usuario ni puerto. */
export function esUrlOficial(url: string): boolean {
  return esUrlHttps(url) && SITIOS_OFICIALES.some((sitio) => url.startsWith(`https://${sitio}/`));
}

const texto = z
  .string(mensaje("debe ser texto"))
  .min(1, "no puede estar vacío")
  .refine(
    (t) => limpiarTexto(t) === t,
    "tiene espacios de más, saltos de línea o espacios especiales",
  );
const fecha = z.string(mensaje(MENSAJE_FECHA)).refine(esFechaIsoValida, MENSAJE_FECHA);
const monto = z.string(mensaje(MENSAJE_MONTO)).refine(esMonto, MENSAJE_MONTO);
const urlOficial = z.string(mensaje(MENSAJE_URL_OFICIAL)).refine(esUrlOficial, MENSAJE_URL_OFICIAL);
const anio = z
  .number(mensaje("debe ser un año entero"))
  .int("debe ser un año entero")
  .min(1900, "debe ser un año entre 1900 y 2100")
  .max(2100, "debe ser un año entre 1900 y 2100");

const opcion = <const T extends readonly [string, ...string[]]>(valores: T) =>
  z.enum(valores, mensaje(`debe ser ${valores.map((v) => `"${v}"`).join(" o ")}`));

export const esquemaFuenteDof: z.ZodType<FuenteDof> = z.strictObject({
  nombre: texto.describe("Nombre de la publicación."),
  url: urlOficial.describe("Dirección de la publicación en el DOF o en diputados.gob.mx."),
  fecha_publicacion: fecha.describe("Fecha de publicación (AAAA-MM-DD)."),
  fragmento: texto.describe("Texto oficial que respalda el valor, citado tal cual."),
});

/**
 * Fecha AAAA-MM-DD del parámetro `fecha=DD/MM/AAAA` de una nota del DOF; `undefined` si la URL
 * no es una nota con fecha y `null` si la trae con otra forma.
 */
export function fechaDeNotaDof(url: string): string | null | undefined {
  if (!url.startsWith("https://dof.gob.mx/nota_detalle.php?")) return undefined;
  const valor = new URL(url).searchParams.get("fecha");
  if (valor === null) return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  return m === null ? null : `${m[3]}-${m[2]}-${m[1]}`;
}

/** Fuente tal como se escribe en el YAML: la publicación más su licencia. */
export const esquemaFuenteCurada = z
  .strictObject({
    nombre: texto,
    url: urlOficial,
    fecha_publicacion: fecha,
    fragmento: texto,
    licencia: texto,
    licencia_url: z
      .string(mensaje("debe ser una URL https"))
      .refine(esUrlHttps, "debe ser una URL https"),
  })
  .superRefine((fuente, ctx) => {
    if (!esUrlOficial(fuente.url) || !esFechaIsoValida(fuente.fecha_publicacion)) return;
    const deUrl = fechaDeNotaDof(fuente.url);
    if (deUrl === null) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "la fecha de la URL debe tener la forma DD/MM/AAAA",
      });
    } else if (deUrl !== undefined && deUrl !== fuente.fecha_publicacion) {
      const dof = `${deUrl.slice(8, 10)}/${deUrl.slice(5, 7)}/${deUrl.slice(0, 4)}`;
      ctx.addIssue({
        code: "custom",
        path: ["fecha_publicacion"],
        message: `no coincide con la fecha de la URL (${dof})`,
      });
    }
  });

export type FuenteCurada = z.infer<typeof esquemaFuenteCurada>;

/**
 * Cuota fija publicada que no empata a ±0.01 con el tramo anterior. Se declara en el YAML con el
 * valor publicado, el recalculado y el motivo; `verificar` exige que haga falta y que se use.
 */
export const esquemaExcepcionCuotaFija = z.strictObject({
  anio,
  periodo: opcion(["mensual", "anual"]),
  tramo: z
    .number(mensaje("debe ser un tramo de 2 en adelante"))
    .int("debe ser un tramo de 2 en adelante")
    .min(2, "debe ser un tramo de 2 en adelante"),
  publicada: monto,
  calculada: monto,
  motivo: texto,
});

export type ExcepcionCuotaFija = z.infer<typeof esquemaExcepcionCuotaFija>;

const rango = z
  .strictObject({ desde: fecha, hasta: fecha })
  .refine((r) => r.desde <= r.hasta, "desde es posterior a hasta");

export const esquemaCobertura: z.ZodType<CoberturaCurada> = z
  .strictObject({ descanso: rango.optional(), vacaciones: rango.optional() })
  .refine(
    (c) => c.descanso !== undefined || c.vacaciones !== undefined,
    "debe declarar al menos un tipo de día",
  )
  .transform((c) => {
    const cobertura: CoberturaCurada = {};
    if (c.descanso !== undefined) cobertura.descanso = c.descanso;
    if (c.vacaciones !== undefined) cobertura.vacaciones = c.vacaciones;
    return cobertura;
  });

export const esquemaDiaInhabilCurado: z.ZodType<DiaInhabilCurado> = z.strictObject({
  fecha: fecha.describe("Día inhábil (AAAA-MM-DD)."),
  autoridad: opcion(["cnbv", "sat"]).describe("Autoridad del calendario."),
  motivo: texto.describe("Motivo del día inhábil; en los días de regla, la regla."),
  tipo: opcion(["descanso", "vacaciones"]).describe("Tipo de día inhábil."),
  fuente: esquemaFuenteDof.describe("Publicación que lo establece."),
});

export const esquemaUma: z.ZodType<Uma> = z.strictObject({
  anio: anio.describe("Año de la UMA."),
  diaria: monto.describe("Valor diario en pesos."),
  mensual: monto.describe("Valor mensual en pesos (diaria × 30.4)."),
  anual: monto.describe("Valor anual en pesos (mensual × 12)."),
  vigencia_desde: fecha.describe("Primer día de vigencia (1 de febrero)."),
  fuente: esquemaFuenteDof.describe("Publicación del INEGI en el DOF."),
});

export const esquemaSalarioMinimo: z.ZodType<SalarioMinimo> = z.strictObject({
  anio: anio.describe("Año del salario mínimo."),
  zona: opcion(["general", "zlfn"]).describe(
    "Zona: general o Zona Libre de la Frontera Norte (zlfn).",
  ),
  diario: monto.describe("Salario mínimo diario en pesos."),
  vigencia_desde: fecha.describe("Primer día de vigencia (1 de enero)."),
  fuente: esquemaFuenteDof.describe("Resolución de la CONASAMI en el DOF."),
});

export const esquemaTramoIsr: z.ZodType<TramoIsr> = z.strictObject({
  limite_inferior: monto.describe("Límite inferior en pesos."),
  limite_superior: monto.nullable().describe("Límite superior en pesos; null en el último tramo."),
  cuota_fija: monto.describe("Cuota fija en pesos."),
  tasa_excedente: monto.describe("Porcentaje sobre el excedente del límite inferior."),
});

export const esquemaTarifaIsr: z.ZodType<TarifaIsr> = z.strictObject({
  anio: anio.describe("Año de la tarifa."),
  periodo: opcion(["mensual", "anual"]).describe("Periodo de la tarifa."),
  tramos: z.array(esquemaTramoIsr).min(1, "debe tener al menos un tramo").describe("Tramos."),
  fuente: esquemaFuenteDof.describe("Anexo de la RMF publicado en el DOF."),
});
