// Entrada `mexicoapi/datos`: estados, municipios y bancos de data/, dentro del paquete y sin red.
// Las series del FIX y de las UDIS van aparte (`mexicoapi/datos/fix` y `mexicoapi/datos/udis`).
export { type BancoCatalogo, banco, bancos, catalogoClabe, type OpcionesBancos } from "./bancos.js";
export { estado, estados } from "./estados.js";
export { meta } from "./meta.js";
export {
  buscarMunicipio,
  municipio,
  municipios,
  type OpcionesBusquedaMunicipio,
} from "./municipios.js";
export type { Banco, BancoClabe, Estado, FuenteDatos, MetaDatos, Municipio } from "./tipos.js";
