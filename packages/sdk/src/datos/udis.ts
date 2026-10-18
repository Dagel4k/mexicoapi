// Entrada `mexicoapi/datos/udis`: la serie de las UDIS que trae el paquete, lista para udiDeFecha
// del núcleo: `udiDeFecha(serie, tramo, cobertura, fecha)`.
import { datos, meta as metaUdis } from "./generados/udis.js";
import { coberturaDe } from "./serie.js";
import type { CoberturaSerie, MetaDatos, Udi } from "./tipos.js";

/** Valor diario de la UDI publicado en el DOF, en orden de fecha. Congelada. */
export const serie: readonly Udi[] = datos;

/** Del primer al último día que trae el paquete; después, udiDeFecha da `no_disponible`. */
export const cobertura: CoberturaSerie = coberturaDe(datos, (r) => r.fecha);

/** El paquete trae la serie completa: el tramo es la cobertura. */
export const tramo: CoberturaSerie = cobertura;

export const meta: MetaDatos = metaUdis;

export type { CoberturaSerie, FuenteDatos, MetaDatos, Udi } from "./tipos.js";
