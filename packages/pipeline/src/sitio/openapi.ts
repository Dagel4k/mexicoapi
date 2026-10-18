import { z } from "zod";
import { esquemaBanco, esquemaEstado, esquemaMunicipio, esquemaPeriodoBanco } from "../esquemas.js";
import {
  esquemaDiaInhabil,
  esquemaEstadoDataset,
  esquemaFuenteMeta,
  esquemaIndice,
  esquemaMeta,
  esquemaProblema,
  esquemaResultadoClabe,
  esquemaResultadoDiasHabiles,
} from "./esquemas-api.js";
import { URL_DOCS } from "./meta.js";

type Json = Record<string, unknown>;

/** Tipos de problema que devuelve la API; el `type` es `<URL_PROBLEMAS>#<tipo>`. */
export const PROBLEMAS = {
  "parametro-invalido": { title: "Parámetro inválido", status: 400 },
  "parametro-desconocido": { title: "Parámetro desconocido", status: 400 },
  "parametro-faltante": { title: "Falta un parámetro obligatorio", status: 400 },
  "no-encontrado": { title: "Recurso no encontrado", status: 404 },
  "calendario-incompleto": { title: "Calendario incompleto", status: 422 },
  "metodo-no-permitido": { title: "Método no permitido", status: 405 },
  "demasiadas-peticiones": { title: "Demasiadas peticiones", status: 429 },
  "error-interno": { title: "Error interno", status: 500 },
} as const;

const URL_PROBLEMAS = `${URL_DOCS}/api/problemas.md`;

/**
 * Quita los `additionalProperties: false` que agrega `z.toJSONSchema`: el documento publica
 * esquemas abiertos para que un campo nuevo no rompa a los clientes generados. La prueba de
 * contrato valida contra una copia cerrada.
 */
function abrir(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(abrir);
  if (valor === null || typeof valor !== "object") return valor;
  const resultado: Json = {};
  for (const [clave, hijo] of Object.entries(valor)) {
    if (clave === "additionalProperties" && hijo === false) continue;
    resultado[clave] = abrir(hijo);
  }
  return resultado;
}

function jsonSchema(esquema: z.ZodType): Json {
  const { $schema: _omitido, ...resto } = z.toJSONSchema(esquema, {
    target: "draft-2020-12",
  }) as Json;
  return abrir(resto) as Json;
}

function esquemas(): Record<string, Json> {
  const banco = jsonSchema(esquemaBanco);
  const propiedades = banco.properties as Record<string, Json>;
  const historial = propiedades.historial as Json;
  propiedades.historial = { ...historial, items: ref("PeriodoBanco") };

  const problema = jsonSchema(esquemaProblema);
  const tipo = (problema.properties as Record<string, Json>).type as Json;
  const tipos = Object.entries(PROBLEMAS)
    .map(([nombre, p]) => `${nombre} (${p.status}, ${p.title})`)
    .join("; ");
  tipo.description = `URI del tipo de problema: ${URL_PROBLEMAS}#<tipo>. Tipos (status, título): ${tipos}.`;

  const sustituirFuente = (esquema: Json): Json => {
    const props = esquema.properties as Record<string, Json>;
    props.sources = { ...props.sources, items: ref("FuenteMeta") };
    return esquema;
  };

  return {
    Estado: jsonSchema(esquemaEstado),
    Municipio: jsonSchema(esquemaMunicipio),
    PeriodoBanco: jsonSchema(esquemaPeriodoBanco),
    Banco: banco,
    FuenteMeta: jsonSchema(esquemaFuenteMeta),
    Meta: sustituirFuente(jsonSchema(esquemaMeta)),
    Problema: problema,
    DiaInhabil: jsonSchema(esquemaDiaInhabil),
    ResultadoDiasHabiles: sustituirDias(jsonSchema(esquemaResultadoDiasHabiles)),
    ResultadoClabe: jsonSchema(esquemaResultadoClabe),
    EstadoDataset: jsonSchema(esquemaEstadoDataset),
    Indice: jsonSchema(esquemaIndice),
  };
}

function sustituirDias(esquema: Json): Json {
  const props = esquema.properties as Record<string, Json>;
  props.inhabiles_saltados = { ...props.inhabiles_saltados, items: ref("DiaInhabil") };
  return esquema;
}

const ref = (nombre: string): Json => ({ $ref: `#/components/schemas/${nombre}` });

/** Respuesta 200 de datos: `{ data, meta }`. */
function respuestaDatos(descripcion: string, data: Json): Json {
  return {
    description: descripcion,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", "meta"],
          properties: { data, meta: ref("Meta") },
        },
      },
    },
  };
}

const lista = (nombre: string): Json => ({ type: "array", items: ref(nombre) });

const refRespuesta = (nombre: string): Json => ({ $ref: `#/components/responses/${nombre}` });

function respuestaProblema(descripcion: string, headers?: Json): Json {
  const respuesta: Json = { description: descripcion };
  if (headers !== undefined) respuesta.headers = headers;
  respuesta.content = { "application/problem+json": { schema: ref("Problema") } };
  return respuesta;
}

const ETAG: Json = {
  description: "Versión del recurso; cambia cuando cambian los datos.",
  required: true,
  schema: { type: "string" },
};

const IF_NONE_MATCH: Json = {
  name: "If-None-Match",
  in: "header",
  required: false,
  description: "ETag de una respuesta anterior; si coincide, la respuesta es 304 sin cuerpo.",
  schema: { type: "string" },
};

const parametroRuta = (
  name: string,
  pattern: string,
  description: string,
  example: string,
): Json => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", pattern },
  example,
});

const AUTORIDAD: Json = {
  name: "autoridad",
  in: "query",
  required: true,
  description: "Autoridad cuyo calendario se usa. Por ahora solo lft.",
  schema: { type: "string", enum: ["lft"] },
  example: "lft",
};

const FECHA_EJEMPLO = "2026-01-05";

interface Operacion {
  ruta: string;
  operationId: string;
  summary: string;
  tag: string;
  parametros?: Json[];
  ok: Json;
  /** Errores propios de la ruta; los de ERRORES_COMUNES se agregan siempre. */
  errores: number[];
  /** Sirve un shard del build: lleva ETag y responde 304 a un If-None-Match que coincide. */
  shard?: boolean;
}

const CODIGOS: Record<number, string> = {
  400: "ParametroInvalido",
  404: "NoEncontrado",
  405: "MetodoNoPermitido",
  422: "CalendarioIncompleto",
  429: "DemasiadasPeticiones",
  500: "ErrorInterno",
};

/** Toda ruta valida su query: un parámetro que no declara es un 400, aunque no tenga ninguno. */
const ERRORES_COMUNES = [400, 405, 429, 500];

function operacion(o: Operacion): [string, Json] {
  const responses: Record<string, Json> = { "200": o.ok };
  let parametros = o.parametros;
  if (o.shard === true) {
    // El asset puede no traer ETag; la 304 siempre lo trae.
    responses["200"] = { ...o.ok, headers: { ETag: { ...ETAG, required: false } } };
    responses["304"] = refRespuesta("NoModificado");
    parametros = [...(parametros ?? []), IF_NONE_MATCH];
  }
  for (const codigo of [...o.errores, ...ERRORES_COMUNES].sort((a, b) => a - b)) {
    responses[String(codigo)] = refRespuesta(CODIGOS[codigo] as string);
  }
  const op: Json = { operationId: o.operationId, summary: o.summary, tags: [o.tag] };
  if (parametros !== undefined) op.parameters = parametros;
  op.responses = responses;
  return [o.ruta, { get: op }];
}

function operaciones(): Operacion[] {
  const cveEnt = parametroRuta(
    "cve_ent",
    "^\\d{2}$",
    "Clave de entidad de INEGI, 2 dígitos.",
    "09",
  );
  const cvegeo = parametroRuta(
    "cvegeo",
    "^\\d{5}$",
    "Clave geoestadística del municipio, 5 dígitos.",
    "09002",
  );
  const codigo = parametroRuta("codigo", "^\\d{3}$", "Código de banco, 3 dígitos.", "002");
  const clabe = parametroRuta("clabe", "^\\d{18}$", "CLABE de 18 dígitos.", "002010077777777771");
  const indice = respuestaDatosPlano("Datos de la API.", ref("Indice"));
  return [
    {
      ruta: "/",
      operationId: "indice",
      summary: "Índice de la API",
      tag: "General",
      ok: indice,
      errores: [],
    },
    {
      ruta: "/v1",
      operationId: "indiceV1",
      summary: "Índice de la versión 1",
      tag: "General",
      ok: indice,
      errores: [],
    },
    {
      ruta: "/v1/estados",
      operationId: "listarEstados",
      summary: "Lista los estados",
      tag: "Estados",
      ok: respuestaDatos("Los 32 estados.", lista("Estado")),
      errores: [],
      shard: true,
    },
    {
      ruta: "/v1/estados/{cve_ent}",
      operationId: "obtenerEstado",
      summary: "Obtiene un estado por su clave",
      tag: "Estados",
      parametros: [cveEnt],
      ok: respuestaDatos("El estado.", ref("Estado")),
      errores: [404],
      shard: true,
    },
    {
      ruta: "/v1/estados/{cve_ent}/municipios",
      operationId: "listarMunicipiosDeEstado",
      summary: "Lista los municipios de un estado",
      tag: "Municipios",
      parametros: [cveEnt],
      ok: respuestaDatos("Los municipios del estado.", lista("Municipio")),
      errores: [404],
      shard: true,
    },
    {
      ruta: "/v1/municipios",
      operationId: "listarMunicipios",
      summary: "Lista los municipios",
      tag: "Municipios",
      ok: respuestaDatos("Todos los municipios.", lista("Municipio")),
      errores: [],
      shard: true,
    },
    {
      ruta: "/v1/municipios/{cvegeo}",
      operationId: "obtenerMunicipio",
      summary: "Obtiene un municipio por su clave geoestadística",
      tag: "Municipios",
      parametros: [cvegeo],
      ok: respuestaDatos("El municipio.", ref("Municipio")),
      errores: [404],
      shard: true,
    },
    {
      ruta: "/v1/bancos",
      operationId: "listarBancos",
      summary: "Lista los bancos",
      tag: "Bancos",
      ok: respuestaDatos("Los bancos del catálogo.", lista("Banco")),
      errores: [],
      shard: true,
    },
    {
      ruta: "/v1/bancos/{codigo}",
      operationId: "obtenerBanco",
      summary: "Obtiene un banco por su código",
      tag: "Bancos",
      parametros: [codigo],
      ok: respuestaDatos("El banco.", ref("Banco")),
      errores: [404],
      shard: true,
    },
    {
      ruta: "/v1/clabe/{clabe}",
      operationId: "validarClabe",
      summary: "Valida una CLABE",
      tag: "Cálculos",
      parametros: [clabe],
      ok: respuestaDatos("Resultado de la validación.", ref("ResultadoClabe")),
      errores: [],
    },
    {
      ruta: "/v1/dias-habiles",
      operationId: "sumarDiasHabiles",
      summary: "Suma días hábiles a una fecha",
      tag: "Cálculos",
      parametros: [
        AUTORIDAD,
        {
          name: "desde",
          in: "query",
          required: true,
          description: "Fecha de partida (AAAA-MM-DD); no se cuenta.",
          schema: { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          example: FECHA_EJEMPLO,
        },
        {
          name: "dias",
          in: "query",
          required: true,
          description: "Días hábiles a sumar, de 1 a 3650.",
          schema: { type: "string", pattern: "^[1-9]\\d{0,3}$" },
          example: "10",
        },
        {
          name: "permitir_incompleto",
          in: "query",
          required: false,
          description:
            "Con true, un calendario que no cubre el periodo solo descuenta fines de semana y agrega una advertencia.",
          schema: { type: "string", enum: ["true", "false"] },
          example: "false",
        },
      ],
      ok: respuestaDatos("La fecha resultante.", ref("ResultadoDiasHabiles")),
      errores: [422],
    },
    {
      ruta: "/v1/dias-inhabiles",
      operationId: "listarDiasInhabiles",
      summary: "Lista los días inhábiles de un año",
      tag: "Cálculos",
      parametros: [
        AUTORIDAD,
        {
          name: "anio",
          in: "query",
          required: true,
          description: "Año de 0001 a 9999, 4 dígitos.",
          schema: { type: "string", pattern: "^\\d{4}$" },
          example: "2026",
        },
      ],
      ok: respuestaDatos("Los días inhábiles del año.", lista("DiaInhabil")),
      errores: [422],
    },
    {
      ruta: "/v1/status",
      operationId: "estadoDatasets",
      summary: "Estado y frescura de los datasets",
      tag: "General",
      ok: respuestaDatosPlano("Estado de cada dataset; no lleva meta.", {
        type: "object",
        required: ["data"],
        properties: { data: lista("EstadoDataset") },
      }),
      errores: [],
    },
    {
      ruta: "/v1/openapi.json",
      operationId: "openapi",
      summary: "Documento OpenAPI de la API",
      tag: "General",
      ok: {
        description: "Este documento.",
        content: { "application/json": { schema: { type: "object" } } },
      },
      errores: [],
      shard: true,
    },
  ];
}

/** Respuesta 200 sin `meta`: el índice es un objeto propio y status lleva solo `{ data }`. */
function respuestaDatosPlano(descripcion: string, schema: Json): Json {
  return { description: descripcion, content: { "application/json": { schema } } };
}

export function documentoOpenApi(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "MéxicoAPI",
      version: "1.0.0",
      summary: "Datos de referencia oficiales de México.",
      description:
        "API de solo lectura con catálogos oficiales de México (estados, municipios y bancos) y cálculos sobre ellos (validación de CLABE, días hábiles). Los datos conservan la licencia de su fuente: consulta meta.sources en cada respuesta.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "General", description: "Índice, estado y especificación." },
      { name: "Estados", description: "Catálogo de entidades de INEGI." },
      { name: "Municipios", description: "Catálogo de municipios de INEGI." },
      { name: "Bancos", description: "Catálogo de bancos del SPEI." },
      { name: "Cálculos", description: "Validaciones y cálculos sobre los datos." },
    ],
    paths: Object.fromEntries(operaciones().map(operacion)),
    components: {
      schemas: esquemas(),
      responses: {
        ParametroInvalido: respuestaProblema(
          "Un parámetro es inválido, desconocido o falta (tipos parametro-invalido, parametro-desconocido y parametro-faltante). Toda ruta rechaza los parámetros de consulta que no declara.",
        ),
        NoModificado: {
          description: "El If-None-Match coincide con el ETag actual: la respuesta no trae cuerpo.",
          headers: { ETag: ETAG },
        },
        NoEncontrado: respuestaProblema("El recurso o la ruta no existe."),
        MetodoNoPermitido: respuestaProblema("Métodos permitidos: GET, HEAD y OPTIONS.", {
          Allow: {
            description: "Métodos que acepta la API.",
            required: true,
            schema: { type: "string" },
            example: "GET, HEAD, OPTIONS",
          },
        }),
        CalendarioIncompleto: respuestaProblema(
          "El calendario no cubre el periodo pedido; la extensión cobertura indica el rango.",
        ),
        DemasiadasPeticiones: respuestaProblema("Se superó el límite de peticiones.", {
          "Retry-After": {
            description: "Segundos que conviene esperar antes de reintentar.",
            required: true,
            schema: { type: "integer", minimum: 0 },
            example: 60,
          },
        }),
        ErrorInterno: respuestaProblema("Error interno."),
      },
    },
  };
}
