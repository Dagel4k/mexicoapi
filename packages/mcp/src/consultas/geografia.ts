// Municipios y alcaldías del catálogo de INEGI que trae el paquete: datos estables, sin red.
import type { Municipio } from "mexicoapi";
import { buscarMunicipio, estado, meta } from "mexicoapi/datos";
import { type Herramienta, resultadoError } from "../herramientas.js";
import {
  anotaciones,
  aUnaLinea,
  consultar,
  esquemaSalida,
  type OpcionesHerramientas,
  procedencia,
  resultado,
} from "../respuesta.js";

const MUNICIPIO = {
  type: "object",
  properties: {
    cvegeo: { type: "string" },
    cve_ent: { type: "string" },
    cve_mun: { type: "string" },
    nombre: { type: "string" },
    cve_cabecera: { type: ["string", "null"] },
    estado: { type: "string", description: "Nombre del estado." },
  },
  required: ["cvegeo", "cve_ent", "cve_mun", "nombre", "cve_cabecera", "estado"],
} as const;

type ConEstado = Municipio & { estado: string };

const conEstado = (m: Municipio): ConEstado => ({
  ...m,
  estado: estado(m.cve_ent)?.nombre ?? "",
});

const linea = (m: ConEstado): string =>
  `${m.cvegeo} ${aUnaLinea(m.nombre)}, ${aUnaLinea(m.estado)}`;

export function buscarMunicipioHerramienta(): Herramienta {
  return {
    name: "buscar_municipio",
    title: "Buscar municipio",
    description:
      "Busca municipios y alcaldías por nombre en el catálogo de INEGI que trae el paquete, sin red. No distingue mayúsculas, acentos ni signos: primero los de nombre igual al texto, luego los que empiezan con él y al final los que lo contienen. Devuelve de cada uno su clave geoestadística (cvegeo), la clave de su estado y el nombre del estado, y el total de coincidencias.",
    inputSchema: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Nombre o parte del nombre del municipio.",
        },
        cve_ent: {
          type: "string",
          pattern: "^[0-9]{2}$",
          description: "Clave INEGI del estado (2 dígitos) para buscar solo en él.",
        },
        limite: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "Máximo de resultados, de 1 a 50.",
        },
      },
      required: ["texto"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(
      { type: "array", items: MUNICIPIO },
      {
        origenes: ["paquete"],
        extra: { total: { type: "integer", description: "Coincidencias sin el límite." } },
      },
    ),
    annotations: anotaciones(false),
    async ejecutar(args) {
      const {
        texto,
        cve_ent,
        limite = 10,
      } = args as {
        texto: string;
        cve_ent?: string;
        limite?: number;
      };
      if (!/[\p{L}\p{N}]/u.test(texto)) {
        return resultadoError("El texto no tiene letras ni números para buscar.");
      }
      if (cve_ent !== undefined && estado(cve_ent) === undefined) {
        return resultadoError(`No existe el estado ${cve_ent}.`);
      }
      const todos = buscarMunicipio(texto, { cve_ent });
      const datos = todos.slice(0, limite).map(conEstado);
      const total = todos.length;
      const lineas =
        total === 0
          ? ["Ningún municipio coincide con la búsqueda."]
          : [
              total === 1
                ? "1 municipio coincide con la búsqueda:"
                : `${total} municipios coinciden con la búsqueda${total > datos.length ? `; se muestran ${datos.length}` : ""}:`,
              ...datos.map((m) => `- ${linea(m)}`),
            ];
      const p = procedencia({ meta: meta.municipios, origen: "paquete" });
      return resultado(lineas, datos, p, { extra: { total } });
    },
  };
}

export function municipioHerramienta({ cliente }: OpcionesHerramientas): Herramienta {
  return {
    name: "municipio",
    title: "Municipio por clave",
    description:
      "Devuelve un municipio o alcaldía por su clave geoestadística de INEGI (cvegeo: los 2 dígitos del estado y los 3 del municipio), con el nombre de su estado. Sale del catálogo que trae el paquete, sin red.",
    inputSchema: {
      type: "object",
      properties: {
        cvegeo: {
          type: "string",
          pattern: "^[0-9]{5}$",
          description: "Clave geoestadística de 5 dígitos.",
        },
      },
      required: ["cvegeo"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(MUNICIPIO, { origenes: ["paquete"] }),
    annotations: anotaciones(false),
    async ejecutar(args, { signal }) {
      const cvegeo = args.cvegeo as string;
      const r = await consultar(signal, () =>
        cliente.municipio(cvegeo, { fuente: "paquete", signal }),
      );
      const m = conEstado(r.data);
      const cabecera =
        m.cve_cabecera === null ? "sin cabecera en la fuente" : `cabecera ${m.cve_cabecera}`;
      return resultado([`${linea(m)} (municipio ${m.cve_mun}, ${cabecera})`], m, procedencia(r));
    },
  };
}
