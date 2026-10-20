// `/calculadora-dias-habiles/`: el formulario que `sitio.js` activa para sumar días hábiles con la
// API del mismo origen. Sin JavaScript explica cómo cuenta cada autoridad y enlaza ejemplos. Los
// textos son los de docs/api/README.md y docs/datos/dias-inhabiles-*.md; las coberturas salen de
// los mismos calendarios que usa la API.
import { COBERTURA_LFT } from "@mexicoapi/core";
import { fechaEnTexto, metaLft } from "@mexicoapi/core/rutas";
import { URL_DOCS } from "../meta.js";
import {
  type CalendarioDePagina,
  RUTA_CALCULADORA,
  RUTA_DIAS_CNBV,
  RUTA_DIAS_LFT,
  RUTA_DIAS_SAT,
} from "./dias-inhabiles.js";
import { escaparHtml } from "./html.js";
import { seccion, tabla } from "./indicadores.js";
import type { PaginaDatos } from "./pagina-datos.js";

export interface EntradaCalculadora {
  sat: CalendarioDePagina;
  cnbv: CalendarioDePagina;
}

/** Los ejemplos de la documentación de la API (docs/api/README.md, sección dias-habiles). */
const EJEMPLOS: ReadonlyArray<{ consulta: string; texto: string }> = [
  {
    consulta: "/v1/dias-habiles?autoridad=lft&desde=2026-12-18&dias=3",
    texto: "LFT: 3 días hábiles desde el viernes 18 de diciembre de 2026",
  },
  {
    consulta: "/v1/dias-habiles?autoridad=cnbv&desde=2026-12-23&dias=3",
    texto: "CNBV: 3 días hábiles desde el miércoles 23 de diciembre de 2026",
  },
  {
    consulta: "/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-17&dias=3",
    texto: "SAT, plazo general: 3 días hábiles desde el viernes 17 de julio de 2026",
  },
  {
    consulta:
      "/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-07-17&dias=3",
    texto: "SAT, declaraciones y pagos: lo mismo; las vacaciones cuentan como hábiles",
  },
];

const rango = (r: { desde: string; hasta: string }): string =>
  `del ${fechaEnTexto(r.desde)} al ${fechaEnTexto(r.hasta)}`;

const masReciente = (...fechas: string[]): string => [...fechas].sort().at(-1) as string;

export function paginaCalculadora({ sat, cnbv }: EntradaCalculadora): PaginaDatos {
  const lft = metaLft("dias-habiles");
  const generalSat = sat.calendario.general.cobertura;
  const declaraciones = (
    sat.calendario.plazos.get("declaraciones_pagos") as {
      cobertura: { desde: string; hasta: string };
    }
  ).cobertura;

  const formulario = `<section id="calculadora" aria-labelledby="titulo-calculadora">
<h2 id="titulo-calculadora">Calcular un plazo</h2>
<noscript><p class="aviso">Esta calculadora necesita JavaScript. Sin él, la API hace el mismo cálculo: <code>GET /v1/dias-habiles</code>; abajo hay ejemplos.</p></noscript>
<form id="form-dias" class="calculadora" hidden>
<div>
<label for="dias-autoridad">Autoridad</label>
<select id="dias-autoridad" name="autoridad">
<option value="sat">SAT (Código Fiscal de la Federación)</option>
<option value="lft">LFT (Ley Federal del Trabajo)</option>
<option value="cnbv">CNBV (calendario bancario)</option>
</select>
</div>
<div id="campo-tipo-plazo">
<label for="dias-tipo-plazo">Tipo de plazo del SAT</label>
<select id="dias-tipo-plazo" name="tipo_plazo">
<option value="general">General</option>
<option value="declaraciones_pagos">Declaraciones y pagos</option>
</select>
</div>
<div>
<label for="dias-desde">Fecha desde</label>
<input id="dias-desde" name="desde" type="date" required>
</div>
<div>
<label for="dias-dias">Días hábiles</label>
<input id="dias-dias" name="dias" type="number" inputmode="numeric" min="1" max="3650" step="1" required>
</div>
<div class="opcion">
<input id="dias-incompleto" name="permitir_incompleto" type="checkbox">
<label for="dias-incompleto">Permitir calendario incompleto</label>
</div>
<button type="submit">Calcular</button>
</form>
<div id="resultado-dias" role="status"></div>
<p class="detalle">La fecha desde es el día en que el plazo empieza a contar, y no se cuenta: el día 1 es el día hábil siguiente. Con la casilla marcada, la API calcula con lo que tiene cuando la fecha sale de la cobertura del calendario y avisa lo que puede faltar; sin marcarla, responde 422.</p>
</section>`;

  const tablaPlazos = tabla(
    "plazos-sat",
    "Qué cuenta como hábil según el tipo de plazo del SAT",
    [{ texto: "tipo_plazo" }, { texto: "Vacaciones del SAT" }, { texto: "Descanso (artículo 12)" }],
    [
      '<tr><th scope="row"><code>general</code></th><td>Inhábiles</td><td>Inhábiles</td></tr>',
      '<tr><th scope="row"><code>declaraciones_pagos</code></th><td>Hábiles</td><td>Inhábiles</td></tr>',
    ],
  );

  const comoCuenta = seccion("como-cuenta", "Cómo cuenta cada autoridad", [
    "<p>La API suma los días hábiles a una fecha según el calendario de una autoridad. El plazo empieza a contar el día hábil siguiente a <code>desde</code>, sea <code>desde</code> hábil o no. En un plazo que corre desde una notificación, <code>desde</code> es el día en que la notificación surte efectos. El resultado es el último día del cómputo y no aplica prórrogas que dependen de dónde se hace el trámite.</p>",
    `<h3 id="como-sat">SAT: artículo 12 del CFF</h3>
<p>El artículo 12 del Código Fiscal de la Federación dice que en los plazos para presentar declaraciones y pagar contribuciones los periodos generales de vacaciones de las autoridades fiscales se consideran hábiles. En los demás plazos son inhábiles. Los días de descanso del artículo 12 y los sábados y domingos son inhábiles en los dos casos.</p>
${tablaPlazos}
<p>Con <code>declaraciones_pagos</code>, si el resultado cae en viernes, en vacaciones del SAT o en un cierre bancario, la respuesta trae el aviso <code>prorroga-art-12</code>: el quinto párrafo del artículo 12 puede prorrogar el plazo según dónde se presente o se pague, y el cálculo no la aplica.</p>`,
    `<h3 id="como-lft">LFT: artículos 74 y 733</h3>
<p>Con <code>lft</code> se descuentan los sábados, los domingos y los días de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo. En materia laboral los términos corren desde el día siguiente al en que surte efectos la notificación (artículo 733): por eso <code>desde</code> no se cuenta. Del viernes 18 de diciembre de 2026, el día 1 es el lunes 21 y el día 3 el miércoles 23.</p>
<p>El artículo 715 también excluye los festivos del calendario oficial y los días en que las autoridades laborales suspenden labores, como la Semana Santa o sus vacaciones. Este calendario no los tiene, así que cada respuesta con <code>lft</code> trae el aviso <code>lft-art-715</code> y el resultado puede ser anterior al vencimiento real de un plazo procesal. Revisa el calendario del tribunal o del centro de conciliación.</p>`,
    `<h3 id="como-cnbv">CNBV: calendario bancario</h3>
<p>Con <code>cnbv</code> se descuentan los días que las disposiciones de la CNBV mandan cerrar a las entidades financieras, además de sábados y domingos. Es el calendario bancario, no el de la CNBV como autoridad: para un plazo en un procedimiento ante la Comisión cuentan sus propios días de suspensión de labores, que no están aquí.</p>`,
  ]);

  const cobertura = seccion("cobertura", "Qué fechas cubre", [
    `<p>El calendario de la LFT cubre ${rango(COBERTURA_LFT)}. El de la CNBV, ${rango(cnbv.calendario.amplia)}. Para el SAT, el artículo 12 se calcula por regla ${rango(declaraciones)}, y las vacaciones están publicadas ${rango(generalSat)}: un plazo general que pase de esa fecha responde 422 <code>calendario-incompleto</code>.</p>`,
    "<p>Con <code>permitir_incompleto=true</code>, la API calcula con lo publicado y trae un aviso (<code>calendario-incompleto</code> o <code>tipo-plazo-incompleto</code>): el resultado puede cambiar cuando se publique lo que falta.</p>",
  ]);

  const ejemplos = seccion("ejemplos", "Ejemplos con la API", [
    "<p>Cada enlace consulta la API de este mismo sitio y muestra la respuesta en JSON:</p>",
    `<ul>
${EJEMPLOS.map((e) => `<li><a href="${escaparHtml(e.consulta)}">${escaparHtml(e.texto)}</a></li>`).join("\n")}
</ul>`,
  ]);

  const fuentes = [...sat.meta.sources, ...cnbv.meta.sources, ...lft.sources];
  const datosAl = masReciente(sat.meta.as_of, cnbv.meta.as_of, lft.as_of);
  return {
    ruta: RUTA_CALCULADORA,
    titulo: "Calculadora de días hábiles: SAT, LFT y bancos · MéxicoAPI",
    descripcion:
      "Suma días hábiles a una fecha con el calendario del SAT, de la LFT o bancario de la CNBV. Muestra los días que salta y sus avisos.",
    h1: "Calculadora de días hábiles: SAT, LFT y bancos",
    miga: "Calculadora de días hábiles",
    dataset: null,
    datosAl,
    queEsDatosAl: "la fecha de la publicación más reciente de los calendarios",
    intro:
      '<p class="intro">Suma días hábiles a una fecha según el calendario del SAT, de la Ley Federal del Trabajo o bancario de la CNBV, y ve qué días inhábiles saltó el cálculo y qué avisos trae.</p>',
    contenido: [formulario, comoCuenta, cobertura, ejemplos].join("\n"),
    fuentes,
    citas: [],
    consultas: EJEMPLOS.map((e) => e.consulta),
    guiaApi: `${URL_DOCS}/api/README.md#dias-habiles`,
    paquete: null,
    descargas: [],
    docs: null,
    conjunto: null,
    relacionadas: [RUTA_DIAS_SAT, RUTA_DIAS_LFT, RUTA_DIAS_CNBV],
  };
}
