// Transporte por omisión de `sync`, con node:http(s) en vez del fetch global: pide las
// direcciones IPv4 primero (el sitio de Correos de México corta el TLS por IPv6) y entrega el
// cuerpo por partes, para que quien lee lo corte al pasar del límite.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { FetchSepomex, LectorCuerpo } from "./tipos.js";

type Listo = (
  error: NodeJS.ErrnoException | null,
  direccion: string | dns.LookupAddress[],
  familia?: number,
) => void;

/**
 * `lookup` para node:net con las direcciones IPv4 primero. Pide todas y las ordena aquí en vez de
 * pasar `order: "ipv4first"` a dns.lookup: el orden queda en este código y las pruebas lo revisan
 * con un dns.lookup falso. Con la selección automática de familia de Node, si la IPv4 no conecta
 * se intenta la IPv6.
 */
export function buscarIpv4Primero(host: string, opciones: dns.LookupOptions, listo: Listo): void {
  dns.lookup(host, { ...opciones, all: true }, (error, direcciones) => {
    if (error) {
      listo(error, opciones.all ? [] : "");
      return;
    }
    const ordenadas = [...direcciones].sort((a, b) => a.family - b.family);
    if (opciones.all) {
      listo(null, ordenadas);
      return;
    }
    const primera = ordenadas[0];
    if (primera === undefined) {
      listo(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }), "");
      return;
    }
    listo(null, primera.address, primera.family);
  });
}

export interface OpcionesTransporte {
  /** Milisegundos sin recibir nada (antes o durante el cuerpo) antes de rendirse. */
  esperaMs: number;
}

/**
 * Un `fetch` mínimo sobre node:http y node:https: sin redirecciones, cookies ni compresión.
 * Responde al llegar los encabezados; el cuerpo es un ReadableStream y cancelarlo corta la
 * conexión.
 */
export function crearTransporte({ esperaMs }: OpcionesTransporte): FetchSepomex {
  return (url, init) =>
    new Promise((resolver, rechazar) => {
      const destino = new URL(url);
      const modulo =
        destino.protocol === "https:" ? https : destino.protocol === "http:" ? http : undefined;
      if (modulo === undefined) {
        rechazar(new TypeError(`Solo se descarga por http o https, no por ${destino.protocol}`));
        return;
      }
      let enCurso: http.IncomingMessage | undefined;
      const peticion = modulo.request(
        destino,
        {
          method: init.method,
          headers: init.headers,
          agent: false,
          lookup: buscarIpv4Primero,
          timeout: esperaMs,
          ...(init.signal ? { signal: init.signal } : {}),
        },
        (respuesta) => {
          enCurso = respuesta;
          const cuerpo = Readable.toWeb(respuesta) as unknown as ReadableStream<Uint8Array>;
          resolver({
            status: respuesta.statusCode ?? 0,
            headers: {
              get(nombre) {
                const valor = respuesta.headers[nombre.toLowerCase()];
                if (valor === undefined) return null;
                return Array.isArray(valor) ? valor.join(", ") : valor;
              },
            },
            body: { getReader: () => cuerpo.getReader() as LectorCuerpo },
            arrayBuffer: () => new Response(cuerpo).arrayBuffer(),
          });
        },
      );
      peticion.on("timeout", () => {
        const error = new Error(`${destino.host} no respondió en ${esperaMs / 1000} s.`);
        rechazar(error);
        // A mitad del cuerpo, el error llega a quien lo está leyendo.
        enCurso?.destroy(error);
        peticion.destroy(error);
      });
      peticion.on("error", rechazar);
      peticion.end(init.body);
    });
}
