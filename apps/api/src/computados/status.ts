import { esFechaIsoValida } from "@mexicoapi/core";
import { metaInterna } from "../cargas.js";
import { CACHE_STATUS, respuestaJson } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

/** Lo que cada corrida de datos deja en KV bajo `estado:<dataset>`, ya revisado. */
interface EstadoCorrida {
  readonly last_attempt: string;
  readonly last_success: string | null;
}

const RESULTADOS: ReadonlySet<unknown> = new Set([
  "sin_cambios",
  "actualizado",
  "requiere_revision",
  "error",
]);

// Instante UTC con segundos y `Z`, como lo escribe toISOString(). La validación es más
// estricta que el contrato a propósito: lo que no la cumple se toma como sin registro en vez de
// publicarse.
const INSTANTE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

function esInstante(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const fecha = INSTANTE.exec(valor)?.[1];
  return fecha !== undefined && esFechaIsoValida(fecha);
}

function aEstadoCorrida(valor: unknown): EstadoCorrida | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  const { last_attempt, last_success, last_result } = valor as Record<string, unknown>;
  if (!esInstante(last_attempt)) return null;
  if (last_success !== null && !esInstante(last_success)) return null;
  if (!RESULTADOS.has(last_result)) return null;
  return Object.freeze({ last_attempt, last_success });
}

const MEMORIA_MS = 60_000;
const MS_POR_HORA = 3_600_000;

// Memoria por isolate: dataset → lectura revisada (null si no había valor o no tenía forma).
// Una falla de KV no se recuerda.
const memoria = new Map<string, { corrida: EstadoCorrida | null; hasta: number }>();

async function leerCorrida(
  kv: KVNamespace,
  dataset: string,
  ahora: number,
): Promise<EstadoCorrida | null> {
  const guardada = memoria.get(dataset);
  if (guardada !== undefined && ahora < guardada.hasta) return guardada.corrida;
  let corrida: EstadoCorrida | null;
  try {
    corrida = aEstadoCorrida(await kv.get(`estado:${dataset}`, { type: "json", cacheTtl: 60 }));
  } catch {
    return null;
  }
  memoria.set(dataset, { corrida, hasta: ahora + MEMORIA_MS });
  return corrida;
}

function estadoDe(
  corrida: EstadoCorrida | null,
  frescuraHoras: number,
  ahora: number,
): "ok" | "stale" | "unknown" {
  if (corrida === null) return "unknown";
  if (corrida.last_success === null) return "stale";
  return ahora - Date.parse(corrida.last_success) > frescuraHoras * MS_POR_HORA ? "stale" : "ok";
}

/** `GET /v1/status`: datos del build (meta interno) más la última corrida de cada dataset (KV). */
export async function status(c: Contexto): Promise<Response> {
  const { datasets } = await metaInterna(c.entorno);
  const ahora = (c.opciones.ahora?.() ?? new Date()).getTime();
  const kv = c.entorno.ESTADO;
  // Los ids son únicos: nunca hay empate.
  const entradas = Object.entries(datasets).sort(([a], [b]) => (a < b ? -1 : 1));
  const data = await Promise.all(
    entradas.map(async ([id, d]) => {
      const corrida = kv === undefined ? null : await leerCorrida(kv, id, ahora);
      return {
        dataset: id,
        as_of: d.meta.as_of,
        records: d.records,
        data_sha256: d.data_sha256,
        status: estadoDe(corrida, d.frescura_horas, ahora),
        last_attempt: corrida?.last_attempt ?? null,
        last_success: corrida?.last_success ?? null,
        frescura_horas: d.frescura_horas,
      };
    }),
  );
  return respuestaJson({ data }, { cache: CACHE_STATUS });
}

/** Para pruebas: olvida las lecturas de KV. */
export function reiniciarMemoriaStatus(): void {
  memoria.clear();
}
