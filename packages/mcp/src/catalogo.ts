// Las herramientas del servidor, en el orden en que se publican. Sus definiciones son constantes
// del código: no dependen del cliente ni de los datos.
import { bancoPorCodigoHerramienta, validarClabeHerramienta } from "./consultas/bancos.js";
import { diasInhabilesHerramienta, sumarDiasHabilesHerramienta } from "./consultas/calendarios.js";
import { codigoPostalHerramienta } from "./consultas/codigo-postal.js";
import { constantesHerramienta } from "./consultas/constantes.js";
import {
  buscarMunicipioHerramienta,
  estadosHerramienta,
  municipioHerramienta,
  municipiosDeEstadoHerramienta,
} from "./consultas/geografia.js";
import { tipoDeCambioFixHerramienta, udisHerramienta } from "./consultas/indicadores.js";
import {
  validarCurpHerramienta,
  validarNssHerramienta,
  validarRfcHerramienta,
} from "./consultas/validacion.js";
import type { Herramienta } from "./herramientas.js";
import { conSalidaDeApiRevisada, type OpcionesHerramientas } from "./respuesta.js";

export function crearHerramientas(opciones: OpcionesHerramientas): readonly Herramienta[] {
  const herramientas = [
    buscarMunicipioHerramienta(),
    municipioHerramienta(opciones),
    estadosHerramienta(),
    municipiosDeEstadoHerramienta(),
    validarClabeHerramienta(opciones),
    bancoPorCodigoHerramienta(opciones),
    validarRfcHerramienta(),
    validarCurpHerramienta(),
    validarNssHerramienta(),
    tipoDeCambioFixHerramienta(opciones),
    udisHerramienta(opciones),
    diasInhabilesHerramienta(opciones),
    sumarDiasHabilesHerramienta(opciones),
    constantesHerramienta(opciones),
    codigoPostalHerramienta(opciones),
  ];
  return herramientas.map(conSalidaDeApiRevisada);
}

export type { OpcionesHerramientas } from "./respuesta.js";
