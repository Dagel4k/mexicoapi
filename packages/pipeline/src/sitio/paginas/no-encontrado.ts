import { documento, navegacion } from "./html.js";

/**
 * `404.html`: Cloudflare la sirve en cualquier URL fuera de `/v1` que no es un asset, así que
 * todos sus enlaces son absolutos. No lleva scripts ni repite la URL pedida. De `_headers` solo
 * la alcanza la regla `/*` (nosniff, referrer y X-Frame-Options): su CSP va en `<meta>`.
 */
export function paginaNoEncontrada(): string {
  return documento({
    titulo: "No existe esta página · MéxicoAPI",
    descripcion: "La dirección no corresponde a ninguna página ni descarga de MéxicoAPI.",
    seguridadEnMeta: true,
    indexable: false,
    cuerpo: `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
<div class="marco">
<p class="marca"><a href="/">MéxicoAPI</a></p>
${navegacion(false)}
</div>
</header>
<main id="contenido" class="marco">
<h1>No existe esta página</h1>
<p>La dirección no corresponde a ninguna página ni descarga de MéxicoAPI. Revisa que esté bien escrita o empieza desde aquí:</p>
<ul>
<li><a href="/">Inicio</a>: qué datos hay, cómo usarlos y las descargas.</li>
<li><a href="/v1">Índice de la API</a>: los enlaces principales de <code>/v1</code>, en JSON.</li>
</ul>
</main>`,
  });
}
