// Lector de un ZIP de un solo archivo, como el que entrega Correos de México: fin del directorio
// central, una entrada, su encabezado local y deflate con node:zlib. No escribe nada en disco.
import * as zlib from "node:zlib";
import { archivoInvalido, tamanoLegible } from "./error.js";

/** Límites por omisión: el ZIP oficial pesa unos 2 MB y su TXT unos 16 MB. */
export const LIMITE_ZIP = 20 * 1_048_576;
export const LIMITE_TXT = 60 * 1_048_576;

export interface LimitesZip {
  /** Bytes del ZIP. */
  zip?: number;
  /** Bytes del archivo descomprimido. */
  txt?: number;
}

export interface ArchivoZip {
  nombre: string;
  datos: Uint8Array;
}

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;
const LARGO_LOCAL = 30;
const LARGO_CENTRAL = 46;
const LARGO_FIN = 22;

let tabla: Uint32Array | undefined;

/** CRC-32 (el de ZIP) con tabla, para un Node sin `zlib.crc32` (antes de 20.15 y 22.2). */
export function crc32Tabla(datos: Uint8Array): number {
  tabla ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of datos) crc = (tabla[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32: (datos: Uint8Array) => number =
  typeof zlib.crc32 === "function" ? (datos) => zlib.crc32(datos) : crc32Tabla;

/** Si empieza con la firma de un encabezado local de ZIP (`PK\x03\x04`). */
export function esZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

/** Un nombre de archivo sin carpetas, ni unidad, ni caracteres de control, terminado en .txt. */
const NOMBRE_VALIDO = /^[^/\\:\p{Cc}]+\.txt$/iu;

function buscarFin(vista: DataView): number {
  // El fin del directorio central mide 22 bytes más un comentario de hasta 65 535.
  const minimo = Math.max(0, vista.byteLength - LARGO_FIN - 0xffff);
  for (let i = vista.byteLength - LARGO_FIN; i >= minimo; i--) {
    if (
      vista.getUint32(i, true) === FIRMA_FIN &&
      i + LARGO_FIN + vista.getUint16(i + 20, true) === vista.byteLength
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Devuelve el único archivo de un ZIP, descomprimido y con su CRC revisado. Lanza SepomexError
 * (`archivo-invalido`) si el ZIP pasa del límite, trae más de un archivo o uno con un nombre
 * raro, está cifrado, usa ZIP64 u otro método que no sea deflate, o si el archivo descomprimido
 * pasa del límite o no coincide con su tamaño y su CRC.
 */
export function leerZip(bytes: Uint8Array, limites: LimitesZip = {}): ArchivoZip {
  const limiteZip = limites.zip ?? LIMITE_ZIP;
  const limiteTxt = limites.txt ?? LIMITE_TXT;
  if (bytes.length > limiteZip) {
    throw archivoInvalido(
      `El ZIP pesa ${tamanoLegible(bytes.length)} y el límite es ${tamanoLegible(limiteZip)}.`,
    );
  }
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i: number) => vista.getUint16(i, true);
  const u32 = (i: number) => vista.getUint32(i, true);

  const fin = buscarFin(vista);
  if (fin < 0)
    throw archivoInvalido("El archivo no es un ZIP: no tiene el fin del directorio central.");
  const total = u16(fin + 10);
  const tamCentral = u32(fin + 12);
  const inicioCentral = u32(fin + 16);
  if (total === 0xffff || tamCentral === 0xffffffff || inicioCentral === 0xffffffff) {
    throw archivoInvalido("El ZIP usa ZIP64, que no se espera en el catálogo de SEPOMEX.");
  }
  if (u16(fin + 4) !== 0 || u16(fin + 6) !== 0 || u16(fin + 8) !== total) {
    throw archivoInvalido("El ZIP viene en varias partes.");
  }
  if (total !== 1) throw archivoInvalido(`El ZIP trae ${total} archivos y se esperaba uno.`);
  if (inicioCentral + tamCentral > fin) {
    throw archivoInvalido("El directorio central del ZIP queda fuera del archivo.");
  }
  if (tamCentral < LARGO_CENTRAL || u32(inicioCentral) !== FIRMA_CENTRAL) {
    throw archivoInvalido("El directorio central del ZIP está dañado.");
  }
  const c = inicioCentral;
  const flags = u16(c + 8);
  const metodo = u16(c + 10);
  const crc = u32(c + 16);
  const tamComprimido = u32(c + 20);
  const tamano = u32(c + 24);
  const largoNombre = u16(c + 28);
  if (LARGO_CENTRAL + largoNombre + u16(c + 30) + u16(c + 32) !== tamCentral) {
    throw archivoInvalido("El directorio central del ZIP está dañado.");
  }
  const nombreBytes = bytes.subarray(c + LARGO_CENTRAL, c + LARGO_CENTRAL + largoNombre);
  const nombre = new TextDecoder("utf-8").decode(nombreBytes);
  if (!NOMBRE_VALIDO.test(nombre)) {
    throw archivoInvalido(
      `El ZIP trae un archivo con un nombre inesperado: ${JSON.stringify(nombre)}.`,
    );
  }
  if (flags & 1) throw archivoInvalido("El archivo del ZIP está cifrado.");
  if (metodo !== 0 && metodo !== 8) {
    throw archivoInvalido(`El ZIP usa el método de compresión ${metodo}; solo se acepta deflate.`);
  }
  if (tamano > limiteTxt) {
    throw archivoInvalido(
      `El archivo descomprimido pesaría ${tamanoLegible(tamano)} y el límite es ${tamanoLegible(limiteTxt)}.`,
    );
  }

  const local = u32(c + 42);
  if (local + LARGO_LOCAL > inicioCentral || u32(local) !== FIRMA_LOCAL) {
    throw archivoInvalido("El encabezado local del ZIP está dañado.");
  }
  const largoNombreLocal = u16(local + 26);
  const nombreLocal = bytes.subarray(local + LARGO_LOCAL, local + LARGO_LOCAL + largoNombreLocal);
  if (!Buffer.from(nombreLocal).equals(Buffer.from(nombreBytes))) {
    throw archivoInvalido("El encabezado local del ZIP nombra otro archivo.");
  }
  const inicioDatos = local + LARGO_LOCAL + largoNombreLocal + u16(local + 28);
  const finDatos = inicioDatos + tamComprimido;
  if (finDatos > inicioCentral) {
    throw archivoInvalido("Los datos comprimidos quedan fuera del archivo.");
  }
  const comprimidos = bytes.subarray(inicioDatos, finDatos);

  let datos: Uint8Array;
  if (metodo === 0) {
    datos = comprimidos.slice();
  } else {
    try {
      const salida = zlib.inflateRawSync(comprimidos, { maxOutputLength: Math.max(1, limiteTxt) });
      datos = new Uint8Array(salida.buffer, salida.byteOffset, salida.byteLength);
    } catch (error) {
      if (error instanceof RangeError) {
        throw archivoInvalido(
          `El archivo descomprimido pasa del límite de ${tamanoLegible(limiteTxt)}.`,
          error,
        );
      }
      throw archivoInvalido("Los datos deflate del ZIP están dañados.", error);
    }
  }
  if (datos.length !== tamano) {
    throw archivoInvalido(
      `El archivo descomprimido mide ${datos.length} bytes y el ZIP declara un tamaño de ${tamano}.`,
    );
  }
  if (crc32(datos) !== crc) throw archivoInvalido("El CRC del archivo descomprimido no coincide.");
  return { nombre, datos };
}
