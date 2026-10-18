import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Entorno } from "../src/cli.js";
import { crearCliente } from "../src/http.js";

const raizFixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const BASE = "https://gaia.inegi.org.mx/wscatgeo/v2/";
const URL_INFO = "https://www.banxico.org.mx/servicios/spei_-informacion-banco-mex.html";
const URL_PDF = "https://www.banxico.org.mx/servicios/d/{C24C7DBC-9ABF-6F41-DA38-561CEB1401B3}.pdf";

export const HOY = "2026-10-17";

export const leerFixture = async (ruta: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(join(raizFixtures, ruta)));

export interface Salida {
  salida: string[];
  errores: string[];
  /** URL pedidas al fetch falso, sin robots.txt. */
  pedidas: string[];
  /** Intervalos con que se pidió un cliente. */
  intervalos: number[];
}

export interface Opciones {
  /** Cuerpo del CEP de `HOY`; por defecto el fixture. */
  cep?: Uint8Array;
  /** Estado HTTP forzado para las URL que contengan este texto. */
  estados?: Record<string, number>;
  /** Instante de la corrida; por defecto 2026-10-17T18:00:00Z. */
  ahora?: Date;
  /** Respuesta alterna del CEP según la fecha ISO pedida; `undefined` usa `cep`. */
  cepPorFecha?: (fecha: string) => string | undefined;
}

/** Entorno con `fetch` falso que sirve los fixtures de INEGI y Banxico. */
export async function crearEntorno(
  raizDatos: string,
  opciones: Opciones = {},
): Promise<Entorno & Salida> {
  const [cep, html, pdf, mgee] = await Promise.all([
    opciones.cep ?? leerFixture("bancos/cep-2026-10-17.json"),
    leerFixture("bancos/spei-informacion.html"),
    leerFixture("bancos/participantes-spei-2026-09-23.pdf"),
    leerFixture("inegi/mgee.json"),
  ]);
  const municipios = new Map<string, Uint8Array>();
  for (let i = 1; i <= 32; i++) {
    const n = String(i).padStart(2, "0");
    municipios.set(n, await leerFixture(`inegi/mgem-${n}.json`));
  }
  const pedidas: string[] = [];
  const intervalos: number[] = [];
  const fetchFalso: typeof fetch = async (entrada) => {
    const url = String(entrada);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    pedidas.push(url);
    for (const [parte, estado] of Object.entries(opciones.estados ?? {})) {
      if (url.includes(parte)) return new Response("", { status: estado });
    }
    if (url === `${BASE}mgee/`) return new Response(mgee);
    const m = /mgem\/(\d{2})$/.exec(url);
    if (m?.[1] !== undefined) return new Response(municipios.get(m[1]));
    if (url.startsWith("https://www.banxico.org.mx/cep/instituciones.do")) {
      const [, d, mes, a] = /fecha=(\d{2})-(\d{2})-(\d{4})/.exec(url) ?? [];
      return new Response(opciones.cepPorFecha?.(`${a}-${mes}-${d}`) ?? cep);
    }
    if (url === URL_INFO) return new Response(html);
    if (decodeURI(url) === URL_PDF) return new Response(pdf);
    return new Response("no", { status: 404 });
  };
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    crearCliente: (ms) => {
      intervalos.push(ms);
      return crearCliente({ fetch: fetchFalso, esperar: async () => {}, intervaloMinimoMs: 0 });
    },
    raizDatos,
    ahora: () => opciones.ahora ?? new Date("2026-10-17T18:00:00Z"),
    escribir: (t) => void salida.push(t),
    escribirError: (t) => void errores.push(t),
    salida,
    errores,
    pedidas,
    intervalos,
  };
}
