import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { esquemaBanco, esquemaEstado, esquemaMunicipio } from "../../src/esquemas.js";
import { sobre } from "../../src/sitio/esquemas-api.js";
import { documentoOpenApi, PROBLEMAS } from "../../src/sitio/openapi.js";
import { PRUEBA_LENTA } from "../ayudas.js";

// biome-ignore lint/suspicious/noExplicitAny: el documento se inspecciona de forma dinámica.
type Obj = Record<string, any>;

const doc = documentoOpenApi() as Obj;
const operaciones: Array<{ ruta: string; metodo: string; op: Obj }> = Object.entries(
  doc.paths as Obj,
).flatMap(([ruta, item]) =>
  Object.entries(item as Obj).map(([metodo, op]) => ({ ruta, metodo, op: op as Obj })),
);

const leerJson = async (url: URL) => JSON.parse(await readFile(url, "utf8"));

function referencias(valor: unknown, acumulado: string[] = []): string[] {
  if (Array.isArray(valor)) {
    for (const v of valor) referencias(v, acumulado);
  } else if (valor !== null && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      if (k === "$ref" && typeof v === "string") acumulado.push(v);
      else referencias(v, acumulado);
    }
  }
  return acumulado;
}

function resolverRef(ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>(
      (nodo, parte) =>
        (nodo as Obj | undefined)?.[parte.replaceAll("~1", "/").replaceAll("~0", "~")],
      doc,
    );
}

describe("documento OpenAPI", () => {
  async function validadorOas() {
    const texto = await readFile(
      new URL("../fixtures/openapi-3.1-schema.json", import.meta.url),
      "utf8",
    );
    // Ajv no resuelve bien `$dynamicRef: "#meta"` (lo manda a la raíz del esquema), así que
    // se cambia por la referencia estática equivalente: en este esquema un Schema Object es
    // `object | boolean`. Su contenido se valida aparte, contra el metaesquema 2020-12.
    const esquema = JSON.parse(
      JSON.stringify(JSON.parse(texto)).replaceAll(
        '{"$dynamicRef":"#meta"}',
        '{"$ref":"#/$defs/schema"}',
      ),
    );
    expect(JSON.stringify(esquema)).not.toContain("$dynamicRef");
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    return ajv.compile(esquema);
  }

  it("valida contra el esquema oficial de OAS 3.1", async () => {
    const validar = await validadorOas();
    const ok = validar(doc);
    expect(validar.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("el validador rechaza documentos inválidos", async () => {
    const validar = await validadorOas();
    const sinInfo = structuredClone(doc);
    delete sinInfo.info;
    expect(validar(sinInfo)).toBe(false);
    const rutaInvalida = structuredClone(doc);
    rutaInvalida.paths["/x"] = 5;
    expect(validar(rutaInvalida)).toBe(false);
  });

  it("/v1/status responde solo { data }, sin meta", () => {
    const op = operaciones.find((o) => o.ruta === "/v1/status")?.op as Obj;
    const schema = op.responses["200"].content["application/json"].schema;
    expect(schema.required).toEqual(["data"]);
    expect(Object.keys(schema.properties)).toEqual(["data"]);
    expect(schema.properties.data).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/EstadoDataset" },
    });
  });

  it("cada esquema de componentes es un JSON Schema 2020-12 válido", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [nombre, esquema] of Object.entries(doc.components.schemas as Obj)) {
      expect(ajv.validateSchema(esquema), nombre).toBe(true);
    }
  });

  it("declara la información general", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("MéxicoAPI");
    expect(doc.info.version).toBe("1.0.0");
    expect(doc.info.license).toEqual({ name: "MIT", identifier: "MIT" });
    expect(doc.info.description).toContain("meta.sources");
    expect(doc.servers).toEqual([{ url: "/" }]);
  });

  it("documenta exactamente las rutas y operationId esperados", () => {
    const esperado = [
      ["/", "indice"],
      ["/v1", "indiceV1"],
      ["/v1/estados", "listarEstados"],
      ["/v1/estados/{cve_ent}", "obtenerEstado"],
      ["/v1/estados/{cve_ent}/municipios", "listarMunicipiosDeEstado"],
      ["/v1/municipios", "listarMunicipios"],
      ["/v1/municipios/{cvegeo}", "obtenerMunicipio"],
      ["/v1/bancos", "listarBancos"],
      ["/v1/bancos/{codigo}", "obtenerBanco"],
      ["/v1/clabe/{clabe}", "validarClabe"],
      ["/v1/dias-habiles", "sumarDiasHabiles"],
      ["/v1/dias-inhabiles", "listarDiasInhabiles"],
      ["/v1/status", "estadoDatasets"],
      ["/v1/openapi.json", "openapi"],
    ];
    expect(operaciones.map((o) => [o.ruta, o.op.operationId])).toEqual(esperado);
    expect(operaciones.every((o) => o.metodo === "get")).toBe(true);
  });

  it("cada operación tiene operationId único, summary, tags y respuesta 200", () => {
    const ids = operaciones.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { op } of operaciones) {
      expect(op.summary).toBeTruthy();
      expect(op.tags.length).toBeGreaterThan(0);
      expect(op.responses["200"]).toBeDefined();
    }
  });

  it("toda operación declara 400, 405, 429 y 500 como problem+json", () => {
    for (const { op } of operaciones) {
      for (const codigo of ["400", "405", "429", "500"]) {
        const resp = op.responses[codigo];
        expect(resp, codigo).toBeDefined();
        const real = resp.$ref ? (resolverRef(resp.$ref) as Obj) : resp;
        expect(real.content["application/problem+json"].schema.$ref).toBe(
          "#/components/schemas/Problema",
        );
      }
    }
  });

  it("declara los códigos de error por ruta", () => {
    const codigos = (ruta: string) =>
      Object.keys(operaciones.find((o) => o.ruta === ruta)?.op.responses ?? {}).sort();
    expect(codigos("/v1/estados/{cve_ent}")).toEqual([
      "200",
      "304",
      "400",
      "404",
      "405",
      "429",
      "500",
    ]);
    expect(codigos("/v1/clabe/{clabe}")).toEqual(["200", "400", "405", "429", "500"]);
    expect(codigos("/v1/dias-habiles")).toEqual(["200", "400", "405", "422", "429", "500"]);
    expect(codigos("/v1/dias-inhabiles")).toEqual(["200", "400", "405", "422", "429", "500"]);
    // Las rutas sin parámetros también responden 400 a cualquier parámetro de consulta.
    for (const ruta of ["/", "/v1", "/v1/status"]) {
      expect(codigos(ruta), ruta).toEqual(["200", "400", "405", "429", "500"]);
    }
    for (const ruta of ["/v1/estados", "/v1/municipios", "/v1/bancos", "/v1/openapi.json"]) {
      expect(codigos(ruta), ruta).toEqual(["200", "304", "400", "405", "429", "500"]);
    }
  });

  it("la respuesta 400 dice que toda ruta rechaza los parámetros de consulta que no declara", () => {
    expect(doc.components.responses.ParametroInvalido.description).toContain(
      "Toda ruta rechaza los parámetros de consulta que no declara.",
    );
  });

  it("los parámetros de ruta son obligatorios y tienen el patrón exacto", () => {
    const patrones: Record<string, string> = {
      cve_ent: "^\\d{2}$",
      cvegeo: "^\\d{5}$",
      codigo: "^\\d{3}$",
      clabe: "^\\d{18}$",
    };
    let vistos = 0;
    for (const { op } of operaciones) {
      for (const p of op.parameters ?? []) {
        if (p.in !== "path") continue;
        vistos += 1;
        expect(p.required).toBe(true);
        expect(p.schema.pattern).toBe(patrones[p.name]);
      }
    }
    expect(vistos).toBe(5);
  });

  it("describe los parámetros de consulta", () => {
    const params = (ruta: string): Obj =>
      Object.fromEntries(
        ((operaciones.find((o) => o.ruta === ruta)?.op.parameters ?? []) as Obj[]).map((p) => [
          p.name,
          p,
        ]),
      );
    const habiles = params("/v1/dias-habiles");
    expect(Object.keys(habiles).sort()).toEqual([
      "autoridad",
      "desde",
      "dias",
      "permitir_incompleto",
    ]);
    expect(habiles.autoridad.schema.enum).toEqual(["lft"]);
    expect(habiles.dias.schema.pattern).toBe("^[1-9]\\d{0,3}$");
    expect(habiles.dias.required).toBe(true);
    expect(habiles.permitir_incompleto.required).toBeFalsy();
    expect(habiles.permitir_incompleto.schema.enum).toEqual(["true", "false"]);
    const inhabiles = params("/v1/dias-inhabiles");
    expect(inhabiles.anio.schema.pattern).toBe("^\\d{4}$");
    expect(inhabiles.autoridad.required).toBe(true);
  });

  it("todo $ref resuelve", () => {
    const refs = referencias(doc);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      expect(ref.startsWith("#/"), ref).toBe(true);
      expect(resolverRef(ref), ref).toBeDefined();
    }
  });

  it("registra los componentes con nombre PascalCase y sin $schema", () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual(
      [
        "Banco",
        "DiaInhabil",
        "Estado",
        "EstadoDataset",
        "FuenteMeta",
        "Indice",
        "Meta",
        "Municipio",
        "PeriodoBanco",
        "Problema",
        "ResultadoClabe",
        "ResultadoDiasHabiles",
      ].sort(),
    );
    for (const esquema of Object.values(doc.components.schemas as Obj)) {
      expect(esquema.$schema).toBeUndefined();
    }
  });

  it(
    "los esquemas de Estado, Municipio y Banco validan el primer registro real",
    async () => {
      const ajv = new Ajv2020({ strict: false });
      const casos: Array<[string, string]> = [
        ["Estado", "inegi-estados/estados.json"],
        ["Municipio", "inegi-municipios/municipios.json"],
        ["Banco", "bancos/bancos.json"],
      ];
      for (const [nombre, archivo] of casos) {
        const registros = (await leerJson(
          new URL(`../../../../data/${archivo}`, import.meta.url),
        )) as unknown[];
        const validar = ajv.compile({
          components: doc.components,
          $ref: `#/components/schemas/${nombre}`,
        });
        expect(validar(registros[0]), `${nombre}: ${JSON.stringify(validar.errors)}`).toBe(true);
      }
    },
    PRUEBA_LENTA,
  );

  it(
    "los esquemas zod aceptan el primer registro real dentro del sobre",
    async () => {
      const [estado] = (await leerJson(
        new URL("../../../../data/inegi-estados/estados.json", import.meta.url),
      )) as unknown[];
      const [municipio] = (await leerJson(
        new URL("../../../../data/inegi-municipios/municipios.json", import.meta.url),
      )) as unknown[];
      const [banco] = (await leerJson(
        new URL("../../../../data/bancos/bancos.json", import.meta.url),
      )) as unknown[];
      const meta = {
        dataset: "inegi.estados",
        as_of: "2026-01-01",
        sources: [
          { name: "n", url: "https://x", license: "l", license_url: "https://l", citation: "c" },
        ],
        docs: "https://d",
      };
      expect(sobre(esquemaEstado).safeParse({ data: estado, meta }).success).toBe(true);
      expect(sobre(esquemaMunicipio).safeParse({ data: municipio, meta }).success).toBe(true);
      expect(sobre(esquemaBanco).safeParse({ data: banco, meta }).success).toBe(true);
      expect(sobre(esquemaEstado).safeParse({ data: {}, meta }).success).toBe(false);
    },
    PRUEBA_LENTA,
  );

  it("Problema.type nombra la base de los tipos de problema", () => {
    const base = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
    const descripcion = doc.components.schemas.Problema.properties.type.description as string;
    expect(descripcion).toContain(`${base}<tipo>`);
    for (const tipo of Object.keys(PROBLEMAS)) expect(descripcion).toContain(tipo);
    expect(Object.keys(PROBLEMAS).sort()).toEqual([
      "calendario-incompleto",
      "demasiadas-peticiones",
      "error-interno",
      "metodo-no-permitido",
      "no-encontrado",
      "parametro-desconocido",
      "parametro-faltante",
      "parametro-invalido",
    ]);
  });

  it("Problema.type lista cada tipo con su status y su título", () => {
    const descripcion = doc.components.schemas.Problema.properties.type.description as string;
    const listados = Object.fromEntries(
      [...descripcion.matchAll(/([a-z-]+) \((\d{3}), ([^;)]+)\)/g)].map(
        ([, tipo, status, title]) => [tipo, { title, status: Number(status) }],
      ),
    );
    expect(listados).toEqual(PROBLEMAS);
  });

  it("publica esquemas abiertos: ningún objeto lleva additionalProperties: false", () => {
    const cerrados: string[] = [];
    let conPropiedades = 0;
    const recorrer = (valor: unknown, camino: string): void => {
      if (Array.isArray(valor)) {
        valor.forEach((v, i) => {
          recorrer(v, `${camino}/${i}`);
        });
      } else if (valor !== null && typeof valor === "object") {
        const objeto = valor as Obj;
        if ("properties" in objeto) conPropiedades += 1;
        if (objeto.additionalProperties === false) cerrados.push(camino);
        for (const [k, v] of Object.entries(objeto)) recorrer(v, `${camino}/${k}`);
      }
    };
    recorrer(JSON.parse(JSON.stringify(doc)), "#");
    expect(cerrados).toEqual([]);
    expect(conPropiedades).toBeGreaterThan(10);
  });

  it("la 405 dice los métodos permitidos y trae Allow; la 429 trae Retry-After", () => {
    const { MetodoNoPermitido, DemasiadasPeticiones } = doc.components.responses;
    expect(MetodoNoPermitido.description).toBe("Métodos permitidos: GET, HEAD y OPTIONS.");
    expect(MetodoNoPermitido.headers.Allow).toMatchObject({
      required: true,
      schema: { type: "string" },
      example: "GET, HEAD, OPTIONS",
    });
    expect(DemasiadasPeticiones.headers["Retry-After"]).toMatchObject({
      required: true,
      schema: { type: "integer", minimum: 0 },
      example: 60,
    });
  });

  it("las rutas que sirven shards documentan ETag, If-None-Match y la 304 sin cuerpo", () => {
    const shards = [
      "/v1/estados",
      "/v1/estados/{cve_ent}",
      "/v1/estados/{cve_ent}/municipios",
      "/v1/municipios",
      "/v1/municipios/{cvegeo}",
      "/v1/bancos",
      "/v1/bancos/{codigo}",
      "/v1/openapi.json",
    ];
    const conEtag = operaciones
      .filter((o) => o.op.responses["304"] !== undefined)
      .map((o) => o.ruta);
    expect(conEtag).toEqual(shards);
    for (const { ruta, op } of operaciones) {
      const condicion = ((op.parameters ?? []) as Obj[]).filter((p) => p.in === "header");
      if (!shards.includes(ruta)) {
        expect(condicion, ruta).toEqual([]);
        expect(op.responses["200"].headers, ruta).toBeUndefined();
        continue;
      }
      expect(condicion, ruta).toEqual([
        expect.objectContaining({
          name: "If-None-Match",
          required: false,
          schema: { type: "string" },
        }),
      ]);
      expect(op.responses["200"].headers.ETag, ruta).toMatchObject({ schema: { type: "string" } });
      const r304 = resolverRef(op.responses["304"].$ref) as Obj;
      expect(r304.content, ruta).toBeUndefined();
      expect(r304.headers.ETag, ruta).toMatchObject({ required: true, schema: { type: "string" } });
    }
  });

  it("Problema declara las extensiones opcionales", () => {
    const p = doc.components.schemas.Problema;
    expect([...p.required].sort()).toEqual(["detail", "status", "title", "type"]);
    for (const k of ["instance", "parametro", "autoridad", "fecha", "cobertura"]) {
      expect(p.properties[k], k).toBeDefined();
    }
  });
});
