import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoberturaCurada, FuenteDof } from "@mexicoapi/core";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { aNfc, ordenarPorClave } from "../canonico.js";
import {
  type ExcepcionCuotaFija,
  esquemaCobertura,
  esquemaExcepcionCuotaFija,
  esquemaFuenteCurada,
  type FuenteCurada,
} from "./esquemas.js";
import { type DefinicionCurado, DIRECTORIO_CURADO } from "./registro.js";

export interface DocumentoCurado<T> {
  dataset: string;
  /** Solo en los calendarios de días; `null` en los demás. */
  cobertura: CoberturaCurada | null;
  /** Solo en las tarifas de ISR; vacío en los demás. */
  excepciones: ExcepcionCuotaFija[];
  /** Por clave, en el orden del YAML. */
  fuentes: ReadonlyMap<string, FuenteCurada>;
  /** Ordenados por clave, en NFC y con la fuente completa en lugar de su clave. */
  registros: T[];
}

export type LecturaCurado<T> =
  | { documento: DocumentoCurado<T>; problemas: [] }
  | { documento: null; problemas: string[] };

// YAML 1.2 con el esquema core: las fechas sin comillas quedan como texto, los números como
// número (y el esquema los rechaza donde se espera un monto). Sin merge keys, sin etiquetas de
// YAML 1.1 y sin llaves repetidas.
const OPCIONES_YAML = {
  version: "1.2",
  schema: "core",
  merge: false,
  resolveKnownTags: false,
  uniqueKeys: true,
  strict: true,
  stringKeys: true,
  prettyErrors: true,
  logLevel: "silent",
} as const;

const CLAVE_FUENTE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const CAMPOS_PUBLICACION = ["nombre", "fecha_publicacion", "licencia", "licencia_url"] as const;

const MENSAJES: z.core.$ZodErrorMap = (problema) => {
  if (problema.code === "unrecognized_keys") {
    return `llave no permitida: ${problema.keys.map((k) => JSON.stringify(k)).join(", ")}`;
  }
  if (problema.code === "invalid_type" && problema.input === undefined) return "falta";
  return undefined;
};

function ruta(partes: readonly PropertyKey[]): string {
  return partes.length === 0 ? "(raíz)" : partes.map(String).join(".");
}

function describir(error: z.ZodError, prefijo: readonly PropertyKey[] = []): string[] {
  return error.issues.map((p) => {
    // Una clave de mapa inválida trae el motivo en el problema anidado.
    const texto = p.code === "invalid_key" ? (p.issues[0]?.message ?? p.message) : p.message;
    return `${ruta([...prefijo, ...p.path])}: ${texto}`;
  });
}

function primeraLinea(texto: string): string {
  return (texto.split("\n")[0] ?? "").replace(/:$/, "");
}

/** Interpreta el texto YAML; los problemas de sintaxis salen con línea y columna. */
function cargarYaml(texto: string): { valor: unknown; problemas: string[] } {
  const documentos = parseAllDocuments(texto, OPCIONES_YAML);
  const [documento] = documentos;
  if (documentos.length !== 1 || documento === undefined) {
    return { valor: null, problemas: ["YAML: el archivo debe tener un solo documento"] };
  }
  const problemas = [...documento.errors, ...documento.warnings].map(
    (e) => `YAML: ${primeraLinea(e.message)}`,
  );
  if (problemas.length > 0) return { valor: null, problemas };
  let anclas = 0;
  try {
    const valor = documento.toJS({ maxAliasCount: 0, onAnchor: () => void anclas++ });
    if (anclas === 0) return { valor, problemas: [] };
  } catch {
    // maxAliasCount: 0 rechaza cualquier alias
  }
  return { valor: null, problemas: ["YAML: no se permiten anclas ni alias (&, *)"] };
}

interface DocumentoYaml {
  dataset: string;
  fuentes: Record<string, FuenteCurada>;
  registros: unknown[];
  cobertura?: CoberturaCurada;
  excepciones_cuota_fija?: ExcepcionCuotaFija[];
}

/** `cobertura` y `excepciones_cuota_fija` solo se aceptan en los datasets que las usan. */
function esquemaDocumento(def: DefinicionCurado<{ fuente: FuenteDof }>): z.ZodType<DocumentoYaml> {
  const forma: Record<string, z.ZodType> = {
    dataset: z.literal(def.id, `se esperaba ${def.id}`),
    fuentes: z
      .record(
        z.string().regex(CLAVE_FUENTE, "la clave debe usar minúsculas, dígitos, puntos y guiones"),
        esquemaFuenteCurada,
      )
      .refine((f) => Object.keys(f).length > 0, "debe declarar al menos una fuente"),
    registros: z.array(z.unknown()).min(1, "debe tener al menos un registro"),
  };
  if (def.conCobertura) forma.cobertura = esquemaCobertura;
  if (def.conExcepciones) {
    forma.excepciones_cuota_fija = z.array(esquemaExcepcionCuotaFija).optional();
  }
  // La forma se arma según el dataset; el tipo de salida es el de DocumentoYaml.
  return z.strictObject(forma) as unknown as z.ZodType<DocumentoYaml>;
}

/** Fuentes que comparten URL deben describir la misma publicación (cambia solo el fragmento). */
function revisarPublicaciones(fuentes: ReadonlyMap<string, FuenteCurada>): string[] {
  const problemas: string[] = [];
  const primeraPorUrl = new Map<string, [string, FuenteCurada]>();
  for (const [clave, fuente] of fuentes) {
    const primera = primeraPorUrl.get(fuente.url);
    if (primera === undefined) {
      primeraPorUrl.set(fuente.url, [clave, fuente]);
      continue;
    }
    for (const campo of CAMPOS_PUBLICACION) {
      if (fuente[campo] !== primera[1][campo]) {
        problemas.push(
          `fuentes.${clave}: comparte URL con ${primera[0]} pero su ${campo} no coincide`,
        );
      }
    }
  }
  return problemas;
}

/** Valida el YAML de un dataset curado y lo convierte en los registros que se publican. */
export function interpretarCurado<T extends { fuente: FuenteDof }>(
  def: DefinicionCurado<T>,
  texto: string,
): LecturaCurado<T> {
  const cargado = cargarYaml(texto);
  if (cargado.problemas.length > 0) return { documento: null, problemas: cargado.problemas };
  const estructura = esquemaDocumento(def).safeParse(aNfc(cargado.valor), { error: MENSAJES });
  if (!estructura.success) return { documento: null, problemas: describir(estructura.error) };
  const datos = estructura.data;
  const fuentes = new Map(Object.entries(datos.fuentes));
  const problemas = revisarPublicaciones(fuentes);

  const usadas = new Set<string>();
  const registros: T[] = [];
  let todosValidos = true;
  datos.registros.forEach((crudo, i) => {
    const lugar = `registros.${i}`;
    const falla = (texto: string) => {
      todosValidos = false;
      problemas.push(texto);
    };
    if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) {
      falla(`${lugar}: debe ser un mapa de campos`);
      return;
    }
    const { fuente: clave, ...campos } = crudo as Record<string, unknown>;
    if (typeof clave !== "string") {
      falla(
        `${lugar}.fuente: ${clave === undefined ? "falta" : "debe ser la clave de una fuente declarada"}`,
      );
      return;
    }
    usadas.add(clave);
    const fuente = fuentes.get(clave);
    if (fuente === undefined) {
      falla(`${lugar}.fuente: fuente no declarada: ${clave}`);
      return;
    }
    const { nombre, url, fecha_publicacion, fragmento } = fuente;
    const completo = { ...campos, fuente: { nombre, url, fecha_publicacion, fragmento } };
    const r = def.esquema.safeParse(completo, { error: MENSAJES });
    if (r.success) registros.push(r.data);
    else for (const p of describir(r.error, ["registros", i])) falla(p);
  });
  for (const clave of fuentes.keys()) {
    if (!usadas.has(clave)) problemas.push(`fuentes.${clave}: no la usa ningún registro`);
  }

  const cobertura = datos.cobertura ?? null;
  const excepciones = datos.excepciones_cuota_fija ?? [];
  const ordenados = ordenarPorClave(registros, (r) => def.clave(r));
  if (todosValidos) {
    for (let i = 1; i < ordenados.length; i++) {
      const clave = def.clave(ordenados[i] as T);
      if (clave === def.clave(ordenados[i - 1] as T)) {
        problemas.push(`registros: clave duplicada: ${clave}`);
      }
    }
    for (const f of def.invariantes(ordenados, { cobertura, excepciones }))
      problemas.push(`invariante: ${f}`);
  }
  if (problemas.length > 0) return { documento: null, problemas };
  return {
    documento: { dataset: datos.dataset, cobertura, excepciones, fuentes, registros: ordenados },
    problemas: [],
  };
}

/** Lee `data/curado/<yaml>`; `null` si el archivo no existe. */
export async function leerCurado<T extends { fuente: FuenteDof }>(
  def: DefinicionCurado<T>,
  raizDatos: string,
): Promise<LecturaCurado<T> | null> {
  let texto: string;
  try {
    texto = await readFile(join(raizDatos, DIRECTORIO_CURADO, def.yaml), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return interpretarCurado(def, texto);
}
