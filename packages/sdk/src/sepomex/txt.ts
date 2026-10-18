// Lector del TXT oficial de SEPOMEX: la primera línea es el aviso de uso de Correos de México, la
// segunda los nombres de las columnas y después una fila por asentamiento, separadas con `|`.
import { archivoInvalido } from "./error.js";

/** Columnas del TXT oficial (CPdescarga.txt). Se leen por nombre: el orden puede cambiar. */
export const COLUMNAS = [
  "d_codigo",
  "d_asenta",
  "d_tipo_asenta",
  "D_mnpio",
  "d_estado",
  "d_ciudad",
  "d_CP",
  "c_estado",
  "c_oficina",
  "c_CP",
  "c_tipo_asenta",
  "c_mnpio",
  "id_asenta_cpcons",
  "d_zona",
  "c_cve_ciudad",
] as const;

export type Columna = (typeof COLUMNAS)[number];

/** Una fila del TXT con sus valores sin espacios alrededor y su número de línea en el archivo. */
export type FilaSepomex = { readonly linea: number } & { readonly [C in Columna]: string };

export interface TxtSepomex {
  /** Primera línea del archivo: el aviso de uso de Correos de México. */
  aviso: string;
  filas: FilaSepomex[];
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Texto del archivo. El oficial viene en ISO-8859-1; si los bytes son UTF-8 válido (un archivo
 * convertido a mano), se leen como UTF-8: un texto en ISO-8859-1 con acentos casi nunca lo es.
 */
export function decodificar(bytes: Uint8Array): string {
  let texto: string;
  try {
    texto = UTF8.decode(bytes);
  } catch {
    texto = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  }
  return texto.startsWith("\uFEFF") ? texto.slice(1) : texto;
}

const mostrar = (nombres: readonly string[]) =>
  nombres.map((n) => (n === "" ? '""' : n)).join(", ");

function indicesDeColumnas(cabecera: readonly string[]): number[] {
  const repetida = cabecera.find((c, i) => cabecera.indexOf(c) !== i);
  if (repetida !== undefined) {
    throw archivoInvalido(`La cabecera del TXT trae una columna repetida: ${repetida}.`);
  }
  const faltan = COLUMNAS.filter((c) => !cabecera.includes(c));
  const sobran = cabecera.filter((c) => !(COLUMNAS as readonly string[]).includes(c));
  if (faltan.length > 0 || sobran.length > 0) {
    const partes = [
      faltan.length > 0 ? `faltan: ${mostrar(faltan)}` : "",
      sobran.length > 0 ? `sobran: ${mostrar(sobran)}` : "",
    ].filter((p) => p !== "");
    throw archivoInvalido(
      `Las columnas del TXT de SEPOMEX cambiaron (${partes.join("; ")}). Actualiza mexicoapi o avisa en https://github.com/Dagel4k/mexicoapi/issues.`,
    );
  }
  return COLUMNAS.map((c) => cabecera.indexOf(c));
}

const REGLAS: readonly [Columna, RegExp, string][] = [
  ["d_codigo", /^\d{5}$/, "no es un código postal de 5 dígitos"],
  ["c_estado", /^\d{2}$/, "no es una clave de 2 dígitos"],
  ["c_mnpio", /^\d{3}$/, "no es una clave de 3 dígitos"],
];

const OBLIGATORIAS: readonly Columna[] = ["d_asenta", "d_tipo_asenta", "D_mnpio", "d_estado"];

function revisarFila(fila: FilaSepomex): void {
  for (const [columna, regla, problema] of REGLAS) {
    if (!regla.test(fila[columna])) {
      throw archivoInvalido(`Línea ${fila.linea}: ${columna} "${fila[columna]}" ${problema}.`);
    }
  }
  for (const columna of OBLIGATORIAS) {
    if (fila[columna] === "") throw archivoInvalido(`Línea ${fila.linea}: falta ${columna}.`);
  }
}

/**
 * Lee y revisa el TXT: el aviso en la primera línea, las 15 columnas oficiales en la segunda (por
 * nombre, sin faltantes ni sobrantes) y en cada fila el mismo número de campos, un código postal
 * de 5 dígitos, claves de entidad y municipio de 2 y 3 dígitos y los nombres que no pueden faltar.
 * Lanza SepomexError (`archivo-invalido`) con la línea del problema.
 */
export function leerTxt(bytes: Uint8Array): TxtSepomex {
  const lineas = decodificar(bytes).split(/\r\n|\n|\r/);
  const aviso = (lineas[0] as string).trim();
  if (aviso === "" || aviso.includes("|")) {
    throw archivoInvalido(
      "La primera línea del TXT debería ser el aviso de uso de Correos de México.",
    );
  }
  const cabecera = (lineas[1] ?? "").split("|").map((c) => c.trim());
  const indices = indicesDeColumnas(cabecera);
  const filas: FilaSepomex[] = [];
  for (let i = 2; i < lineas.length; i++) {
    const linea = lineas[i] as string;
    if (linea.trim() === "") continue;
    const campos = linea.split("|");
    if (campos.length !== cabecera.length) {
      throw archivoInvalido(
        `Línea ${i + 1}: trae ${campos.length} campos y la cabecera ${cabecera.length}.`,
      );
    }
    const fila: Record<string, string | number> = { linea: i + 1 };
    COLUMNAS.forEach((columna, j) => {
      fila[columna] = (campos[indices[j] as number] as string).trim();
    });
    revisarFila(fila as FilaSepomex);
    filas.push(fila as FilaSepomex);
  }
  if (filas.length === 0) throw archivoInvalido("El TXT no trae filas.");
  return { aviso, filas };
}
