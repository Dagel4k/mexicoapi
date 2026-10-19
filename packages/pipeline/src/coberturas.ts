// Hasta cuándo cubren los datos curados: los plazos de los calendarios de la CNBV y el SAT, la
// vigencia de la última UMA y el último año del salario mínimo y de las tarifas de ISR. Después de
// esa fecha la API responde 422 o dato-no-disponible hasta que alguien capture la publicación
// nueva. Lo usa el comando `coberturas` y, con él, la alerta de frescura.yml. Lee solo data/.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FechaISO, FuenteDof } from "@mexicoapi/core";
import { coberturaAnual, coberturaUma } from "@mexicoapi/core/constantes";
import { z } from "zod";
import {
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
  type DefinicionCurado,
  DIRECTORIO_CURADO,
} from "./curado/registro.js";
import { ErrorDatos } from "./errores.js";
import { porNombre } from "./sitio/comun.js";

export interface Cobertura {
  /** Estable entre corridas: va en el título del issue ("dias-inhabiles.sat general"). */
  id: string;
  dataset: string;
  /** Último día cubierto. */
  hasta: FechaISO;
  /** Qué deja de responder la API después de `hasta` y qué hay que capturar. */
  detalle: string;
}

export interface CoberturaPorVencer extends Cobertura {
  /** De la fecha de la consulta a `hasta`; negativo si ya terminó. */
  dias_restantes: number;
  /** El título del issue de la alerta. */
  titulo: string;
  /** Una oración con la fecha y los días que faltan. */
  resumen: string;
}

export const PREFIJO_TITULO = "Cobertura por vencer: ";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Lo que se usa de `calendario.json`: la cobertura de cada tipo de plazo. */
const esquemaCalendario = z.object({
  autoridad: z.string(),
  plazos: z
    .record(z.string(), z.object({ cobertura: z.object({ desde: fecha, hasta: fecha }) }))
    .refine((plazos) => Object.keys(plazos).length > 0, "no tiene tipos de plazo"),
});

const rutaDe = (directorio: string, archivo: string): string => `${directorio}/${archivo}`;

async function leerJson<T>(
  raizDatos: string,
  dataset: string,
  ruta: string,
  esquema: z.ZodType<T>,
): Promise<T> {
  let texto: string;
  try {
    texto = await readFile(join(raizDatos, ruta), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ErrorDatos(`falta ${ruta}`, dataset);
    }
    throw error;
  }
  const resultado = esquema.safeParse(JSON.parse(texto));
  if (!resultado.success) {
    throw new ErrorDatos(`${ruta} tiene una forma inesperada: ${resultado.error.message}`, dataset);
  }
  return resultado.data;
}

const yaml = <T extends { fuente: FuenteDof }>(def: DefinicionCurado<T>): string =>
  `data/${DIRECTORIO_CURADO}/${def.yaml}`;

async function deCalendario(
  raizDatos: string,
  def: typeof curadoDiasCnbv | typeof curadoDiasSat,
): Promise<Cobertura[]> {
  const { autoridad, plazos } = await leerJson(
    raizDatos,
    def.id,
    rutaDe(def.directorio, "calendario.json"),
    esquemaCalendario,
  );
  // La CNBV solo tiene el plazo general: no acepta tipo_plazo.
  const conTipo = Object.keys(plazos).length > 1 || autoridad === "sat";
  return Object.entries(plazos).map(([tipo, { cobertura }]) => ({
    id: `${def.id} ${tipo}`,
    dataset: def.id,
    hasta: cobertura.hasta,
    detalle: `Después de ese día, /v1/dias-habiles con autoridad=${autoridad}${conTipo ? ` y tipo_plazo=${tipo}` : ""} responde 422 calendario-incompleto. Hay que capturar en ${yaml(def)} la publicación que extiende la cobertura.`,
  }));
}

/** Los años distintos de `registros`, en orden. */
const aniosDe = (registros: readonly { anio: number }[]): number[] =>
  [...new Set(registros.map((r) => r.anio))].sort((a, b) => a - b);

async function deUma(raizDatos: string): Promise<Cobertura> {
  const umas = await leerJson(
    raizDatos,
    curadoUma.id,
    rutaDe(curadoUma.directorio, curadoUma.archivo),
    z.array(curadoUma.esquema).min(1),
  );
  const { hasta } = coberturaUma(umas);
  const ultima = umas[umas.length - 1]?.anio as number;
  return {
    id: curadoUma.id,
    dataset: curadoUma.id,
    hasta,
    detalle: `La última UMA cargada es la de ${ultima}. Después de ese día, /v1/constantes/uma responde dato-no-disponible hasta capturar la UMA de ${ultima + 1} en ${yaml(curadoUma)}.`,
  };
}

async function deSalarioMinimo(raizDatos: string): Promise<Cobertura> {
  const def = curadoSalarioMinimo;
  const registros = await leerJson(
    raizDatos,
    def.id,
    rutaDe(def.directorio, def.archivo),
    z.array(def.esquema).min(1),
  );
  const { hasta } = coberturaAnual(aniosDe(registros));
  const ultimo = Number(hasta.slice(0, 4));
  return {
    id: def.id,
    dataset: def.id,
    hasta,
    detalle: `El último salario mínimo cargado es el de ${ultimo}. /v1/constantes/salario-minimo/${ultimo + 1} responde dato-no-disponible hasta capturarlo en ${yaml(def)}.`,
  };
}

/** Cada periodo tiene su año cargado: la cobertura termina con el que va atrás. */
async function deTarifasIsr(raizDatos: string): Promise<Cobertura> {
  const def = curadoTarifasIsr;
  const tarifas = await leerJson(
    raizDatos,
    def.id,
    rutaDe(def.directorio, def.archivo),
    z.array(def.esquema).min(1),
  );
  const periodos = [...new Set(tarifas.map((t) => t.periodo))].sort(porNombre);
  const ultimos = periodos.map((periodo) => ({
    periodo,
    hasta: coberturaAnual(aniosDe(tarifas.filter((t) => t.periodo === periodo))).hasta,
  }));
  const hasta = ultimos.map((u) => u.hasta).sort(porNombre)[0] as FechaISO;
  const lista = ultimos.map((u) => `la ${u.periodo} de ${u.hasta.slice(0, 4)}`).join(" y ");
  const siguiente = Number(hasta.slice(0, 4)) + 1;
  return {
    id: def.id,
    dataset: def.id,
    hasta,
    detalle: `Las últimas tarifas cargadas son ${lista}. /v1/isr/tarifa/{periodo}/${siguiente} responde dato-no-disponible hasta capturarlas en ${yaml(def)}.`,
  };
}

/** Las coberturas de los datos curados de `raizDatos`, de la que termina antes a la última. */
export async function leerCoberturas(raizDatos: string): Promise<Cobertura[]> {
  const coberturas = [
    ...(await deCalendario(raizDatos, curadoDiasCnbv)),
    ...(await deCalendario(raizDatos, curadoDiasSat)),
    await deUma(raizDatos),
    await deSalarioMinimo(raizDatos),
    await deTarifasIsr(raizDatos),
  ];
  return coberturas.sort((a, b) => porNombre(a.hasta, b.hasta) || porNombre(a.id, b.id));
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior); vale de 0001 a 9999. */
function diasEntre(desde: FechaISO, hasta: FechaISO): number {
  const dia = (f: FechaISO): number => {
    const d = new Date(0);
    d.setUTCFullYear(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)));
    return d.getTime() / 86_400_000;
  };
  return dia(hasta) - dia(desde);
}

const plural = (n: number, palabra: string): string => `${n} ${palabra}${n === 1 ? "" : "s"}`;

function resumen(id: string, hasta: FechaISO, dias: number): string {
  const nombre = `La cobertura de \`${id}\``;
  if (dias < 0) return `${nombre} terminó el ${hasta}, hace ${plural(-dias, "día")}.`;
  if (dias === 0) return `${nombre} termina hoy, ${hasta}.`;
  return `${nombre} termina el ${hasta}: falta${dias === 1 ? "" : "n"} ${plural(dias, "día")}.`;
}

/**
 * Las coberturas con los días que faltan desde `fecha`. Con `dias`, solo las que terminan en ese
 * plazo o antes, incluidas las que ya terminaron.
 */
export function porVencer(
  coberturas: readonly Cobertura[],
  fecha: FechaISO,
  dias?: number,
): CoberturaPorVencer[] {
  return coberturas
    .map((c) => {
      const restantes = diasEntre(fecha, c.hasta);
      return {
        id: c.id,
        dataset: c.dataset,
        hasta: c.hasta,
        dias_restantes: restantes,
        titulo: `${PREFIJO_TITULO}${c.id}`,
        resumen: resumen(c.id, c.hasta, restantes),
        detalle: c.detalle,
      };
    })
    .filter((c) => dias === undefined || c.dias_restantes <= dias);
}

/** Las coberturas en texto, una por renglón, con los días que faltan. */
export function coberturasEnTexto(
  lista: readonly CoberturaPorVencer[],
  fecha: FechaISO,
  dias?: number,
): string {
  if (dias !== undefined && lista.length === 0) {
    return `Ninguna cobertura termina en los próximos ${dias} días (al ${fecha}).\n`;
  }
  const titulo =
    dias === undefined
      ? `Coberturas de los datos curados (al ${fecha}):`
      : `Coberturas que terminan en los próximos ${dias} días (al ${fecha}):`;
  const ancho = Math.max(0, ...lista.map((c) => c.id.length));
  const renglones = lista.map((c) => {
    const cuanto =
      c.dias_restantes < 0
        ? `terminó hace ${plural(-c.dias_restantes, "día")}`
        : c.dias_restantes === 0
          ? "termina hoy"
          : `falta${c.dias_restantes === 1 ? "" : "n"} ${plural(c.dias_restantes, "día")}`;
    return `  ${c.id.padEnd(ancho)}  hasta ${c.hasta}  (${cuanto})`;
  });
  return `${titulo}\n${renglones.join("\n")}\n`;
}
