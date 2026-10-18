// Códigos postales del catálogo de Correos de México que el usuario descargó en su equipo con
// `mexicoapi sepomex sync`. Nunca usa la red ni descarga nada: si no hay catálogo, dice cómo
// bajarlo. Los mensajes de mexicoapi/sepomex traen la ruta de la caché, así que no se repiten.
import { ErrorHerramienta, type Herramienta, resultadoError } from "../herramientas.js";
import {
  anotaciones,
  aUnaLinea,
  esquemaSalida,
  type Fuente,
  type OpcionesHerramientas,
  type Procedencia,
  resultado,
} from "../respuesta.js";

const COMANDO = "npx mexicoapi sepomex sync";

/** Asentamientos que el texto lista con tipo, zona y ciudad; los demás van solo con el nombre. */
const MAX_EN_TEXTO = 30;

const SIN_INEGI =
  "El municipio de este código postal no está en el catálogo de INEGI del paquete: el nombre es el de Correos de México y no hay cvegeo.";

const FUENTE_NOMBRE = "Correos de México, Catálogo Nacional de Códigos Postales";

type Sepomex = typeof import("mexicoapi/sepomex");

/**
 * Un catálogo que falta da null y uno dañado, un error con el comando para bajarlo de nuevo. Los
 * demás siguen tal cual: son errores internos, que se responden sin su mensaje.
 */
function errorDeCache(error: unknown, sepomex: Sepomex): unknown {
  if (!(error instanceof sepomex.SepomexError)) return error;
  if (error.tipo === "sin-datos") return null;
  if (error.tipo === "cache-invalida") {
    return new ErrorHerramienta(
      `El catálogo de códigos postales guardado en este equipo está dañado. Vuelve a descargarlo con: ${COMANDO}`,
    );
  }
  return error;
}

export function codigoPostalHerramienta({ dirSepomex }: OpcionesHerramientas): Herramienta {
  return {
    name: "codigo_postal",
    title: "Código postal",
    description: `Estado, municipio y asentamientos (colonias, fraccionamientos, pueblos) de un código postal, del catálogo de Correos de México que el usuario descargó en este equipo con ${COMANDO}. No usa la red. Si el catálogo no está descargado, responde con error y el comando para descargarlo. Los datos son de Correos de México, para uso particular, y cada resultado trae su aviso de uso.`,
    inputSchema: {
      type: "object",
      properties: {
        cp: {
          type: "string",
          pattern: "^[0-9]{5}$",
          description: "Código postal de 5 dígitos, con ceros a la izquierda.",
        },
      },
      required: ["cp"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(
      {
        type: "object",
        properties: {
          cp: { type: "string" },
          estado: {
            type: "object",
            properties: { cve_ent: { type: "string" }, nombre: { type: "string" } },
            required: ["cve_ent", "nombre"],
          },
          municipio: {
            type: "object",
            properties: { cvegeo: { type: ["string", "null"] }, nombre: { type: "string" } },
            required: ["cvegeo", "nombre"],
          },
          asentamientos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string" },
                tipo: { type: "string" },
                zona: { type: "string" },
                ciudad: { type: "string" },
              },
              required: ["nombre", "tipo", "zona", "ciudad"],
            },
          },
        },
        required: ["cp", "estado", "municipio", "asentamientos"],
      },
      {
        origenes: ["cache_local"],
        asOfNulo: true,
        extra: {
          aviso: { type: "string", description: "Aviso de uso de Correos de México." },
          descargado: {
            type: "string",
            format: "date-time",
            description: "Cuándo se descargó el catálogo en este equipo.",
          },
        },
      },
    ),
    annotations: anotaciones(false),
    async ejecutar(args) {
      const cp = args.cp as string;
      const sepomex: Sepomex = await import("mexicoapi/sepomex");
      const sinCatalogo = `No hay catálogo de códigos postales en este equipo. Quien usa el equipo puede descargarlo de Correos de México con: ${COMANDO}. Aviso de Correos de México: ${sepomex.AVISO_SEPOMEX} Los datos se descargan y se guardan solo en este equipo; MéxicoAPI no los distribuye.`;
      const opciones = dirSepomex === undefined ? {} : { dir: dirSepomex };
      let resumen: Awaited<ReturnType<Sepomex["resumen"]>>;
      let encontrado: Awaited<ReturnType<Sepomex["cp"]>>;
      try {
        resumen = await sepomex.resumen(opciones);
        if (resumen === null) return resultadoError(sinCatalogo);
        encontrado = await sepomex.cp(cp, opciones);
      } catch (error) {
        const traducido = errorDeCache(error, sepomex);
        if (traducido === null) return resultadoError(sinCatalogo);
        throw traducido;
      }
      if (encontrado === null) {
        return resultadoError(
          `El código postal ${cp} no está en el catálogo de Correos de México descargado en este equipo.`,
        );
      }
      const { estado, municipio, asentamientos } = encontrado;
      const clave = municipio.cvegeo === null ? "" : ` (${municipio.cvegeo})`;
      const n = asentamientos.length;
      const lineas = [
        `Código postal ${cp}: ${aUnaLinea(municipio.nombre)}${clave}, ${aUnaLinea(estado.nombre)}.`,
        `${n} ${n === 1 ? "asentamiento" : "asentamientos"}:`,
        ...asentamientos.slice(0, MAX_EN_TEXTO).map((a) => {
          const partes = [a.tipo, a.zona, a.ciudad].filter((p) => p !== "").map(aUnaLinea);
          return `- ${aUnaLinea(a.nombre)} (${partes.join(", ")})`;
        }),
      ];
      // Los demás van solo con el nombre: en 2025-03-26 y 2024-11-05 no hay structuredContent y
      // muchos hosts solo le pasan el texto al modelo, así que el texto los trae todos.
      if (n > MAX_EN_TEXTO) {
        lineas.push(
          `Los otros ${n - MAX_EN_TEXTO}, solo con el nombre:`,
          ...asentamientos.slice(MAX_EN_TEXTO).map((a) => `- ${aUnaLinea(a.nombre)}`),
        );
      }
      lineas.push(`Aviso de Correos de México: ${aUnaLinea(resumen.aviso)}`);
      const fuente: Fuente = { nombre: FUENTE_NOMBRE, url: resumen.fuente };
      const p: Procedencia = {
        as_of: resumen.as_of,
        fuente,
        fuentes: [fuente],
        origen: "cache_local",
        // Las advertencias del catálogo (cuántos códigos no se unieron con INEGI) no son de este código.
        advertencias: municipio.cvegeo === null ? [SIN_INEGI] : [],
      };
      const descargado = resumen.descargado.slice(0, 10);
      return resultado(lineas, encontrado, p, {
        extra: { aviso: resumen.aviso, descargado: resumen.descargado },
        sinFecha: `Correos de México no indicó la fecha; se descargó el ${descargado}`,
      });
    },
  };
}
