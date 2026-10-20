import { CATALOGO, type EntradaCatalogo } from "./catalogo.js";
import { documento, escaparHtml, navegacion } from "./html.js";

/**
 * `estado/index.html`: qué significa cada estado y la tabla que `sitio.js` llena con
 * `/v1/status`. Los renglones salen de la API, así que un dataset nuevo aparece sin tocar esta
 * página; del catálogo solo vienen los nombres para personas, en `data-nombres`.
 */
export function paginaEstado(
  catalogo: Readonly<Record<string, Pick<EntradaCatalogo, "nombre">>> = CATALOGO,
): string {
  const nombres = Object.fromEntries(Object.entries(catalogo).map(([id, e]) => [id, e.nombre]));
  const ruta = "/estado/";
  const cuerpo = `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
<div class="marco">
<p class="marca"><a href="/">MéxicoAPI</a></p>
${navegacion(ruta)}
</div>
</header>
<main id="contenido" class="marco">
<h1>Estado de los datos</h1>
<p class="intro">Un bot revisa la fuente oficial de cada dataset automático y actualiza los datos cuando cambian. Para cada uno, <a href="/v1/status"><code>/v1/status</code></a> dice cuándo terminó bien su última revisión y si eso fue dentro de su plazo. Las horas son de la Ciudad de México.</p>
<noscript><p class="aviso">La tabla se llena con JavaScript. Sin él, el mismo estado está en <a href="/v1/status">/v1/status</a>, en JSON.</p></noscript>
<div class="acciones">
<button type="button" id="actualizar-estado" hidden>Actualizar</button>
<p id="mensaje-estado" class="mensaje" role="status" aria-live="polite"></p>
</div>
<div class="tabla tarjetas" id="marco-estado" role="region" aria-labelledby="tabla-estado" tabindex="0" hidden>
<table>
<caption id="tabla-estado">Estado de cada dataset automático, según /v1/status</caption>
<thead>
<tr><th scope="col">Dataset</th><th scope="col">Estado</th><th scope="col">Datos al</th><th scope="col">Última revisión correcta</th><th scope="col" class="num">Plazo</th><th scope="col">Cobertura</th></tr>
</thead>
<tbody id="filas-estado" data-nombres="${escaparHtml(JSON.stringify(nombres))}"></tbody>
</table>
</div>
<section id="significado" aria-labelledby="titulo-significado">
<h2 id="titulo-significado">Qué significa cada estado</h2>
<dl>
<dt>Al día</dt>
<dd>La última revisión correcta fue dentro del plazo del dataset.</dd>
<dt>Desactualizado</dt>
<dd>Pasó más del plazo sin una revisión correcta, o el bot ya corrió y ninguna revisión ha terminado bien. Los datos se siguen sirviendo, con la fecha de la columna «Datos al».</dd>
<dt>Sin registro</dt>
<dd>El bot todavía no reporta ninguna corrida de este dataset, como pasa en un despliegue nuevo o en una copia local, o su registro no se pudo leer. Los datos se sirven igual, solo falta con qué medir su frescura.</dd>
</dl>
</section>
<section id="columnas" aria-labelledby="titulo-columnas">
<h2 id="titulo-columnas">Las columnas</h2>
<dl>
<dt>Datos al</dt>
<dd>La fecha de la última actualización que cambió el dataset. En las series (FIX y UDIS) no es la del último dato: esa va debajo, como «último dato», y es el final de la cobertura.</dd>
<dt>Última revisión correcta</dt>
<dd>Cuándo terminó bien la última corrida del bot, haya traído cambios o no, y cuántas horas han pasado desde entonces.</dd>
<dt>Plazo</dt>
<dd>Las horas que el dataset puede pasar sin una revisión correcta antes de contar como desactualizado.</dd>
<dt>Cobertura</dt>
<dd>En las series, la primera y la última fecha publicadas.</dd>
</dl>
<p>La API guarda esta respuesta hasta un minuto, así que una corrida recién terminada puede tardar ese tiempo en verse. Los datasets curados no aparecen aquí: los transcribe una persona de publicaciones oficiales, sin bot, y su fecha está en la <a href="/#datos">tabla de datos</a>.</p>
</section>
</main>`;
  return documento({
    titulo: "Estado de los datos · MéxicoAPI",
    descripcion:
      "Si cada dataset automático de MéxicoAPI está al día: la fecha de sus datos, su última revisión correcta y su plazo.",
    cuerpo,
    ruta,
    scripts: ["/sitio.js"],
  });
}
