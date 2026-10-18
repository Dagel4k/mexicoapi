/**
 * Arranque como proceso: stdio, señales y salida. Lo usan el binario y las pruebas de
 * integración, para que estas ejerciten el mismo cableado.
 */
import { Console } from "node:console";
import type { Herramienta } from "./herramientas.js";
import type { InfoServidor } from "./protocolo.js";
import { ejecutarStdio } from "./stdio.js";

export interface OpcionesArranque {
  info: InfoServidor;
  instrucciones: string;
  herramientas: readonly Herramienta[];
  msGraciaCierre?: number;
}

/** Margen para que el proceso termine solo; si algo lo sigue manteniendo vivo, sale igual. */
const MS_SALIDA_FORZADA = 2000;

export async function arrancar(opciones: OpcionesArranque): Promise<void> {
  // stdout es solo para mensajes MCP: cualquier console.* (también de dependencias) va a stderr.
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  // Los registros son de mejor esfuerzo: si el cliente cierra stderr, el servidor sigue.
  process.stderr.on("error", () => {});
  const registrar = (mensaje: string): void => void process.stderr.write(`${mensaje}\n`);
  const conexion = ejecutarStdio({
    ...opciones,
    entrada: process.stdin,
    salida: process.stdout,
    registrar,
  });
  registrar(`${opciones.info.name} ${opciones.info.version}: servidor MCP por stdio`);
  for (const senal of ["SIGINT", "SIGTERM"] as const) {
    process.once(senal, () => conexion.cerrar());
  }
  await conexion.terminado;
  // EOF, señal o error de E/S: lo pendiente ya se respondió o se canceló. Si una herramienta que
  // no respeta la cancelación mantiene vivo el proceso, se sale de todos modos.
  setTimeout(() => process.exit(0), MS_SALIDA_FORZADA).unref();
}
