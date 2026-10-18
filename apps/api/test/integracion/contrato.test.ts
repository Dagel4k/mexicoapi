import { readFile } from "node:fs/promises";
import { sumarDias } from "@mexicoapi/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { PROBLEMAS } from "../../src/problemas.js";
import { BASE_PROBLEMAS, PUBLICO, pedir, tipoDeMedio } from "./ayudas.js";

interface Parametro {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  example?: string;
  schema: { pattern?: string; enum?: string[] };
}

interface Respuesta {
  $ref?: string;
  headers?: Record<string, { required?: boolean }>;
  content?: Record<string, { schema: unknown }>;
}

interface Operacion {
  operationId: string;
  parameters?: Parametro[];
  responses: Record<string, Respuesta>;
}

interface Documento {
  paths: Record<string, Record<string, Operacion>>;
  [clave: string]: unknown;
}

/** Una operación del documento: su ruta (plantilla), su método y su objeto. */
interface OperacionDoc {
  ruta: string;
  metodo: string;
  op: Operacion;
}

const texto = await readFile(new URL("v1/openapi.json", PUBLICO), "utf8");
const doc = JSON.parse(texto) as Documento;

const OPERACIONES: OperacionDoc[] = Object.entries(doc.paths).flatMap(([ruta, item]) =>
  Object.entries(item).map(([metodo, op]) => ({ ruta, metodo, op })),
);

/**
 * Copia cerrada del documento: a todo objeto con `properties` y sin `additionalProperties` le
 * pone `false`. El documento publica esquemas abiertos (un campo nuevo no rompe a los clientes);
 * aquí el Worker no puede mandar nada que el documento no declare.
 */
function cerrar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(cerrar);
  if (valor === null || typeof valor !== "object") return valor;
  const copia: Record<string, unknown> = {};
  for (const [clave, hijo] of Object.entries(valor)) copia[clave] = cerrar(hijo);
  if ("properties" in copia && !("additionalProperties" in copia)) {
    copia.additionalProperties = false;
  }
  return copia;
}

// `validateFormats: false`: los instantes declaran `format: date-time` y además un `pattern`
// que sí se valida.
const nuevoAjv = () => new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const ajv = nuevoAjv();
ajv.addSchema(cerrar(doc) as object, "openapi");

/** Puntero JSON (RFC 6901) dentro del documento, escapado para ir en el fragmento de la URI. */
const puntero = (...partes: string[]): string =>
  `openapi#/${partes
    .map((p) => encodeURIComponent(p.replaceAll("~", "~0").replaceAll("/", "~1")))
    .join("/")}`;

const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `/v1/estados/{cve_ent}` → `^/v1/estados/[^/]+$`. */
function plantilla(ruta: string): RegExp {
  const partes = ruta.split(/\{[^}]+\}/).map(escaparRegex);
  return new RegExp(`^${partes.join("[^/]+")}$`);
}

/** La única operación del documento cuya plantilla coincide con la ruta pedida. */
function operacionDe(ruta: string): OperacionDoc {
  const camino = new URL(ruta, "http://local").pathname;
  const candidatas = OPERACIONES.filter((o) => plantilla(o.ruta).test(camino));
  if (candidatas.length !== 1) {
    throw new Error(`${camino} coincide con ${candidatas.length} operaciones del documento.`);
  }
  return candidatas[0] as OperacionDoc;
}

/** Puntero a la respuesta que el documento declara para `estado`, siguiendo un `$ref`. */
function respuestaDeclarada(
  o: OperacionDoc,
  estado: number,
): { base: string[]; respuesta: Respuesta } | undefined {
  const declarada = o.op.responses[String(estado)];
  if (declarada === undefined) return undefined;
  if (declarada.$ref === undefined) {
    return { base: ["paths", o.ruta, o.metodo, "responses", String(estado)], respuesta: declarada };
  }
  const base = declarada.$ref.replace(/^#\//, "").split("/");
  const respuesta = base.reduce<unknown>(
    (nodo, parte) => (nodo as Record<string, unknown>)[parte],
    doc,
  ) as Respuesta;
  return { base, respuesta };
}

/** CLABE con su dígito de control (pesos 3, 7, 1). */
function conDigito(base: string): string {
  const pesos = [3, 7, 1];
  const suma = [...base].reduce((s, d, i) => s + ((Number(d) * (pesos[i % 3] ?? 0)) % 10), 0);
  return `${base}${(10 - (suma % 10)) % 10}`;
}

interface Caso {
  ruta: string;
  estado: number;
  metodo?: string;
}

/**
 * Hasta dónde cubre cada plazo de un calendario curado, del calendario que usa el Worker: los
 * casos del borde se arman con ella y no con la cobertura de hoy.
 */
async function hastaDonde(
  autoridad: string,
  tipo: string,
): Promise<{ desde: string; hasta: string }> {
  const texto = await readFile(
    new URL(`v1/_internos/calendarios/${autoridad}.json`, PUBLICO),
    "utf8",
  );
  const { plazos } = JSON.parse(texto) as {
    plazos: Record<string, { cobertura: { desde: string; hasta: string } }>;
  };
  const plazo = plazos[tipo];
  if (plazo === undefined) throw new Error(`${autoridad} no tiene el plazo ${tipo}.`);
  return plazo.cobertura;
}

const SAT_GENERAL = await hastaDonde("sat", "general");
const SAT_DECLARACIONES = await hastaDonde("sat", "declaraciones_pagos");
const CNBV = await hastaDonde("cnbv", "general");
const anioDe = (fecha: string): string => fecha.slice(0, 4);

/** Peticiones por operación; cada estado practicable que declara una operación tiene al menos una. */
const CASOS: Caso[] = [
  { ruta: "/", estado: 200 },
  { ruta: "/?formato=csv", estado: 400 },
  { ruta: "/?&", estado: 400 },

  { ruta: "/v1", estado: 200 },
  { ruta: "/v1?version=2", estado: 400 },

  { ruta: "/v1/estados", estado: 200 },
  { ruta: "/v1/estados?nombre=Sinaloa", estado: 400 },

  { ruta: "/v1/estados/25", estado: 200 },
  { ruta: "/v1/estados/01", estado: 200 },
  { ruta: "/v1/estados/5", estado: 400 },
  { ruta: "/v1/estados/250", estado: 400 },
  { ruta: "/v1/estados/sinaloa", estado: 400 },
  { ruta: "/v1/estados/25?campos=nombre", estado: 400 },
  { ruta: "/v1/estados/33", estado: 404 },
  { ruta: "/v1/estados/00", estado: 404 },

  { ruta: "/v1/estados/25/municipios", estado: 200 },
  { ruta: "/v1/estados/2/municipios", estado: 400 },
  { ruta: "/v1/estados/25/municipios?pagina=2", estado: 400 },
  { ruta: "/v1/estados/33/municipios", estado: 404 },

  { ruta: "/v1/municipios", estado: 200 },
  { ruta: "/v1/municipios?cve_ent=25", estado: 400 },

  { ruta: "/v1/municipios/25006", estado: 200 },
  { ruta: "/v1/municipios/2500", estado: 400 },
  { ruta: "/v1/municipios/25999", estado: 404 },

  { ruta: "/v1/bancos", estado: 200 },
  { ruta: "/v1/bancos?activo=true", estado: 400 },

  { ruta: "/v1/bancos/012", estado: 200 },
  { ruta: "/v1/bancos/12", estado: 400 },
  { ruta: "/v1/bancos/999", estado: 404 },

  { ruta: "/v1/clabe/002010077777777771", estado: 200 },
  { ruta: "/v1/clabe/002010077777777770", estado: 200 },
  { ruta: `/v1/clabe/${conDigito("99999900000000000")}`, estado: 200 },
  { ruta: "/v1/clabe/12345", estado: 400 },
  { ruta: "/v1/clabe/00201007777777777A", estado: 400 },

  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-01-30&dias=1", estado: 200 },
  {
    ruta: "/v1/dias-habiles?autoridad=lft&desde=2100-12-20&dias=30&permitir_incompleto=true",
    estado: 200,
  },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-01-05", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=sat&desde=2026-01-05&dias=10", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-02-30&dias=10", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-01-05&dias=0", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-01-05&dias=10&dias=11", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2026-01-05&dias=10&zona=mx", estado: 400 },
  {
    ruta: "/v1/dias-habiles?autoridad=lft&desde=9999-12-01&dias=3650&permitir_incompleto=true",
    estado: 400,
  },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2100-12-20&dias=30", estado: 422 },
  { ruta: "/v1/dias-habiles?autoridad=lft&desde=2006-12-29&dias=1", estado: 422 },
  // CNBV y SAT: el 2 de noviembre bancario, el primer periodo de vacaciones del SAT con los dos
  // tipos de plazo, y el fin de cada cobertura.
  { ruta: "/v1/dias-habiles?autoridad=cnbv&desde=2026-10-30&dias=1", estado: 200 },
  {
    ruta: "/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-15&dias=10",
    estado: 200,
  },
  {
    ruta: "/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-07-15&dias=10",
    estado: 200,
  },
  {
    ruta: `/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=${SAT_GENERAL.hasta}&dias=2&permitir_incompleto=true`,
    estado: 200,
  },
  {
    ruta: `/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=${SAT_DECLARACIONES.hasta}&dias=5&permitir_incompleto=true`,
    estado: 200,
  },
  { ruta: "/v1/dias-habiles?autoridad=cnbv&desde=2026-12-11&dias=1", estado: 200 },
  {
    ruta: "/v1/dias-habiles?autoridad=lft&tipo_plazo=general&desde=2026-01-05&dias=10",
    estado: 400,
  },
  { ruta: "/v1/dias-habiles?autoridad=sat&tipo_plazo=anual&desde=2026-01-05&dias=10", estado: 400 },
  { ruta: "/v1/dias-habiles?autoridad=banxico&desde=2026-01-05&dias=10", estado: 400 },
  {
    ruta: `/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=${SAT_GENERAL.hasta}&dias=1`,
    estado: 422,
  },
  {
    ruta: `/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=${SAT_DECLARACIONES.hasta}&dias=1`,
    estado: 422,
  },
  { ruta: `/v1/dias-habiles?autoridad=cnbv&desde=${CNBV.hasta}&dias=1`, estado: 422 },

  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=2026", estado: 200 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=2030", estado: 200 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft", estado: 400 },
  { ruta: "/v1/dias-inhabiles?anio=2026", estado: 400 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=26", estado: 400 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=0000", estado: 400 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=2006", estado: 422 },
  { ruta: "/v1/dias-inhabiles?autoridad=lft&anio=2101", estado: 422 },
  { ruta: "/v1/dias-inhabiles?autoridad=cnbv&anio=2025", estado: 200 },
  // La lista publicada, con la advertencia si faltan vacaciones; los años junto a cada cobertura.
  { ruta: "/v1/dias-inhabiles?autoridad=sat&anio=2026", estado: 200 },
  { ruta: "/v1/dias-inhabiles?autoridad=sat&anio=2026&tipo_plazo=general", estado: 400 },
  {
    ruta: `/v1/dias-inhabiles?autoridad=sat&anio=${anioDe(sumarDias(SAT_DECLARACIONES.hasta, 1))}`,
    estado: 422,
  },
  {
    ruta: `/v1/dias-inhabiles?autoridad=cnbv&anio=${anioDe(sumarDias(CNBV.desde, -1))}`,
    estado: 422,
  },

  // Lunes tras un viernes con publicación; cambio de año (sin publicación en 2021 antes del 4).
  { ruta: "/v1/tipo-cambio/fix?publicado=2026-10-16", estado: 200 },
  { ruta: "/v1/tipo-cambio/fix?operacion=2026-10-19", estado: 200 },
  { ruta: "/v1/tipo-cambio/fix?operacion=2021-01-04", estado: 200 },
  { ruta: "/v1/tipo-cambio/fix", estado: 400 },
  { ruta: "/v1/tipo-cambio/fix?publicado=2026-10-16&operacion=2026-10-19", estado: 400 },
  { ruta: "/v1/tipo-cambio/fix?publicado=2026-02-30", estado: 400 },
  { ruta: "/v1/tipo-cambio/fix?operacion=19-10-2026", estado: 400 },
  { ruta: "/v1/tipo-cambio/fix?fecha=2026-10-16", estado: 400 },
  // Sábado, feriado bancario, antes de la serie, y fechas que todavía no se cargan.
  { ruta: "/v1/tipo-cambio/fix?publicado=2026-10-10", estado: 404 },
  { ruta: "/v1/tipo-cambio/fix?publicado=2021-01-01", estado: 404 },
  { ruta: "/v1/tipo-cambio/fix?publicado=2019-12-31", estado: 404 },
  { ruta: "/v1/tipo-cambio/fix?operacion=2020-01-02", estado: 404 },
  { ruta: "/v1/tipo-cambio/fix?publicado=2099-01-02", estado: 404 },
  { ruta: "/v1/tipo-cambio/fix?operacion=2099-01-06", estado: 404 },

  { ruta: "/v1/tipo-cambio/fix/ultimo", estado: 200 },
  { ruta: "/v1/tipo-cambio/fix/ultimo?fecha=2026-10-16", estado: 400 },

  { ruta: "/v1/udis?fecha=2026-01-05", estado: 200 },
  { ruta: "/v1/udis?fecha=2021-01-01", estado: 200 },
  { ruta: "/v1/udis", estado: 400 },
  { ruta: "/v1/udis?fecha=2026-13-01", estado: 400 },
  { ruta: "/v1/udis?fecha=2019-12-31", estado: 404 },
  { ruta: "/v1/udis?fecha=2099-01-01", estado: 404 },

  // En enero rige la UMA del año anterior.
  { ruta: "/v1/constantes/uma?fecha=2026-01-31", estado: 200 },
  { ruta: "/v1/constantes/uma?fecha=2026-02-01", estado: 200 },
  { ruta: "/v1/constantes/uma", estado: 400 },
  { ruta: "/v1/constantes/uma?fecha=2026-02-30", estado: 400 },
  { ruta: "/v1/constantes/uma?fecha=2017-01-31", estado: 404 },
  { ruta: "/v1/constantes/uma?fecha=2099-02-01", estado: 404 },

  { ruta: "/v1/constantes/uma/2017", estado: 200 },
  { ruta: "/v1/constantes/uma/2026", estado: 200 },
  { ruta: "/v1/constantes/uma/26", estado: 400 },
  { ruta: "/v1/constantes/uma/2026?campos=diaria", estado: 400 },
  { ruta: "/v1/constantes/uma/2016", estado: 404 },
  { ruta: "/v1/constantes/uma/2099", estado: 404 },

  { ruta: "/v1/constantes/salario-minimo/2019", estado: 200 },
  { ruta: "/v1/constantes/salario-minimo/0000", estado: 400 },
  { ruta: "/v1/constantes/salario-minimo/2018", estado: 404 },
  { ruta: "/v1/constantes/salario-minimo/2099", estado: 404 },

  { ruta: "/v1/isr/tarifa/mensual/2026", estado: 200 },
  { ruta: "/v1/isr/tarifa/anual/2025", estado: 200 },
  { ruta: "/v1/isr/tarifa/anual/2026", estado: 200 },
  { ruta: "/v1/isr/tarifa/semanal/2026", estado: 400 },
  { ruta: "/v1/isr/tarifa/mensual/26", estado: 400 },
  { ruta: "/v1/isr/tarifa/mensual/2025", estado: 404 },
  { ruta: "/v1/isr/tarifa/anual/2099", estado: 404 },

  { ruta: "/v1/status", estado: 200 },
  { ruta: "/v1/status?dataset=bancos", estado: 400 },

  { ruta: "/v1/openapi.json", estado: 200 },
  { ruta: "/v1/openapi.json?v=1", estado: 400 },
];

/** 429 pide el binding de límite y 500 un asset roto; ninguno se provoca en local. */
const PRACTICABLES = [200, 400, 404, 422];

/**
 * Ejemplos de las operaciones que no se arman con sus parámetros obligatorios: `consultarFix`
 * pide exactamente uno de publicado u operacion, y ninguno es obligatorio.
 */
const EJEMPLOS: Readonly<Record<string, readonly string[]>> = {
  consultarFix: [
    "/v1/tipo-cambio/fix?publicado=2026-10-16",
    "/v1/tipo-cambio/fix?operacion=2026-10-19",
  ],
};

/** Rutas de ejemplo de una operación: las explícitas, o la armada con sus obligatorios. */
function ejemplos(ruta: string, op: Operacion): readonly string[] {
  return EJEMPLOS[op.operationId] ?? [armarEjemplo(ruta, op)];
}

function ejemplo(ruta: string, op: Operacion): string {
  return ejemplos(ruta, op)[0] as string;
}

/** Ruta de ejemplo de una operación, armada con los `example` de sus parámetros obligatorios. */
function armarEjemplo(ruta: string, op: Operacion): string {
  const valor = (p: Parametro | undefined, nombre: string): string => {
    if (p?.example === undefined) throw new Error(`${ruta}: ${nombre} no tiene example.`);
    return p.example;
  };
  const parametros = op.parameters ?? [];
  const camino = ruta.replace(/\{([^}]+)\}/g, (_, nombre: string) =>
    valor(
      parametros.find((p) => p.in === "path" && p.name === nombre),
      nombre,
    ),
  );
  const query = parametros
    .filter((p) => p.in === "query" && p.required === true)
    .map((p) => `${p.name}=${encodeURIComponent(valor(p, p.name))}`);
  return query.length === 0 ? camino : `${camino}?${query.join("&")}`;
}

/** Pide el caso y valida estado, tipo de medio y cuerpo contra lo que declara el documento. */
async function validarCaso({ ruta, estado, metodo = "GET" }: Caso): Promise<void> {
  const o = operacionDe(ruta);
  const respuesta = await pedir(ruta, { method: metodo });
  expect(respuesta.status).toBe(estado);

  const declarada = respuestaDeclarada(o, estado);
  if (declarada === undefined) {
    throw new Error(`${o.ruta} no declara la respuesta ${estado}.`);
  }
  for (const [nombre, encabezado] of Object.entries(declarada.respuesta.headers ?? {})) {
    if (encabezado.required === true) {
      expect(respuesta.headers.get(nombre), `${o.ruta} ${estado} ${nombre}`).not.toBeNull();
    }
  }
  const tipo = tipoDeMedio(respuesta);
  expect(Object.keys(declarada.respuesta.content ?? {})).toContain(tipo);

  const cuerpo = (await respuesta.json()) as Record<string, unknown>;
  const validar = ajv.getSchema(puntero(...declarada.base, "content", tipo, "schema"));
  if (validar === undefined) throw new Error(`Sin esquema para ${o.ruta} ${estado} ${tipo}.`);
  expect(validar(cuerpo), JSON.stringify(validar.errors, null, 2)).toBe(true);

  if (tipo === "application/problem+json") {
    expect(String(cuerpo.type).startsWith(BASE_PROBLEMAS), String(cuerpo.type)).toBe(true);
    expect(cuerpo.status).toBe(estado);
    expect(cuerpo.instance).toBe(new URL(ruta, "http://local").pathname);
  }
}

describe("documento OpenAPI del build", () => {
  it("solo declara GET; el Worker resuelve HEAD y OPTIONS en toda ruta", () => {
    expect(OPERACIONES.length).toBeGreaterThan(0);
    expect(OPERACIONES.filter((o) => o.metodo !== "get")).toEqual([]);
  });

  it("toda operación declara 400, 405, 429 y 500 como problem+json", () => {
    for (const o of OPERACIONES) {
      for (const estado of [400, 405, 429, 500]) {
        const declarada = respuestaDeclarada(o, estado);
        expect(declarada?.respuesta.content, `${o.ruta} ${estado}`).toHaveProperty([
          "application/problem+json",
        ]);
      }
    }
  });

  it("cada operación tiene casos para cada estado practicable que declara", () => {
    const cubiertos = new Set(CASOS.map((c) => `${operacionDe(c.ruta).ruta} ${c.estado}`));
    const faltantes = OPERACIONES.flatMap((o) =>
      Object.keys(o.op.responses)
        .map(Number)
        .filter((estado) => PRACTICABLES.includes(estado))
        .map((estado) => `${o.ruta} ${estado}`)
        .filter((clave) => !cubiertos.has(clave)),
    );
    expect(faltantes).toEqual([]);
  });

  it("cada caso pide un estado que su operación declara", () => {
    const sinDeclarar = CASOS.filter((c) => {
      const o = operacionDe(c.ruta);
      return o.op.responses[String(c.estado)] === undefined;
    }).map((c) => `${c.ruta} ${c.estado}`);
    expect(sinDeclarar).toEqual([]);
  });

  it("el documento publica esquemas abiertos; la copia cerrada rechaza un campo de más", async () => {
    expect(texto).not.toContain('"additionalProperties": false');
    const abierto = nuevoAjv();
    abierto.addSchema(doc, "openapi");
    const esquema = puntero(
      "paths",
      "/v1/estados/{cve_ent}",
      "get",
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
    );
    const respuesta = await pedir("/v1/estados/25");
    const cuerpo = (await respuesta.json()) as { data: Record<string, unknown> };
    const conExtra = { ...cuerpo, data: { ...cuerpo.data, campo_nuevo: 1 } };
    expect(ajv.getSchema(esquema)?.(cuerpo)).toBe(true);
    expect(ajv.getSchema(esquema)?.(conExtra)).toBe(false);
    expect(ajv.getSchema(esquema)?.({ ...cuerpo, otro: 1 })).toBe(false);
    expect(abierto.getSchema(esquema)?.(conExtra)).toBe(true);
  });

  it("los tipos de problema del documento son los del Worker, con el mismo status y título", () => {
    const esquemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const problema = esquemas.Problema as { properties: { type: { description: string } } };
    const descripcion = problema.properties.type.description;
    expect(descripcion).toContain(`${BASE_PROBLEMAS}<tipo>`);
    const listados = Object.fromEntries(
      [...descripcion.matchAll(/([a-z-]+) \((\d{3}), ([^;)]+)\)/g)].map(
        ([, tipo, status, title]) => [tipo, { title, status: Number(status) }],
      ),
    );
    expect(listados).toEqual(PROBLEMAS);
  });
});

describe("ETag y 304 según el documento", () => {
  const conEtag = OPERACIONES.filter((o) => o.op.responses["304"] !== undefined);

  it("las rutas de shards declaran 304", () => {
    expect(conEtag.map((o) => o.ruta)).toEqual(
      expect.arrayContaining(["/v1/estados/{cve_ent}", "/v1/bancos/{codigo}", "/v1/openapi.json"]),
    );
  });

  it.each(conEtag.map((o) => ({ ruta: o.ruta, o })))(
    "$ruta: el ETag en If-None-Match da 304 sin cuerpo, como declara",
    async ({ o }) => {
      const ruta = ejemplo(o.ruta, o.op);
      expect(
        (o.op.parameters ?? []).filter((p) => p.in === "header").map((p) => p.name),
        o.ruta,
      ).toEqual(["If-None-Match"]);
      const declarada = respuestaDeclarada(o, 304);
      expect(declarada?.respuesta.content).toBeUndefined();

      const primera = await pedir(ruta);
      await primera.arrayBuffer();
      const etag = primera.headers.get("ETag");
      expect(etag, ruta).not.toBeNull();
      const condicional = await pedir(ruta, { headers: { "If-None-Match": etag as string } });
      expect(condicional.status, ruta).toBe(304);
      expect(await condicional.text()).toBe("");
      for (const nombre of Object.keys(declarada?.respuesta.headers ?? {})) {
        expect(condicional.headers.get(nombre), `${ruta} ${nombre}`).not.toBeNull();
      }
    },
  );

  it.each(
    OPERACIONES.filter((o) => o.op.responses["304"] === undefined).map((o) => ({
      ruta: o.ruta,
      o,
    })),
  )("$ruta no declara 304 y no manda ETag", async ({ o }) => {
    const respuesta = await pedir(ejemplo(o.ruta, o.op));
    await respuesta.arrayBuffer();
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("ETag")).toBeNull();
  });
});

describe("respuestas del Worker contra el documento", () => {
  it.each(CASOS)("GET $ruta → $estado", validarCaso);

  it("/v1/status: las series mandan la cobertura opcional que declara EstadoDataset", async () => {
    const respuesta = await pedir("/v1/status");
    const { data } = (await respuesta.json()) as { data: Array<Record<string, unknown>> };
    const validar = ajv.getSchema(puntero("components", "schemas", "EstadoDataset"));
    if (validar === undefined) throw new Error("Sin esquema EstadoDataset.");
    for (const d of data) {
      expect(validar(d), `${String(d.dataset)}: ${JSON.stringify(validar.errors)}`).toBe(true);
    }
    expect(data.filter((d) => "cobertura" in d).map((d) => d.dataset)).toEqual([
      "tipo-cambio.fix",
      "udis",
    ]);
  });

  it("los ejemplos explícitos son de operaciones del documento, en su ruta", () => {
    for (const [id, rutas] of Object.entries(EJEMPLOS)) {
      const o = OPERACIONES.find((x) => x.op.operationId === id);
      expect(o, id).toBeDefined();
      for (const ruta of rutas) expect(operacionDe(ruta).ruta, ruta).toBe(o?.ruta);
    }
  });

  describe.each(OPERACIONES.flatMap((o) => ejemplos(o.ruta, o.op).map((ejemplo) => ({ ejemplo }))))(
    "$ejemplo, ejemplo del documento",
    ({ ejemplo: ruta }) => {
      it("GET → 200", () => validarCaso({ ruta, estado: 200 }));
      it("con un parámetro no declarado → 400", () =>
        validarCaso({
          ruta: `${ruta}${ruta.includes("?") ? "&" : "?"}no_declarado=1`,
          estado: 400,
        }));
      it("POST → 405", () => validarCaso({ ruta, estado: 405, metodo: "POST" }));
      it("DELETE → 405", () => validarCaso({ ruta, estado: 405, metodo: "DELETE" }));
    },
  );
});

interface ReglaWorker {
  patron: RegExp;
  obligatorio?: boolean;
}

interface RutaWorker {
  plantilla: string;
  patron: RegExp;
  parametros?: Readonly<Record<string, ReglaWorker>>;
  consulta?: Readonly<Record<string, ReglaWorker>>;
}

/**
 * La tabla de rutas del Worker. Se carga en tiempo de ejecución porque está tipada con
 * @cloudflare/workers-types y este proyecto usa los tipos de Node.
 */
async function tablaDeRutas(): Promise<readonly RutaWorker[]> {
  const modulo: string = "../../src/rutas.ts";
  const { RUTAS } = (await import(modulo)) as { RUTAS: readonly RutaWorker[] };
  return RUTAS;
}

describe("rutas del Worker y del documento", () => {
  it("cada ruta del Worker tiene exactamente una operación documentada y viceversa", async () => {
    const rutas = await tablaDeRutas();
    expect(rutas.length).toBe(OPERACIONES.length);
    for (const o of OPERACIONES) {
      const camino = new URL(ejemplo(o.ruta, o.op), "http://local").pathname;
      const delWorker = rutas.filter((r) => r.patron.test(camino));
      expect(delWorker.length, o.ruta).toBe(1);
      // La plantilla que registra el Worker ante un error es la ruta del documento.
      expect(delWorker[0]?.plantilla, o.ruta).toBe(o.ruta);
    }
    for (const r of rutas) {
      const documentadas = OPERACIONES.filter((o) =>
        r.patron.test(new URL(ejemplo(o.ruta, o.op), "http://local").pathname),
      );
      expect(documentadas.length, String(r.patron)).toBe(1);
    }
  });

  it("los parámetros documentados son los que valida el Worker, con la misma regla", async () => {
    const rutas = await tablaDeRutas();
    for (const o of OPERACIONES) {
      const camino = new URL(ejemplo(o.ruta, o.op), "http://local").pathname;
      const ruta = rutas.find((r) => r.patron.test(camino)) as RutaWorker;
      for (const [donde, reglas] of [
        ["path", ruta.parametros ?? {}],
        ["query", ruta.consulta ?? {}],
      ] as const) {
        const documentados = (o.op.parameters ?? []).filter((p) => p.in === donde);
        expect(documentados.map((p) => p.name).sort(), `${o.ruta} ${donde}`).toEqual(
          Object.keys(reglas).sort(),
        );
        for (const p of documentados) {
          const regla = reglas[p.name] as ReglaWorker;
          const contexto = `${o.ruta} ${p.name}`;
          expect(p.required === true, contexto).toBe(
            donde === "path" || regla.obligatorio === true,
          );
          if (p.schema.pattern !== undefined) {
            expect(p.schema.pattern, contexto).toBe(regla.patron.source);
          }
          for (const valor of p.schema.enum ?? []) {
            expect(regla.patron.test(valor), `${contexto} ${valor}`).toBe(true);
          }
        }
      }
    }
  });

  it.each([
    "/v1/_internos/meta.json",
    "/v1/estados.json",
    "/v1/estados/25/municipios/25006",
    "/v1/municipios/25006/localidades",
    "/v1/bancos/012/historial",
    "/v1/clabe",
    "/v1/dias",
    "/v1/tipo-cambio",
    "/v1/tipo-cambio/fix/2026-10-16",
    "/v1/udis/2026-01-05",
    "/v1/_internos/calendarios/sat.json",
    "/v1/constantes",
    "/v1/constantes/uma.json",
    "/v1/constantes/salario-minimo",
    "/v1/isr/tarifa/mensual",
    "/v1/isr/tarifa/mensual/2026/1",
    "/v1/openapi",
    "/v2",
    "/descargas",
  ])("%s no es una ruta: 404 problem+json", async (ruta) => {
    const respuesta = await pedir(ruta);
    expect(respuesta.status).toBe(404);
    expect(tipoDeMedio(respuesta)).toBe("application/problem+json");
    const cuerpo = (await respuesta.json()) as Record<string, unknown>;
    const validar = ajv.getSchema(
      puntero(
        "components",
        "responses",
        "NoEncontrado",
        "content",
        "application/problem+json",
        "schema",
      ),
    );
    expect(validar?.(cuerpo), JSON.stringify(validar?.errors)).toBe(true);
    expect(cuerpo).toMatchObject({
      type: `${BASE_PROBLEMAS}no-encontrado`,
      detail: "No existe la ruta.",
      instance: ruta,
    });
  });
});
