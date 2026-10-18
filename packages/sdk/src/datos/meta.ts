import { meta as bancos } from "./generados/bancos.js";
import { meta as estados } from "./generados/inegi-estados.js";
import { meta as municipios } from "./generados/inegi-municipios.js";
import type { MetaDatos } from "./tipos.js";

/** Meta de cada dataset de `mexicoapi/datos`: su `as_of` y sus fuentes. */
export const meta: Readonly<{ estados: MetaDatos; municipios: MetaDatos; bancos: MetaDatos }> =
  Object.freeze({ estados, municipios, bancos });
