/**
 * Validador de un subconjunto de JSON Schema 2020-12, suficiente para los esquemas de las
 * herramientas. Los esquemas son constantes del código: cualquier palabra clave que no esté
 * soportada hace fallar la compilación (al arrancar y en las pruebas), para que nunca se deje
 * de validar algo en silencio.
 *
 * Soportado: type (uno o varios de object, array, string, number, integer, boolean, null),
 * properties, required, additionalProperties (true o false), items, minItems, maxItems, enum y
 * const (valores simples), pattern, minLength, maxLength, minimum, maximum y format (solo `date`
 * y `date-time`, que sí se validan). Las anotaciones (title, description, default, examples,
 * etc.) se aceptan y no se validan. No hay combinadores (oneOf, anyOf, allOf, not) ni $ref:
 * tampoco en la raíz de un inputSchema.
 */

export type EsquemaJson = { readonly [clave: string]: unknown };

/** Devuelve la lista de errores; vacía si el valor cumple el esquema. */
export type Validador = (valor: unknown) => string[];

export class EsquemaNoSoportadoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EsquemaNoSoportadoError";
  }
}

export const DIALECTO = "https://json-schema.org/draft/2020-12/schema";

/** Tope de errores por validación, para que un objeto enorme no produzca un mensaje enorme. */
const MAX_ERRORES = 10;
/** Largo máximo de un nombre de propiedad dentro de un mensaje. */
const MAX_NOMBRE = 64;

const ANOTACIONES = new Set([
  "$schema",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

const TIPOS = {
  object: "un objeto",
  array: "una lista",
  string: "texto",
  number: "un número",
  integer: "un número entero",
  boolean: "true o false",
  null: "null",
} as const;

type Tipo = keyof typeof TIPOS;
type Revision = (valor: unknown, ruta: string, errores: string[]) => void;

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Recorta y entrecomilla un texto que viene de afuera para meterlo en un mensaje. */
export function citar(texto: string): string {
  return JSON.stringify(texto.length > MAX_NOMBRE ? `${texto.slice(0, MAX_NOMBRE)}…` : texto);
}

function etiqueta(ruta: string): string {
  return ruta === "" ? "el valor" : citar(ruta);
}

function rutaPropiedad(ruta: string, clave: string): string {
  const recortada = clave.length > MAX_NOMBRE ? `${clave.slice(0, MAX_NOMBRE)}…` : clave;
  return ruta === "" ? recortada : `${ruta}.${recortada}`;
}

function cumpleTipo(valor: unknown, tipo: Tipo): boolean {
  switch (tipo) {
    case "object":
      return esObjeto(valor);
    case "array":
      return Array.isArray(valor);
    case "string":
      return typeof valor === "string";
    case "number":
      return typeof valor === "number" && Number.isFinite(valor);
    case "integer":
      return Number.isInteger(valor);
    case "boolean":
      return typeof valor === "boolean";
    case "null":
      return valor === null;
  }
}

function esTipo(valor: unknown): valor is Tipo {
  return typeof valor === "string" && Object.hasOwn(TIPOS, valor);
}

function esEnteroNoNegativo(valor: unknown): valor is number {
  return Number.isInteger(valor) && (valor as number) >= 0;
}

/** Los patrones de JSON Schema son expresiones de ECMA-262 sin anclar; se usa el modo Unicode. */
function compilarPatron(patron: string): RegExp | undefined {
  try {
    return new RegExp(patron, "u");
  } catch {
    return undefined;
  }
}

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** `full-date` de RFC 3339: AAAA-MM-DD con dígitos ASCII y una fecha que existe. */
function esFecha(texto: string): boolean {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = partes.slice(1).map(Number) as [number, number, number];
  const dias = [31, esBisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= (dias[mes - 1] as number);
}

const FECHA_HORA =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$/;

/**
 * `date-time` de RFC 3339, con T y zona obligatorias. No acepta el segundo intercalar (60): los
 * datos de este servidor no lo usan y validarlo bien pide saber la hora UTC.
 */
function esFechaHora(texto: string): boolean {
  const partes = FECHA_HORA.exec(texto);
  if (partes === null || !esFecha(partes[1] as string)) return false;
  const [hora, minuto, segundo] = partes.slice(2, 5).map(Number) as [number, number, number];
  if (hora > 23 || minuto > 59 || segundo > 59) return false;
  return partes[5] === undefined || (Number(partes[5]) <= 23 && Number(partes[6]) <= 59);
}

interface Formato {
  revisar: (texto: string) => boolean;
  descripcion: string;
}

const FORMATOS: Readonly<Record<string, Formato>> = {
  date: { revisar: esFecha, descripcion: "una fecha AAAA-MM-DD válida" },
  "date-time": { revisar: esFechaHora, descripcion: "una fecha y hora RFC 3339 válida" },
};

function esValorSimple(valor: unknown): boolean {
  return valor === null || ["string", "number", "boolean"].includes(typeof valor);
}

/** "1 carácter", "2 caracteres". */
const contar = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** Largo en caracteres (puntos de código), como lo cuenta JSON Schema. */
function largo(texto: string): number {
  let n = 0;
  for (const _ of texto) n++;
  return n;
}

function compilarNodo(esquema: unknown, donde: string): Revision {
  if (!esObjeto(esquema)) {
    throw new EsquemaNoSoportadoError(`${donde}: el esquema debe ser un objeto`);
  }
  const revisiones: Revision[] = [];
  const falla = (clave: string, motivo: string): never => {
    throw new EsquemaNoSoportadoError(`${donde}/${clave}: ${motivo}`);
  };
  const propiedades = new Map<string, Revision>();
  for (const clave of Object.keys(esquema)) {
    const valor = esquema[clave];
    switch (clave) {
      case "type": {
        const tipos = typeof valor === "string" ? [valor] : valor;
        if (!Array.isArray(tipos) || tipos.length === 0) {
          falla(clave, "debe ser un tipo o una lista de tipos");
        }
        for (const tipo of tipos as unknown[]) {
          if (!esTipo(tipo)) falla(clave, `tipo desconocido: ${String(tipo)}`);
        }
        const aceptados = tipos as Tipo[];
        const descripcion = aceptados.map((t) => TIPOS[t]).join(" o ");
        revisiones.push((v, ruta, errores) => {
          if (!aceptados.some((t) => cumpleTipo(v, t))) {
            errores.push(`${etiqueta(ruta)} debe ser ${descripcion}`);
          }
        });
        break;
      }
      case "properties": {
        if (!esObjeto(valor)) falla(clave, "debe ser un objeto");
        for (const nombre of Object.keys(valor as object)) {
          propiedades.set(
            nombre,
            compilarNodo(
              (valor as Record<string, unknown>)[nombre],
              `${donde}/properties/${nombre}`,
            ),
          );
        }
        revisiones.push((v, ruta, errores) => {
          if (!esObjeto(v)) return;
          for (const [nombre, revisar] of propiedades) {
            if (Object.hasOwn(v, nombre)) revisar(v[nombre], rutaPropiedad(ruta, nombre), errores);
          }
        });
        break;
      }
      case "required": {
        if (!Array.isArray(valor) || !valor.every((r) => typeof r === "string")) {
          falla(clave, "debe ser una lista de textos");
        }
        const requeridas = valor as string[];
        revisiones.push((v, ruta, errores) => {
          if (!esObjeto(v)) return;
          for (const nombre of requeridas) {
            if (!Object.hasOwn(v, nombre)) {
              errores.push(`falta ${citar(rutaPropiedad(ruta, nombre))}`);
            }
          }
        });
        break;
      }
      case "additionalProperties": {
        if (typeof valor !== "boolean") falla(clave, "solo se admite true o false");
        if (valor === false) {
          revisiones.push((v, ruta, errores) => {
            if (!esObjeto(v)) return;
            const aceptadas =
              propiedades.size === 0
                ? "no se aceptan propiedades"
                : `se aceptan: ${[...propiedades.keys()].map((n) => JSON.stringify(n)).join(", ")}`;
            for (const nombre of Object.keys(v)) {
              if (errores.length >= MAX_ERRORES) return;
              if (!propiedades.has(nombre)) {
                errores.push(
                  `${citar(rutaPropiedad(ruta, nombre))} no está permitido (${aceptadas})`,
                );
              }
            }
          });
        }
        break;
      }
      case "items": {
        const revisar = compilarNodo(valor, `${donde}/items`);
        revisiones.push((v, ruta, errores) => {
          if (!Array.isArray(v)) return;
          for (let i = 0; i < v.length && errores.length < MAX_ERRORES; i++) {
            revisar(v[i], `${ruta}[${i}]`, errores);
          }
        });
        break;
      }
      case "enum": {
        if (!Array.isArray(valor) || valor.length === 0 || !valor.every(esValorSimple)) {
          falla(clave, "debe ser una lista no vacía de textos, números, booleanos o null");
        }
        const opciones = valor as unknown[];
        const lista = opciones.map((o) => JSON.stringify(o)).join(", ");
        revisiones.push((v, ruta, errores) => {
          if (!opciones.includes(v)) errores.push(`${etiqueta(ruta)} debe ser uno de: ${lista}`);
        });
        break;
      }
      case "const": {
        if (!esValorSimple(valor)) falla(clave, "debe ser texto, número, booleano o null");
        revisiones.push((v, ruta, errores) => {
          if (v !== valor) errores.push(`${etiqueta(ruta)} debe ser ${JSON.stringify(valor)}`);
        });
        break;
      }
      case "format": {
        const formato = typeof valor === "string" && Object.hasOwn(FORMATOS, valor) ? valor : null;
        if (formato === null) falla(clave, "solo se admiten date y date-time");
        const { revisar, descripcion } = FORMATOS[formato as string] as Formato;
        revisiones.push((v, ruta, errores) => {
          if (typeof v === "string" && !revisar(v)) {
            errores.push(`${etiqueta(ruta)} debe ser ${descripcion}`);
          }
        });
        break;
      }
      case "minItems":
      case "maxItems": {
        if (!esEnteroNoNegativo(valor)) falla(clave, "debe ser un entero mayor o igual a 0");
        const limite = valor as number;
        const minimo = clave === "minItems";
        const cuantos = contar(limite, "elemento", "elementos");
        revisiones.push((v, ruta, errores) => {
          if (!Array.isArray(v)) return;
          if (minimo && v.length < limite) {
            errores.push(`${etiqueta(ruta)} debe tener al menos ${cuantos}`);
          } else if (!minimo && v.length > limite) {
            errores.push(`${etiqueta(ruta)} debe tener como máximo ${cuantos}`);
          }
        });
        break;
      }
      case "pattern": {
        const regla = typeof valor === "string" ? compilarPatron(valor) : undefined;
        if (regla === undefined) falla(clave, "debe ser una expresión regular válida");
        const expresion = regla as RegExp;
        revisiones.push((v, ruta, errores) => {
          if (typeof v === "string" && !expresion.test(v)) {
            errores.push(`${etiqueta(ruta)} no tiene el formato esperado (${String(valor)})`);
          }
        });
        break;
      }
      case "minLength":
      case "maxLength": {
        if (!esEnteroNoNegativo(valor)) falla(clave, "debe ser un entero mayor o igual a 0");
        const limite = valor as number;
        const minimo = clave === "minLength";
        const cuantos = contar(limite, "carácter", "caracteres");
        revisiones.push((v, ruta, errores) => {
          if (typeof v !== "string") return;
          const n = largo(v);
          if (minimo && n < limite) {
            errores.push(`${etiqueta(ruta)} debe tener al menos ${cuantos}`);
          } else if (!minimo && n > limite) {
            errores.push(`${etiqueta(ruta)} debe tener como máximo ${cuantos}`);
          }
        });
        break;
      }
      case "minimum":
      case "maximum": {
        if (typeof valor !== "number" || !Number.isFinite(valor)) {
          falla(clave, "debe ser un número");
        }
        const limite = valor as number;
        const minimo = clave === "minimum";
        revisiones.push((v, ruta, errores) => {
          if (typeof v !== "number") return;
          if (minimo && v < limite) {
            errores.push(`${etiqueta(ruta)} debe ser mayor o igual a ${limite}`);
          } else if (!minimo && v > limite) {
            errores.push(`${etiqueta(ruta)} debe ser menor o igual a ${limite}`);
          }
        });
        break;
      }
      case "$schema":
        if (valor !== DIALECTO) falla(clave, `solo se admite ${DIALECTO}`);
        break;
      default:
        if (!ANOTACIONES.has(clave)) {
          throw new EsquemaNoSoportadoError(`${donde}: palabra clave no soportada: ${clave}`);
        }
    }
  }
  return (valor, ruta, errores) => {
    for (const revisar of revisiones) {
      if (errores.length >= MAX_ERRORES) return;
      revisar(valor, ruta, errores);
    }
  };
}

/**
 * Compila un esquema a una función de validación. Lanza EsquemaNoSoportadoError si el esquema
 * usa algo fuera del subconjunto soportado o declara un dialecto distinto de 2020-12.
 */
export function compilarEsquema(esquema: unknown): Validador {
  const revisar = compilarNodo(esquema, "#");
  return (valor) => {
    const errores: string[] = [];
    revisar(valor, "", errores);
    return errores.slice(0, MAX_ERRORES);
  };
}
