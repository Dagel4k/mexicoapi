import { bancos, estados, municipios } from "mexicoapi/datos";
import { describe, expect, it } from "vitest";
import { crearRegistro, type Herramienta } from "../src/herramientas.js";
import { conectar } from "./ayudas.js";
import { herramientasSinRed } from "./ayudas-herramientas.js";
import { COLONIAS_FIXTURE } from "./ayudas-sepomex.js";

const herramientas = herramientasSinRed();
/** Las mismas, como si hubiera MEXICOAPI_BASE: las de datos que caducan pueden usar la red. */
const conApi = herramientasSinRed({ conApi: true });

/** Lo que se publica de cada herramienta en tools/list. */
const definicion = ({ ejecutar: _, ...resto }: Herramienta) => resto;

const NOMBRES = [
  "buscar_municipio",
  "municipio",
  "validar_clabe",
  "banco_por_codigo",
  "validar_rfc",
  "validar_curp",
  "validar_nss",
  "tipo_de_cambio_fix",
  "udis",
  "dias_inhabiles",
  "sumar_dias_habiles",
  "constantes",
  "codigo_postal",
];

/** Las que pueden consultar la API: los datos que caducan. */
const CON_API = new Set([
  "tipo_de_cambio_fix",
  "udis",
  "dias_inhabiles",
  "sumar_dias_habiles",
  "constantes",
]);

describe("catálogo de herramientas", () => {
  it("publica las herramientas en orden y el registro las acepta", () => {
    expect(herramientas.map((h) => h.name)).toEqual(NOMBRES);
    expect([...crearRegistro(herramientas).keys()]).toEqual(NOMBRES);
  });

  it("todas son de solo lectura e idempotentes; sin MEXICOAPI_BASE ninguna usa la red", () => {
    for (const h of herramientas) {
      expect(h.annotations, h.name).toEqual({
        readOnlyHint: true,
        openWorldHint: false,
        idempotentHint: true,
      });
      expect(h.outputSchema, h.name).toBeDefined();
    }
  });

  it("con MEXICOAPI_BASE, solo las de datos que caducan pueden usar la red", () => {
    for (const h of conApi) {
      expect(h.annotations, h.name).toEqual({
        readOnlyHint: true,
        openWorldHint: CON_API.has(h.name),
        idempotentHint: true,
      });
    }
  });

  // Las descripciones y los esquemas son constantes versionadas: cambiarlos exige actualizar esta
  // instantánea a propósito (vitest -u) y revisarla en el diff.
  it("fija nombre, título, descripción, esquemas y anotaciones de cada herramienta", () => {
    expect(herramientas.map(definicion)).toMatchSnapshot();
  });

  it("fija las anotaciones de cada herramienta sin y con MEXICOAPI_BASE", () => {
    const anotaciones = Object.fromEntries(
      herramientas.map((h, i) => [
        h.name,
        { sinApi: h.annotations, conApi: conApi[i]?.annotations },
      ]),
    );
    expect(anotaciones).toMatchSnapshot();
  });

  it("con MEXICOAPI_BASE solo cambia openWorldHint; el cliente y dirSepomex no cambian nada", () => {
    const sinAnotaciones = ({ annotations: _, ...resto }: ReturnType<typeof definicion>) => resto;
    expect(conApi.map(definicion).map(sinAnotaciones)).toEqual(
      herramientas.map(definicion).map(sinAnotaciones),
    );
    const otras = herramientasSinRed({ dirSepomex: "otro" });
    expect(otras.map(definicion)).toEqual(herramientas.map(definicion));
  });

  it("tools/list publica las mismas definiciones", async () => {
    const cliente = conectar({ herramientas });
    await cliente.inicializar();
    const lista = await cliente.pedir("tools/list");
    const tools = (lista.result as { tools: unknown[] }).tools;
    expect(tools).toEqual(JSON.parse(JSON.stringify(herramientas.map(definicion))));
  });
});

/** Minúsculas, sin acentos y con cualquier signo como espacio, entre espacios. */
const normalizar = (texto: string): string =>
  ` ${texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;

/** Cada title y description de las definiciones, también los de los esquemas. */
function textosDe(valor: unknown, textos: string[] = []): string[] {
  if (Array.isArray(valor)) for (const v of valor) textosDe(v, textos);
  else if (typeof valor === "object" && valor !== null) {
    for (const [clave, v] of Object.entries(valor)) {
      if ((clave === "title" || clave === "description") && typeof v === "string") textos.push(v);
      else textosDe(v, textos);
    }
  }
  return textos;
}

describe("las descripciones no traen texto de los datos (Review Focus 5)", () => {
  // Palabras que también son nombre de un dato y se usan a propósito: "México" es el país (y uno
  // de los 32 estados) y "Frontera" va en "Zona Libre de la Frontera Norte" (también es un
  // municipio de Coahuila).
  const PERMITIDOS = new Set(["México", "Frontera"].map(normalizar));
  const textos = textosDe(herramientas.map(definicion)).map(normalizar);

  const revisar = (nombres: readonly string[]) => {
    const encontrados: string[] = [];
    for (const nombre of new Set(nombres.map(normalizar))) {
      if (nombre.trim() === "" || PERMITIDOS.has(nombre)) continue;
      if (textos.some((t) => t.includes(nombre))) encontrados.push(nombre.trim());
    }
    return encontrados;
  };

  it("revisa títulos y descripciones de herramientas y esquemas", () => {
    expect(textos.length).toBeGreaterThan(NOMBRES.length * 2);
  });

  it("ningún nombre de banco ni razón social", () => {
    const nombres = bancos().flatMap((b) => [
      b.nombre_corto,
      b.razon_social ?? "",
      ...b.historial.map((h) => h.nombre_corto),
    ]);
    expect(revisar(nombres)).toEqual([]);
  });

  it("ningún nombre de estado, municipio ni colonia", () => {
    const nombres = [
      ...estados().map((e) => e.nombre),
      ...municipios().map((m) => m.nombre),
      ...COLONIAS_FIXTURE,
    ];
    expect(revisar(nombres)).toEqual([]);
  });
});
