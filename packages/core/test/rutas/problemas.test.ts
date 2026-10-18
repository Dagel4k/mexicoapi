import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROBLEMAS,
  tipoDeProblema,
  URL_API,
  URL_DOCS,
  URL_PROBLEMAS,
  URL_REPOSITORIO,
} from "../../src/rutas/problemas.js";

const documento = readFileSync(
  new URL("../../../../docs/api/problemas.md", import.meta.url),
  "utf8",
);

describe("direcciones", () => {
  it("la documentación y los problemas están en la rama main del repositorio", () => {
    expect(URL_REPOSITORIO).toBe("https://github.com/Dagel4k/mexicoapi");
    expect(URL_DOCS).toBe("https://github.com/Dagel4k/mexicoapi/blob/main/docs");
    expect(URL_PROBLEMAS).toBe(
      "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md",
    );
  });
});

describe("URL_API", () => {
  it("es el origen de la API en producción, sin barra final ni /v1", () => {
    expect(URL_API).toBe("https://mexicoapi.dagel4k.workers.dev");
  });
});

describe("PROBLEMAS", () => {
  it("tiene un status por tipo, en orden de status", () => {
    const status = Object.entries(PROBLEMAS).map(([t, p]) => [t, p.status]);
    expect(status).toEqual([
      ["parametro-invalido", 400],
      ["parametro-desconocido", 400],
      ["parametro-faltante", 400],
      ["no-encontrado", 404],
      ["dato-no-disponible", 404],
      ["metodo-no-permitido", 405],
      ["calendario-incompleto", 422],
      ["demasiadas-peticiones", 429],
      ["error-interno", 500],
    ]);
  });

  it("cada tipo tiene un título y la tabla no se puede alterar", () => {
    expect(PROBLEMAS["dato-no-disponible"]).toEqual({
      title: "Dato todavía no disponible",
      status: 404,
    });
    for (const p of Object.values(PROBLEMAS)) expect(p.title).toMatch(/^\S.*\S$/);
    expect(Object.isFrozen(PROBLEMAS)).toBe(true);
    for (const p of Object.values(PROBLEMAS)) expect(Object.isFrozen(p)).toBe(true);
  });

  it("docs/api/problemas.md tiene un encabezado por tipo y ninguno más", () => {
    const encabezados = [...documento.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect([...encabezados].sort()).toEqual(Object.keys(PROBLEMAS).sort());
  });
});

describe("tipoDeProblema", () => {
  it("quita la base del type de la API", () => {
    expect(tipoDeProblema(`${URL_PROBLEMAS}#no-encontrado`)).toBe("no-encontrado");
    expect(tipoDeProblema(`${URL_PROBLEMAS}#otro-nuevo`)).toBe("otro-nuevo");
  });

  it("da undefined si el type no es de la API", () => {
    for (const type of ["about:blank", "https://otra.example/problemas#no-encontrado", ""]) {
      expect(tipoDeProblema(type)).toBeUndefined();
    }
    expect(tipoDeProblema(`${URL_PROBLEMAS}#`)).toBeUndefined();
  });
});
