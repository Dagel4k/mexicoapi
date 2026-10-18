import { z } from "zod";
import {
  esquemaBanco,
  esquemaEstado,
  esquemaMunicipio,
  esquemaPeriodoBanco,
  esquemaTipoCambioFix,
  esquemaUdi,
} from "../esquemas.js";
import {
  esquemaDiaInhabil,
  esquemaEstadoDataset,
  esquemaFixOperacion,
  esquemaFuente,
  esquemaFuenteDof,
  esquemaFuenteMeta,
  esquemaIndice,
  esquemaMeta,
  esquemaProblema,
  esquemaResultadoClabe,
  esquemaResultadoDiasHabiles,
  esquemaSalarioMinimo,
  esquemaTarifaIsr,
  esquemaTramoIsr,
  esquemaUma,
} from "./esquemas-api.js";
import { URL_DOCS } from "./meta.js";

type Json = Record<string, unknown>;

/** Tipos de problema que devuelve la API; el `type` es `<URL_PROBLEMAS>#<tipo>`. */
export const PROBLEMAS = {
  "parametro-invalido": { title: "Parámetro inválido", status: 400 },
  "parametro-desconocido": { title: "Parámetro desconocido", status: 400 },
  "parametro-faltante": { title: "Falta un parámetro obligatorio", status: 400 },
  "no-encontrado": { title: "Recurso no encontrado", status: 404 },
  "dato-no-disponible": { title: "Dato todavía no disponible", status: 404 },
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
    Fuente: jsonSchema(esquemaFuente),
    DiaInhabil: conFuente(jsonSchema(esquemaDiaInhabil), "fuente"),
    ResultadoDiasHabiles: sustituirDias(jsonSchema(esquemaResultadoDiasHabiles)),
    ResultadoClabe: jsonSchema(esquemaResultadoClabe),
    TipoCambioFix: jsonSchema(esquemaTipoCambioFix),
    FixOperacion: conFuente(jsonSchema(esquemaFixOperacion), "fundamento"),
    Udi: jsonSchema(esquemaUdi),
    FuenteDof: jsonSchema(esquemaFuenteDof),
    Uma: conRef(jsonSchema(esquemaUma), "fuente", "FuenteDof"),
    SalarioMinimo: conRef(jsonSchema(esquemaSalarioMinimo), "fuente", "FuenteDof"),
    TramoIsr: jsonSchema(esquemaTramoIsr),
    TarifaIsr: tarifaIsr(),
    EstadoDataset: jsonSchema(esquemaEstadoDataset),
    Indice: jsonSchema(esquemaIndice),
  };
}

/** Cambia el esquema en línea de `propiedad` por una referencia; conserva su descripción. */
function conRef(esquema: Json, propiedad: string, nombre: string): Json {
  const props = esquema.properties as Record<string, Json>;
  props[propiedad] = { description: props[propiedad]?.description, ...ref(nombre) };
  return esquema;
}

const conFuente = (esquema: Json, propiedad: string): Json => conRef(esquema, propiedad, "Fuente");

function tarifaIsr(): Json {
  const tarifa = conRef(jsonSchema(esquemaTarifaIsr), "fuente", "FuenteDof");
  const props = tarifa.properties as Record<string, Json>;
  props.tramos = { ...props.tramos, items: ref("TramoIsr") };
  return tarifa;
}

function sustituirDias(esquema: Json): Json {
  const props = esquema.properties as Record<string, Json>;
  props.inhabiles_saltados = { ...props.inhabiles_saltados, items: ref("DiaInhabil") };
  return esquema;
}

const ref = (nombre: string): Json => ({ $ref: `#/components/schemas/${nombre}` });

/** Respuesta 200 de datos: `{ data, meta }`, con `extra` (obligatorios) entre los dos. */
function respuestaDatos(descripcion: string, data: Json, extra: Record<string, Json> = {}): Json {
  return {
    description: descripcion,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", ...Object.keys(extra), "meta"],
          properties: { data, ...extra, meta: ref("Meta") },
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

const FECHA_EJEMPLO = "2026-01-05";

const parametroFecha = (name: string, required: boolean, description: string): Json => ({
  name,
  in: "query",
  required,
  description,
  schema: { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  example: FECHA_EJEMPLO,
});

const AUTORIDAD: Json = {
  name: "autoridad",
  in: "query",
  required: true,
  description:
    "Autoridad cuyo calendario se usa. lft: sábados, domingos y días de descanso obligatorio del art. 74 de la Ley Federal del Trabajo; no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715), y cada respuesta lo advierte. cnbv: calendario bancario, los días en que cierran las entidades supervisadas por la CNBV; no es el calendario de la CNBV como autoridad. sat: días del art. 12 del CFF, calculados por regla, y vacaciones de la regla 2.1.6 de la RMF.",
  schema: { type: "string", enum: ["lft", "cnbv", "sat"] },
  example: "lft",
};

const TIPO_PLAZO: Json = {
  name: "tipo_plazo",
  in: "query",
  required: false,
  description:
    "Obligatorio con autoridad=sat y no se acepta con las demás. general cuenta las vacaciones generales del SAT como inhábiles; declaraciones_pagos no, porque en los plazos para presentar declaraciones y pagar contribuciones las vacaciones no son inhábiles (CFF art. 12, segundo párrafo).",
  schema: { type: "string", enum: ["general", "declaraciones_pagos"] },
  example: "general",
};

interface Operacion {
  ruta: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  parametros?: Json[];
  ok: Json;
  /** Errores propios de la ruta; los de ERRORES_COMUNES se agregan siempre. */
  errores: number[];
  /** Respuesta de componentes para un código, en lugar de la de CODIGOS. */
  respuestas?: Partial<Record<number, string>>;
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
    responses[String(codigo)] = refRespuesta(o.respuestas?.[codigo] ?? (CODIGOS[codigo] as string));
  }
  const op: Json = { operationId: o.operationId, summary: o.summary };
  if (o.description !== undefined) op.description = o.description;
  op.tags = [o.tag];
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
  const anio = parametroRuta("anio", "^\\d{4}$", "Año, 4 dígitos.", "2026");
  const indice = respuestaDatosPlano("Datos de la API.", ref("Indice"));
  return [
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
      description:
        "Con autoridad=sat, tipo_plazo es obligatorio: sin él la respuesta es 400 parametro-faltante. Con lft o cnbv, tipo_plazo no se acepta (400). Si el cálculo sale de la cobertura del calendario, la respuesta es 422 calendario-incompleto, salvo con permitir_incompleto=true. El resultado es el último día del cómputo y no aplica la prórroga del quinto párrafo del art. 12 del CFF: con tipo_plazo=declaraciones_pagos, si cae en viernes, en vacaciones del SAT o en un cierre bancario, advertencias lo dice. Con lft, advertencias siempre dice que no se descuentan los festivos ni las suspensiones de labores del art. 715.",
      tag: "Cálculos",
      parametros: [
        AUTORIDAD,
        TIPO_PLAZO,
        parametroFecha(
          "desde",
          true,
          "Fecha de partida (AAAA-MM-DD); no se cuenta. En un plazo que corre desde una notificación es el día en que surte efectos, no el día en que se hizo: si una notificación del lunes surte efectos el martes, desde es el martes.",
        ),
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
            "Con true, el cálculo sigue fuera de la cobertura del calendario con lo que está publicado: descuenta los días inhábiles publicados (por ejemplo, los días del art. 12 del CFF después del último periodo de vacaciones del SAT capturado) y los fines de semana, y agrega una advertencia por cada tramo incompleto. Donde no hay nada publicado solo descuenta los fines de semana, y la advertencia dice qué puede faltar (con cnbv, días de cierre bancario como el 1 de enero; con sat, antes de 2026 o después de 2100, días del art. 12 del CFF).",
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
      description:
        "Lista los días inhábiles del año, sin los fines de semana, cada uno con su tipo y su fuente. Si la lista solo está completa para algunos tipos de plazo, la respuesta lo dice en advertencias. Es el caso del SAT desde diciembre de 2026 mientras no se publique su segundo periodo de vacaciones: los días del art. 12 del CFF se calculan por regla hasta 2100 y la lista está completa para tipo_plazo=declaraciones_pagos, que no cuenta las vacaciones, pero no para general. Con lft, advertencias dice que la lista no tiene los festivos ni las suspensiones de labores del art. 715. Un año fuera de la cobertura del calendario da 422 calendario-incompleto.",
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
      ok: respuestaDatos("Los días inhábiles del año.", lista("DiaInhabil"), {
        advertencias: {
          type: "array",
          items: { type: "string" },
          description:
            "Avisos sobre lo que puede faltar en la lista, como días de un tipo que solo están completos en parte del año y los tipo_plazo para los que la lista sí está completa, los días de la transmisión del Poder Ejecutivo que el SAT no descuenta o, con lft, los festivos y las suspensiones de labores del art. 715. Vacía si la lista está completa.",
        },
      }),
      errores: [422],
    },
    {
      ruta: "/v1/tipo-cambio/fix",
      operationId: "consultarFix",
      summary: "Tipo de cambio FIX por fecha de publicación o para una operación",
      description:
        "Indica exactamente uno de publicado u operacion: sin ninguno la respuesta es 400 parametro-faltante y con los dos, 400 parametro-invalido.",
      tag: "Indicadores",
      parametros: [
        parametroFecha(
          "publicado",
          false,
          "Fecha de publicación en el DOF (AAAA-MM-DD): responde el FIX publicado ese día.",
        ),
        parametroFecha(
          "operacion",
          false,
          "Fecha de una operación (AAAA-MM-DD): responde el último FIX publicado en el DOF antes de ese día y su fundamento (CFF art. 20).",
        ),
      ],
      ok: respuestaDatos(
        "Con publicado, el FIX de ese día (TipoCambioFix); con operacion, el FIX que aplica (FixOperacion).",
        // anyOf: con esquemas abiertos, una FixOperacion también cumple TipoCambioFix.
        { anyOf: [ref("TipoCambioFix"), ref("FixOperacion")] },
      ),
      errores: [404],
      respuestas: { 404: "SinDato" },
    },
    {
      ruta: "/v1/tipo-cambio/fix/ultimo",
      operationId: "ultimoFix",
      summary: "Último tipo de cambio FIX publicado",
      tag: "Indicadores",
      ok: respuestaDatos("La publicación más reciente de la serie.", ref("TipoCambioFix")),
      errores: [],
    },
    {
      ruta: "/v1/udis",
      operationId: "consultarUdi",
      summary: "Valor de la UDI en una fecha",
      tag: "Indicadores",
      parametros: [parametroFecha("fecha", true, "Día del valor (AAAA-MM-DD).")],
      ok: respuestaDatos("El valor de la UDI ese día.", ref("Udi")),
      errores: [404],
      respuestas: { 404: "SinDato" },
    },
    {
      ruta: "/v1/constantes/uma",
      operationId: "consultarUma",
      summary: "UMA vigente en una fecha",
      description:
        "Cada UMA rige del 1 de febrero de su año al 31 de enero del siguiente: en enero aplica la del año anterior.",
      tag: "Constantes",
      parametros: [parametroFecha("fecha", true, "Día que se consulta (AAAA-MM-DD).")],
      ok: respuestaDatos("La UMA vigente ese día.", ref("Uma")),
      errores: [404],
      respuestas: { 404: "SinDato" },
    },
    {
      ruta: "/v1/constantes/uma/{anio}",
      operationId: "obtenerUma",
      summary: "UMA de un año",
      tag: "Constantes",
      parametros: [anio],
      ok: respuestaDatos(
        "La UMA del año, vigente del 1 de febrero de ese año al 31 de enero del siguiente.",
        ref("Uma"),
      ),
      errores: [404],
      respuestas: { 404: "SinAnio" },
      shard: true,
    },
    {
      ruta: "/v1/constantes/salario-minimo/{anio}",
      operationId: "obtenerSalarioMinimo",
      summary: "Salario mínimo de un año",
      tag: "Constantes",
      parametros: [anio],
      ok: respuestaDatos(
        "El salario mínimo diario del año en sus dos zonas: general y zlfn.",
        lista("SalarioMinimo"),
      ),
      errores: [404],
      respuestas: { 404: "SinAnio" },
      shard: true,
    },
    {
      ruta: "/v1/isr/tarifa/{periodo}/{anio}",
      operationId: "obtenerTarifaIsr",
      summary: "Tarifa de ISR de un periodo y un año",
      tag: "Constantes",
      parametros: [
        {
          name: "periodo",
          in: "path",
          required: true,
          description: "Periodo de la tarifa: mensual (pagos provisionales) o anual (ejercicio).",
          schema: { type: "string", enum: ["mensual", "anual"] },
          example: "mensual",
        },
        anio,
      ],
      ok: respuestaDatos("La tarifa con sus tramos.", ref("TarifaIsr")),
      errores: [404],
      respuestas: { 404: "SinAnio" },
      shard: true,
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
        "API de solo lectura con catálogos oficiales de México (estados, municipios y bancos), indicadores publicados en el DOF (tipo de cambio FIX y UDIS), constantes publicadas en el DOF (UMA, salario mínimo y tarifas de ISR) y cálculos sobre ellos (validación de CLABE, días hábiles). Los datos conservan la licencia de su fuente: consulta meta.sources en cada respuesta.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "General", description: "Índice, estado y especificación." },
      { name: "Estados", description: "Catálogo de entidades de INEGI." },
      { name: "Municipios", description: "Catálogo de municipios de INEGI." },
      { name: "Bancos", description: "Catálogo de bancos del SPEI." },
      { name: "Indicadores", description: "Tipo de cambio FIX y UDIS publicados en el DOF." },
      {
        name: "Constantes",
        description: "UMA, salario mínimo y tarifas de ISR publicados en el DOF.",
      },
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
        SinDato: respuestaProblema(
          "No hay dato para la fecha pedida. El tipo no-encontrado es definitivo: ese día no hubo publicación o la fecha es anterior al inicio de la serie. El tipo dato-no-disponible puede cambiar: todavía no se cargan los datos necesarios para responder con certeza, y se puede reintentar después de la siguiente actualización.",
        ),
        SinAnio: respuestaProblema(
          "No hay datos del año pedido. El tipo no-encontrado es definitivo: el año es anterior a los datos cargados o no tiene publicación. El tipo dato-no-disponible puede cambiar: el año es posterior al último cargado, y se puede reintentar cuando se carguen sus valores.",
        ),
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
