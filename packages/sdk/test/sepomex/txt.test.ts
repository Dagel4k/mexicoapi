import { describe, expect, it } from "vitest";
import { SepomexError } from "../../src/sepomex/error.js";
import { COLUMNAS, decodificar, leerTxt } from "../../src/sepomex/txt.js";
import { AVISO, CABECERA, FILAS_A_MANO, lineasTxt, txt } from "./ayudas.js";

const bytes = (texto: string, codificacion: BufferEncoding = "latin1") =>
  new Uint8Array(Buffer.from(texto, codificacion));

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

describe("decodificar", () => {
  it("lee ISO-8859-1: acentos y ñ de un solo byte", () => {
    const texto = "Peñón de los Baños|Culiacán|Querétaro|ÁÉÍÓÚÜ";
    expect(Buffer.from(texto, "latin1").length).toBe(texto.length);
    expect(decodificar(bytes(texto))).toBe(texto);
  });

  it("lee UTF-8 si el archivo es UTF-8 válido", () => {
    expect(decodificar(bytes("Peñón|Culiacán", "utf8"))).toBe("Peñón|Culiacán");
  });

  it("quita la marca de orden de bytes", () => {
    expect(decodificar(bytes("\uFEFFaviso", "utf8"))).toBe("aviso");
    expect(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
  });
});

describe("leerTxt", () => {
  it("lee el aviso y las filas por nombre de columna", () => {
    const { aviso, filas } = leerTxt(txt());
    expect(aviso).toBe(AVISO);
    expect(filas).toHaveLength(lineasTxt().length - 2);
    expect(filas[0]).toEqual({
      linea: 3,
      d_codigo: "80000",
      d_asenta: "Culiacán Centro",
      d_tipo_asenta: "Colonia",
      D_mnpio: "Culiacán",
      d_estado: "Sinaloa",
      d_ciudad: "Culiacán Rosales",
      d_CP: "80001",
      c_estado: "25",
      c_oficina: "80001",
      c_CP: "",
      c_tipo_asenta: "09",
      c_mnpio: "006",
      id_asenta_cpcons: "0001",
      d_zona: "Urbano",
      c_cve_ciudad: "01",
    });
    expect(filas[4]?.d_asenta).toBe("Peñón de los Baños");
    expect(filas[5]).toMatchObject({
      linea: 8,
      d_asenta: "La Cañada",
      d_ciudad: "",
      d_zona: "Rural",
    });
  });

  it("acepta las columnas en otro orden", () => {
    const orden = [...COLUMNAS].reverse();
    const reordenar = (linea: string) => {
      const campos = linea.split("|");
      return orden.map((c) => campos[COLUMNAS.indexOf(c)]).join("|");
    };
    const original = leerTxt(txt()).filas;
    const otra = leerTxt(txt([AVISO, orden.join("|"), ...lineasTxt().slice(2).map(reordenar)]));
    expect(otra.filas).toEqual(original);
  });

  it("acepta LF, líneas vacías y espacios alrededor de los campos", () => {
    const fila = FILAS_A_MANO[0].replace("|Culiacán Centro|", "| Culiacán Centro  |");
    const texto = [AVISO, CABECERA, "", fila, "   ", FILAS_A_MANO[1], ""].join("\n");
    const { filas } = leerTxt(bytes(texto));
    expect(filas.map((f) => [f.linea, f.d_asenta])).toEqual([
      [4, "Culiacán Centro"],
      [6, "Jorge Almada"],
    ]);
  });

  it("falla si la primera línea no es el aviso", () => {
    falla(() => leerTxt(bytes("")), /primera línea/);
    falla(() => leerTxt(txt([CABECERA, ...FILAS_A_MANO])), /primera línea/);
  });

  it("falla si cambian las columnas, con las que faltan y las que sobran", () => {
    const sinZona = CABECERA.replace("|d_zona", "");
    falla(() => leerTxt(txt([AVISO, sinZona, ...FILAS_A_MANO])), /faltan: d_zona/);
    falla(
      () => leerTxt(txt([AVISO, CABECERA.replace("d_zona", "zona"), ...FILAS_A_MANO])),
      /faltan: d_zona; sobran: zona/,
    );
    falla(
      () => leerTxt(txt([AVISO, `${CABECERA}|d_codigo`, ...FILAS_A_MANO])),
      /repetida: d_codigo/,
    );
    falla(() => leerTxt(txt([AVISO, CABECERA.toUpperCase(), ...FILAS_A_MANO])), /faltan/);
    falla(() => leerTxt(txt([AVISO])), /faltan/);
  });

  it("falla con una fila de otro número de campos", () => {
    falla(
      () => leerTxt(txt([AVISO, CABECERA, FILAS_A_MANO[0], `${FILAS_A_MANO[1]}|extra`])),
      /Línea 4: trae 16 campos y la cabecera 15/,
    );
    falla(() => leerTxt(txt([AVISO, CABECERA, "80000|Centro"])), /Línea 3: trae 2 campos/);
  });

  it.each([
    ["8000", "d_codigo", /Línea 3: d_codigo "8000" no es un código postal de 5 dígitos/],
    ["8000a", "d_codigo", /d_codigo "8000a"/],
    ["", "d_asenta", /Línea 3: falta d_asenta/],
    ["", "d_tipo_asenta", /falta d_tipo_asenta/],
    ["", "D_mnpio", /falta D_mnpio/],
    ["", "d_estado", /falta d_estado/],
    ["5", "c_estado", /c_estado "5" no es una clave de 2 dígitos/],
    ["6", "c_mnpio", /c_mnpio "6" no es una clave de 3 dígitos/],
  ])("falla con %j en %s", (valor, columna, mensaje) => {
    const campos = FILAS_A_MANO[0].split("|");
    campos[COLUMNAS.indexOf(columna as (typeof COLUMNAS)[number])] = valor;
    falla(() => leerTxt(txt([AVISO, CABECERA, campos.join("|")])), mensaje);
  });

  it("falla sin filas", () => {
    falla(() => leerTxt(txt([AVISO, CABECERA])), /no trae filas/);
  });

  it("falla con una columna nueva aunque no falte ninguna", () => {
    falla(
      () => leerTxt(txt([AVISO, `${CABECERA}|d_nueva`, `${FILAS_A_MANO[0]}|x`])),
      /cambiaron \(sobran: d_nueva\)/,
    );
  });

  it("falla con un archivo de una sola línea", () => {
    falla(() => leerTxt(bytes(AVISO)), /cambiaron \(faltan: d_codigo, .*; sobran: ""\)/);
  });
});
