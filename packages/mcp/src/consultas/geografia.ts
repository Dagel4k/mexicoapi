// Estados, municipios y alcaldías del catálogo de INEGI que trae el paquete: datos estables, sin
// red.
import type { Estado, Municipio } from "mexicoapi";
import { buscarMunicipio, estado, estados, meta, municipios } from "mexicoapi/datos";
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

/**
 * Un municipio en la lista de su estado: solo la clave y el nombre. cve_ent va en `estado`, cve_mun
 * son los últimos 3 dígitos de cvegeo y `municipio` da el registro completo; así el estado con más
 * municipios (570) cabe en el tope de resultado de los clientes.
 */
const MUNICIPIO_DE_ESTADO = {
  type: "object",
  properties: { cvegeo: { type: "string" }, nombre: { type: "string" } },
  required: ["cvegeo", "nombre"],
} as const;

const ESTADO = {
  type: "object",
  properties: {
    cve_ent: { type: "string", description: "Clave INEGI de 2 dígitos." },
    nombre: { type: "string" },
    abreviatura: { type: "string" },
    cvegeo: { type: "string" },
  },
  required: ["cve_ent", "nombre", "abreviatura", "cvegeo"],
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
        return resultadoError(
          "parametro-invalido",
          "El texto no tiene letras ni números para buscar.",
        );
      }
      if (cve_ent !== undefined && estado(cve_ent) === undefined) {
        return resultadoError("no-encontrado", `No existe el estado ${cve_ent}.`);
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

/** Minúsculas, sin acentos y con cualquier signo como un espacio: como busca buscarMunicipio. */
const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

type Resolucion = { estado: Estado } | { varios: readonly Estado[] } | { ninguno: true };

/**
 * El estado de un nombre: el de nombre o abreviatura iguales al texto (sin mayúsculas, acentos ni
 * signos) o, si no hay, el único cuyo nombre empieza con esas palabras ("coahuila" es "Coahuila de
 * Zaragoza"). "Estado de" al inicio no cuenta. Si el comienzo es de varios, los da todos.
 */
function resolverEstado(texto: string): Resolucion {
  const n = normalizar(texto);
  const buscado = n.startsWith("estado de ") ? n.slice("estado de ".length) : n;
  const todos = estados();
  const igual =
    todos.find((e) => normalizar(e.nombre) === buscado) ??
    todos.find((e) => normalizar(e.abreviatura) === buscado);
  if (igual !== undefined) return { estado: igual };
  const empiezan = todos.filter((e) => normalizar(e.nombre).startsWith(`${buscado} `));
  if (empiezan.length === 1) return { estado: empiezan[0] as Estado };
  return empiezan.length > 1 ? { varios: empiezan } : { ninguno: true };
}

export function estadosHerramienta(): Herramienta {
  return {
    name: "estados",
    title: "Estados",
    description:
      "Las 32 entidades federativas del catálogo de INEGI que trae el paquete, sin red: clave de 2 dígitos (cve_ent), nombre, abreviatura y cvegeo. Úsala para saber la clave de un estado, que piden municipios_de_estado y buscar_municipio.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: esquemaSalida({ type: "array", items: ESTADO }, { origenes: ["paquete"] }),
    annotations: anotaciones(false),
    async ejecutar() {
      const datos = estados();
      const lineas = [
        `${datos.length} entidades federativas (clave, nombre y abreviatura):`,
        ...datos.map((e) => `- ${e.cve_ent} ${aUnaLinea(e.nombre)} (${aUnaLinea(e.abreviatura)})`),
      ];
      return resultado(lineas, datos, procedencia({ meta: meta.estados, origen: "paquete" }));
    },
  };
}

export function municipiosDeEstadoHerramienta(): Herramienta {
  return {
    name: "municipios_de_estado",
    title: "Municipios de un estado",
    description:
      "Todos los municipios y alcaldías de un estado, con el total, del catálogo de INEGI que trae el paquete, sin red: de cada uno, su clave geoestadística (cvegeo) y su nombre; municipio da el registro completo. Úsala para preguntas como qué municipios tiene un estado o cuántos son: buscar_municipio solo da los que coinciden con un texto. Indica el estado con cve_ent (su clave de 2 dígitos) o con estado (su nombre o abreviatura, sin distinguir mayúsculas ni acentos), no con los dos. Si el nombre no es de un solo estado, responde con error; estados da los nombres y las claves.",
    inputSchema: {
      type: "object",
      properties: {
        cve_ent: {
          type: "string",
          pattern: "^[0-9]{2}$",
          description: "Clave INEGI del estado (2 dígitos).",
        },
        estado: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description: "Nombre o abreviatura del estado, como los da estados.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(
      { type: "array", items: MUNICIPIO_DE_ESTADO },
      {
        origenes: ["paquete"],
        extra: {
          estado: { ...ESTADO, description: "El estado consultado." },
          total: { type: "integer", description: "Municipios y alcaldías del estado." },
        },
      },
    ),
    annotations: anotaciones(false),
    async ejecutar(args) {
      const { cve_ent, estado: nombre } = args as { cve_ent?: string; estado?: string };
      if (cve_ent !== undefined && nombre !== undefined) {
        return resultadoError("parametro-invalido", "Indica solo uno de cve_ent o estado.");
      }
      let elegido: Estado | undefined;
      if (cve_ent !== undefined) {
        elegido = estado(cve_ent);
        if (elegido === undefined) {
          return resultadoError(
            "no-encontrado",
            `No existe el estado ${cve_ent}. La herramienta estados da las claves.`,
          );
        }
      } else if (nombre !== undefined) {
        if (!/[\p{L}\p{N}]/u.test(nombre)) {
          return resultadoError(
            "parametro-invalido",
            "El nombre del estado no tiene letras ni números.",
          );
        }
        const r = resolverEstado(nombre);
        const pedido = aUnaLinea(nombre).trim();
        if ("varios" in r) {
          const cuales = r.varios.map((e) => `${e.cve_ent} ${aUnaLinea(e.nombre)}`).join(", ");
          return resultadoError(
            "parametro-invalido",
            `"${pedido}" corresponde a más de un estado: ${cuales}. Indica cve_ent.`,
          );
        }
        if ("ninguno" in r) {
          return resultadoError(
            "no-encontrado",
            `Ningún estado se llama "${pedido}". La herramienta estados da los nombres y las claves.`,
          );
        }
        elegido = r.estado;
      } else {
        return resultadoError(
          "parametro-faltante",
          "Indica cve_ent (la clave de 2 dígitos) o estado (el nombre).",
        );
      }
      const datos = municipios(elegido.cve_ent).map(({ cvegeo, nombre }) => ({ cvegeo, nombre }));
      const total = datos.length;
      // Las demarcaciones de la Ciudad de México son alcaldías, no municipios.
      const que = elegido.cve_ent === "09" ? "alcaldías" : "municipios";
      const lineas = [
        `${aUnaLinea(elegido.nombre)} (cve_ent ${elegido.cve_ent}) tiene ${total} ${que}:`,
        ...datos.map((m) => `- ${m.cvegeo} ${aUnaLinea(m.nombre)}`),
      ];
      const p = procedencia({ meta: meta.municipios, origen: "paquete" });
      return resultado(lineas, datos, p, { extra: { estado: elegido, total } });
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
