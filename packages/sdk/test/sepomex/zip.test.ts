import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SepomexError } from "../../src/sepomex/error.js";
import { crc32Tabla, esZip, leerZip } from "../../src/sepomex/zip.js";
import { crearZip, txt } from "./ayudas.js";

const TEXTO = new Uint8Array(
  Buffer.from("aviso\r\nd_codigo|d_asenta\r\n80000|Culiacán\r\n", "latin1"),
);

function falla(accion: () => unknown, mensaje: RegExp): void {
  let error: unknown;
  try {
    accion();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SepomexError);
  expect((error as SepomexError).tipo).toBe("archivo-invalido");
  expect((error as SepomexError).message).toMatch(mensaje);
}

describe("leerZip", () => {
  it("lee el único archivo de un ZIP con deflate", () => {
    const zip = crearZip([{ nombre: "CPdescarga.txt", datos: TEXTO }]);
    const archivo = leerZip(zip);
    expect(archivo.nombre).toBe("CPdescarga.txt");
    expect(Buffer.from(archivo.datos).equals(Buffer.from(TEXTO))).toBe(true);
  });

  it("lee un archivo sin comprimir y uno con el TXT completo", () => {
    expect(leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, metodo: 0 }])).datos).toEqual(TEXTO);
    const grande = txt();
    expect(leerZip(crearZip([{ nombre: "CPdescarga.txt", datos: grande }])).datos).toEqual(grande);
  });

  it("acepta el descriptor de datos (bit 3) y un comentario al final", () => {
    const zip = crearZip([{ nombre: "CPdescarga.TXT", datos: TEXTO, flags: 0b1000 }], {
      comentario: "PK\u0005\u0006 de mentira dentro del comentario",
    });
    expect(leerZip(zip).datos).toEqual(TEXTO);
  });

  it("acepta un ZIP que viene dentro de un buffer más grande", () => {
    const zip = crearZip([{ nombre: "a.txt", datos: TEXTO }]);
    const contenedor = new Uint8Array(zip.length + 10);
    contenedor.set(zip, 5);
    expect(leerZip(contenedor.subarray(5, 5 + zip.length)).datos).toEqual(TEXTO);
  });

  it("falla si no es un ZIP", () => {
    falla(() => leerZip(TEXTO), /no es un ZIP/);
    falla(() => leerZip(new Uint8Array(0)), /no es un ZIP/);
  });

  it("falla con más de un archivo o sin ninguno", () => {
    const dos = crearZip([
      { nombre: "a.txt", datos: TEXTO },
      { nombre: "b.txt", datos: TEXTO },
    ]);
    falla(() => leerZip(dos), /trae 2 archivos y se esperaba uno/);
    falla(() => leerZip(crearZip([])), /trae 0 archivos/);
  });

  it.each([
    "../CPdescarga.txt",
    "datos/../../CPdescarga.txt",
    "/etc/CPdescarga.txt",
    "\\CPdescarga.txt",
    "C:CPdescarga.txt",
    "datos\\CPdescarga.txt",
    "datos/",
    "CPdescarga.xls",
    "CP\u0000descarga.txt",
    "",
  ])("falla con un nombre raro: %j", (nombre) => {
    falla(() => leerZip(crearZip([{ nombre, datos: TEXTO }])), /nombre/);
  });

  it("falla si las longitudes del directorio central no cuadran", () => {
    const zip = crearZip([{ nombre: "a.txt", datos: TEXTO }]);
    const central = zip.length - 22 - (46 + "a.txt".length);
    // Comentario de 3 bytes que no existen dentro del directorio central.
    new DataView(zip.buffer).setUint16(central + 32, 3, true);
    falla(() => leerZip(zip), /directorio central del ZIP está dañado/);
  });

  it("falla si el encabezado local nombra otro archivo", () => {
    const zip = crearZip([{ nombre: "a.txt", nombreLocal: "../a.txt", datos: TEXTO }]);
    falla(() => leerZip(zip), /encabezado local/);
  });

  it("falla con un archivo cifrado o un método que no es deflate", () => {
    falla(() => leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, flags: 1 }])), /cifrado/);
    falla(
      () => leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, metodo: 12 }])),
      /método de compresión 12/,
    );
  });

  it("falla si el CRC o el tamaño no coinciden", () => {
    falla(() => leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, crc: 1234 }])), /CRC/);
    falla(
      () => leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, tamano: TEXTO.length + 1 }])),
      /tamaño/,
    );
    falla(
      () => leerZip(crearZip([{ nombre: "a.txt", datos: TEXTO, metodo: 0, tamano: 3 }])),
      /tamaño/,
    );
  });

  it("falla con datos deflate dañados", () => {
    const zip = crearZip([{ nombre: "a.txt", datos: TEXTO }]);
    // Bloque deflate con tipo 3 (reservado) al inicio de los datos.
    const inicio = 30 + "a.txt".length;
    zip[inicio] = 0xff;
    falla(() => leerZip(zip), /deflate/);
  });

  it("falla con ZIP64, en varias partes o con el directorio central fuera del archivo", () => {
    const base = [{ nombre: "a.txt", datos: TEXTO }];
    falla(() => leerZip(crearZip(base, { fin: { total: 0xffff } })), /ZIP64/);
    falla(() => leerZip(crearZip(base, { fin: { inicioCentral: 0xffffffff } })), /ZIP64/);
    falla(() => leerZip(crearZip(base, { fin: { disco: 1 } })), /varias partes/);
    falla(() => leerZip(crearZip(base, { fin: { enDisco: 0 } })), /varias partes/);
    falla(() => leerZip(crearZip(base, { fin: { inicioCentral: 4000 } })), /directorio central/);
    falla(() => leerZip(crearZip(base, { fin: { inicioCentral: 2 } })), /directorio central/);
    falla(() => leerZip(crearZip(base, { fin: { tamCentral: 10 } })), /directorio central/);
  });

  it("falla si el encabezado local o los datos se salen del archivo", () => {
    const zip = crearZip([{ nombre: "a.txt", datos: TEXTO }]);
    const roto = new Uint8Array(zip);
    roto[0] = 0;
    falla(() => leerZip(roto), /encabezado local/);
    // Tamaño comprimido enorme en el directorio central: los datos pasarían del archivo.
    const largo = new Uint8Array(zip);
    const central = zip.length - 22 - (46 + "a.txt".length);
    new DataView(largo.buffer).setUint32(central + 20, 0x7fffffff, true);
    falla(() => leerZip(largo), /fuera del archivo/);
  });

  it("respeta los límites del ZIP y del archivo descomprimido", () => {
    const zip = crearZip([{ nombre: "a.txt", datos: TEXTO }]);
    falla(() => leerZip(zip, { zip: zip.length - 1 }), /El ZIP pesa .* y el límite es/);
    falla(() => leerZip(zip, { txt: TEXTO.length - 1 }), /descomprimido pesaría .* y el límite es/);
  });

  it("corta un archivo que se descomprime más de lo que declara (bomba)", () => {
    const ceros = new Uint8Array(1_000_000);
    const zip = crearZip([{ nombre: "a.txt", datos: ceros, tamano: 100 }]);
    expect(zip.length).toBeLessThan(5_000);
    falla(() => leerZip(zip, { txt: 10_000 }), /pasa del límite/);
  });
});

describe("esZip", () => {
  it("reconoce la firma de un encabezado local", () => {
    expect(esZip(crearZip([{ nombre: "a.txt", datos: TEXTO }]))).toBe(true);
    expect(esZip(TEXTO)).toBe(false);
    expect(esZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe("crc32Tabla", () => {
  it("da lo mismo que zlib", () => {
    expect(crc32Tabla(new Uint8Array(0))).toBe(0);
    expect(crc32Tabla(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    for (const largo of [1, 7, 1000, 65_537]) {
      const datos = new Uint8Array(randomBytes(largo));
      expect(crc32Tabla(datos)).toBe(crc32(datos));
    }
    expect(crc32Tabla(deflateRawSync(TEXTO))).toBe(crc32(deflateRawSync(TEXTO)));
  });
});
