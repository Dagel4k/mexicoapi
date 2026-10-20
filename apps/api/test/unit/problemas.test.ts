import { describe, expect, it } from "vitest";
import documento from "../../../../docs/api/problemas.md?raw";
import { PROBLEMAS, URL_PROBLEMAS } from "../../src/problemas.js";

describe("PROBLEMAS", () => {
  it("apunta a la documentación de problemas en GitHub", () => {
    expect(URL_PROBLEMAS).toBe(
      "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md",
    );
  });

  it("tiene un status por tipo", () => {
    const status = Object.fromEntries(Object.entries(PROBLEMAS).map(([t, p]) => [t, p.status]));
    expect(status).toEqual({
      "parametro-invalido": 400,
      "parametro-desconocido": 400,
      "parametro-faltante": 400,
      "https-requerido": 403,
      "no-encontrado": 404,
      "dato-no-disponible": 404,
      "metodo-no-permitido": 405,
      "calendario-incompleto": 422,
      "demasiadas-peticiones": 429,
      "error-interno": 500,
    });
  });

  it("cada tipo tiene un título y la tabla no se puede alterar", () => {
    for (const p of Object.values(PROBLEMAS)) expect(p.title).toMatch(/^\S.*\S$/);
    expect(Object.isFrozen(PROBLEMAS)).toBe(true);
    for (const p of Object.values(PROBLEMAS)) expect(Object.isFrozen(p)).toBe(true);
  });
});

describe("docs/api/problemas.md", () => {
  const encabezados = [...documento.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

  it("tiene un encabezado por cada tipo, cuyo ancla es el tipo", () => {
    for (const tipo of Object.keys(PROBLEMAS)) {
      expect(encabezados.filter((e) => e === tipo)).toEqual([tipo]);
    }
  });

  it("no tiene encabezados de nivel 2 que no sean un tipo", () => {
    expect([...encabezados].sort()).toEqual(Object.keys(PROBLEMAS).sort());
  });
});
