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

  // Un presupuesto contra el crecimiento sin querer, no un requisito de rendimiento: la hoja es una
  // sola, se guarda en caché y comprimida pesa una fracción. 9 KB desde las páginas de datos (migas,
  // citas y tablas compactas); antes 7 KB, desde que las tablas se ven como tarjetas, y 6 KB.
  it("no crece sin que se decida", () => {
    expect(Buffer.byteLength(ESTILO)).toBeLessThan(9 * 1024);
  });

  // Las migas se leen como texto: la diagonal entre una y otra es contenido, no un color.
  it("las migas van en un renglón, sin viñetas y separadas con una diagonal", () => {
    expect(ESTILO).toMatch(
      /\.migas ol \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*list-style: none;/,
    );
    expect(ESTILO).toMatch(/\.migas li \+ li::before \{[^}]*content: "\/";/);
    expect(ESTILO).toMatch(/\nblockquote \{[^}]*border-left: 4px solid var\(--borde\);/);
  });

  // Una tabla de dos o tres columnas a todo el ancho de 1280 px se lee mal; a 375 px, con el
  // relleno normal y los encabezados sin partir, la última columna se corta.
  it("las tablas compactas tienen un ancho máximo y a 375 px menos relleno y encabezados que se parten", () => {
    expect(ESTILO).toContain("\n.compacta { max-width: 48rem; }\n");
    expect(ESTILO).toContain(
      "@media (max-width: 39.99rem) { .compacta th, .compacta td { padding-inline: 0.5rem; white-space: normal; } }",
    );
  });

  // `.oculto` es absoluto: sin un contenedor posicionado sale del que se desplaza y la página gana
  // desplazamiento horizontal a 320 px.
  it("las tablas se desplazan dentro de su contenedor, con el texto oculto adentro", () => {
    expect(ESTILO).toMatch(/\.tabla \{[^}]*position: relative;[^}]*overflow-x: auto;/);
    expect(ESTILO).toMatch(/\.oculto \{[^}]*position: absolute;/);
    expect(ESTILO).toMatch(/\npre \{[^}]*overflow-x: auto;/);
  });

  // El primer comando que uno copia no puede quedar cortado en una columna angosta ni en móvil.
  // break-word y no anywhere: se parte en un espacio y solo a media palabra lo que no cabe solo.
  it("los bloques de código parten las líneas largas en vez de cortarlas", () => {
    expect(ESTILO).toMatch(/\npre \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: break-word;/);
    expect(ESTILO).not.toMatch(/\npre \{[^}]*anywhere/);
    // A 375 px, API= con la URL de producción (41 caracteres) cabe en un renglón.
    expect(ESTILO).toContain(
      "@media (max-width: 39.99rem) { pre { font-size: 0.8125rem; padding-inline: 0.75rem; } }",
    );
  });

  // Debajo de 1024 px una tabla de seis columnas no cabe (a 768 escondía dos): cada renglón es una
  // tarjeta y cada celda lleva la etiqueta de su columna (data-etiqueta), sin estilos en línea.
  it("debajo de 64rem las tablas .tarjetas se ven como tarjetas con la etiqueta de cada celda", () => {
    // max-width y no la sintaxis de rango, que Safari solo entiende desde la 16.4.
    expect(ESTILO).not.toMatch(/@media \([^)]*[<>]/);
    expect(ESTILO).not.toContain("39.99rem) {\n");
    const inicio = ESTILO.indexOf("@media (max-width: 63.99rem) {\n");
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

  // Entre 1024 y 1280 px la tabla completa cabe si las rutas se parten y la fuente es más angosta.
  it("entre 64 y 80rem las rutas se parten y la columna de fuentes es más angosta", () => {
    const inicio = ESTILO.indexOf("@media (min-width: 64rem) and (max-width: 79.99rem) {\n");
    expect(inicio).toBeGreaterThan(0);
    const bloque = ESTILO.slice(inicio, ESTILO.indexOf("\n}\n", inicio));
    expect(bloque).toMatch(/\.fuentes \{ min-width: 14rem; \}/);
    expect(bloque).toMatch(/\.rutas code \{ white-space: normal; overflow-wrap: anywhere; \}/);
    // Sin un mínimo, la columna API se queda en un carácter de ancho y parte /v1/estados.
    expect(bloque).toMatch(/\.rutas \{ min-width: 11rem; \}/);
  });

  // WCAG 2.5.8: los enlaces del menú miden al menos 24 px de alto.
  it("los enlaces del menú tienen caja propia con relleno vertical", () => {
    expect(ESTILO).toMatch(
      /\.secciones a \{[^}]*display: inline-block;[^}]*padding-block: 0\.25rem;/,
    );
    // La página actual también se distingue a la vista, no solo con aria-current, y no solo por
    // el color (WCAG 1.4.1): lleva una línea debajo.
    expect(ESTILO).toMatch(
      /\.secciones \[aria-current\] \{[^}]*color: var\(--texto\);[^}]*border-bottom: 2px solid;/,
    );
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
