// Entrada `mexicoapi/cliente`: cliente HTTP de la API con errores tipados, reintentos, tiempo
// límite, caché opcional y respaldo en los datos del paquete. Universal: usa solo fetch,
// AbortController y temporizadores. Los datos y el núcleo se cargan al usarlos, aparte.
export {
  PROBLEMAS,
  type TipoProblema,
  URL_DOCS,
  URL_PROBLEMAS,
  URL_REPOSITORIO,
} from "@mexicoapi/core/problemas";
export { crearCliente } from "./cliente.js";
export { DIAS_DATOS_RECIENTES } from "./comun.js";
export { type ContextoError, MexicoApiError, type Problema } from "./error.js";
export type {
  ArgumentosDe,
  Base,
  Cliente,
  ConsultaDiasHabiles,
  ConsultaDiasInhabiles,
  EstadoDataset,
  FetchCompatible,
  FixOperacion,
  InitFetch,
  Meta,
  OpcionesCache,
  OpcionesCliente,
  OpcionesComunes,
  OpcionesConsulta,
  Origen,
  Respuesta,
  RespuestaFetch,
  RespuestaSinMeta,
  ResultadoClabe,
  RutaApi,
  RutasApi,
  SenalAborto,
} from "./tipos.js";
