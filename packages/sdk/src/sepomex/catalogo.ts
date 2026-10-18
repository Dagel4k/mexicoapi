// Une las filas del TXT de SEPOMEX con las entidades y los municipios de INEGI del paquete:
// el CVEGEO de un municipio es `c_estado` + `c_mnpio`.
import { estado as estadoInegi, estados as estadosInegi } from "../datos/estados.js";
import { municipio as municipioInegi } from "../datos/municipios.js";
import { archivoInvalido } from "./error.js";
import type { FilaSepomex } from "./txt.js";

/** Colonia, fraccionamiento, pueblo, ranchería... con los nombres del catálogo de SEPOMEX. */
export interface Asentamiento {
  readonly nombre: string;
  /** Tipo de asentamiento: Colonia, Fraccionamiento, Pueblo, Ranchería... */
  readonly tipo: string;
  /** Urbano, Rural o Semiurbano. */
  readonly zona: string;
  /** Ciudad a la que pertenece; vacío si no está en una. */
  readonly ciudad: string;
}

export interface CodigoPostal {
  readonly cp: string;
  /** Entidad federativa con su clave y su nombre de INEGI. */
  readonly estado: { readonly cve_ent: string; readonly nombre: string };
  /**
   * Municipio con el CVEGEO y el nombre de INEGI. Si su clave no está en el catálogo de INEGI del
   * paquete, `cvegeo` es null y el nombre es el de SEPOMEX.
   */
  readonly municipio: { readonly cvegeo: string | null; readonly nombre: string };
  /** En el orden del archivo de SEPOMEX. */
  readonly asentamientos: readonly Asentamiento[];
}

export interface ResumenCatalogo {
  /** Filas del TXT (asentamientos). */
  filas: number;
  codigos_postales: number;
  /** Municipios distintos (`c_estado` + `c_mnpio`). */
  municipios: number;
  /** Códigos postales cuyo municipio no está en el catálogo de INEGI del paquete. */
  sin_municipio_inegi: number;
  advertencias: string[];
}

export interface Catalogo {
  /** Ordenados por código postal. */
  codigos: CodigoPostal[];
  resumen: ResumenCatalogo;
}

const LISTADOS = 10;

function lista(elementos: readonly string[]): string {
  const vistos = elementos.slice(0, LISTADOS).join(", ");
  return elementos.length > LISTADOS ? `${vistos} y ${elementos.length - LISTADOS} más` : vistos;
}

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

interface Armado {
  cp: string;
  estado: { cve_ent: string; nombre: string };
  municipio: { cvegeo: string | null; nombre: string };
  asentamientos: Asentamiento[];
  claves: Set<string>;
}

/**
 * Agrupa las filas por código postal y las une con INEGI. Un municipio que no está en INEGI es
 * una advertencia contada; una entidad que no existe o un archivo sin las 32 entidades es error
 * (SepomexError `archivo-invalido`): el catálogo se guarda completo o no se guarda.
 */
export function armarCatalogo(filas: readonly FilaSepomex[]): Catalogo {
  const porCp = new Map<string, Armado>();
  const municipios = new Set<string>();
  const entidades = new Set<string>();
  for (const fila of filas) {
    const entidad = estadoInegi(fila.c_estado);
    if (entidad === undefined) {
      throw archivoInvalido(
        `Línea ${fila.linea}: c_estado "${fila.c_estado}" no es una entidad de INEGI.`,
      );
    }
    entidades.add(entidad.cve_ent);
    const clave = fila.c_estado + fila.c_mnpio;
    municipios.add(clave);
    const asentamiento: Asentamiento = {
      nombre: fila.d_asenta,
      tipo: fila.d_tipo_asenta,
      zona: fila.d_zona,
      ciudad: fila.d_ciudad,
    };
    const armado = porCp.get(fila.d_codigo);
    if (armado !== undefined) {
      armado.asentamientos.push(asentamiento);
      armado.claves.add(clave);
      continue;
    }
    const inegi = municipioInegi(clave);
    porCp.set(fila.d_codigo, {
      cp: fila.d_codigo,
      estado: { cve_ent: entidad.cve_ent, nombre: entidad.nombre },
      municipio: inegi
        ? { cvegeo: inegi.cvegeo, nombre: inegi.nombre }
        : { cvegeo: null, nombre: fila.D_mnpio },
      asentamientos: [asentamiento],
      claves: new Set([clave]),
    });
  }

  const todas = estadosInegi();
  if (entidades.size < todas.length) {
    const faltan = todas.filter((e) => !entidades.has(e.cve_ent)).map((e) => e.cve_ent);
    throw archivoInvalido(
      `El archivo trae ${entidades.size} de las ${todas.length} entidades (${faltan.length === 1 ? "falta" : "faltan"} ${lista(faltan)}); descarga el de todo el país (estado "Todos", formato TXT).`,
    );
  }

  const armados = [...porCp.values()].sort((a, b) => (a.cp < b.cp ? -1 : 1));
  const sinInegi = armados.filter((a) => a.municipio.cvegeo === null);
  const variosMunicipios = armados.filter((a) => a.claves.size > 1);
  const advertencias: string[] = [];
  if (sinInegi.length > 0) {
    advertencias.push(
      `${cuantos(sinInegi.length, "código postal tiene", "códigos postales tienen")} un municipio que no está en el catálogo de INEGI del paquete (van con cvegeo null y el nombre de SEPOMEX): ${lista(sinInegi.map((a) => `${a.cp} (${[...a.claves][0]})`))}.`,
    );
  }
  if (variosMunicipios.length > 0) {
    advertencias.push(
      `${cuantos(variosMunicipios.length, "código postal aparece", "códigos postales aparecen")} en más de un municipio (se usa el de su primera fila): ${lista(variosMunicipios.map((a) => `${a.cp} (${[...a.claves].join(", ")})`))}.`,
    );
  }
  return {
    codigos: armados.map(({ cp, estado, municipio, asentamientos }) => ({
      cp,
      estado,
      municipio,
      asentamientos,
    })),
    resumen: {
      filas: filas.length,
      codigos_postales: armados.length,
      municipios: municipios.size,
      sin_municipio_inegi: sinInegi.length,
      advertencias,
    },
  };
}
