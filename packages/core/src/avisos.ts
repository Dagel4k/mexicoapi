// Advertencias que comparten el cliente del paquete y el servidor MCP: el mismo texto en los dos.

/**
 * Una respuesta de una serie que sale de los datos del paquete y no de la API: la publicación más
 * reciente que trae el paquete puede no ser la última que hay. El cliente la da siempre en el
 * último FIX del paquete; el MCP sin red, también en una fecha cerca del final de la serie.
 */
export const AVISO_SIN_API =
  "Respuesta con los datos del paquete mexicoapi, no de la API: pueden faltar publicaciones recientes.";
