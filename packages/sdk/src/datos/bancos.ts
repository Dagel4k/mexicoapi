import { datos } from "./generados/bancos.js";
import type { Banco, BancoClabe } from "./tipos.js";

// Meta del dataset, para quien carga solo este módulo (el cliente HTTP).
export { meta } from "./generados/bancos.js";

export interface OpcionesBancos {
  /** `true`: solo los activos; `false`: solo los dados de baja. Sin la opción, todos. */
  activos?: boolean | undefined;
}

/** Entrada de `catalogoClabe`: lo que pide validarClabe y si el banco sigue activo. */
export interface BancoCatalogo extends BancoClabe {
  activo: boolean;
}

let activos: readonly Banco[] | undefined;
let inactivos: readonly Banco[] | undefined;
let porCodigo: ReadonlyMap<string, Banco> | undefined;
let catalogo: ReadonlyMap<string, BancoCatalogo> | undefined;

/** Bancos en el orden de su código de CLABE, con su historial. Arreglos y registros congelados. */
export function bancos(opciones: OpcionesBancos = {}): readonly Banco[] {
  if (opciones.activos === undefined) return datos;
  if (opciones.activos) {
    activos ??= Object.freeze(datos.filter((b) => b.activo));
    return activos;
  }
  inactivos ??= Object.freeze(datos.filter((b) => !b.activo));
  return inactivos;
}

/** Banco por los 3 dígitos con los que empieza la CLABE (`"002"`). */
export function banco(codigo: string): Banco | undefined {
  porCodigo ??= new Map(datos.map((b) => [b.codigo, b]));
  return porCodigo.get(codigo);
}

/**
 * Catálogo para `validarClabe(clabe, { bancos: catalogoClabe() })`, con todos los bancos: uno
 * dado de baja sigue dando una CLABE con formato válido y `activo: false` lo dice, como en la
 * API. Cada llamada devuelve un mapa nuevo con los mismos registros congelados; si se validan
 * muchas CLABE, conviene guardarlo.
 */
export function catalogoClabe(): ReadonlyMap<string, BancoCatalogo> {
  catalogo ??= new Map(
    datos.map((b) => [
      b.codigo,
      Object.freeze({ codigo: b.codigo, nombre_corto: b.nombre_corto, activo: b.activo }),
    ]),
  );
  return new Map(catalogo);
}
