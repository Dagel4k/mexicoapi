import { describe, expect, it } from "vitest";
import type { ResultadoCorrida } from "../src/marco.js";
import { codigoEnLinea, resumenMarkdown } from "../src/resumen.js";

const base: ResultadoCorrida = {
  dataset: "x.y",
  estado: "actualizado",
  altas: 0,
  bajas: 0,
  cambios: 0,
  motivos: [],
  registros: 3,
  escrito: true,
};

describe("resumenMarkdown", () => {
  it("limita a 20 altas y dice cuantas faltan", () => {
    const altas = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}` }));
    const md = resumenMarkdown(
      [{ ...base, altas: 25, motivos: ["snapshot inicial"] }],
      new Map([["x.y", { altas, bajas: [], cambios: [] }]]),
    );
    expect(md).toContain("x.y");
    expect(md).toContain("snapshot inicial");
    expect(md).toContain('"id":"a19"');
    expect(md).not.toContain('"id":"a20"');
    expect(md).toContain("y 5 más");
  });

  it("muestra bajas y cambios con clave y campos, truncando registros largos", () => {
    const cambios = Array.from({ length: 21 }, (_, i) => ({
      clave: `k${i}`,
      antes: {},
      despues: {},
      campos: ["nombre", "cve"],
    }));
    const md = resumenMarkdown(
      [{ ...base, estado: "requiere_revision", bajas: 1, cambios: 21 }],
      new Map([["x.y", { altas: [], bajas: [{ id: "b", texto: "z".repeat(400) }], cambios }]]),
    );
    expect(md).toContain("k0");
    expect(md).toContain("nombre, cve");
    expect(md).not.toContain("k20");
    expect(md).toContain("y 1 más");
    expect(md).toContain("requiere_revision");
    expect(md.split("\n").every((l) => l.length < 260)).toBe(true);
  });

  it("dice sin cambios cuando no hay diferencias", () => {
    const md = resumenMarkdown([{ ...base, estado: "sin_cambios" }], new Map());
    expect(md).toContain("sin cambios");
  });
});

const ZWSP = "\u200b";

describe("codigoEnLinea", () => {
  it("envuelve en código en línea y neutraliza las menciones", () => {
    expect(codigoEnLinea("hola @daniel")).toBe(`\`hola @${ZWSP}daniel\``);
    expect(codigoEnLinea("a@b @c")).toBe(`\`a@${ZWSP}b @${ZWSP}c\``);
  });

  it("usa un cerco de backticks más largo que cualquiera de adentro", () => {
    expect(codigoEnLinea("a `b` c")).toBe("``a `b` c``");
    expect(codigoEnLinea("a ``` b")).toBe("````a ``` b````");
    // Con un backtick o un espacio en un borde, un espacio de relleno a cada lado.
    expect(codigoEnLinea("`x`")).toBe("`` `x` ``");
    expect(codigoEnLinea(" x")).toBe("`  x `");
  });

  it("deja todo en una línea: los saltos y controles pasan a un espacio", () => {
    const texto = "a\n```\n@x [y](https://e.mx)\r\u0007z\u2028w";
    expect(codigoEnLinea(texto)).toBe(`\`\`\`\`a \`\`\` @${ZWSP}x [y](https://e.mx) z w\`\`\`\``);
  });

  it("un texto vacío sigue siendo un código válido", () => {
    expect(codigoEnLinea("")).toBe("` `");
  });
});

describe("resumenMarkdown con textos de las fuentes", () => {
  it("pone motivos, registros, claves y errores en código y sin menciones", () => {
    const md = resumenMarkdown(
      [
        {
          ...base,
          estado: "requiere_revision",
          altas: 1,
          cambios: 1,
          motivos: ["nombre @alguien"],
        },
      ],
      new Map([
        [
          "x.y",
          {
            altas: [{ id: "a", nombre: "Banco `raro` @equipo" }],
            bajas: [],
            cambios: [{ clave: "k@1", antes: {}, despues: {}, campos: ["nombre"] }],
          },
        ],
      ]),
      [{ dataset: "x.z", mensaje: "HTTP 404 al pedir https://e.mx\n## Falso\n@daniel" }],
    );
    // Ninguna @ queda como mención.
    expect(md).not.toMatch(new RegExp(`@(?!${ZWSP})`));
    expect(md).toContain(`- \`nombre @${ZWSP}alguien\``);
    expect(md).toContain('- ``{"id":"a","nombre":"Banco `raro` @');
    expect(md).toContain(`- \`k@${ZWSP}1\`: \`nombre\``);
    expect(md).toContain("## Errores");
    expect(md).toContain(`- x.z: \`HTTP 404 al pedir https://e.mx ## Falso @${ZWSP}daniel\``);
    // El salto del mensaje no abre un encabezado nuevo.
    expect(md).not.toMatch(/^## Falso/m);
  });

  it("sin errores no agrega la sección", () => {
    expect(resumenMarkdown([base], new Map())).not.toContain("## Errores");
  });
});
