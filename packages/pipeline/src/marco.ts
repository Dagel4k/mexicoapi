import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FechaISO, FuenteManifiesto, Manifiesto } from "@mexicoapi/core";
import { z } from "zod";
import { aNfc, jsonCanonico, ordenarPorClave, sha256Hex } from "./canonico.js";
import { type Diferencias, diferenciar, hayDiferencias } from "./diferencias.js";
import { ErrorDatos } from "./errores.js";
import { escribirDirectorioAtomico } from "./escritura.js";
import type { Cliente } from "./http.js";

export interface Contexto {
  cliente: Cliente;
  fecha: FechaISO;
  raizDatos: string;
}

export interface CrudoCapturado {
  file: string;
  url: string;
  bytes: Uint8Array;
  obtenido_en: string;
}

export interface FuenteCapturada {
  name: string;
  url: string;
  license: string;
  license_url: string;
  citation: string;
  published_at: FechaISO | null;
  crudos: CrudoCapturado[];
}

export interface Construccion<T> {
  registros: T[];
  avisos: string[];
}

export interface Revision {
  requiereRevision: boolean;
  motivos: string[];
}

export interface DefinicionDataset<T extends object> {
  id: string;
  /**
   * Hosts a los que el dataset puede pedir, también en las redirecciones: el cliente que recibe
   * en `ctx` rechaza cualquier otro y todo lo que no sea https.
   */
  hosts: readonly string[];
  directorio: string;
  archivo: string;
  esquema: z.ZodType<T>;
  clave(r: T): string;
  capturar(ctx: Contexto): Promise<FuenteCapturada[]>;
  construir(
    fuentes: readonly FuenteCapturada[],
    anterior: readonly T[] | null,
    ctx: Contexto,
  ): Promise<Construccion<T>>;
  invariantes(registros: readonly T[]): string[];
  /** Puede leer otros datos de `ctx.raizDatos` (el FIX lee el calendario de la CNBV). */
  revisar(
    diferencias: Diferencias<T>,
    anterior: readonly T[],
    ctx: Contexto,
  ): Revision | Promise<Revision>;
}

export interface ResultadoCorrida {
  dataset: string;
  estado: "sin_cambios" | "actualizado" | "requiere_revision";
  altas: number;
  bajas: number;
  cambios: number;
  motivos: string[];
  registros: number;
  /** Verdadero solo si la corrida escribió archivos. */
  escrito: boolean;
}

export interface OpcionesCorrida<T> {
  seco?: boolean;
  /** Si no existe el archivo de datos, se pasa a `construir` como `anterior`. */
  anteriorInicial?: readonly T[];
}

const RUTA_CRUDO = /^raw\/[A-Za-z0-9._-]+$/;

/** El mismo cliente, pero cada pedido solo puede ir a `hosts`. */
export function restringirCliente(cliente: Cliente, hosts: readonly string[]): Cliente {
  return { obtener: (url, opciones = {}) => cliente.obtener(url, { ...opciones, hosts }) };
}

function primerProblema(error: z.ZodError): string {
  const p = error.issues[0];
  if (p === undefined) return "error de esquema";
  const ruta = p.path.map(String).join(".");
  return `${ruta === "" ? "(raíz)" : ruta}: ${p.message}`;
}

function parsear<T extends object>(def: DefinicionDataset<T>, valor: unknown): T[] {
  const r = z.array(def.esquema).safeParse(valor);
  if (r.success) return r.data;
  const indice = r.error.issues[0]?.path[0];
  const donde = typeof indice === "number" ? ` (registro ${indice})` : "";
  throw new ErrorDatos(`Esquema inválido${donde}: ${primerProblema(r.error)}`, def.id);
}

/** Lee el snapshot actual; `null` si no existe, `ErrorDatos` si está corrupto. */
export async function leerRegistros<T extends object>(
  def: DefinicionDataset<T>,
  raizDatos: string,
): Promise<T[] | null> {
  const ruta = join(raizDatos, def.directorio, def.archivo);
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErrorDatos(`El snapshot previo no es JSON válido: ${ruta}`, def.id);
  }
  return parsear(def, json);
}

function validarCrudos(def: { id: string }, fuentes: readonly FuenteCapturada[]): void {
  const archivos = fuentes.flatMap((f) => f.crudos);
  if (archivos.length === 0) throw new ErrorDatos("capturar no devolvió archivos crudos", def.id);
  const vistos = new Set<string>();
  for (const c of archivos) {
    if (!RUTA_CRUDO.test(c.file) || c.file === "raw/." || c.file === "raw/..") {
      throw new ErrorDatos(`Ruta de crudo no permitida: ${c.file}`, def.id);
    }
    if (vistos.has(c.file)) throw new ErrorDatos(`Crudo repetido: ${c.file}`, def.id);
    vistos.add(c.file);
  }
}

export async function ejecutarDataset<T extends object>(
  def: DefinicionDataset<T>,
  ctxCorrida: Contexto,
  opciones: OpcionesCorrida<T> = {},
): Promise<{ resultado: ResultadoCorrida; diferencias: Diferencias<T> }> {
  const ctx: Contexto = {
    ...ctxCorrida,
    cliente: restringirCliente(ctxCorrida.cliente, def.hosts),
  };
  const fuentes = await def.capturar(ctx);
  validarCrudos(def, fuentes);

  const anteriorDisco = await leerRegistros(def, ctx.raizDatos);
  const anteriorParaConstruir = anteriorDisco ?? opciones.anteriorInicial ?? null;
  const construccion = await def.construir(fuentes, anteriorParaConstruir, ctx);

  if (construccion.registros.length === 0) {
    throw new ErrorDatos("construir no produjo registros", def.id);
  }

  const validados = parsear(def, aNfc(construccion.registros));
  const registros = ordenarPorClave(validados, def.clave);

  const vistas = new Set<string>();
  const repetidas = new Set<string>();
  for (const r of registros) {
    const k = def.clave(r);
    if (vistas.has(k)) repetidas.add(k);
    vistas.add(k);
  }
  if (repetidas.size > 0) {
    throw new ErrorDatos(`Claves duplicadas: ${[...repetidas].join(", ")}`, def.id);
  }
  const fallas = def.invariantes(registros);
  if (fallas.length > 0) {
    throw new ErrorDatos(`Invariantes violados: ${fallas.join("; ")}`, def.id);
  }

  const hayAnterior = anteriorDisco !== null;
  const diferencias = diferenciar(anteriorDisco ?? [], registros, def.clave);
  const base = {
    dataset: def.id,
    altas: diferencias.altas.length,
    bajas: diferencias.bajas.length,
    cambios: diferencias.cambios.length,
    registros: registros.length,
  };
  if (!hayDiferencias(diferencias)) {
    if (construccion.avisos.length > 0) {
      const resultado: ResultadoCorrida = {
        ...base,
        estado: "requiere_revision",
        motivos: [...construccion.avisos],
        escrito: false,
      };
      return { resultado, diferencias };
    }
    return {
      resultado: { ...base, estado: "sin_cambios", motivos: [], escrito: false },
      diferencias,
    };
  }

  const motivos: string[] = [];
  let requiere = false;
  if (!hayAnterior) {
    motivos.push("snapshot inicial");
  } else {
    const revision = await def.revisar(diferencias, anteriorDisco, ctx);
    if (revision.requiereRevision) {
      requiere = true;
      motivos.push(...revision.motivos);
    }
  }
  if (construccion.avisos.length > 0) {
    requiere = true;
    motivos.push(...construccion.avisos);
  }
  const resultado: ResultadoCorrida = {
    ...base,
    estado: requiere ? "requiere_revision" : "actualizado",
    motivos,
    escrito: !opciones.seco,
  };

  if (!opciones.seco) await escribir(def, ctx, fuentes, registros);
  return { resultado, diferencias };
}

async function escribir<T extends object>(
  def: DefinicionDataset<T>,
  ctx: Contexto,
  fuentes: readonly FuenteCapturada[],
  registros: readonly T[],
): Promise<void> {
  const texto = jsonCanonico(registros);
  const archivos = new Map<string, Uint8Array | string>([[def.archivo, texto]]);
  const tiempos: string[] = [];
  const sources: FuenteManifiesto[] = fuentes.map((f) => ({
    name: f.name,
    url: f.url,
    license: f.license,
    license_url: f.license_url,
    citation: f.citation,
    published_at: f.published_at,
    raw: f.crudos.map((c) => {
      archivos.set(c.file, c.bytes);
      tiempos.push(c.obtenido_en);
      return { file: c.file, url: c.url, sha256: sha256Hex(c.bytes) };
    }),
  }));
  const fetchedAt = [...tiempos].sort()[0] as string;
  const manifiesto: Manifiesto = {
    dataset: def.id,
    schema_version: 1,
    as_of: ctx.fecha,
    fetched_at: fetchedAt,
    data_file: def.archivo,
    data_sha256: sha256Hex(texto),
    records: registros.length,
    sources,
  };
  archivos.set("manifest.json", jsonCanonico(manifiesto));
  await escribirDirectorioAtomico(join(ctx.raizDatos, def.directorio), archivos);
}
