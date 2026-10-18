// Pruebas de las entradas de datos que corren igual sobre src (con los módulos que sirve
// pluginDatos) y sobre dist (con los que escribe el build). Todo se compara contra data/.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import type * as Fix from "../../src/datos/fix.js";
import type * as Datos from "../../src/datos/index.js";
import type * as Udis from "../../src/datos/udis.js";
import type { Banco, Estado, FechaISO, Municipio, TipoCambioFix, Udi } from "../../src/index.js";
import type { Modulo } from "../comun.js";

export type ModuloDatos = typeof Datos;
export type ModuloFix = typeof Fix;
export type ModuloUdis = typeof Udis;

export const EXPORTACIONES_DATOS = [
  "banco",
  "bancos",
  "buscarMunicipio",
  "catalogoClabe",
  "estado",
  "estados",
  "meta",
  "municipio",
  "municipios",
] as const;

export const EXPORTACIONES_SERIE = ["cobertura", "meta", "serie", "tramo"] as const;

const DATA = new URL("../../../../data/", import.meta.url);

interface Manifiesto {
  dataset: string;
  as_of: string;
  data_file: string;
  data_sha256: string;
  records: number;
  sources: Record<string, unknown>[];
}

export interface DesdeData<T> {
  manifiesto: Manifiesto;
  /** Del archivo de datos tal como está en data/. */
  sha256: string;
  registros: T[];
}

export const sha256 = (texto: string | Uint8Array): string =>
  createHash("sha256").update(texto).digest("hex");

/** JSON canónico del pipeline: el que da el `data_sha256` del manifest. */
export const canonico = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;

export async function desdeData<T>(directorio: string): Promise<DesdeData<T>> {
  const carpeta = new URL(`${directorio}/`, DATA);
  const manifiesto = JSON.parse(
    await readFile(new URL("manifest.json", carpeta), "utf8"),
  ) as Manifiesto;
  const bytes = await readFile(new URL(manifiesto.data_file, carpeta));
  return {
    manifiesto,
    sha256: sha256(bytes),
    registros: JSON.parse(bytes.toString("utf8")) as T[],
  };
}

/** Lo que se espera en `meta`: el manifest sin lo interno del pipeline. */
export function metaEsperada(m: Manifiesto) {
  return {
    dataset: m.dataset,
    as_of: m.as_of,
    sources: m.sources.map((s) => ({
      name: s.name,
      url: s.url,
      license: s.license,
      license_url: s.license_url,
      citation: s.citation,
    })),
  };
}

/** Los mismos datos que data/: su JSON canónico tiene el sha256 del manifest. */
export function esperarIgualesAData(registros: readonly unknown[], d: DesdeData<unknown>): void {
  expect(registros.length).toBe(d.manifiesto.records);
  expect(d.sha256).toBe(d.manifiesto.data_sha256);
  expect(sha256(canonico(registros))).toBe(d.manifiesto.data_sha256);
}

/** Congelado a fondo: el objeto y todo lo que cuelga de él. */
export function esperarCongelado(valor: unknown, ruta = "valor"): void {
  if (typeof valor !== "object" || valor === null) return;
  expect(Object.isFrozen(valor), ruta).toBe(true);
  for (const [clave, hijo] of Object.entries(valor)) esperarCongelado(hijo, `${ruta}.${clave}`);
}

// Misma regla que buscarMunicipio, escrita aparte para comparar.
const normal = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function nivel(nombre: string, consulta: string): number {
  const n = normal(nombre);
  if (n === consulta) return 0;
  return n.startsWith(consulta) ? 1 : 2;
}

const diaSiguiente = (fecha: FechaISO): FechaISO =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function probarDatos(
  cargar: () => Promise<{ datos: ModuloDatos; mexicoapi: Modulo }>,
): void {
  let m: ModuloDatos;
  let mx: Modulo;
  let estados: DesdeData<Estado>;
  let municipios: DesdeData<Municipio>;
  let bancos: DesdeData<Banco>;

  beforeAll(async () => {
    ({ datos: m, mexicoapi: mx } = await cargar());
    [estados, municipios, bancos] = await Promise.all([
      desdeData<Estado>("inegi-estados"),
      desdeData<Municipio>("inegi-municipios"),
      desdeData<Banco>("bancos"),
    ]);
  });

  it("exporta exactamente su API", () => {
    expect(Object.keys(m).sort()).toEqual([...EXPORTACIONES_DATOS]);
    for (const nombre of EXPORTACIONES_DATOS) {
      if (nombre !== "meta") expect(typeof m[nombre], nombre).toBe("function");
    }
  });

  it("trae los estados, municipios y bancos de data/ tal cual", () => {
    esperarIgualesAData(m.estados(), estados);
    esperarIgualesAData(m.municipios(), municipios);
    esperarIgualesAData(m.bancos(), bancos);
  });

  it("da la meta de cada dataset desde su manifest", () => {
    expect(Object.keys(m.meta)).toEqual(["estados", "municipios", "bancos"]);
    expect(m.meta.estados).toEqual(metaEsperada(estados.manifiesto));
    expect(m.meta.municipios).toEqual(metaEsperada(municipios.manifiesto));
    expect(m.meta.bancos).toEqual(metaEsperada(bancos.manifiesto));
  });

  describe("estados", () => {
    it("encuentra un estado por su clave de 2 dígitos", () => {
      expect(m.estado("25")?.nombre).toBe("Sinaloa");
      expect(m.estado("01")).toEqual(estados.registros[0]);
      for (const e of estados.registros) expect(m.estado(e.cve_ent)).toBe(m.estado(e.cve_ent));
    });

    it("no encuentra claves que no existen ni sin el cero a la izquierda", () => {
      expect(m.estado("99")).toBeUndefined();
      expect(m.estado("1")).toBeUndefined();
      expect(m.estado("")).toBeUndefined();
    });
  });

  describe("municipios", () => {
    it("filtra por estado con tantos municipios como tiene data/", () => {
      const esperados = municipios.registros.filter((x) => x.cve_ent === "25");
      expect(esperados.length).toBeGreaterThan(0);
      expect(m.municipios("25")).toEqual(esperados);
      for (const e of estados.registros) {
        const suyos = municipios.registros.filter((x) => x.cve_ent === e.cve_ent);
        expect(m.municipios(e.cve_ent).length, e.cve_ent).toBe(suyos.length);
      }
    });

    it("da un arreglo vacío para un estado que no existe", () => {
      expect(m.municipios("99")).toEqual([]);
      expect(Object.isFrozen(m.municipios("99"))).toBe(true);
    });

    it("encuentra un municipio por su cvegeo", () => {
      expect(m.municipio("25006")?.nombre).toBe("Culiacán");
      expect(m.municipio("25006")).toEqual(municipios.registros.find((x) => x.cvegeo === "25006"));
      expect(m.municipio("99999")).toBeUndefined();
      expect(m.municipio("25")).toBeUndefined();
    });
  });

  describe("buscarMunicipio", () => {
    it('encuentra Culiacán (25006) primero con "culiacan"', () => {
      expect(m.buscarMunicipio("culiacan")[0]?.cvegeo).toBe("25006");
    });

    it("no distingue acentos, mayúsculas, espacios de más ni la forma Unicode", () => {
      const esperado = m.buscarMunicipio("culiacan");
      for (const texto of ["Culiacán", "CULIACÁN", "  culiacán  ", "Culiacán".normalize("NFD")]) {
        expect(m.buscarMunicipio(texto), texto).toEqual(esperado);
      }
    });

    it("trata la ñ como n y los signos como espacios", () => {
      expect(m.buscarMunicipio("penon blanco")[0]?.nombre).toBe("Peñón Blanco");
      expect(m.buscarMunicipio("PEÑÓN-BLANCO")[0]?.nombre).toBe("Peñón Blanco");
      const madero = m.buscarMunicipio("francisco i madero");
      expect(madero.length).toBeGreaterThanOrEqual(2);
      expect(madero.slice(0, 2).map((x) => x.nombre)).toEqual([
        "Francisco I. Madero",
        "Francisco I. Madero",
      ]);
    });

    it("pone primero los nombres exactos, luego los que empiezan igual y luego los que contienen", () => {
      for (const texto of ["guadalupe", "juarez", "san", "hidalgo"]) {
        const resultado = m.buscarMunicipio(texto);
        const esperados = municipios.registros.filter((x) => normal(x.nombre).includes(texto));
        expect(resultado.length, texto).toBe(esperados.length);
        expect(resultado.length, texto).toBeGreaterThan(0);
        const niveles = resultado.map((x) => nivel(x.nombre, texto));
        expect(niveles, texto).toEqual([...niveles].sort((a, b) => a - b));
        // Dentro de cada nivel, el orden de data/ (por cvegeo).
        const orden = resultado.map((x) => `${nivel(x.nombre, texto)}${x.cvegeo}`);
        expect(orden, texto).toEqual([...orden].sort());
      }
      expect(m.buscarMunicipio("guadalupe")[0]?.nombre).toBe("Guadalupe");
    });

    it("busca solo en un estado con la opción estado", () => {
      const resultado = m.buscarMunicipio("guadalupe", { estado: "32" });
      expect(resultado.map((x) => x.cvegeo)).toEqual(
        municipios.registros
          .filter((x) => x.cve_ent === "32" && normal(x.nombre).includes("guadalupe"))
          .map((x) => x.cvegeo),
      );
      expect(resultado[0]?.nombre).toBe("Guadalupe");
      expect(m.buscarMunicipio("culiacan", { estado: "01" })).toEqual([]);
      expect(m.buscarMunicipio("culiacan", { estado: undefined })[0]?.cvegeo).toBe("25006");
    });

    it("corta en limite", () => {
      const todos = m.buscarMunicipio("san");
      expect(todos.length).toBeGreaterThan(5);
      expect(m.buscarMunicipio("san", { limite: 5 })).toEqual(todos.slice(0, 5));
      expect(m.buscarMunicipio("san", { limite: 0 })).toEqual([]);
      expect(m.buscarMunicipio("san", { limite: todos.length + 10 })).toEqual(todos);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "lanza RangeError con limite %s",
      (limite) => {
        expect(() => m.buscarMunicipio("san", { limite })).toThrow(RangeError);
      },
    );

    it("da un arreglo vacío sin texto que buscar, sin coincidencias o si no es string", () => {
      for (const texto of ["", "   ", "¿...?", "zzzzzz"]) {
        expect(m.buscarMunicipio(texto), texto).toEqual([]);
      }
      expect(m.buscarMunicipio(42 as unknown as string)).toEqual([]);
      expect(m.buscarMunicipio(undefined as unknown as string)).toEqual([]);
    });
  });

  describe("bancos", () => {
    it("filtra los activos y los inactivos", () => {
      const activos = m.bancos({ activos: true });
      const inactivos = m.bancos({ activos: false });
      expect(activos.length).toBe(bancos.registros.filter((b) => b.activo).length);
      expect(inactivos.length).toBe(bancos.registros.filter((b) => !b.activo).length);
      expect(activos.every((b) => b.activo)).toBe(true);
      expect(inactivos.every((b) => !b.activo)).toBe(true);
      expect(activos.length).toBeGreaterThan(0);
      expect(inactivos.length).toBeGreaterThan(0);
      expect(m.bancos({})).toBe(m.bancos());
      expect(m.bancos({ activos: undefined })).toBe(m.bancos());
    });

    it("encuentra un banco por su código de 3 dígitos", () => {
      expect(m.banco("002")).toEqual(bancos.registros.find((b) => b.codigo === "002"));
      expect(m.banco("000")).toBeUndefined();
      expect(m.banco("2")).toBeUndefined();
    });

    it("da un catálogo para validarClabe con todos los bancos, activos o no", () => {
      const catalogo = m.catalogoClabe();
      expect(catalogo.size).toBe(bancos.registros.length);
      for (const b of bancos.registros) {
        expect(catalogo.get(b.codigo)).toEqual({
          codigo: b.codigo,
          nombre_corto: b.nombre_corto,
          activo: b.activo,
        });
      }

      const banamex = mx.validarClabe("002010077777777771", { bancos: catalogo });
      expect(banamex.valido).toBe(true);
      expect(banamex.detalle?.banco?.nombre_corto).toBe(m.banco("002")?.nombre_corto);

      const inactivo = bancos.registros.find((b) => !b.activo) as Banco;
      const primeros = `${inactivo.codigo}01007777777777`;
      const deBaja = mx.validarClabe(`${primeros}${mx.digitoControlClabe(primeros)}`, {
        bancos: catalogo,
      });
      expect(deBaja.valido).toBe(true);
      expect(deBaja.detalle?.banco).toEqual({ ...catalogo.get(inactivo.codigo) });

      const desconocido = `00001007777777777${mx.digitoControlClabe("00001007777777777")}`;
      const r = mx.validarClabe(desconocido, { bancos: catalogo });
      expect(r.valido).toBe(false);
      expect(r.errores).toEqual(["banco"]);
    });
  });

  describe("congelados", () => {
    it("los arreglos, registros y meta que comparte el paquete están congelados", () => {
      esperarCongelado(m.estados(), "estados()");
      esperarCongelado(m.municipios(), "municipios()");
      esperarCongelado(m.municipios("25"), 'municipios("25")');
      esperarCongelado(m.buscarMunicipio("san"), 'buscarMunicipio("san")');
      esperarCongelado(m.bancos(), "bancos()");
      esperarCongelado(m.bancos({ activos: true }), "bancos({ activos: true })");
      esperarCongelado(m.bancos({ activos: false }), "bancos({ activos: false })");
      esperarCongelado(m.meta, "meta");
      expect(() => {
        (m.estados() as Estado[]).push(m.estados()[0] as Estado);
      }).toThrow(TypeError);
      expect(() => {
        (m.estado("25") as Estado).nombre = "Otro";
      }).toThrow(TypeError);
      expect(() => {
        ((m.banco("002") as Banco).historial[0] as { hasta: string | null }).hasta = "2020-01-01";
      }).toThrow(TypeError);
      expect(m.estado("25")?.nombre).toBe("Sinaloa");
    });

    it("cada catálogo de CLABE es una copia: cambiar uno no cambia el siguiente", () => {
      const catalogo = m.catalogoClabe() as Map<string, unknown>;
      expect(catalogo).not.toBe(m.catalogoClabe());
      catalogo.delete("002");
      catalogo.set("000", { codigo: "000", nombre_corto: "FALSO", activo: true });
      expect(m.catalogoClabe().has("002")).toBe(true);
      expect(m.catalogoClabe().has("000")).toBe(false);
      for (const valor of m.catalogoClabe().values()) expect(Object.isFrozen(valor)).toBe(true);
    });
  });
}

function probarSerie<T extends TipoCambioFix | Udi>(
  cargar: () => Promise<{ serie: ModuloFix | ModuloUdis; mexicoapi: Modulo }>,
  directorio: string,
  fechaDe: (registro: T) => FechaISO,
  consultar: (mx: Modulo, s: ModuloFix | ModuloUdis, fecha: FechaISO) => { tipo: string },
): void {
  let s: ModuloFix | ModuloUdis;
  let mx: Modulo;
  let d: DesdeData<T>;

  beforeAll(async () => {
    ({ serie: s, mexicoapi: mx } = await cargar());
    d = await desdeData<T>(directorio);
  });

  it("exporta exactamente su API", () => {
    expect(Object.keys(s).sort()).toEqual([...EXPORTACIONES_SERIE]);
  });

  it("trae la serie de data/ tal cual, con la meta de su manifest", () => {
    esperarIgualesAData(s.serie, d);
    expect(s.meta).toEqual(metaEsperada(d.manifiesto));
  });

  it("da la cobertura del primer al último registro, y el tramo es la serie completa", () => {
    const primero = d.registros[0] as T;
    const ultimo = d.registros.at(-1) as T;
    expect(s.cobertura).toEqual({ desde: fechaDe(primero), hasta: fechaDe(ultimo) });
    expect(s.tramo).toEqual(s.cobertura);
  });

  it("está congelada", () => {
    esperarCongelado(s.serie, "serie");
    esperarCongelado(s.cobertura, "cobertura");
    esperarCongelado(s.tramo, "tramo");
    esperarCongelado(s.meta, "meta");
  });

  it("sirve para las consultas del núcleo", () => {
    expect(consultar(mx, s, s.cobertura.desde)).toEqual({
      tipo: "encontrado",
      registro: d.registros[0],
    });
    expect(consultar(mx, s, s.cobertura.hasta)).toEqual({
      tipo: "encontrado",
      registro: d.registros.at(-1),
    });
    expect(consultar(mx, s, "2100-01-05").tipo).toBe("no_disponible");
  });
}

export function probarFix(cargar: () => Promise<{ fix: ModuloFix; mexicoapi: Modulo }>): void {
  probarSerie<TipoCambioFix>(
    async () => {
      const { fix, mexicoapi } = await cargar();
      return { serie: fix, mexicoapi };
    },
    "tipo-cambio-fix",
    (r) => r.fecha_publicacion,
    (mx, s, fecha) =>
      mx.fixPublicado(s.serie as readonly TipoCambioFix[], s.tramo, s.cobertura, fecha),
  );

  it("da el FIX para una operación del día siguiente al último publicado", async () => {
    const { fix, mexicoapi } = await cargar();
    const ultimo = fix.serie.at(-1) as TipoCambioFix;
    const r = mexicoapi.fixParaOperacion(
      fix.serie,
      fix.tramo,
      fix.cobertura,
      diaSiguiente(ultimo.fecha_publicacion),
    );
    expect(r).toEqual({ tipo: "encontrado", registro: ultimo });
    expect(mexicoapi.fixPublicado(fix.serie, fix.tramo, fix.cobertura, "2019-12-31").tipo).toBe(
      "sin_dato",
    );
  });
}

export function probarUdis(cargar: () => Promise<{ udis: ModuloUdis; mexicoapi: Modulo }>): void {
  probarSerie<Udi>(
    async () => {
      const { udis, mexicoapi } = await cargar();
      return { serie: udis, mexicoapi };
    },
    "udis",
    (r) => r.fecha,
    (mx, s, fecha) => mx.udiDeFecha(s.serie as readonly Udi[], s.tramo, s.cobertura, fecha),
  );
}
