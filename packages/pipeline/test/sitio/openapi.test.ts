import { readFile } from "node:fs/promises";
import { FUENTE_CFF_20 } from "@mexicoapi/core";
import { PROBLEMAS } from "@mexicoapi/core/problemas";
import {
  CONSULTAS,
  REGLAS_RUTA,
  type ReglaConsulta,
  type ReglaParametro,
} from "@mexicoapi/core/rutas";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  esquemaBanco,
  esquemaEstado,
  esquemaMunicipio,
  esquemaTipoCambioFix,
  esquemaUdi,
} from "../../src/esquemas.js";
import {
  esquemaFixOperacion,
  esquemaSalarioMinimo,
  esquemaTarifaIsr,
  esquemaUma,
  sobre,
} from "../../src/sitio/esquemas-api.js";
import { documentoOpenApi } from "../../src/sitio/openapi.js";
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

/** Los patrones de `anio` (0001 a 9999) y `dias` (1 a 3650), como los publica el documento. */
const ANIO = "^(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})$";
const DIAS = "^(?:[1-9][0-9]{0,2}|[12][0-9]{3}|3[0-5][0-9]{2}|36[0-4][0-9]|3650)$";
const FECHA = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

/** Esquema de la respuesta 200 en JSON de la operación de `ruta`. */
function esquema200(ruta: string): Obj {
  const o = operaciones.find((x) => x.ruta === ruta);
  if (o === undefined) throw new Error(`${ruta} no está en el documento`);
  return o.op.responses["200"].content["application/json"].schema;
}

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

  it("el índice de /v1 enlaza la página de inicio y llms.txt", () => {
    expect(esquema200("/v1")).toEqual({ $ref: "#/components/schemas/Indice" });
    const indice = doc.components.schemas.Indice;
    expect(Object.keys(indice.properties)).toEqual([
      "nombre",
      "version",
      "documentacion",
      "openapi",
      "status",
      "descargas",
      "sitio",
      "llms",
    ]);
    expect(indice.required).toEqual(Object.keys(indice.properties));
    expect(indice.properties.sitio.description).toBe("Ruta de la página de inicio del sitio.");
    expect(indice.properties.llms.description).toBe(
      "Ruta del resumen para herramientas que leen llms.txt.",
    );
  });

  it("EstadoDataset declara la cobertura de las series como opcional", () => {
    const estado = doc.components.schemas.EstadoDataset;
    expect(estado.required).not.toContain("cobertura");
    expect(estado.properties.cobertura).toMatchObject({
      type: "object",
      required: ["desde", "hasta"],
      properties: {
        desde: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        hasta: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
    });
    expect(estado.properties.cobertura.description).toContain("series");
    expect(Object.keys(estado.properties)).toEqual([
      "dataset",
      "as_of",
      "records",
      "data_sha256",
      "cobertura",
      "status",
      "last_attempt",
      "last_success",
      "frescura_horas",
    ]);
  });

  it("as_of se describe como la última corrida que cambió los datos, en Meta y en EstadoDataset", () => {
    for (const nombre of ["Meta", "EstadoDataset"]) {
      const descripcion = doc.components.schemas[nombre].properties.as_of.description as string;
      expect(descripcion, nombre).toContain("última corrida que cambió los datos");
      expect(descripcion, nombre).toContain("no es la última fecha de la serie");
    }
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
    expect(doc.info.description).toContain("tipo de cambio FIX y UDIS");
    expect(doc.info.description).toContain("UMA, salario mínimo y tarifas de ISR");
    expect(doc.servers).toEqual([{ url: "/" }]);
  });

  // HEAD y OPTIONS valen en toda ruta y el documento solo declara GET: declararlos daría a los
  // clientes generados dos métodos de más por ruta. La prueba de contrato revisa la nota contra
  // el Worker.
  it("la descripción general dice cómo responden HEAD, OPTIONS y una URL demasiado larga", () => {
    const { description } = doc.info;
    expect(description).toContain(
      "Toda ruta acepta también HEAD, que responde lo mismo que GET sin cuerpo",
    );
    expect(description).toContain(
      "y OPTIONS, que responde 204 sin cuerpo con Access-Control-Allow-Methods: GET, HEAD, OPTIONS, Access-Control-Allow-Headers: If-None-Match y Access-Control-Max-Age: 86400, y no cuenta en el límite de peticiones",
    );
    expect(description).toContain("Otro método da 405.");
    expect(description).toContain("no es problem+json");
  });

  it("documenta exactamente las rutas y operationId esperados", () => {
    const esperado = [
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
      ["/v1/tipo-cambio/fix", "consultarFix"],
      ["/v1/tipo-cambio/fix/ultimo", "ultimoFix"],
      ["/v1/udis", "consultarUdi"],
      ["/v1/constantes/uma", "consultarUma"],
      ["/v1/constantes/uma/{anio}", "obtenerUma"],
      ["/v1/constantes/salario-minimo/{anio}", "obtenerSalarioMinimo"],
      ["/v1/isr/tarifa/{periodo}/{anio}", "obtenerTarifaIsr"],
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

  it("toda operación declara la 308 de una ruta con / al final, con Location", () => {
    for (const { ruta, op } of operaciones) {
      expect(op.responses["308"], ruta).toEqual({ $ref: "#/components/responses/Redireccion" });
    }
    const { Redireccion } = doc.components.responses;
    expect(Redireccion.content).toBeUndefined();
    expect(Redireccion.description).toContain("termina en /");
    expect(Redireccion.headers.Location).toMatchObject({
      required: true,
      schema: { type: "string" },
      example: "/v1/estados",
    });
  });

  // El Worker busca la ruta sin decodificarla: un parámetro de ruta con % (un espacio codificado
  // en la CLABE) no la encuentra y da 404. Sin parámetros de ruta, ese 404 no tiene cómo llegar.
  it("toda operación con parámetros de ruta declara 404; las demás, solo si tienen el suyo", () => {
    const propios = ["/v1/tipo-cambio/fix", "/v1/udis", "/v1/constantes/uma"];
    for (const { ruta, op } of operaciones) {
      const debe = ruta.includes("{") || propios.includes(ruta);
      expect(op.responses["404"] !== undefined, ruta).toBe(debe);
    }
    expect(doc.paths["/v1/clabe/{clabe}"].get.responses["404"]).toEqual({
      $ref: "#/components/responses/NoEncontrado",
    });
    expect(doc.components.responses.NoEncontrado.description).toContain("%");
    expect(doc.components.responses.SinAnio.description).toContain("%");
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
      "308",
      "400",
      "404",
      "405",
      "429",
      "500",
    ]);
    expect(codigos("/v1/clabe/{clabe}")).toEqual(["200", "308", "400", "404", "405", "429", "500"]);
    expect(codigos("/v1/dias-habiles")).toEqual(["200", "308", "400", "405", "422", "429", "500"]);
    expect(codigos("/v1/dias-inhabiles")).toEqual([
      "200",
      "308",
      "400",
      "405",
      "422",
      "429",
      "500",
    ]);
    for (const ruta of ["/v1/tipo-cambio/fix", "/v1/udis", "/v1/constantes/uma"]) {
      expect(codigos(ruta), ruta).toEqual(["200", "308", "400", "404", "405", "429", "500"]);
    }
    for (const ruta of [
      "/v1/constantes/uma/{anio}",
      "/v1/constantes/salario-minimo/{anio}",
      "/v1/isr/tarifa/{periodo}/{anio}",
    ]) {
      expect(codigos(ruta), ruta).toEqual(["200", "304", "308", "400", "404", "405", "429", "500"]);
    }
    // Las rutas sin parámetros también responden 400 a cualquier parámetro de consulta.
    for (const ruta of ["/v1", "/v1/status", "/v1/tipo-cambio/fix/ultimo"]) {
      expect(codigos(ruta), ruta).toEqual(["200", "308", "400", "405", "429", "500"]);
    }
    for (const ruta of ["/v1/estados", "/v1/municipios", "/v1/bancos", "/v1/openapi.json"]) {
      expect(codigos(ruta), ruta).toEqual(["200", "304", "308", "400", "405", "429", "500"]);
    }
  });

  it("la respuesta 400 dice que toda ruta rechaza los parámetros de consulta que no declara", () => {
    expect(doc.components.responses.ParametroInvalido.description).toContain(
      "Toda ruta rechaza los parámetros de consulta que no declara.",
    );
  });

  it("los parámetros de ruta son obligatorios y tienen el patrón exacto", () => {
    const patrones: Record<string, string> = {
      cve_ent: "^[0-9]{2}$",
      cvegeo: "^[0-9]{5}$",
      codigo: "^[0-9]{3}$",
      clabe: "^[0-9]{18}$",
      anio: ANIO,
    };
    let vistos = 0;
    for (const { op } of operaciones) {
      for (const p of op.parameters ?? []) {
        if (p.in !== "path") continue;
        vistos += 1;
        expect(p.required).toBe(true);
        expect(p.example, p.name).toBeTruthy();
        // El periodo de la tarifa es una de dos palabras: se declara como enum.
        if (p.name === "periodo") {
          expect(p.schema).toEqual({ type: "string", enum: ["mensual", "anual"] });
          continue;
        }
        expect(p.schema.pattern, p.name).toBe(patrones[p.name]);
      }
    }
    expect(vistos).toBe(9);
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
      "tipo_plazo",
    ]);
    expect(habiles.autoridad.schema.enum).toEqual(["lft", "cnbv", "sat"]);
    // Obligatorio solo con sat: el documento no puede marcarlo como required.
    expect(habiles.tipo_plazo).toMatchObject({
      in: "query",
      required: false,
      schema: { type: "string", enum: ["general", "declaraciones_pagos"] },
    });
    expect(habiles.tipo_plazo.description).toContain("autoridad=sat");
    expect(habiles.tipo_plazo.description).toContain("vacaciones");
    // Lo que cada calendario aplica y lo que no, y qué fecha va en desde.
    expect(habiles.autoridad.description).toContain(
      "no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715)",
    );
    expect(habiles.autoridad.description).toContain(
      "no es el calendario de la CNBV como autoridad",
    );
    expect(habiles.autoridad.description).toContain("art. 12 del CFF, calculados por regla");
    expect(habiles.desde.description).toContain(
      "el día en que surte efectos, no el día en que se hizo",
    );
    expect(habiles.permitir_incompleto.description).toContain(
      "días de cierre bancario como el 1 de enero",
    );
    const sumar = doc.paths["/v1/dias-habiles"].get;
    expect(sumar.description).toContain(
      "no aplica la prórroga del quinto párrafo del art. 12 del CFF",
    );
    expect(habiles.dias.schema).toEqual({ type: "string", pattern: DIAS });
    expect(habiles.dias.required).toBe(true);
    expect(habiles.permitir_incompleto.required).toBeFalsy();
    expect(habiles.permitir_incompleto.schema.enum).toEqual(["true", "false"]);
    const inhabiles = params("/v1/dias-inhabiles");
    expect(inhabiles.anio.schema).toEqual({ type: "string", pattern: ANIO });
    expect(inhabiles.autoridad.required).toBe(true);
    expect(inhabiles.autoridad.schema.enum).toEqual(["lft", "cnbv", "sat"]);
    expect(Object.keys(inhabiles).sort()).toEqual(["anio", "autoridad"]);
    const fecha = { type: "string", format: "date", pattern: FECHA };
    expect(habiles.desde.schema).toEqual(fecha);
    // Se pide exactamente uno de los dos: ninguno es obligatorio por sí solo.
    const fix = params("/v1/tipo-cambio/fix");
    expect(Object.keys(fix).sort()).toEqual(["operacion", "publicado"]);
    for (const nombre of ["operacion", "publicado"]) {
      expect(fix[nombre].in, nombre).toBe("query");
      expect(fix[nombre].required, nombre).toBe(false);
      expect(fix[nombre].schema, nombre).toEqual(fecha);
      expect(fix[nombre].example, nombre).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const udis = params("/v1/udis");
    expect(Object.keys(udis)).toEqual(["fecha"]);
    expect(udis.fecha).toMatchObject({ in: "query", required: true, schema: fecha });
    expect(params("/v1/tipo-cambio/fix/ultimo")).toEqual({});
    const uma = params("/v1/constantes/uma");
    expect(Object.keys(uma)).toEqual(["fecha"]);
    expect(uma.fecha).toMatchObject({ in: "query", required: true, schema: fecha });
  });

  it("listarDiasInhabiles responde la lista con advertencias y dice cuándo las hay", () => {
    const schema = esquema200("/v1/dias-inhabiles");
    expect(schema.required).toEqual(["data", "advertencias", "meta"]);
    expect(Object.keys(schema.properties)).toEqual(["data", "advertencias", "meta"]);
    expect(schema.properties.data).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/DiaInhabil" },
    });
    expect(schema.properties.advertencias).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.properties.advertencias.description).toContain("tipo_plazo");
    const op = operaciones.find((o) => o.ruta === "/v1/dias-inhabiles")?.op as Obj;
    expect(op.description).toContain("advertencias");
    expect(op.description).toContain("calendario-incompleto");
    expect(op.description).toContain("vacaciones");
  });

  it("sumarDiasHabiles explica tipo_plazo: obligatorio con sat y no aceptado con las demás", () => {
    const op = operaciones.find((o) => o.ruta === "/v1/dias-habiles")?.op as Obj;
    expect(op.description).toContain("tipo_plazo");
    expect(op.description).toContain("parametro-faltante");
    expect(op.description).toContain("lft o cnbv");
  });

  it("consultarUma dice que en enero rige la UMA del año anterior", () => {
    const op = operaciones.find((o) => o.ruta === "/v1/constantes/uma")?.op as Obj;
    expect(op.description).toContain("1 de febrero");
    expect(op.description).toContain("año anterior");
    expect(op.responses["404"]).toEqual({ $ref: "#/components/responses/SinDato" });
  });

  it("las constantes por año responden 404 con los dos tipos: antes de los datos o todavía no cargado", () => {
    for (const ruta of [
      "/v1/constantes/uma/{anio}",
      "/v1/constantes/salario-minimo/{anio}",
      "/v1/isr/tarifa/{periodo}/{anio}",
    ]) {
      const op = operaciones.find((o) => o.ruta === ruta)?.op as Obj;
      expect(op.responses["404"], ruta).toEqual({ $ref: "#/components/responses/SinAnio" });
    }
    const { description } = doc.components.responses.SinAnio;
    expect(description).toContain("no-encontrado");
    expect(description).toContain("dato-no-disponible");
    expect(doc.components.responses.SinAnio.content).toEqual({
      "application/problem+json": { schema: { $ref: "#/components/schemas/Problema" } },
    });
  });

  it("permitir_incompleto dice que fuera de la cobertura se descuentan los días publicados", () => {
    const op = operaciones.find((o) => o.ruta === "/v1/dias-habiles")?.op as Obj;
    const permitir = (op.parameters as Obj[]).find((p) => p.name === "permitir_incompleto");
    expect(permitir?.description).toContain("publicados");
    expect(permitir?.description).toContain("advertencia");
    expect(permitir?.description).toContain("fines de semana");
  });

  it("las constantes van en la etiqueta Constantes y responden su esquema", () => {
    const constantes = operaciones
      .filter((o) => o.op.tags.includes("Constantes"))
      .map((o) => o.op.operationId);
    expect(constantes).toEqual([
      "consultarUma",
      "obtenerUma",
      "obtenerSalarioMinimo",
      "obtenerTarifaIsr",
    ]);
    expect(doc.tags.map((t: Obj) => t.name)).toContain("Constantes");
    expect(esquema200("/v1/constantes/uma").properties.data).toEqual({
      $ref: "#/components/schemas/Uma",
    });
    expect(esquema200("/v1/constantes/uma/{anio}").properties.data).toEqual({
      $ref: "#/components/schemas/Uma",
    });
    expect(esquema200("/v1/constantes/salario-minimo/{anio}").properties.data).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/SalarioMinimo" },
    });
    expect(esquema200("/v1/isr/tarifa/{periodo}/{anio}").properties.data).toEqual({
      $ref: "#/components/schemas/TarifaIsr",
    });
  });

  it("Uma, SalarioMinimo y TarifaIsr citan su fuente con FuenteDof, con montos de dos decimales", () => {
    const { Uma, SalarioMinimo, TarifaIsr, TramoIsr, FuenteDof } = doc.components.schemas;
    for (const [nombre, esquema] of Object.entries({ Uma, SalarioMinimo, TarifaIsr })) {
      expect((esquema as Obj).properties.fuente.$ref, nombre).toBe(
        "#/components/schemas/FuenteDof",
      );
    }
    expect([...FuenteDof.required].sort()).toEqual([
      "fecha_publicacion",
      "fragmento",
      "nombre",
      "url",
    ]);
    expect(TarifaIsr.properties.tramos.items).toEqual({ $ref: "#/components/schemas/TramoIsr" });
    const monto = "^(0|[1-9]\\d*)\\.\\d{2}$";
    for (const campo of ["diaria", "mensual", "anual"]) {
      expect(Uma.properties[campo].pattern, campo).toBe(monto);
    }
    expect(SalarioMinimo.properties.diario.pattern).toBe(monto);
    expect(SalarioMinimo.properties.zona.enum).toEqual(["general", "zlfn"]);
    expect(TarifaIsr.properties.periodo.enum).toEqual(["mensual", "anual"]);
    expect(Uma.properties.anio.type).toBe("integer");
    expect(TramoIsr.properties.limite_inferior.pattern).toBe(monto);
    expect(TramoIsr.properties.limite_superior.anyOf).toEqual([
      { type: "string", pattern: monto },
      { type: "null" },
    ]);
    expect([...TramoIsr.required].sort()).toEqual([
      "cuota_fija",
      "limite_inferior",
      "limite_superior",
      "tasa_excedente",
    ]);
  });

  it("consultarFix dice que se indica exactamente uno de publicado u operacion", () => {
    const op = operaciones.find((o) => o.ruta === "/v1/tipo-cambio/fix")?.op as Obj;
    expect(op.description).toContain("exactamente uno de publicado u operacion");
    expect(op.description).toContain("parametro-faltante");
    expect(op.description).toContain("parametro-invalido");
  });

  it("las operaciones de FIX y UDIS van en la etiqueta Indicadores", () => {
    const indicadores = operaciones
      .filter((o) => o.op.tags.includes("Indicadores"))
      .map((o) => o.op.operationId);
    expect(indicadores).toEqual(["consultarFix", "ultimoFix", "consultarUdi"]);
    expect(doc.tags.map((t: Obj) => t.name)).toContain("Indicadores");
  });

  it("FIX y UDIS responden 404 con los dos tipos de problema", () => {
    for (const ruta of ["/v1/tipo-cambio/fix", "/v1/udis"]) {
      const op = operaciones.find((o) => o.ruta === ruta)?.op as Obj;
      expect(op.responses["404"], ruta).toEqual({ $ref: "#/components/responses/SinDato" });
    }
    const sinDato = doc.components.responses.SinDato;
    expect(sinDato.content["application/problem+json"].schema).toEqual({
      $ref: "#/components/schemas/Problema",
    });
    expect(sinDato.description).toContain("no-encontrado");
    expect(sinDato.description).toContain("dato-no-disponible");
    expect(PROBLEMAS["dato-no-disponible"]).toEqual({
      title: "Dato todavía no disponible",
      status: 404,
    });
  });

  it("la respuesta de consultarFix es TipoCambioFix o FixOperacion", () => {
    const schema = esquema200("/v1/tipo-cambio/fix");
    // anyOf y no oneOf: con esquemas abiertos, una FixOperacion también cumple TipoCambioFix.
    expect(schema.properties.data).toEqual({
      anyOf: [
        { $ref: "#/components/schemas/TipoCambioFix" },
        { $ref: "#/components/schemas/FixOperacion" },
      ],
    });
    expect(esquema200("/v1/tipo-cambio/fix/ultimo").properties.data).toEqual({
      $ref: "#/components/schemas/TipoCambioFix",
    });
    expect(esquema200("/v1/udis").properties.data).toEqual({ $ref: "#/components/schemas/Udi" });
  });

  it("DiaInhabil y FixOperacion citan su fuente con el esquema Fuente", () => {
    const { DiaInhabil, FixOperacion, Fuente } = doc.components.schemas;
    expect(DiaInhabil.properties.fuente.$ref).toBe("#/components/schemas/Fuente");
    expect(FixOperacion.properties.fundamento.$ref).toBe("#/components/schemas/Fuente");
    expect([...FixOperacion.required].sort()).toEqual([
      "fecha_operacion",
      "fecha_publicacion",
      "fundamento",
      "valor",
    ]);
    expect([...Fuente.required].sort()).toEqual(["nombre", "url"]);
    expect(Object.keys(Fuente.properties).sort()).toEqual([
      "fecha_publicacion",
      "fragmento",
      "nombre",
      "url",
    ]);
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
        "FixOperacion",
        "Fuente",
        "FuenteDof",
        "FuenteMeta",
        "Indice",
        "Meta",
        "Municipio",
        "PeriodoBanco",
        "Problema",
        "ResultadoClabe",
        "ResultadoDiasHabiles",
        "SalarioMinimo",
        "TarifaIsr",
        "TipoCambioFix",
        "TramoIsr",
        "Udi",
        "Uma",
      ].sort(),
    );
    for (const esquema of Object.values(doc.components.schemas as Obj)) {
      expect(esquema.$schema).toBeUndefined();
    }
  });

  it(
    "los esquemas de cada dataset validan su primer registro real",
    async () => {
      const ajv = new Ajv2020({ strict: false });
      const casos: Array<[string, string]> = [
        ["Estado", "inegi-estados/estados.json"],
        ["Municipio", "inegi-municipios/municipios.json"],
        ["Banco", "bancos/bancos.json"],
        ["TipoCambioFix", "tipo-cambio-fix/fix.json"],
        ["Udi", "udis/udis.json"],
        ["Uma", "constantes-uma/uma.json"],
        ["SalarioMinimo", "constantes-salario-minimo/salario-minimo.json"],
        ["TarifaIsr", "isr-tarifas/tarifas.json"],
        // Un día del calendario de la CNBV o del SAT es un DiaInhabil sin `autoridad`.
        ["DiaInhabil", "dias-inhabiles-sat/dias-inhabiles.json"],
        ["DiaInhabil", "dias-inhabiles-cnbv/dias-inhabiles.json"],
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

      const real = async (archivo: string) =>
        (await leerJson(new URL(`../../../../data/${archivo}`, import.meta.url))) as Obj[];
      const [uma] = await real("constantes-uma/uma.json");
      const salario = await real("constantes-salario-minimo/salario-minimo.json");
      const tarifas = await real("isr-tarifas/tarifas.json");
      expect(sobre(esquemaUma).safeParse({ data: uma, meta }).success).toBe(true);
      expect(sobre(esquemaSalarioMinimo.array()).safeParse({ data: salario, meta }).success).toBe(
        true,
      );
      for (const t of tarifas) {
        expect(sobre(esquemaTarifaIsr).safeParse({ data: t, meta }).success).toBe(true);
      }
      expect(sobre(esquemaUma).safeParse({ data: { ...uma, diaria: "117.3" }, meta }).success).toBe(
        false,
      );
    },
    PRUEBA_LENTA,
  );

  it(
    "FIX, FixOperacion y UDI de los datos reales validan contra el documento y zod",
    async () => {
      const fix = (await leerJson(
        new URL("../../../../data/tipo-cambio-fix/fix.json", import.meta.url),
      )) as Array<{ fecha_publicacion: string; valor: string }>;
      const udis = (await leerJson(
        new URL("../../../../data/udis/udis.json", import.meta.url),
      )) as unknown[];
      const publicado = fix.at(-1) as { fecha_publicacion: string; valor: string };
      const operacion = {
        fecha_operacion: "2026-10-19",
        fecha_publicacion: publicado.fecha_publicacion,
        valor: publicado.valor,
        fundamento: FUENTE_CFF_20,
      };
      const meta = {
        dataset: "tipo-cambio.fix",
        as_of: "2026-10-18",
        sources: [
          { name: "n", url: "https://x", license: "l", license_url: "https://l", citation: "c" },
        ],
        docs: "https://d",
      };
      const ajv = new Ajv2020({ strict: false });
      const respuesta = (ruta: string) =>
        ajv.compile({ components: doc.components, ...esquema200(ruta) });
      const consultar = respuesta("/v1/tipo-cambio/fix");
      expect(consultar({ data: publicado, meta }), JSON.stringify(consultar.errors)).toBe(true);
      expect(consultar({ data: operacion, meta }), JSON.stringify(consultar.errors)).toBe(true);
      expect(consultar({ data: { valor: publicado.valor }, meta })).toBe(false);
      const udi = respuesta("/v1/udis");
      expect(udi({ data: udis[0], meta: { ...meta, dataset: "udis" } })).toBe(true);
      expect(respuesta("/v1/tipo-cambio/fix/ultimo")({ data: publicado, meta })).toBe(true);

      expect(sobre(esquemaTipoCambioFix).safeParse({ data: publicado, meta }).success).toBe(true);
      expect(sobre(esquemaFixOperacion).safeParse({ data: operacion, meta }).success).toBe(true);
      expect(sobre(esquemaUdi).safeParse({ data: udis[0], meta }).success).toBe(true);
      const sinFundamento = { ...operacion, fundamento: undefined };
      expect(sobre(esquemaFixOperacion).safeParse({ data: sinFundamento, meta }).success).toBe(
        false,
      );
    },
    PRUEBA_LENTA,
  );

  it("Problema.type nombra la base de los tipos de problema", () => {
    const base = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";
    const descripcion = doc.components.schemas.Problema.properties.type.description as string;
    expect(descripcion).toContain(`${base}<tipo>`);
    // La misma frase de docs/api/problemas.md.
    expect(descripcion).toContain(
      "Es un identificador estable: dentro de /v1 no cambia, aunque la API llegue a un dominio propio. Para distinguir un error, compara el type completo o la parte después de #.",
    );
    for (const tipo of Object.keys(PROBLEMAS)) expect(descripcion).toContain(tipo);
    expect(Object.keys(PROBLEMAS).sort()).toEqual([
      "calendario-incompleto",
      "dato-no-disponible",
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
      "/v1/constantes/uma/{anio}",
      "/v1/constantes/salario-minimo/{anio}",
      "/v1/isr/tarifa/{periodo}/{anio}",
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
    // `fecha` y `cobertura` sirven también para las series (FIX y UDIS).
    expect(p.properties.fecha.description).toContain("la serie");
    expect(p.properties.cobertura.description).toContain("la serie");
  });

  // En un 422 `fecha` es el primer día sin cobertura, no la fecha pedida; en un 404 de una serie
  // o de la UMA es la de la consulta, que puede estar cubierta (un día sin publicación del FIX).
  it("Problema.fecha dice qué fecha lleva en el 422 y en el 404", () => {
    const { description } = doc.components.schemas.Problema.properties.fecha;
    expect(description).toContain("primer día del cálculo que el calendario no cubre");
    expect(description).toContain("la fecha de la consulta (publicado, operacion o fecha)");
    expect(description).toContain("puede estar dentro de la cobertura");
    expect(description).not.toContain("Fecha pedida que el calendario o la serie no cubre");
  });

  // La ruta revisa longitud y caracteres antes (400): en la API, formato_valido en false solo
  // significa un banco que no está en el catálogo.
  it("ResultadoClabe dice qué revisa formato_valido y solo enumera los errores que da la API", () => {
    const { properties } = doc.components.schemas.ResultadoClabe;
    expect(properties.formato_valido.description).toContain("código de banco");
    expect(properties.formato_valido.description).toContain("catálogo");
    expect(properties.errores.items.enum).toEqual(["banco", "digito_verificador"]);
    // Lo que solo da el paquete va en la descripción.
    for (const codigo of ["vacio", "caracteres", "longitud"]) {
      expect(properties.errores.description, codigo).toContain(codigo);
    }
    const plaza = properties.detalle.anyOf[0].properties.plaza;
    expect(plaza.description).toContain("Por ahora es siempre null");
    expect(plaza.description).toContain("catálogo de plazas de la CLABE está pendiente (v1.1)");
  });

  // Un día publicado que cae en sábado (el 12 de diciembre de 2026 de la CNBV) sí se lista.
  it("inhabiles_saltados dice que los fines de semana no se listan por serlo", () => {
    const { description } =
      doc.components.schemas.ResultadoDiasHabiles.properties.inhabiles_saltados;
    expect(description).toContain("Los fines de semana no se listan por serlo");
    expect(description).toContain("un día publicado que cae en fin de semana sí");
  });

  it("DiaInhabil.tipo solo enumera los tipos que da la API; fin_de_semana es del paquete", () => {
    const { tipo } = doc.components.schemas.DiaInhabil.properties;
    expect(tipo.enum).toEqual(["descanso", "vacaciones"]);
    expect(tipo.description).toContain("fin_de_semana");
    expect(tipo.description).toContain("paquete");
  });
});

// Las reglas de los parámetros son las del núcleo, las que aplican la API y el paquete: el
// documento no puede declarar un parámetro sin regla ni dejar fuera uno que la API revisa.
describe("parámetros y reglas del núcleo", () => {
  const consultas = CONSULTAS as Readonly<Record<string, Readonly<Record<string, ReglaConsulta>>>>;
  const delDocumento = (op: Obj, donde: "path" | "query"): Obj[] =>
    ((op.parameters ?? []) as Obj[]).filter((p) => p.in === donde);
  const comoEsquema = (regla: ReglaParametro): Obj =>
    regla.valores === undefined ? { pattern: regla.patron.source } : { enum: [...regla.valores] };

  it("cada parámetro de ruta tiene la regla del núcleo de su nombre", () => {
    for (const { ruta, op } of operaciones) {
      const nombres = [...ruta.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const declarados = delDocumento(op, "path");
      expect(declarados.map((p) => p.name).sort(), ruta).toEqual([...nombres].sort());
      for (const p of declarados) {
        const regla = (REGLAS_RUTA as Readonly<Record<string, ReglaParametro>>)[p.name];
        expect(regla, `${ruta} ${p.name}`).toBeDefined();
        expect(p.required).toBe(true);
        expect(p.schema).toMatchObject({ type: "string", ...comoEsquema(regla as ReglaParametro) });
      }
    }
  });

  it("la query de cada ruta es la del núcleo, con su regla y si es obligatoria", () => {
    for (const { ruta, op } of operaciones) {
      const reglas = consultas[ruta] ?? {};
      const declarados = delDocumento(op, "query");
      expect(
        declarados.map((p) => p.name),
        ruta,
      ).toEqual(Object.keys(reglas));
      for (const p of declarados) {
        const regla = reglas[p.name] as ReglaConsulta;
        expect(p.required, `${ruta} ${p.name}`).toBe(regla.obligatorio === true);
        expect(p.schema, `${ruta} ${p.name}`).toMatchObject({
          type: "string",
          ...comoEsquema(regla),
        });
      }
    }
    // Ninguna ruta del núcleo con query queda fuera del documento.
    const conQuery = operaciones.filter(({ op }) => delDocumento(op, "query").length > 0);
    expect(conQuery.map((o) => o.ruta).sort()).toEqual(Object.keys(consultas).sort());
  });

  // Un validador de JSON Schema con el `pattern` publicado acepta lo mismo que la API: anio sin
  // 0000 y dias hasta 3650, sin ceros a la izquierda.
  it("un validador con el schema publicado acepta anio y dias como la API", () => {
    const ajv = new Ajv2020({ strict: false });
    const schemaDe = (ruta: string, nombre: string): Obj =>
      ((operaciones.find((o) => o.ruta === ruta)?.op.parameters ?? []) as Obj[]).find(
        (p) => p.name === nombre,
      )?.schema;
    const casos: Array<[Obj, RegExp, string[], string[]]> = [
      [
        schemaDe("/v1/dias-habiles", "dias"),
        CONSULTAS["/v1/dias-habiles"].dias?.patron as RegExp,
        ["1", "10", "999", "1000", "2999", "3000", "3599", "3600", "3649", "3650"],
        ["0", "01", "3651", "3700", "4000", "9999", "10000", "+3", "1.5", "1e3"],
      ],
      [
        schemaDe("/v1/dias-inhabiles", "anio"),
        CONSULTAS["/v1/dias-inhabiles"].anio?.patron as RegExp,
        ["0001", "0010", "0100", "1000", "2026", "9999"],
        ["0000", "26", "20266", "２０２６"],
      ],
      [
        schemaDe("/v1/constantes/uma/{anio}", "anio"),
        REGLAS_RUTA.anio.patron,
        ["0001", "2026", "9999"],
        ["0000", "026"],
      ],
    ];
    for (const [schema, patron, buenos, malos] of casos) {
      const validar = ajv.compile(schema);
      for (const v of buenos) {
        expect(validar(v), v).toBe(true);
        expect(patron.test(v), v).toBe(true);
      }
      for (const v of malos) {
        expect(validar(v), v).toBe(false);
        expect(patron.test(v), v).toBe(false);
      }
    }
  });

  it("las fechas se publican con format date además del patrón", () => {
    for (const { ruta, op } of operaciones) {
      for (const p of delDocumento(op, "query")) {
        const regla = consultas[ruta]?.[p.name] as ReglaConsulta;
        const esFecha = regla.patron.source === FECHA;
        expect(p.schema.format === "date", `${ruta} ${p.name}`).toBe(esFecha);
      }
    }
  });

  // En Python o .NET, \d acepta cualquier dígito Unicode: un validador generado de este documento
  // aceptaría "２０２６", que la API rechaza. Los patrones publicados solo usan [0-9] y ASCII.
  it("los patrones de los parámetros solo aceptan dígitos ASCII", () => {
    const ajv = new Ajv2020({ strict: false });
    let vistos = 0;
    for (const { ruta, op } of operaciones) {
      for (const p of (op.parameters ?? []) as Obj[]) {
        const { pattern } = p.schema as { pattern?: string };
        if (pattern === undefined) continue;
        vistos += 1;
        const contexto = `${ruta} ${p.name}`;
        expect(pattern, contexto).not.toMatch(/\\[dDwWsSb]/);
        expect(pattern, contexto).toMatch(/^[\x20-\x7e]+$/);
        const ancho = String(p.example).replace(/[0-9]/g, (d) =>
          String.fromCodePoint(0xff10 + Number(d)),
        );
        expect(ancho, contexto).not.toBe(p.example);
        expect(ajv.compile({ type: "string", pattern })(ancho), `${contexto} ${ancho}`).toBe(false);
      }
    }
    expect(vistos).toBeGreaterThan(10);
  });
});
