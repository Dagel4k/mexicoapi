/** El fondo de cada tema; también es el `theme-color` de las páginas. */
export const FONDO = { claro: "#ffffff", oscuro: "#111514" } as const;

/**
 * `estilo.css`: la única hoja del sitio. Solo ASCII, sin `url()` ni `@import`; los colores son
 * variables que el modo oscuro redefine y que la prueba revisa contra el contraste AA.
 */
export const ESTILO = `:root {
  color-scheme: light dark;
  --fondo: ${FONDO.claro};
  --texto: #1c1f1e;
  --tenue: #535a57;
  --acento: #0a6640;
  --superficie: #f1f4f2;
  --borde: #d3d9d6;
  --aviso: #fdf3d8;
  --aviso-borde: #9a6700;
  --foco: #1a56db;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: ${FONDO.oscuro};
    --texto: #e3e8e5;
    --tenue: #a3aca8;
    --acento: #6ccf9d;
    --superficie: #1b2120;
    --borde: #323a37;
    --aviso: #2a2312;
    --aviso-borde: #d4a72c;
    --foco: #8ab4ff;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--fondo);
  color: var(--texto);
  font: 1rem/1.6 var(--sans);
  overflow-wrap: break-word;
}
.marco { max-width: 80rem; margin: 0 auto; padding-inline: 1rem; }
@media (min-width: 40rem) { .marco { padding-inline: 2rem; } }
a { color: var(--acento); text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; border-radius: 2px; }
.saltar {
  position: absolute;
  left: 1rem;
  top: -4rem;
  padding: 0.5rem 1rem;
  background: var(--fondo);
  border: 1px solid var(--borde);
}
.saltar:focus { top: 1rem; }
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
h1, h2, h3 { line-height: 1.2; margin: 0 0 0.75rem; }
h1 { font-size: clamp(2.25rem, 7vw, 3.25rem); letter-spacing: -0.02em; }
h2 { font-size: 1.5rem; padding-top: 0.5rem; }
h3 { font-size: 1.125rem; }
p, ul, ol, dl, details { margin: 0 0 1rem; }
p, pre, dl, details { max-width: 68ch; }
.cabecera { border-bottom: 1px solid var(--borde); padding: 2.5rem 0 1.25rem; }
.lema { font-size: 1.1875rem; color: var(--tenue); max-width: 38rem; }
.marca { margin: 0 0 0.25rem; font-weight: 700; font-size: 1.25rem; }
.marca a { color: var(--texto); text-decoration: none; }
.secciones ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
}
.secciones a { display: inline-block; padding-block: 0.25rem; font-weight: 600; text-decoration: none; }
.secciones a:hover { text-decoration: underline; }
.secciones [aria-current] { color: var(--texto); border-bottom: 2px solid; }
/* migas de las paginas de datos: en un renglon, separadas con / */
.migas ol { display: flex; flex-wrap: wrap; gap: 0 0.5rem; list-style: none; margin: 0 0 1rem; padding: 0; }
.migas li + li::before { content: "/"; margin-right: 0.5rem; color: var(--tenue); }
.datos-al { color: var(--tenue); }
main { padding-block: 2rem 3rem; }
section { margin-top: 2.5rem; }
.intro { font-size: 1.0625rem; }
.bloques { display: grid; gap: 1.75rem; }
.bloque { min-width: 0; max-width: 68ch; }
.bloque p { margin-bottom: 0.75rem; }
@media (min-width: 80rem) {
  .bloques { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; }
  .bloque pre { font-size: 0.8125rem; }
}
code, pre { font-family: var(--mono); font-size: 0.875em; }
:not(pre) > code { background: var(--superficie); padding: 0.1em 0.35em; border-radius: 4px; }
pre {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 6px;
  padding: 0.875rem 1rem;
  margin: 0 0 1rem;
  overflow-x: auto;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
pre code { font-size: 1em; }
/* en un telefono de 375 px, API= y la URL de produccion caben en un renglon */
@media (max-width: 39.99rem) { pre { font-size: 0.8125rem; padding-inline: 0.75rem; } }
.aviso {
  background: var(--aviso);
  border-left: 4px solid var(--aviso-borde);
  border-radius: 0 6px 6px 0;
  padding: 0.5rem 0.875rem;
}
.acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem; margin: 0 0 1rem; }
.mensaje { margin: 0; }
button {
  font: inherit;
  font-weight: 600;
  color: var(--texto);
  background: var(--superficie);
  border: 1px solid var(--tenue);
  border-radius: 6px;
  padding: 0.375rem 1rem;
  cursor: pointer;
}
button:hover { background: var(--fondo); }
.estado { font-weight: 600; white-space: nowrap; }
.estado::before {
  content: "";
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  margin-right: 0.4rem;
  border-radius: 50%;
}
.estado-ok::before { background: var(--acento); }
.estado-stale::before { background: var(--aviso-borde); border-radius: 1px; }
.estado-unknown::before { border: 2px solid var(--tenue); }
.detalle { display: block; color: var(--tenue); font-size: 0.875rem; font-weight: 400; }
/* relative: el texto .oculto de las celdas no se sale del contenedor que se desplaza */
.tabla {
  position: relative;
  container-type: inline-size;
  overflow-x: auto;
  margin: 0 0 1.25rem;
  border: 1px solid var(--borde);
  border-radius: 6px;
}
table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
/* el caption mide lo que el contenedor (100cqi) y no se va con la tabla al desplazarla */
caption {
  position: sticky;
  left: 0;
  max-width: 100cqi;
  text-align: left;
  padding: 0.75rem 1rem;
  color: var(--tenue);
}
th, td { text-align: left; vertical-align: top; padding: 0.625rem 1rem; border-top: 1px solid var(--borde); }
thead th { background: var(--superficie); font-size: 0.875rem; white-space: nowrap; }
tbody th { font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.junto { white-space: nowrap; }
.id { display: block; margin-top: 0.125rem; font: 400 0.8125rem/1.4 var(--mono); color: var(--tenue); }
.fuentes { min-width: 18rem; }
.fuentes ul { list-style: none; margin: 0 0 0.375rem; padding: 0; }
.fuentes li + li { margin-top: 0.25rem; }
.fuentes details { margin: 0 0 0.375rem; }
.licencia { margin: 0; color: var(--tenue); font-size: 0.875rem; }
.rutas code { display: block; width: fit-content; white-space: nowrap; }
.rutas .detalle { margin-bottom: 0.25rem; }
/* hasta 80rem la tabla completa solo cabe si las rutas se parten */
@media (min-width: 64rem) and (max-width: 79.99rem) {
  .fuentes { min-width: 14rem; }
  .rutas { min-width: 11rem; }
  .rutas code { white-space: normal; overflow-wrap: anywhere; }
}
/* cada renglon como tarjeta; la etiqueta de cada celda sale de data-etiqueta */
@media (max-width: 63.99rem) {
  .tarjetas thead { display: none; }
  .tarjetas table, .tarjetas caption, .tarjetas tbody, .tarjetas tr, .tarjetas th, .tarjetas td { display: block; }
  .tarjetas tr { border-top: 1px solid var(--borde); padding: 0.5rem 0; }
  .tarjetas th, .tarjetas td { border: 0; padding: 0.25rem 1rem; text-align: left; min-width: 0; }
  .tarjetas td::before { content: attr(data-etiqueta); display: block; font-size: 0.8125rem; color: var(--tenue); }
  .tarjetas .junto, .tarjetas .rutas code { white-space: normal; overflow-wrap: anywhere; }
}
summary { cursor: pointer; }
details[open] > summary { margin-bottom: 0.5rem; }
dt { font-weight: 600; }
dd { margin: 0 0 0.875rem; color: var(--tenue); }
blockquote { margin: 0 0 1rem; padding-left: 1rem; border-left: 4px solid var(--borde); max-width: 68ch; }
.pie { border-top: 1px solid var(--borde); padding: 1.5rem 0 2.5rem; color: var(--tenue); font-size: 0.9375rem; }
.pie p { margin: 0 0 0.5rem; }
`;
