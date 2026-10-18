/**
 * Transporte stdio de MCP: un mensaje JSON-RPC por línea, en UTF-8, sin saltos de línea dentro.
 * Por stdout solo salen mensajes; el diagnóstico va por `registrar` (stderr en el binario).
 */
import type { Readable, Writable } from "node:stream";
import {
  crearServidor,
  ERROR_PARSEO,
  type OpcionesServidor,
  SOLICITUD_INVALIDA,
} from "./protocolo.js";

/** Tope por mensaje: un mensaje más grande se rechaza y se descarta hasta el siguiente salto. */
export const MAX_BYTES_MENSAJE = 1024 * 1024;

const SALTO = 0x0a;
const RETORNO = 0x0d;

export interface OpcionesStdio extends OpcionesServidor {
  entrada: Readable;
  salida: Writable;
  maxBytesMensaje?: number;
}

export interface ConexionStdio {
  /** Se cumple con EOF, una vez respondido lo pendiente, o al cerrar. */
  readonly terminado: Promise<void>;
  /** Aborta lo que esté en curso, deja de leer y no escribe nada más. */
  cerrar(): void;
}

/** Línea vacía o de solo espacios y tabuladores: no es un mensaje y no se responde. */
function esBlanco(linea: Buffer): boolean {
  return linea.every((byte) => byte === 0x20 || byte === 0x09);
}

export function ejecutarStdio(opciones: OpcionesStdio): ConexionStdio {
  const { entrada, salida } = opciones;
  const maxBytes = opciones.maxBytesMensaje ?? MAX_BYTES_MENSAJE;
  const registrar = (mensaje: string): void => {
    try {
      opciones.registrar?.(`${opciones.info.name}: ${mensaje}`);
    } catch {
      // Registro de mejor esfuerzo.
    }
  };
  const servidor = crearServidor(opciones);
  const decodificador = new TextDecoder("utf-8", { fatal: true });
  const pendientes = new Set<Promise<void>>();
  let trozos: Buffer[] = [];
  let bytes = 0;
  let descartando = false;
  let finDeEntrada = false;
  let cerrado = false;
  let esperandoDrenado = false;
  let avisarFin!: () => void;
  const terminado = new Promise<void>((resolver) => {
    avisarFin = resolver;
  });

  function escribir(texto: string | null): void {
    if (texto === null || cerrado || salida.writableEnded || salida.destroyed) return;
    if (salida.write(`${texto}\n`) || esperandoDrenado) return;
    // La salida está llena: no se leen más pedidos hasta que el cliente lea lo ya escrito.
    esperandoDrenado = true;
    entrada.pause();
    salida.once("drain", () => {
      esperandoDrenado = false;
      if (!cerrado) entrada.resume();
    });
  }

  function rechazarGrande(): void {
    registrar(`se descartó un mensaje de más de ${maxBytes} bytes`);
    escribir(servidor.errorSinId(SOLICITUD_INVALIDA, `El mensaje pasa de ${maxBytes} bytes`));
  }

  function atenderLinea(linea: Buffer): void {
    const cuerpo = linea.at(-1) === RETORNO ? linea.subarray(0, -1) : linea;
    if (esBlanco(cuerpo)) return;
    if (cuerpo.length > maxBytes) {
      rechazarGrande();
      return;
    }
    let texto: string;
    try {
      texto = decodificador.decode(cuerpo);
    } catch {
      registrar("se descartó un mensaje que no es UTF-8 válido");
      escribir(servidor.errorSinId(ERROR_PARSEO, "El mensaje no es UTF-8 válido"));
      return;
    }
    const pendiente = servidor.atender(texto).then(escribir);
    pendientes.add(pendiente);
    void pendiente.then(() => pendientes.delete(pendiente));
  }

  function alDato(trozo: Buffer | string): void {
    if (cerrado) return;
    const datos = typeof trozo === "string" ? Buffer.from(trozo, "utf8") : trozo;
    let inicio = 0;
    for (let salto = datos.indexOf(SALTO); salto !== -1; salto = datos.indexOf(SALTO, inicio)) {
      const parte = datos.subarray(inicio, salto);
      inicio = salto + 1;
      if (descartando) {
        descartando = false;
      } else if (bytes + parte.length > maxBytes + 1) {
        rechazarGrande();
      } else {
        atenderLinea(trozos.length === 0 ? parte : Buffer.concat([...trozos, parte]));
      }
      trozos = [];
      bytes = 0;
    }
    const resto = datos.subarray(inicio);
    if (descartando || resto.length === 0) return;
    // Se deja un byte de holgura para el "\r" de un fin de línea CRLF.
    if (bytes + resto.length > maxBytes + 1) {
      trozos = [];
      bytes = 0;
      descartando = true;
      rechazarGrande();
      return;
    }
    trozos.push(resto);
    bytes += resto.length;
  }

  function alFin(): void {
    if (cerrado || finDeEntrada) return;
    finDeEntrada = true;
    // La última línea puede llegar sin salto.
    if (!descartando && trozos.length > 0) atenderLinea(Buffer.concat(trozos));
    trozos = [];
    void Promise.all(pendientes).then(() => avisarFin());
  }

  function cerrar(): void {
    if (cerrado) return;
    cerrado = true;
    servidor.cancelarTodo();
    entrada.destroy();
    avisarFin();
  }

  entrada.on("data", alDato);
  entrada.on("end", alFin);
  entrada.on("close", alFin);
  entrada.on("error", () => {
    registrar("error al leer la entrada; terminando");
    cerrar();
  });
  salida.on("error", (error: NodeJS.ErrnoException) => {
    registrar(`la salida se cerró (${error.code ?? error.name}); terminando`);
    cerrar();
  });

  return { terminado, cerrar };
}
