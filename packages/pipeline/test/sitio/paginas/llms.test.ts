import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { URL_API } from "@mexicoapi/core/problemas";
import { describe, expect, it } from "vitest";
import { PUBLICADO_EN_NPM } from "../../../src/sitio/comun.js";
import { URL_ARCHIVOS, URL_DOCS } from "../../../src/sitio/meta.js";
import { documentoOpenApi } from "../../../src/sitio/openapi.js";
import { CATALOGO } from "../../../src/sitio/paginas/catalogo.js";
import {
  archivoLlms,
  archivoLlmsCompleto,
  type DatasetLlms,
  enlacesAbsolutos,
  ordenLlmsCompleto,
} from "../../../src/sitio/paginas/llms.js";

const RAIZ = fileURLToPath(new URL("../../../../../", import.meta.url));

const DATASETS: DatasetLlms[] = [
  {
    id: "inegi.estados",
    as_of: "2026-10-17",
    docs: `${URL_DOCS}/datos/inegi-estados.md`,
  },
  {
    id: "dias-inhabiles.cnbv",
    as_of: "2025-12-20",
    docs: `${URL_DOCS}/datos/dias-inhabiles-cnbv.md`,
  },
];

const texto = archivoLlms(DATASETS);
const lineas = texto.split("\n");

/** Los renglones de lista de una sección `## nombre`. */
function seccion(nombre: string): string[] {
  const inicio = lineas.indexOf(`## ${nombre}`);
  expect(inicio, nombre).toBeGreaterThan(0);
  const fin = lineas.findIndex((l, i) => i > inicio && l.startsWith("## "));
  return lineas.slice(inicio + 1, fin === -1 ? undefined : fin).filter((l) => l !== "");
}

/** `[texto](destino)` de cada enlace de Markdown. */
const enlaces = (md: string): string[] =>
  [...md.matchAll(/\]\(([^)\s]*)\)/g)].map((m) => m[1] ?? "");

describe("llms.txt", () => {
  it("sigue el formato de llmstxt.org: título, resumen en cita y secciones de enlaces", () => {
    expect(lineas[0]).toBe("# MéxicoAPI");
    expect(lineas[1]).toBe("");
    expect(lineas[2]).toMatch(/^> \S/);
    expect(lineas.filter((l) => l.startsWith("# "))).toHaveLength(1);
    expect(lineas.filter((l) => l.startsWith("## "))).toEqual([
      "## Docs",
      "## Datos",
      "## Optional",
    ]);
    for (const nombre of ["Docs", "Datos", "Optional"]) {
      for (const linea of seccion(nombre)) {
        expect(linea, nombre).toMatch(/^- \[[^\]]+\]\((https:\/\/|\/)[^)\s]+\)(: \S.*)?$/);
      }
    }
    expect(texto.endsWith("\n")).toBe(true);
    expect(texto).not.toContain("\n\n\n");
    expect(texto).not.toContain("\r");
  });

  it("dice la base, el sobre de las respuestas y que un dato no disponible no se inventa", () => {
    const intro = lineas.slice(3, lineas.indexOf("## Docs")).join("\n");
    expect(intro).toContain("`/v1`");
    expect(intro).toContain('`{ "data": …, "meta": … }`');
    expect(intro).toContain("`dato-no-disponible`");
    expect(intro).toContain("`calendario-incompleto`");
    expect(intro).toContain("no lo inventes ni lo estimes");
    expect(intro).toContain(`La API pública es \`${URL_API}\``);
    expect(intro).not.toContain("<base>");
  });

  it("Docs: la referencia, los errores, las rutas de cálculo, el OpenAPI y llms-full.txt", () => {
    const docs = seccion("Docs");
    expect(docs.map((l) => enlaces(l)[0])).toEqual([
      `${URL_DOCS}/api/README.md`,
      `${URL_DOCS}/api/problemas.md`,
      `${URL_DOCS}/api/README.md#clabe`,
      `${URL_DOCS}/api/README.md#dias-habiles`,
      `${URL_DOCS}/api/README.md#último`,
      "/v1/openapi.json",
      "/llms-full.txt",
    ]);
    expect(docs[2]).toMatch(/^- \[GET \/v1\/clabe\/\{clabe\}\]\(/);
    // La plaza no se valida: no hay catálogo oficial y `detalle.plaza` siempre es null.
    expect(docs[2]).toContain("formato, dígito verificador y banco");
    expect(docs[2]).not.toContain("plaza");
    expect(docs[3]).toMatch(
      /^- \[GET \/v1\/dias-habiles\?autoridad=\{lft\|cnbv\|sat\}&desde=\{fecha\}&dias=\{n\}\]\(/,
    );
    expect(docs[3]).toContain(
      "con `autoridad=sat`, `tipo_plazo` (`general` o `declaraciones_pagos`) es obligatorio",
    );
    // Lo que no descuenta la LFT y qué fecha va en desde.
    expect(docs[3]).toContain(
      "no incluye los festivos ni las suspensiones de labores del art. 715",
    );
    expect(docs[3]).toContain("`desde` es el día en que surte efectos la notificación");
    expect(docs[4]).toMatch(/^- \[GET \/v1\/tipo-cambio\/fix\/ultimo\]\(/);
    expect(texto).toContain("Las fechas van en `AAAA-MM-DD`.");
  });

  // Quien arme una petición con estos renglones no debe adivinar parámetros ni seguir un ancla rota.
  it("las rutas de cálculo existen en el OpenAPI con sus obligatorios y sus anclas en la referencia", async () => {
    const doc = documentoOpenApi() as unknown as {
      paths: Record<
        string,
        { get: { parameters?: { name?: string; required?: boolean; $ref?: string }[] } }
      >;
      components: { parameters?: Record<string, { name: string; required?: boolean }> };
    };
    const rutas = seccion("Docs")
      .map((l) => /^- \[GET ([^\]]+)\]/.exec(l)?.[1])
      .filter((r): r is string => r !== undefined);
    expect(rutas).toHaveLength(3);
    for (const ruta of rutas) {
      const [camino, consulta = ""] = ruta.split("?") as [string, string?];
      expect(Object.keys(doc.paths), ruta).toContain(camino);
      const obligatorios = (doc.paths[camino]?.get.parameters ?? [])
        .map((p) =>
          p.$ref === undefined ? p : doc.components.parameters?.[p.$ref.split("/").at(-1) ?? ""],
        )
        .filter((p) => p?.required === true)
        .map((p) => p?.name as string);
      const mostrados = [...camino.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const nombre of new URLSearchParams(consulta).keys()) mostrados.push(nombre);
      for (const nombre of obligatorios) expect(mostrados, `${ruta}: ${nombre}`).toContain(nombre);
    }
    const referencia = await readFile(`${RAIZ}docs/api/README.md`, "utf8");
    const anclas = new Set(
      [...referencia.matchAll(/^#{2,3} (.+)$/gm)].map((m) =>
        (m[1] as string)
          .replaceAll("`", "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\- ]/gu, "")
          .replaceAll(" ", "-"),
      ),
    );
    for (const destino of enlaces(texto).filter((e) =>
      e.startsWith(`${URL_DOCS}/api/README.md#`),
    )) {
      expect([...anclas], destino).toContain(destino.split("#")[1]);
    }
  });

  it("Datos: un renglón por dataset con nombre, as_of, ruta con sus parámetros y su doc", () => {
    expect(seccion("Datos")).toEqual([
      `- [Estados](${URL_DOCS}/datos/inegi-estados.md): \`inegi.estados\`, as_of 2026-10-17, \`GET /v1/estados\``,
      `- [Días inhábiles de la CNBV](${URL_DOCS}/datos/dias-inhabiles-cnbv.md): \`dias-inhabiles.cnbv\`, as_of 2025-12-20, \`GET /v1/dias-inhabiles?autoridad=cnbv&anio={anio}\``,
    ]);
  });

  it("cada ruta del catálogo sale tal cual, con sus parámetros obligatorios", () => {
    const todos = Object.keys(CATALOGO).map((id) => ({
      id,
      as_of: "2026-10-17",
      docs: `${URL_DOCS}/datos/${id}.md`,
    }));
    const datos = archivoLlms(todos);
    for (const { ruta } of Object.values(CATALOGO)) expect(datos).toContain(`\`GET ${ruta}\``);
  });

  // Un dataset nuevo sale de su manifiesto: aparece sin tocar este generador ni el catálogo.
  it("un dataset que el catálogo no conoce aparece con su id y sin ruta de la API", () => {
    const nuevo = archivoLlms([
      ...DATASETS,
      {
        id: "nuevo.dataset",
        as_of: "2026-10-18",
        docs: `${URL_DOCS}/datos/nuevo-dataset.md`,
      },
    ]);
    expect(nuevo).toContain(
      `- [nuevo.dataset](${URL_DOCS}/datos/nuevo-dataset.md): \`nuevo.dataset\`, as_of 2026-10-18, sin ruta propia en la API; está en las descargas\n`,
    );
  });

  // Ninguna URL de datos entra a un enlace si no empieza con https://, y el texto de datos no
  // puede abrir un renglón, un encabezado ni otro enlace.
  it("una doc que no es https no se enlaza y el texto de datos no rompe el Markdown", () => {
    const raro = archivoLlms([
      {
        id: "a](https://malo.mx)\n## b `c`",
        as_of: "2026-10-18\r\n# x",
        docs: "javascript:alert(1)",
      },
      { id: "d", as_of: "2026-10-18", docs: "http://inseguro.mx/d.md" },
      { id: "e", as_of: "2026-10-18", docs: "https://ejemplo.mx/con espacio" },
    ]);
    const datos = raro.split("\n## Datos\n")[1]?.split("\n## ")[0] ?? "";
    expect(datos).not.toContain("javascript:");
    expect(datos).not.toContain("http://");
    expect(datos).not.toContain("](https://malo.mx");
    expect(datos).not.toContain("](https://ejemplo.mx");
    expect(raro.split("\n").filter((l) => l.startsWith("#"))).toEqual([
      "# MéxicoAPI",
      "## Docs",
      "## Datos",
      "## Optional",
    ]);
    expect(datos.trim().split("\n")).toHaveLength(3);
    expect(datos).toContain("- a\\]\\(https://malo.mx\\) ## b \\`c\\`: ");
    expect(datos).toContain(", as_of 2026-10-18  # x, ");
    expect(datos).toContain("- d: `d`, as_of 2026-10-18");
    expect(datos).toContain("- e: `e`, as_of 2026-10-18");
  });

  it("dice que el paquete y el servidor MCP todavía no están en npm mientras no lo estén", () => {
    expect(PUBLICADO_EN_NPM).toBe(false);
    expect(texto).toContain("todavía no están publicados en npm");
    expect(texto).not.toContain("npx");
    expect(texto).not.toContain("npm install");
    const publicado = archivoLlms(DATASETS, true);
    expect(publicado).not.toContain("no están publicados");
    expect(publicado).toContain("`npm install mexicoapi`");
    expect(publicado).toContain("`npx -y mexicoapi-mcp`");
  });

  it("Optional: descargas, diseño técnico y seguridad; los enlaces al repositorio existen", async () => {
    expect(seccion("Optional").map((l) => enlaces(l)[0])).toEqual([
      "/descargas/SHA256SUMS",
      `${URL_DOCS}/diseno/arquitectura-v1.md`,
      `${URL_ARCHIVOS}/SECURITY.md`,
    ]);
    const delRepo = enlaces(texto)
      .filter((e) => e.startsWith(`${URL_ARCHIVOS}/`))
      .map((e) => e.slice(URL_ARCHIVOS.length + 1).split("#")[0] as string);
    expect(delRepo.length).toBeGreaterThanOrEqual(6);
    for (const ruta of delRepo)
      await expect(access(`${RAIZ}${ruta}`), ruta).resolves.toBeUndefined();
  });
});

describe("enlacesAbsolutos", () => {
  const BASE = URL_ARCHIVOS;

  it("resuelve los relativos contra la carpeta del archivo, con su ancla", () => {
    expect(enlacesAbsolutos("docs/datos/udis.md", "ver [x](../api/README.md#udis).")).toBe(
      `ver [x](${BASE}/docs/api/README.md#udis).`,
    );
    expect(enlacesAbsolutos("docs/api/README.md", "[e](problemas.md#no-encontrado)")).toBe(
      `[e](${BASE}/docs/api/problemas.md#no-encontrado)`,
    );
    expect(enlacesAbsolutos("docs/datos/udis.md", "[l](../../DATA_LICENSE.md)")).toBe(
      `[l](${BASE}/DATA_LICENSE.md)`,
    );
    expect(enlacesAbsolutos("docs/api/README.md", "[c](./x/../../README.md)")).toBe(
      `[c](${BASE}/docs/README.md)`,
    );
    expect(enlacesAbsolutos("docs/api/README.md", "[a](problemas.md#publicado-y-operación)")).toBe(
      `[a](${BASE}/docs/api/problemas.md#publicado-y-operación)`,
    );
  });

  it("una ruta que empieza con / es de la raíz del repositorio, como en GitHub", () => {
    expect(enlacesAbsolutos("docs/api/README.md", "[l](/LICENSE)")).toBe(`[l](${BASE}/LICENSE)`);
  });

  it("deja igual los absolutos y las anclas de la misma página", () => {
    const sin = [
      "[a](https://dof.gob.mx/nota.php?codigo=1&fecha=2)",
      "[b](#dias-habiles)",
      "[c](mailto:seguridad@ejemplo.mx)",
      "[d](http://ejemplo.mx/)",
      "`[no es enlace]` y (paréntesis) sueltos",
    ].join("\n");
    expect(enlacesAbsolutos("docs/api/README.md", sin)).toBe(sin);
  });

  it("también reescribe el destino cuando el enlace trae título", () => {
    expect(enlacesAbsolutos("docs/api/README.md", '[x](problemas.md "Errores")')).toBe(
      `[x](${BASE}/docs/api/problemas.md "Errores")`,
    );
  });

  it("falla con un enlace vacío o que sale del repositorio", () => {
    expect(() => enlacesAbsolutos("docs/api/README.md", "[x]()")).toThrow(/docs\/api\/README.md/);
    expect(() => enlacesAbsolutos("docs/api/README.md", "[x](../../../fuera.md)")).toThrow(
      /sale del repositorio/,
    );
    expect(() => enlacesAbsolutos("README.md", "[x](/../fuera.md)")).toThrow(
      /sale del repositorio/,
    );
  });
});

describe("llms-full.txt", () => {
  it("ordena la referencia, los errores y luego la doc de cada dataset por nombre", () => {
    expect(ordenLlmsCompleto(["udis.md", "bancos.md", "isr-tarifas.md"])).toEqual([
      "docs/api/README.md",
      "docs/api/problemas.md",
      "docs/datos/bancos.md",
      "docs/datos/isr-tarifas.md",
      "docs/datos/udis.md",
    ]);
  });

  it("une los archivos, cada uno precedido de su ruta y con los enlaces absolutos", () => {
    const completo = archivoLlmsCompleto([
      { ruta: "docs/api/README.md", texto: "# API v1\r\n\r\nVer [errores](problemas.md).\n\n" },
      { ruta: "docs/datos/udis.md", texto: "# UDIS\n\n[API](../api/README.md#udis)\n" },
    ]);
    expect(completo).toBe(
      [
        "# docs/api/README.md",
        "",
        "# API v1",
        "",
        `Ver [errores](${URL_ARCHIVOS}/docs/api/problemas.md).`,
        "",
        "# docs/datos/udis.md",
        "",
        "# UDIS",
        "",
        `[API](${URL_ARCHIVOS}/docs/api/README.md#udis)`,
        "",
      ].join("\n"),
    );
  });
});
