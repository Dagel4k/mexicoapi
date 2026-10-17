import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validarClabe } from "../src/clabe.js";
import { validarCurp } from "../src/curp.js";
import { validarNss } from "../src/nss.js";
import { validarRfc } from "../src/rfc.js";
import type { CodigoError, ResultadoValidacion } from "../src/validacion.js";

interface Caso {
  nombre: string;
  validar: (entrada: string) => ResultadoValidacion<unknown>;
  /** Entrada válida que sirve de base para las variantes hostiles. */
  valido: string;
  largo: string;
  /** La misma entrada con una letra cirílica parecida; solo RFC y CURP llevan letras. */
  cirilico?: string;
}

const casos: Caso[] = [
  {
    nombre: "validarClabe",
    validar: validarClabe,
    valido: "002180012345678906",
    largo: "1".repeat(10_000),
  },
  {
    nombre: "validarRfc",
    validar: validarRfc,
    valido: "GODE561231GR8",
    largo: "A".repeat(10_000),
    cirilico: "GOD\u0415561231GR8", // E cirílica (U+0415)
  },
  {
    nombre: "validarCurp",
    validar: validarCurp,
    valido: "BOXW310820HNERXN09",
    largo: "A".repeat(10_000),
    cirilico: "B\u041EXW310820HNERXN09", // O cirílica (U+041E)
  },
  {
    nombre: "validarNss",
    validar: validarNss,
    valido: "12345678903",
    largo: "1".repeat(10_000),
  },
];

const anchoCompleto = (s: string): string =>
  s.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));

/** Mínimo de 5 corridas, después de una de calentamiento. */
function msMinimo(fn: () => void): number {
  fn();
  let minimo = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    fn();
    minimo = Math.min(minimo, performance.now() - t0);
  }
  return minimo;
}

function esperarFallaDeFormato(r: ResultadoValidacion<unknown>, error: CodigoError): void {
  expect(r.errores).toEqual([error]);
  expect(r.valido).toBe(false);
  expect(r.formato_valido).toBe(false);
  expect(r.digito_verificador_valido).toBeNull();
  expect(r.detalle).toBeNull();
}

const noTexto: [unknown, CodigoError][] = [
  [null, "vacio"],
  [undefined, "vacio"],
  [12345678903, "caracteres"],
  [2180012345678906, "caracteres"],
  [true, "caracteres"],
  [{}, "caracteres"],
  [["002180012345678906"], "caracteres"],
];

describe.each(casos)("$nombre con entradas hostiles", ({ validar, valido, largo }) => {
  it("acepta la entrada base", () => {
    expect(validar(valido).valido).toBe(true);
  });

  it("rechaza dígitos de ancho completo", () => {
    const entrada = anchoCompleto(valido);
    expect(entrada).not.toBe(valido);
    esperarFallaDeFormato(validar(entrada), "caracteres");
  });

  it.each([
    ["U+200B", "\u200B"],
    ["U+FEFF", "\uFEFF"],
  ])("rechaza %s dentro de una entrada válida", (_nombre, c) => {
    esperarFallaDeFormato(validar(`${valido.slice(0, 4)}${c}${valido.slice(4)}`), "caracteres");
  });

  it("rechaza 10,000 caracteres en menos de 5 ms", () => {
    esperarFallaDeFormato(validar(largo), "longitud");
    expect(msMinimo(() => validar(largo))).toBeLessThan(5);
  });

  it("nunca lanza con cadenas binarias", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        expect(validar(s).errores.length).toBeLessThanOrEqual(1);
      }),
    );
  });

  it.each(noTexto)("con %j da %s y valor vacío", (entrada, error) => {
    const r = validar(entrada as string);
    esperarFallaDeFormato(r, error);
    expect(r.valor).toBe("");
  });

  it("nunca lanza con valores de cualquier tipo", () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        expect(validar(x as string).errores.length).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe.each(casos.filter((c) => c.cirilico !== undefined))(
  "$nombre con letras parecidas",
  ({ validar, cirilico }) => {
    it("rechaza una letra cirílica en posición de letra", () => {
      esperarFallaDeFormato(validar(cirilico as string), "caracteres");
    });
  },
);
