import { aUnaLinea } from "mexicoapi";
import { compilarEsquema, type EsquemaJson, esObjeto, type Validador } from "./esquema.js";

/**
 * Anotaciones de una herramienta. Todas las de este servidor son de solo lectura;
 * `openWorldHint` dice si consultan algo fuera del paquete (la API de MéxicoAPI).
 */
export interface AnotacionesHerramienta {
  readOnlyHint: true;
  openWorldHint: boolean;
  idempotentHint?: boolean;
  destructiveHint?: false;
}

/** Bloque de contenido de un resultado. Por ahora solo texto. */
export interface BloqueTexto {
  type: "text";
  text: string;
}

/** Resultado de `tools/call` (CallToolResult). */
export interface ResultadoHerramienta {
  content: BloqueTexto[];
  /** Obligatorio si la herramienta declara outputSchema y el resultado no es un error. */
  structuredContent?: Record<string, unknown>;
  /** Errores de la herramienta (entrada inválida, dato inexistente, red caída). */
  isError?: boolean;
}

export interface ContextoHerramienta {
  /** Se aborta si el cliente cancela la llamada o el servidor se cierra. */
  signal: AbortSignal;
}

/** Esquema raíz de entrada o salida: la especificación exige `type: "object"`. */
export type EsquemaObjeto = EsquemaJson & { readonly type: "object" };

/**
 * Definición de una herramienta. El nombre, el título, la descripción y los esquemas son
 * constantes del código: nunca se arman con texto que venga de los datos.
 */
export interface Herramienta {
  name: string;
  title: string;
  description: string;
  inputSchema: EsquemaObjeto;
  outputSchema?: EsquemaObjeto;
  annotations: AnotacionesHerramienta;
  /**
   * Recibe los argumentos ya validados contra inputSchema. Los errores esperables se devuelven
   * con `resultadoError` o se lanzan como `ErrorHerramienta`; cualquier otra excepción se
   * responde como error interno, sin detalles.
   */
  ejecutar(
    args: Record<string, unknown>,
    contexto: ContextoHerramienta,
  ): Promise<ResultadoHerramienta>;
}

export interface HerramientaRegistrada {
  readonly definicion: Herramienta;
  readonly validarEntrada: Validador;
  readonly validarSalida: Validador | null;
}

/** Nombres que recomienda la especificación: 1 a 128 caracteres de A-Z, a-z, 0-9, _, - y punto. */
const NOMBRE_VALIDO = /^[A-Za-z0-9_.-]{1,128}$/;

/** Un tipo de problema de la API como `no-encontrado`; otra forma no se copia al texto. */
const TIPO_PROBLEMA = /^[a-z][a-z-]{0,63}$/;

/**
 * El texto de todo error de herramienta: el tipo de problema de la API entre corchetes y el
 * detalle en una línea (`[dato-no-disponible] …`). Así el modelo distingue sin leer el español un
 * dato que todavía no se publica (vuelve a intentar después) de uno que no existe, o un argumento
 * que debe corregir. Sin tipo (sin conexión, una respuesta que no es de la API) o con uno de otra
 * forma, `error-interno`.
 */
export function textoDeError(tipo: string | undefined, detalle: string): string {
  const cual = tipo !== undefined && TIPO_PROBLEMA.test(tipo) ? tipo : "error-interno";
  return `[${cual}] ${aUnaLinea(detalle)}`;
}

/**
 * Error esperado de una herramienta, con su tipo de problema y un detalle que se puede mostrar tal
 * cual (sin datos internos ni rutas): se responde como resultado con isError para que el modelo
 * corrija la llamada.
 */
export class ErrorHerramienta extends Error {
  readonly tipo: string | undefined;
  readonly detalle: string;

  constructor(tipo: string | undefined, detalle: string) {
    super(textoDeError(tipo, detalle));
    this.name = "ErrorHerramienta";
    this.tipo = tipo;
    this.detalle = detalle;
  }
}

/** Resultado de error de una herramienta, con su tipo de problema al inicio del texto. */
export function resultadoError(tipo: string | undefined, detalle: string): ResultadoHerramienta {
  return { content: [{ type: "text", text: textoDeError(tipo, detalle) }], isError: true };
}

function textoNoVacio(valor: unknown): boolean {
  return typeof valor === "string" && valor.trim() !== "";
}

function compilarRaiz(nombre: string, campo: string, esquema: unknown): Validador {
  if (!esObjeto(esquema) || esquema.type !== "object") {
    throw new Error(`${nombre}: ${campo} debe tener type "object"`);
  }
  try {
    return compilarEsquema(esquema);
  } catch (error) {
    throw new Error(`${nombre}: ${campo}: ${(error as Error).message}`);
  }
}

function revisarAnotaciones(nombre: string, anotaciones: AnotacionesHerramienta): void {
  if (anotaciones.readOnlyHint !== true) throw new Error(`${nombre}: debe ser de solo lectura`);
  if (anotaciones.destructiveHint !== undefined && anotaciones.destructiveHint !== false) {
    throw new Error(`${nombre}: destructiveHint debe ser false o no estar`);
  }
  if (anotaciones.idempotentHint !== undefined && typeof anotaciones.idempotentHint !== "boolean") {
    throw new Error(`${nombre}: idempotentHint debe ser booleano`);
  }
  if (typeof anotaciones.openWorldHint !== "boolean") {
    throw new Error(`${nombre}: openWorldHint debe ser booleano`);
  }
}

/**
 * Revisa las definiciones y compila sus esquemas. Lanza un Error al primer problema: son
 * constantes del código, así que un error aquí es un defecto que debe romper el arranque.
 */
export function crearRegistro(
  herramientas: readonly Herramienta[],
): ReadonlyMap<string, HerramientaRegistrada> {
  const registro = new Map<string, HerramientaRegistrada>();
  for (const definicion of herramientas) {
    const { name } = definicion;
    if (typeof name !== "string" || !NOMBRE_VALIDO.test(name)) {
      throw new Error(`nombre de herramienta inválido: ${JSON.stringify(name)}`);
    }
    if (registro.has(name)) throw new Error(`herramienta repetida: ${name}`);
    if (!textoNoVacio(definicion.title)) throw new Error(`${name}: falta title`);
    if (!textoNoVacio(definicion.description)) throw new Error(`${name}: falta description`);
    if (typeof definicion.ejecutar !== "function") throw new Error(`${name}: falta ejecutar`);
    revisarAnotaciones(name, definicion.annotations);
    const validarEntrada = compilarRaiz(name, "inputSchema", definicion.inputSchema);
    // Un argumento de más (mal escrito, por ejemplo) debe dar error, no ignorarse en silencio.
    if (definicion.inputSchema.additionalProperties !== false) {
      throw new Error(`${name}: inputSchema debe tener additionalProperties: false`);
    }
    const validarSalida =
      definicion.outputSchema === undefined
        ? null
        : compilarRaiz(name, "outputSchema", definicion.outputSchema);
    registro.set(name, { definicion, validarEntrada, validarSalida });
  }
  return registro;
}
