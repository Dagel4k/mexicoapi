import { beforeEach, describe, expect, it } from "vitest";
import { reiniciarCargas } from "../../src/cargas.js";
import { manejar } from "../../src/index.js";
import { PROBLEMAS, URL_DOCS, URL_PROBLEMAS } from "../../src/problemas.js";
import { crearAssets, entornoDe, peticion } from "./ayudas.js";

// Los archivos de docs/ por su ruta relativa (`api/README.md`), y los directorios de data/ que
// tienen manifiesto: de cada uno el build publica `<URL_DOCS>/datos/<directorio>.md`.
const DOCS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../../docs/**/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([ruta, texto]) => [ruta.replace("../../../../docs/", ""), texto]),
);
const DIRECTORIOS_DE_DATOS = Object.keys(import.meta.glob("../../../../data/*/manifest.json")).map(
  (ruta) => ruta.split("/").at(-2) as string,
);

/** Ancla que GitHub da a un encabezado: minúsculas, sin puntuación salvo `-` y `_`, con `-`. */
function anclaDe(encabezado: string): string {
  return encabezado
    .replaceAll("`", "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replaceAll(" ", "-");
}

/** Anclas de los encabezados de un Markdown, fuera de los bloques de código. */
function anclas(texto: string): Set<string> {
  const usadas = new Set<string>();
  const cuentas = new Map<string, number>();
  let enCodigo = false;
  for (const linea of texto.split("\n")) {
    if (linea.startsWith("```")) enCodigo = !enCodigo;
    const encabezado = enCodigo ? null : /^#{1,6} (.+)$/.exec(linea)?.[1];
    if (encabezado === undefined || encabezado === null) continue;
    const base = anclaDe(encabezado);
    const n = cuentas.get(base) ?? 0;
    cuentas.set(base, n + 1);
    // GitHub agrega -1, -2… a los encabezados repetidos.
    usadas.add(n === 0 ? base : `${base}-${n}`);
  }
  return usadas;
}

/** El archivo y el ancla a los que apunta un enlace de documentación; falla si no existen. */
function comprobar(url: string): void {
  expect(url.startsWith(`${URL_DOCS}/`), url).toBe(true);
  const [ruta, ancla] = url.slice(URL_DOCS.length + 1).split("#") as [string, string?];
  const texto = DOCS[ruta];
  expect(texto, `${url}: no existe docs/${ruta}`).toBeDefined();
  if (ancla !== undefined) {
    expect([...anclas(texto as string)], `${url}: docs/${ruta} no tiene #${ancla}`).toContain(
      ancla,
    );
  }
}

const META = { dataset: "bancos", as_of: "2026-10-17", sources: [], docs: "sin usar" };

const ASSETS = {
  "/v1/_internos/meta.json": {
    cuerpo: JSON.stringify({
      datasets: { bancos: { meta: META, records: 1, data_sha256: "a", frescura_horas: 72 } },
    }),
  },
  "/v1/bancos.json": {
    cuerpo: JSON.stringify({
      data: [{ codigo: "002", nombre_corto: "BANAMEX", activo: true }],
      meta: META,
    }),
  },
};

/** El enlace de documentación que trae la respuesta de `ruta` en el Worker. */
async function docsDe(ruta: string): Promise<string> {
  const respuesta = await manejar(peticion(ruta), entornoDe(crearAssets(ASSETS)));
  expect(respuesta.status, ruta).toBe(200);
  const cuerpo = (await respuesta.json()) as { documentacion?: string; meta?: { docs: string } };
  return cuerpo.documentacion ?? (cuerpo.meta?.docs as string);
}

beforeEach(() => reiniciarCargas());

describe("enlaces a la documentación", () => {
  it("el ancla de GitHub sale del texto del encabezado", () => {
    expect(anclaDe("dias-habiles")).toBe("dias-habiles");
    expect(anclaDe("Caché y ETag")).toBe("caché-y-etag");
    expect(anclaDe("Fuentes y licencia")).toBe("fuentes-y-licencia");
    expect(anclaDe("`GET /v1/status`")).toBe("get-v1status");
    expect([...anclas("# A\n## B\n```\n## no\n```\n## B\n")]).toEqual(["a", "b", "b-1"]);
  });

  it("los de las respuestas del Worker existen, con su sección", async () => {
    const enlaces = [
      await docsDe("/v1"),
      await docsDe("/v1/clabe/002010077777777771"),
      await docsDe("/v1/dias-habiles?autoridad=lft&desde=2026-01-05&dias=1"),
      await docsDe("/v1/dias-inhabiles?autoridad=lft&anio=2026"),
    ];
    expect(enlaces).toEqual([
      `${URL_DOCS}/api/README.md`,
      `${URL_DOCS}/api/README.md#clabe`,
      `${URL_DOCS}/api/README.md#dias-habiles`,
      `${URL_DOCS}/api/README.md#dias-inhabiles`,
    ]);
    for (const url of enlaces) comprobar(url);
  });

  it("los de cada tipo de problema existen", () => {
    for (const tipo of Object.keys(PROBLEMAS)) comprobar(`${URL_PROBLEMAS}#${tipo}`);
  });

  it("los de cada dataset del build existen: <URL_DOCS>/datos/<directorio>.md", () => {
    expect(DIRECTORIOS_DE_DATOS).toEqual(
      expect.arrayContaining(["bancos", "inegi-estados", "inegi-municipios"]),
    );
    for (const directorio of DIRECTORIOS_DE_DATOS) comprobar(`${URL_DOCS}/datos/${directorio}.md`);
  });

  it("un archivo o una sección que no existen fallan", () => {
    expect(() => comprobar(`${URL_DOCS}/api/README.md#no-existe`)).toThrow();
    expect(() => comprobar(`${URL_DOCS}/datos/no-existe.md`)).toThrow();
    expect(() => comprobar("https://otro.example/docs/api/README.md")).toThrow();
  });
});
