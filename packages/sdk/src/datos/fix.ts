// Entrada `mexicoapi/datos/fix`: la serie del FIX que trae el paquete, lista para fixPublicado y
// fixParaOperacion del núcleo: `fixParaOperacion(serie, tramo, cobertura, fecha)`.
import { datos, meta as metaFix } from "./generados/tipo-cambio-fix.js";
import { coberturaDe } from "./serie.js";
import type { CoberturaSerie, MetaDatos, TipoCambioFix } from "./tipos.js";

/** FIX publicados en el DOF, en orden de fecha de publicación. Congelada. */
export const serie: readonly TipoCambioFix[] = datos;

/** Del primer al último FIX que trae el paquete; después, las consultas dan `no_disponible`. */
export const cobertura: CoberturaSerie = coberturaDe(datos, (r) => r.fecha_publicacion);

/** El paquete trae la serie completa: el tramo es la cobertura. */
export const tramo: CoberturaSerie = cobertura;

export const meta: MetaDatos = metaFix;

export type { CoberturaSerie, FuenteDatos, MetaDatos, TipoCambioFix } from "./tipos.js";
