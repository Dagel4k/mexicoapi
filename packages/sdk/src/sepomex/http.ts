// Transporte por omisión de `sync`, con node:http(s) en vez del fetch global: permite pedir las
// direcciones IPv4 primero (el sitio de Correos de México corta el TLS por IPv6) y cortar una
// respuesta que pasa del límite sin guardarla entera.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { SepomexError, tamanoLegible } from "./error.js";
import type { FetchSepomex } from "./tipos.js";

/**
 * `lookup` para node:net que ordena las direcciones con las IPv4 primero. Con la selección
 * automática de familia de Node, si la IPv4 no conecta se intenta la IPv6.
 */
export function buscarIpv4Primero(
  host: string,
  opciones: dns.LookupOptions,
  listo: (
    error: NodeJS.ErrnoException | null,
    direccion: string | dns.LookupAddress[],
    familia?: number,
  ) => void,
): void {
  dns.lookup(host, { ...opciones, order: "ipv4first" }, listo);
}

export interface OpcionesTransporte {
  /** Bytes máximos de una respuesta: al pasarlos se corta la conexión. */
  maxBytes: number;
  /** Milisegundos sin recibir nada antes de rendirse. */
  esperaMs: number;
}

/** Un `fetch` mínimo sobre node:http y node:https: sin redirecciones, cookies ni compresión. */
export function crearTransporte({ maxBytes, esperaMs }: OpcionesTransporte): FetchSepomex {
  return (url, init) =>
    new Promise((resolver, rechazar) => {
      const destino = new URL(url);
      const modulo =
        destino.protocol === "https:" ? https : destino.protocol === "http:" ? http : undefined;
      if (modulo === undefined) {
        rechazar(new TypeError(`Solo se descarga por http o https, no por ${destino.protocol}`));
        return;
      }
      const peticion = modulo.request(
        destino,
        {
          method: init.method,
          headers: init.headers,
          agent: false,
          lookup: buscarIpv4Primero,
          timeout: esperaMs,
        },
        (respuesta) => {
          const trozos: Buffer[] = [];
          let total = 0;
          respuesta.on("data", (trozo: Buffer) => {
            total += trozo.length;
            if (total > maxBytes) {
              rechazar(
                new SepomexError(
                  "archivo-invalido",
                  `La respuesta de ${destino.host} pasa de ${tamanoLegible(maxBytes)}.`,
                ),
              );
              peticion.destroy();
              return;
            }
            trozos.push(trozo);
          });
          respuesta.on("end", () => {
            const cuerpo = Buffer.concat(trozos);
            resolver({
              status: respuesta.statusCode ?? 0,
              headers: {
                get(nombre) {
                  const valor = respuesta.headers[nombre.toLowerCase()];
                  if (valor === undefined) return null;
                  return Array.isArray(valor) ? valor.join(", ") : valor;
                },
              },
              arrayBuffer: async () =>
                cuerpo.buffer.slice(cuerpo.byteOffset, cuerpo.byteOffset + cuerpo.byteLength),
            });
          });
          respuesta.on("error", rechazar);
        },
      );
      peticion.on("timeout", () => {
        rechazar(new Error(`${destino.host} no respondió en ${esperaMs / 1000} s.`));
        peticion.destroy();
      });
      peticion.on("error", rechazar);
      peticion.end(init.body);
    });
}
