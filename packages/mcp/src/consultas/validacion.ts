// Validadores de RFC, CURP y NSS del paquete: algoritmos que corren en el equipo, sin red y sin
// datos publicados (por eso su as_of es null). Aquí también va lo que comparten con la CLABE.
import {
  type CodigoError,
  type ResultadoValidacion,
  validarCurp,
  validarNss,
  validarRfc,
} from "mexicoapi";
import type { EsquemaJson } from "../esquema.js";
import { type Herramienta, resultadoError } from "../herramientas.js";
import {
  anotaciones,
  aUnaLinea,
  esquemaSalida,
  FUENTE_VALIDADORES,
  type Procedencia,
  resultado,
} from "../respuesta.js";

/** El resultado de un validador, con su `detalle` y los campos propios del validador. */
export function esquemaValidacion(
  detalle: EsquemaJson,
  propios: Readonly<Record<string, EsquemaJson>> = {},
): EsquemaJson {
  return {
    type: "object",
    properties: {
      valor: { type: "string", description: "El valor normalizado que se validó." },
      valido: { type: "boolean" },
      formato_valido: { type: "boolean" },
      digito_verificador_valido: { type: ["boolean", "null"] },
      ...propios,
      errores: { type: "array", items: { type: "string" } },
      nota: { type: "string" },
      detalle,
    },
    required: [
      "valor",
      "valido",
      "formato_valido",
      "digito_verificador_valido",
      ...Object.keys(propios),
      "errores",
      "nota",
      "detalle",
    ],
  };
}

const MOTIVOS: Readonly<Record<CodigoError, string>> = {
  vacio: "está vacío",
  longitud: "no tiene la longitud correcta",
  caracteres: "tiene caracteres no permitidos",
  estructura: "no tiene la estructura esperada",
  fecha: "la fecha no existe",
  entidad: "la clave de entidad no existe",
  banco: "el código de banco no está en el catálogo",
  digito_verificador: "el dígito verificador no coincide",
};

/** Los motivos de `errores` en palabras, separados por coma. */
export const motivos = (errores: readonly CodigoError[]): string =>
  errores.map((e) => MOTIVOS[e]).join(", ");

const PROCEDENCIA: Procedencia = {
  as_of: null,
  fuente: FUENTE_VALIDADORES,
  fuentes: [FUENTE_VALIDADORES],
  origen: "paquete",
  advertencias: [],
};

const SIN_FECHA = "no aplica (validación por algoritmo, sin datos publicados)";

interface Validador<D> {
  name: string;
  title: string;
  description: string;
  /** Nombre del argumento. */
  argumento: string;
  descripcionArgumento: string;
  /** Cómo se nombra en los textos: "El RFC", "La CURP". */
  articulo: "El" | "La";
  sigla: string;
  detalle: EsquemaJson;
  validar: (valor: string) => ResultadoValidacion<D>;
  /** Lo que sigue a "<sigla> válido" en el texto, con el detalle de un resultado válido. */
  valido: (detalle: D) => string;
}

function herramientaValidadora<D>(v: Validador<D>): Herramienta {
  const femenino = v.articulo === "La";
  return {
    name: v.name,
    title: v.title,
    description: v.description,
    inputSchema: {
      type: "object",
      properties: {
        [v.argumento]: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: v.descripcionArgumento,
        },
      },
      required: [v.argumento],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(esquemaValidacion(v.detalle), {
      origenes: ["paquete"],
      asOfNulo: true,
    }),
    annotations: anotaciones(false),
    async ejecutar(args) {
      const r = v.validar(args[v.argumento] as string);
      if (r.errores.includes("vacio")) {
        const vacio = `${v.articulo} ${v.sigla} está ${femenino ? "vacía" : "vacío"}.`;
        return resultadoError("parametro-invalido", vacio);
      }
      const lineas = r.valido
        ? [`${v.sigla} ${femenino ? "válida" : "válido"}${v.valido(r.detalle as D)}`]
        : [`${v.sigla} ${femenino ? "inválida" : "inválido"}: ${motivos(r.errores)}.`];
      if (r.valido && r.errores.includes("digito_verificador")) {
        lineas.push(
          `El dígito verificador no coincide; en el ${v.sigla} es informativo y no lo invalida.`,
        );
      }
      lineas.push(aUnaLinea(r.nota));
      return resultado(lineas, r, PROCEDENCIA, { sinFecha: SIN_FECHA });
    },
  };
}

const TIPOS_RFC = { fisica: "persona física", moral: "persona moral", generico: "genérico" };

export const validarRfcHerramienta = (): Herramienta =>
  herramientaValidadora({
    name: "validar_rfc",
    title: "Validar RFC",
    description:
      "Valida el formato de un RFC de persona física (13 caracteres) o moral (12): estructura, fecha y dígito verificador de la homoclave. El dígito verificador es informativo: si no coincide se reporta, pero el RFC no se marca inválido. Corre en el equipo, sin red; no consulta al SAT ni confirma que el RFC exista.",
    argumento: "rfc",
    descripcionArgumento: "El RFC; se ignoran mayúsculas, espacios y guiones.",
    articulo: "El",
    sigla: "RFC",
    detalle: {
      type: ["object", "null"],
      properties: {
        tipo: { type: "string", enum: ["fisica", "moral", "generico"] },
        fecha_yymmdd: { type: "string" },
        homoclave: { type: "string" },
      },
      required: ["tipo", "fecha_yymmdd", "homoclave"],
    },
    validar: validarRfc,
    valido: (d) =>
      `: ${TIPOS_RFC[d.tipo]}, fecha ${d.fecha_yymmdd} (AAMMDD), homoclave ${d.homoclave}.`,
  });

export const validarCurpHerramienta = (): Herramienta =>
  herramientaValidadora({
    name: "validar_curp",
    title: "Validar CURP",
    description:
      "Valida el formato de una CURP: estructura, fecha de nacimiento, sexo, entidad y dígito verificador. Corre en el equipo, sin red; no consulta a RENAPO ni confirma que la CURP exista.",
    argumento: "curp",
    descripcionArgumento: "La CURP de 18 caracteres; se ignoran mayúsculas, espacios y guiones.",
    articulo: "La",
    sigla: "CURP",
    detalle: {
      type: ["object", "null"],
      properties: {
        fecha: { type: "string" },
        sexo: { type: "string" },
        entidad: { type: "string" },
        nombre_entidad: { type: "string" },
        diferenciador: { type: "string" },
      },
      required: ["fecha", "sexo", "entidad", "nombre_entidad", "diferenciador"],
    },
    validar: validarCurp,
    valido: (d) =>
      `: nacimiento ${d.fecha}, sexo ${d.sexo}, entidad ${d.entidad} (${aUnaLinea(d.nombre_entidad)}).`,
  });

export const validarNssHerramienta = (): Herramienta =>
  herramientaValidadora({
    name: "validar_nss",
    title: "Validar NSS",
    description:
      "Valida un número de seguridad social del IMSS: 11 dígitos y dígito verificador (Luhn). Corre en el equipo, sin red; no consulta al IMSS ni confirma que el número exista.",
    argumento: "nss",
    descripcionArgumento: "El NSS de 11 dígitos; se ignoran espacios y guiones.",
    articulo: "El",
    sigla: "NSS",
    detalle: { type: "null" },
    validar: validarNss,
    valido: () => ".",
  });
