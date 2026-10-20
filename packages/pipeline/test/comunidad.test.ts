import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { URL_API, URL_REPOSITORIO } from "@mexicoapi/core/problemas";
import { metaLft } from "@mexicoapi/core/rutas";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CURADOS } from "../src/curado/registro.js";
import { DATASETS } from "../src/registro.js";

const OTRO = "Otro o no sé";

function formulario(nombre: string) {
  const ruta = fileURLToPath(new URL(`../../../.github/ISSUE_TEMPLATE/${nombre}`, import.meta.url));
  return parse(readFileSync(ruta, "utf8")) as {
    name: string;
    description: string;
    labels?: string[];
    body: {
      type: string;
      id?: string;
      attributes: { options?: unknown[] };
      validations?: { required?: boolean };
    }[];
  };
}

describe("formulario de error en los datos", () => {
  const form = formulario("error-en-datos.yml");
  const campo = (id: string) => form.body.find((b) => b.id === id);

  // La LFT no está en data/, pero sus días pueden estar mal calculados: va con el id que dan sus
  // respuestas.
  it("lista todos los datasets del registro, el calendario de la LFT y la opción de salida", () => {
    const lft = metaLft("dias-inhabiles").dataset;
    const ids = [...DATASETS.keys(), ...CURADOS.map((d) => d.id), lft].sort();
    const opciones = (campo("dataset")?.attributes.options ?? []) as string[];
    expect(opciones.filter((o) => o !== OTRO).sort()).toEqual(ids);
    expect(opciones).toContain(OTRO);
  });

  it("exige dataset, valor, valor correcto, enlace a la fuente y fecha", () => {
    for (const id of ["dataset", "valor-actual", "valor-correcto", "fuente", "fecha"]) {
      expect(campo(id)?.validations?.required, id).toBe(true);
    }
  });

  it("tiene ids únicos", () => {
    const ids = form.body.flatMap((b) => (b.id ? [b.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("formulario de fallo", () => {
  it("tiene ids únicos y el componente exige elegir", () => {
    const form = formulario("fallo.yml");
    const ids = form.body.flatMap((b) => (b.id ? [b.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(form.body.find((b) => b.id === "componente")?.validations?.required).toBe(true);
  });
});

describe("CITATION.cff", () => {
  const raiz = (archivo: string) =>
    readFileSync(new URL(`../../../${archivo}`, import.meta.url), "utf8");

  it("cita MéxicoAPI con su sitio, su repositorio y la licencia del código", () => {
    const cff = parse(raiz("CITATION.cff")) as Record<string, unknown>;
    expect(cff["cff-version"]).toBe("1.2.0");
    expect(typeof cff.message).toBe("string");
    expect(cff.title).toBe("MéxicoAPI");
    expect(cff.authors).toEqual([{ "given-names": "Daniel", "family-names": "Pereda" }]);
    expect(cff["repository-code"]).toBe(URL_REPOSITORIO);
    expect(cff.url).toBe(URL_API);
    // Lo que aporta el proyecto va con la licencia del código (DATA_LICENSE.md).
    expect(cff.license).toBe("MIT");
    expect(raiz("LICENSE")).toMatch(/^MIT License\n/);
  });

  it("no lleva correos", () => {
    expect(raiz("CITATION.cff")).not.toMatch(/@|email/i);
  });
});
