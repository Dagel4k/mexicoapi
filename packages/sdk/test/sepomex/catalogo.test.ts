import { describe, expect, it } from "vitest";
import { municipios } from "../../src/datos/index.js";
import { armarCatalogo } from "../../src/sepomex/catalogo.js";
import { SepomexError } from "../../src/sepomex/error.js";
import { leerTxt } from "../../src/sepomex/txt.js";
import { AVISO, CABECERA, FILAS_A_MANO, filasDeRelleno, lineasTxt, txt } from "./ayudas.js";

const catalogo = (extra: readonly string[] = []) =>
  armarCatalogo(leerTxt(txt(lineasTxt(extra))).filas);
const codigo = (c: ReturnType<typeof armarCatalogo>, cp: string) =>
  c.codigos.find((x) => x.cp === cp);

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

describe("armarCatalogo", () => {
  it("une cada código postal con su entidad y su municipio de INEGI", () => {
    const c = catalogo();
    expect(codigo(c, "80000")).toEqual({
      cp: "80000",
      estado: { cve_ent: "25", nombre: "Sinaloa" },
      municipio: { cvegeo: "25006", nombre: "Culiacán" },
      asentamientos: [
        { nombre: "Culiacán Centro", tipo: "Colonia", zona: "Urbano", ciudad: "Culiacán Rosales" },
      ],
    });
    expect(codigo(c, "15520")).toMatchObject({
      estado: { cve_ent: "09", nombre: "Ciudad de México" },
      municipio: { cvegeo: "09017", nombre: "Venustiano Carranza" },
      asentamientos: [{ nombre: "Peñón de los Baños" }],
    });
    expect(codigo(c, "76240")?.asentamientos).toEqual([
      { nombre: "La Cañada", tipo: "Pueblo", zona: "Rural", ciudad: "" },
    ]);
  });

  it("junta los asentamientos de un código postal en el orden del archivo", () => {
    expect(codigo(catalogo(), "80010")?.asentamientos.map((a) => a.nombre)).toEqual([
      "Jorge Almada",
      "Ciudad Universitaria",
    ]);
  });

  it("ordena los códigos postales y cuenta filas, códigos y municipios", () => {
    const c = catalogo();
    const cps = c.codigos.map((x) => x.cp);
    expect(cps).toEqual([...cps].sort());
    expect(c.resumen).toEqual({
      filas: FILAS_A_MANO.length + filasDeRelleno().length,
      codigos_postales: FILAS_A_MANO.length - 1 + filasDeRelleno().length,
      // Culiacán (3 filas, 3 códigos), Venustiano Carranza, El Marqués y uno por cada relleno.
      municipios: 3 + filasDeRelleno().length,
      sin_municipio_inegi: 0,
      advertencias: [],
    });
  });

  it("usa el nombre de INEGI aunque SEPOMEX lo escriba distinto", () => {
    const fila = FILAS_A_MANO[0].replace(
      "80000|Culiacán Centro|Colonia|Culiacán|",
      "80001|Otra|Colonia|CULIACAN|",
    );
    expect(codigo(catalogo([fila]), "80001")?.municipio).toEqual({
      cvegeo: "25006",
      nombre: "Culiacán",
    });
  });

  it("cuenta como advertencia un municipio que no está en INEGI, sin fallar", () => {
    expect(municipios().some((m) => m.cvegeo === "25099")).toBe(false);
    const nuevo = (cp: string) =>
      `${cp}|Prueba|Colonia|Municipio Nuevo|Sinaloa||${cp}|25|${cp}||09|099|0001|Urbano|`;
    const c = catalogo([nuevo("80999"), nuevo("80998"), nuevo("80999")]);
    expect(codigo(c, "80999")?.municipio).toEqual({ cvegeo: null, nombre: "Municipio Nuevo" });
    expect(codigo(c, "80999")?.asentamientos).toHaveLength(2);
    expect(c.resumen.sin_municipio_inegi).toBe(2);
    expect(c.resumen.advertencias).toEqual([
      "2 códigos postales tienen un municipio que no está en el catálogo de INEGI del paquete (van con cvegeo null y el nombre de SEPOMEX): 80998 (25099), 80999 (25099).",
    ]);
    expect(
      armarCatalogo(leerTxt(txt(lineasTxt([nuevo("80999")]))).filas).resumen.advertencias[0],
    ).toMatch(/^1 código postal tiene un municipio que no está/);
  });

  it("lista solo los primeros 10 que no cruzan con INEGI", () => {
    const filas = Array.from({ length: 12 }, (_, i) => {
      const cp = `809${String(i).padStart(2, "0")}`;
      return `${cp}|Prueba|Colonia|Nuevo|Sinaloa||${cp}|25|${cp}||09|099|0001|Urbano|`;
    });
    const [aviso] = catalogo(filas).resumen.advertencias;
    expect(aviso).toMatch(/: 80900 \(25099\), .*80909 \(25099\) y 2 más\.$/);
  });

  it("avisa si un código postal aparece en más de un municipio y usa el de su primera fila", () => {
    const otro = FILAS_A_MANO[1].replace("|006|0002|", "|007|0099|");
    const c = catalogo([otro]);
    expect(codigo(c, "80010")?.municipio.cvegeo).toBe("25006");
    expect(codigo(c, "80010")?.asentamientos).toHaveLength(3);
    expect(c.resumen.advertencias).toEqual([
      "1 código postal aparece en más de un municipio (se usa el de su primera fila): 80010 (25006, 25007).",
    ]);
  });

  it("falla con una entidad que no existe", () => {
    const fila = FILAS_A_MANO[0].replace("|25|80001||09|006|", "|33|80001||09|006|");
    falla(() => catalogo([fila]), /Línea \d+: c_estado "33" no es una entidad de INEGI/);
  });

  it("falla si no vienen las 32 entidades", () => {
    const sinSinaloa = [AVISO, CABECERA, ...filasDeRelleno(), FILAS_A_MANO[4], FILAS_A_MANO[5]];
    falla(
      () => armarCatalogo(leerTxt(txt(sinSinaloa)).filas),
      /trae 31 de las 32 entidades \(falta 25\)/,
    );
    falla(
      () => armarCatalogo(leerTxt(txt([AVISO, CABECERA, ...FILAS_A_MANO])).filas),
      /trae 3 de las 32 entidades \(faltan 01, 02, .*, 08, 10, 11 y 19 más\)/,
    );
  });
});
