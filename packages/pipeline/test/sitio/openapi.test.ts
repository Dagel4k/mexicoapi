import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { esquemaBanco, esquemaEstado, esquemaMunicipio } from "../../src/esquemas.js";
import { sobre } from "../../src/sitio/esquemas-api.js";
import { documentoOpenApi, PROBLEMAS } from "../../src/sitio/openapi.js";

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
  it("valida contra el esquema oficial de OAS 3.1", async () => {
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
    const dinamicos = JSON.stringify(esquema).includes("$dynamicRef") ? 1 : 0;
    expect(dinamicos).toBe(0);
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    const validar = ajv.compile(esquema);
    const ok = validar(doc);
    expect(validar.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
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

  it("toda operación declara 405, 429 y 500 como problem+json", () => {
    for (const { op } of operaciones) {
      for (const codigo of ["405", "429", "500"]) {
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
    expect(codigos("/v1/estados/{cve_ent}")).toEqual(["200", "400", "404", "405", "429", "500"]);
    expect(codigos("/v1/clabe/{clabe}")).toEqual(["200", "400", "405", "429", "500"]);
    expect(codigos("/v1/dias-habiles")).toEqual(["200", "400", "405", "422", "429", "500"]);
    expect(codigos("/v1/dias-inhabiles")).toEqual(["200", "400", "405", "422", "429", "500"]);
    expect(codigos("/v1/estados")).toEqual(["200", "405", "429", "500"]);
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

  it("los esquemas de Estado, Municipio y Banco validan el primer registro real", async () => {
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
  });

  it("los esquemas zod aceptan el primer registro real dentro del sobre", async () => {
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
  });

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

  it("Problema declara las extensiones opcionales", () => {
    const p = doc.components.schemas.Problema;
    expect([...p.required].sort()).toEqual(["detail", "status", "title", "type"]);
    for (const k of ["instance", "parametro", "autoridad", "fecha", "cobertura"]) {
      expect(p.properties[k], k).toBeDefined();
    }
  });
});
