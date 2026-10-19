import { describe, expect, it } from "vitest";
import { ESTILO } from "../../../src/sitio/paginas/estilo.js";

/** Las variables de color del primer bloque `:root { ... }` que aparece después de `desde`. */
function variables(css: string, desde: number): Map<string, string> {
  const inicio = css.indexOf(":root {", desde);
  const fin = css.indexOf("}", inicio);
  const bloque = css.slice(inicio, fin);
  return new Map(
    [...bloque.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );
}

/** Luminancia relativa de WCAG 2.2. */
function luminancia(hex: string): number {
  const canal = (i: number): number => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (oscuro + 0.05);
}

const claro = variables(ESTILO, 0);
const oscuro = variables(ESTILO, ESTILO.indexOf("prefers-color-scheme: dark"));

describe("estilo.css", () => {
  it("no carga nada externo y es ASCII, así que no depende del charset", () => {
    expect(ESTILO).not.toMatch(/url\(|@import|https?:/i);
    expect(ESTILO).toMatch(/^[\x20-\x7e\n]*$/);
  });

  // 7 KB desde que las tablas se ven como tarjetas en pantallas angostas (antes, 6 KB).
  it("es pequeña", () => {
    expect(Buffer.byteLength(ESTILO)).toBeLessThan(7 * 1024);
  });

  // `.oculto` es absoluto: sin un contenedor posicionado sale del que se desplaza y la página gana
  // desplazamiento horizontal a 320 px.
  it("las tablas se desplazan dentro de su contenedor, con el texto oculto adentro", () => {
    expect(ESTILO).toMatch(/\.tabla \{[^}]*position: relative;[^}]*overflow-x: auto;/);
    expect(ESTILO).toMatch(/\.oculto \{[^}]*position: absolute;/);
    expect(ESTILO).toMatch(/\npre \{[^}]*overflow-x: auto;/);
  });

  // El primer comando que uno copia no puede quedar cortado en una columna angosta ni en móvil.
  it("los bloques de código parten las líneas largas en vez de cortarlas", () => {
    expect(ESTILO).toMatch(/\npre \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  });

  // Debajo de 640 px una tabla de seis columnas no cabe: cada renglón es una tarjeta y cada celda
  // lleva la etiqueta de su columna (data-etiqueta), sin estilos en línea.
  it("debajo de 40rem las tablas .tarjetas se ven como tarjetas con la etiqueta de cada celda", () => {
    const inicio = ESTILO.indexOf("@media (width < 40rem) {");
    expect(inicio).toBeGreaterThan(0);
    const bloque = ESTILO.slice(inicio, ESTILO.indexOf("\n}\n", inicio));
    expect(bloque).toMatch(/\.tarjetas thead \{[^}]*display: none;/);
    expect(bloque).toMatch(/\.tarjetas tr, \.tarjetas th, \.tarjetas td \{[^}]*display: block;/);
    expect(bloque).toMatch(
      /\.tarjetas td::before \{[^}]*content: attr\(data-etiqueta\);[^}]*display: block;/,
    );
    expect(bloque).toMatch(/\.tarjetas \.junto, [^{]*\{[^}]*white-space: normal;/);
    expect(ESTILO).not.toMatch(/style=/);
  });

  // El caption es tan ancho como la tabla: sin esto, a 320 px se desplaza con ella y se corta.
  it("el caption se queda a la vista y del ancho del contenedor", () => {
    expect(ESTILO).toMatch(/\.tabla \{[^}]*container-type: inline-size;/);
    expect(ESTILO).toMatch(
      /\ncaption \{[^}]*position: sticky;[^}]*left: 0;[^}]*max-width: 100cqi;/,
    );
  });

  it("tiene modo oscuro con las mismas variables y foco visible", () => {
    expect(ESTILO.indexOf("prefers-color-scheme: dark")).toBeGreaterThan(0);
    expect(claro.size).toBeGreaterThan(5);
    expect([...oscuro.keys()]).toEqual([...claro.keys()]);
    expect(ESTILO).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  // Texto 4.5:1 y el contorno del foco 3:1 (WCAG 1.4.3 y 1.4.11), en los dos temas.
  it.each([
    ["claro", claro],
    ["oscuro", oscuro],
  ])("el tema %s cumple el contraste AA", (_, tema) => {
    const c = (a: string, b: string): number => contraste(tema.get(a) ?? "", tema.get(b) ?? "");
    for (const texto of ["--texto", "--tenue", "--acento"]) {
      for (const fondo of ["--fondo", "--superficie", "--aviso"]) {
        expect(c(texto, fondo), `${texto} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const fondo of ["--fondo", "--superficie"]) {
      expect(c("--foco", fondo), `--foco sobre ${fondo}`).toBeGreaterThanOrEqual(3);
    }
    expect(c("--aviso-borde", "--aviso")).toBeGreaterThanOrEqual(3);
    // Los marcadores de estado y el borde del botón son gráficos: 3:1 contra el fondo (1.4.11).
    for (const grafico of ["--acento", "--aviso-borde", "--tenue"]) {
      for (const fondo of ["--fondo", "--superficie"]) {
        expect(c(grafico, fondo), `${grafico} sobre ${fondo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // El estado se dice con texto; el marcador cambia de color y también de forma.
  it("cada estado tiene su marcador, distinto en color y en forma", () => {
    expect(ESTILO).toMatch(/\.estado::before \{[^}]*content: "";[^}]*border-radius: 50%;/);
    expect(ESTILO).toMatch(/\.estado-ok::before \{ background: var\(--acento\); \}/);
    expect(ESTILO).toMatch(
      /\.estado-stale::before \{ background: var\(--aviso-borde\); border-radius: 1px; \}/,
    );
    expect(ESTILO).toMatch(/\.estado-unknown::before \{ border: 2px solid var\(--tenue\); \}/);
    expect(ESTILO).toMatch(/\nbutton \{[^}]*font: inherit;[^}]*border: 1px solid var\(--tenue\);/);
  });
});
