// La semántica de las rutas de la API como funciones puras: las reglas de los parámetros, el
// orden en que se revisan, sus textos y cómo se responden los errores. La API las envuelve en
// Response y el cliente del paquete en MexicoApiError; el OpenAPI publica las mismas reglas.
export { CONSULTAS, type RutaConConsulta, revisarConsulta } from "./consulta.js";
export {
  cumpleRegla,
  type NombresTipoPlazo,
  type ProblemaConsulta,
  REGLAS_RUTA,
  type ReglaConsulta,
  type ReglaParametro,
  revisarFix,
  revisarTipoPlazo,
} from "./parametros.js";
export {
  consultarConFeriados,
  diasInhabilesLft,
  type FuenteMetaRuta,
  fechaEnTexto,
  type MetaRuta,
  metaLft,
  problemaDeError,
  problemaSinRegistro,
} from "./respuestas.js";
