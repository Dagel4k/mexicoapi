// Entrada `mexicoapi/cliente`: cliente HTTP de la API con errores tipados, reintentos, tiempo
// límite, caché opcional y respaldo en los datos del paquete. Universal: usa solo fetch,
// AbortController y temporizadores. Los datos y el núcleo se cargan al usarlos, aparte.
export { crearCliente } from "./cliente.js";
export { type ContextoError, MexicoApiError, type Problema } from "./error.js";
export type {
  ArgumentosDe,
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
