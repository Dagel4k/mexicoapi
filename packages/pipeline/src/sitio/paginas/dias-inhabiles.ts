// Las páginas de los calendarios: los días inhábiles del SAT, los de descanso obligatorio de la LFT
// y los días inhábiles bancarios de la CNBV, del año actual y el siguiente. Cada lista sale del
// mismo cálculo que responde `/v1/dias-inhabiles` (las funciones del núcleo con el calendario del
// build), así que la página y la API dicen lo mismo. Los textos explicativos son los de
// docs/datos/dias-inhabiles-*.md y docs/api/README.md.
import {
  type AutoridadCurada,
  COBERTURA_LFT,
  type CoberturaCurada,
  type DiaInhabil,
  type DiaInhabilCurado,
  diaDeLaSemana,
  diasDescansoLft,
  type FechaISO,
  FUENTE_LFT_715,
  type Fuente,
  TIPOS_DIA_CURADO,
  TIPOS_PLAZO,
} from "@mexicoapi/core";
import { type CalendarioCurado, diasInhabilesCurados } from "@mexicoapi/core/curados";
import { diasInhabilesLft, fechaEnTexto, metaLft } from "@mexicoapi/core/rutas";
import { calendarioCurado, coberturasDeLaLista } from "../../curado/calendario.js";
import { COBERTURA_LISTA_LFT } from "../calendarios.js";
import { type Meta, URL_DOCS } from "../meta.js";
import { escaparHtml } from "./html.js";
import type { CitaPagina, PaginaDatos } from "./pagina-datos.js";

export const RUTA_DIAS_SAT = "/dias-inhabiles-sat/";
export const RUTA_DIAS_LFT = "/dias-de-descanso-obligatorio/";
export const RUTA_DIAS_CNBV = "/dias-inhabiles-bancarios/";

type Rango = { readonly desde: FechaISO; readonly hasta: FechaISO };

/** El calendario de una autoridad curada con lo que la página dice de él. */
export interface CalendarioDePagina {
  /** El mismo que arma el Worker con `v1/_internos/calendarios/<autoridad>.json`. */
  calendario: CalendarioCurado;
  /** La del manifiesto: `as_of`, fuentes con su cita y la documentación. */
  meta: Meta;
  /**
   * Hasta dónde está completa la lista descargable (`dias-inhabiles-coberturas`), del primer día
   * de sus plazos al último: el `temporalCoverage` del Dataset.
   */
  lista: Rango;
}

/** Arma el calendario de una autoridad como lo hacen el build, el Worker y el paquete. */
export function calendarioDePagina(
  autoridad: AutoridadCurada,
  registros: readonly DiaInhabilCurado[],
  cobertura: CoberturaCurada | null,
  meta: Meta,
): CalendarioDePagina {
  const plazos = Object.values(coberturasDeLaLista(autoridad, registros, cobertura)).map(
    (p) => p.cobertura,
  );
  const desde = plazos.map((c) => c.desde).sort()[0] as FechaISO;
  const hasta = plazos
    .map((c) => c.hasta)
    .sort()
    .at(-1) as FechaISO;
  return {
    calendario: calendarioCurado(autoridad, registros, cobertura),
    meta,
    lista: { desde, hasta },
  };
}

export interface EntradaCalendarios {
  /** El año actual de las páginas: el de la fecha más reciente del FIX en `data/`. */
  anio: number;
  sat: CalendarioDePagina;
  cnbv: CalendarioDePagina;
}

/** Las tres páginas, en el orden del registro. */
export function paginasDeCalendarios({ anio, sat, cnbv }: EntradaCalendarios): PaginaDatos[] {
  return [paginaDiasSat(anio, sat), paginaDiasLft(anio), paginaDiasCnbv(anio, cnbv)];
}

const anioDe = (fecha: FechaISO): number => Number(fecha.slice(0, 4));

const cubreAnio = (rango: Rango, anio: number): boolean =>
  rango.desde <= `${anio}-01-01` && rango.hasta >= `${anio}-12-31`;

/** De `anio` y el siguiente, los que `rango` cubre completos. */
const aniosCubiertos = (anio: number, rango: Rango): number[] =>
  [anio, anio + 1].filter((a) => cubreAnio(rango, a));

const enTexto = (anios: readonly number[]): string => anios.join(" y ");

const cuenta = (n: number): string => `${n} ${n === 1 ? "día" : "días"}`;

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const TIPOS: Readonly<Record<string, string>> = {
  descanso: "Descanso",
  vacaciones: "Vacaciones",
};

const PLAZOS: Readonly<Record<string, string>> = {
  general: "Plazo general",
  declaraciones_pagos: "Declaraciones y pagos",
};

/** "20 de julio": la fecha sin el año, que ya dice el título de la tabla. */
const diaYMes = (fecha: FechaISO): string => fechaEnTexto(fecha).replace(/ de \d+$/, "");

/** La tabla de los días de un año; el id de su caption es `dias-{anio}`. */
function tablaDias(
  anio: number,
  titulo: string,
  dias: readonly DiaInhabil[],
  conTipo: boolean,
): string {
  const id = `dias-${anio}`;
  const filas = dias.map((d) => {
    const tipo = conTipo ? `<td>${escaparHtml(TIPOS[d.tipo] ?? d.tipo)}</td>` : "";
    return `<tr><th scope="row"><time datetime="${escaparHtml(d.fecha)}">${diaYMes(d.fecha)}</time><span class="detalle">${NOMBRES_DIA[diaDeLaSemana(d.fecha)]}</span></th><td>${escaparHtml(d.motivo)}</td>${tipo}</tr>`;
  });
  return `<div class="tabla compacta" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${escaparHtml(titulo)}</caption>
<thead>
<tr><th scope="col">Fecha</th><th scope="col">Motivo</th>${conTipo ? '<th scope="col">Tipo</th>' : ""}</tr>
</thead>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</div>`;
}

/** La sección de un año: su título, lo que se dice antes de la tabla y la tabla. */
function seccionAnio(
  anio: number,
  titulo: string,
  antes: readonly string[],
  tabla: string,
): string {
  return `<section id="anio-${anio}" aria-labelledby="titulo-${anio}">
<h2 id="titulo-${anio}">${escaparHtml(titulo)}</h2>
${antes.join("\n")}
${tabla}
</section>`;
}

/** Los textos citados de los días, por publicación y sin repetir, y después los de `extra`. */
function citasDe(dias: readonly DiaInhabil[], extra: readonly Fuente[] = []): CitaPagina[] {
  const porPublicacion = new Map<string, { nombre: string; url: string; fragmentos: string[] }>();
  for (const f of [...dias.map((d) => d.fuente), ...extra]) {
    if (f.fragmento === undefined) continue;
    const clave = `${f.nombre}\n${f.url}`;
    const cita = porPublicacion.get(clave) ?? { nombre: f.nombre, url: f.url, fragmentos: [] };
    if (!cita.fragmentos.includes(f.fragmento)) cita.fragmentos.push(f.fragmento);
    porPublicacion.set(clave, cita);
  }
  return [...porPublicacion.values()];
}

const DESCARGA_COBERTURAS = {
  archivo: "dias-inhabiles-coberturas.json",
  contenido: "Hasta dónde está completa la lista de cada autoridad y tipo de plazo",
};

const GUIA_INHABILES = `${URL_DOCS}/api/README.md#dias-inhabiles`;

/** El ejemplo del cliente del paquete para la lista de un año. */
const conCliente = (autoridad: string, anio: number): string =>
  `import { crearCliente } from "mexicoapi/cliente";

const api = crearCliente();
const { data, advertencias } = await api.diasInhabiles({ autoridad: "${autoridad}", anio: ${anio} });`;

/** Qué tanto de las vacaciones de `anio` está publicado, según la cobertura del plazo general. */
function vacacionesDelAnio(anio: number, general: Rango): string {
  if (cubreAnio(general, anio))
    return `<p>La lista de ${anio} está completa para cualquier plazo.</p>`;
  const inicio = `${anio}-01-01`;
  const fin = `${anio}-12-31`;
  if (general.hasta < inicio || general.desde > fin) {
    return `<p class="aviso">Las vacaciones del SAT de ${anio} no se han publicado o no se han cargado: esta lista solo trae los días del artículo 12, que fija la ley.</p>`;
  }
  const desde = general.desde > inicio ? general.desde : inicio;
  const hasta = general.hasta < fin ? general.hasta : fin;
  return `<p class="aviso">Las vacaciones de ${anio} están publicadas del ${fechaEnTexto(desde)} al ${fechaEnTexto(hasta)}; las demás no se han publicado o no se han cargado, así que en esta lista pueden faltar días de vacaciones.</p>`;
}

/** Qué tipo de día cuenta como inhábil en cada plazo, según los `excluirTipos` del calendario. */
function tablaPlazos(calendario: CalendarioCurado): string {
  const plazos = TIPOS_PLAZO.flatMap((t) => {
    const plazo = calendario.plazos.get(t);
    return plazo === undefined ? [] : [[t, plazo.excluirTipos] as const];
  });
  const filas = TIPOS_DIA_CURADO.map((tipo) => {
    const celdas = plazos.map(([, excluir]) => (excluir.includes(tipo) ? "Hábil" : "Inhábil"));
    return `<tr><th scope="row">${TIPOS[tipo]}</th>${celdas.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  });
  return `<div class="tabla compacta" role="region" aria-labelledby="tabla-plazos" tabindex="0">
<table>
<caption id="tabla-plazos">Qué días son inhábiles en cada tipo de plazo</caption>
<thead>
<tr><th scope="col">Tipo de día</th>${plazos.map(([t]) => `<th scope="col">${PLAZOS[t]}</th>`).join("")}</tr>
</thead>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</div>`;
}

/** `/dias-inhabiles-sat/`: los días del art. 12 por regla y las vacaciones publicadas. */
export function paginaDiasSat(anio: number, sat: CalendarioDePagina): PaginaDatos {
  const { calendario, meta, lista } = sat;
  const anios = aniosCubiertos(anio, calendario.amplia);
  if (anios.length === 0) throw new Error(`el calendario del SAT no cubre ${anio}`);
  const general = calendario.general.cobertura;
  const declaraciones =
    calendario.plazos.get("declaraciones_pagos")?.cobertura ?? calendario.amplia;
  const listas = anios.map((a) => ({ anio: a, ...diasInhabilesCurados(calendario, a) }));
  const secciones = listas.map(({ anio: a, dias, avisos }) => {
    const descanso = dias.filter((d) => d.tipo === "descanso").length;
    const vacaciones = dias.length - descanso;
    const resumen =
      vacaciones === 0
        ? `<p>${cuenta(dias.length)}, todos de descanso del artículo 12.</p>`
        : `<p>${cuenta(dias.length)}: ${descanso} de descanso del artículo 12 y ${vacaciones} de vacaciones.</p>`;
    // La API avisa en la lista de un año de transmisión del Poder Ejecutivo; la página también.
    const transmision = avisos
      .filter((av) => av.codigo === "transmision-poder-ejecutivo")
      .map((av) => `<p class="aviso">${escaparHtml(av.texto)}</p>`);
    return seccionAnio(
      a,
      `Días inhábiles del SAT en ${a}`,
      [resumen, vacacionesDelAnio(a, general), ...transmision],
      tablaDias(a, `Días inhábiles del SAT en ${a}`, dias, true),
    );
  });
  const plazos = `<section id="plazos" aria-labelledby="titulo-plazos">
<h2 id="titulo-plazos">Plazos generales y de declaraciones y pagos</h2>
<p>El artículo 12 del Código Fiscal de la Federación dice que en los plazos para presentar declaraciones y pagar contribuciones los periodos generales de vacaciones de las autoridades fiscales se consideran hábiles. En los demás plazos no cuentan.</p>
${tablaPlazos(calendario)}
<p>Los días que la regla 2.1.6 declara inhábiles para el SAT sin ser vacaciones generales se tratan como vacaciones: en un plazo de declaraciones y pagos cuentan como hábiles y el plazo vence antes, no después, que es el lado seguro para el contribuyente.</p>
<p>Para sumar días hábiles, <code>/v1/dias-habiles</code> con <code>autoridad=sat</code> pide <code>tipo_plazo=general</code> o <code>tipo_plazo=declaraciones_pagos</code>.</p>
</section>`;
  const pendiente = `<section id="pendiente" aria-labelledby="titulo-pendiente">
<h2 id="titulo-pendiente">Lo que falta publicar</h2>
<p>Para un plazo general, la lista está completa del ${fechaEnTexto(general.desde)} al ${fechaEnTexto(general.hasta)}: después pueden faltar las vacaciones que el SAT no ha publicado o que no se han cargado. Se agregan cuando el DOF publica la regla 2.1.6 que las fija.</p>
<p>Para un plazo de declaraciones y pagos, que no cuenta las vacaciones, la lista está completa del ${fechaEnTexto(declaraciones.desde)} al ${fechaEnTexto(declaraciones.hasta)}: los días del artículo 12 se calculan por regla.</p>
<p>Un cálculo de plazo general que pase del ${fechaEnTexto(general.hasta)} responde 422 <code>calendario-incompleto</code>; con <code>permitir_incompleto=true</code> calcula con lo publicado y avisa lo que puede faltar.</p>
</section>`;
  const deLaLista = enTexto([...new Set([anioDe(lista.desde), anioDe(lista.hasta)])]);
  const texto = enTexto(anios);
  const h1 = `Días inhábiles del SAT ${texto}`;
  return {
    ruta: RUTA_DIAS_SAT,
    titulo: `${h1} · MéxicoAPI`,
    descripcion: `Días inhábiles del SAT en ${texto}: los del artículo 12 del CFF y las vacaciones de la regla 2.1.6 de la RMF, con su fuente oficial en el DOF.`,
    h1,
    miga: "Días inhábiles del SAT",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
    intro: `<p class="intro">Días que no cuentan en los plazos fiscales ante el SAT: los del artículo 12 del Código Fiscal de la Federación y los periodos de vacaciones y días inhábiles que fija la regla 2.1.6 de la Resolución Miscelánea Fiscal. Los sábados y domingos también son inhábiles y no se listan por serlo; un periodo de vacaciones se lista completo, con sus fines de semana.</p>`,
    contenido: [...secciones, plazos, pendiente].join("\n"),
    fuentes: meta.sources,
    citas: citasDe(listas.flatMap((l) => l.dias)),
    consultas: anios.map((a) => `/v1/dias-inhabiles?autoridad=sat&anio=${a}`),
    guiaApi: GUIA_INHABILES,
    paquete: conCliente("sat", anio),
    descargas: [
      {
        archivo: "dias-inhabiles-sat.json",
        contenido: `Los días de ${deLaLista}, con su motivo, su tipo y su fuente`,
      },
      { archivo: "dias-inhabiles-sat.csv", contenido: "Lo mismo, con la fuente en columnas" },
      { archivo: "dias-inhabiles-sat.manifest.json", contenido: "Fuentes, licencia y sha256" },
      DESCARGA_COBERTURAS,
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Días inhábiles del SAT",
      descripcion: `Días inhábiles para los plazos fiscales ante el SAT: los del primer párrafo del artículo 12 del Código Fiscal de la Federación, calculados por regla, y los periodos de vacaciones y días inhábiles de la regla 2.1.6 de la Resolución Miscelánea Fiscal, transcritos del Diario Oficial de la Federación. Cada día trae su fecha, su motivo, su tipo (descanso o vacaciones) y la cita de su fuente. La descarga trae los días de ${deLaLista}; las vacaciones están completas del ${general.desde} al ${general.hasta}. Los sábados y domingos no se listan por serlo; un periodo de vacaciones se lista completo, con sus fines de semana.`,
      palabrasClave: [
        "días inhábiles",
        "SAT",
        "Código Fiscal de la Federación",
        "artículo 12",
        "Resolución Miscelánea Fiscal",
        "regla 2.1.6",
        "vacaciones del SAT",
        "plazos fiscales",
      ],
      coberturaTemporal: `${lista.desde}/${lista.hasta}`,
      distribucion: ["dias-inhabiles-sat.json", "dias-inhabiles-sat.csv"],
    },
    relacionadas: [RUTA_DIAS_LFT, RUTA_DIAS_CNBV],
  };
}

/** La primera transmisión del Poder Ejecutivo desde `anio`, dentro del calendario de la LFT. */
function transmisionDesde(anio: number): DiaInhabil | undefined {
  for (let a = anio; a <= anioDe(COBERTURA_LFT.hasta); a++) {
    const dia = diasDescansoLft(a).find((d) => d.motivo.includes("transmisión"));
    if (dia !== undefined) return dia;
  }
  return undefined;
}

/** `/dias-de-descanso-obligatorio/`: el art. 74 de la LFT, calculado por regla. */
export function paginaDiasLft(anio: number): PaginaDatos {
  const anios = aniosCubiertos(anio, COBERTURA_LFT);
  if (anios.length === 0) throw new Error(`el calendario de la LFT no cubre ${anio}`);
  const meta = metaLft("dias-inhabiles");
  const listas = anios.map((a) => ({ anio: a, ...diasInhabilesLft(a) }));
  const secciones = listas.map(({ anio: a, dias }) =>
    seccionAnio(
      a,
      `Días de descanso obligatorio en ${a}`,
      [`<p>${cuenta(dias.length)}.</p>`],
      tablaDias(a, `Días de descanso obligatorio en ${a}`, dias, false),
    ),
  );
  const proxima = transmisionDesde(anio);
  const transmision =
    proxima === undefined
      ? []
      : [
          `<section id="transmision" aria-labelledby="titulo-transmision">
<h2 id="titulo-transmision">Transmisión del Poder Ejecutivo</h2>
<p>Cada seis años se suma el día de la transmisión del Poder Ejecutivo Federal (fracción VII del artículo 74). El primero desde ${anio} es el ${fechaEnTexto(proxima.fecha)}.</p>
</section>`,
        ];
  const art715 = `<section id="art-715" aria-labelledby="titulo-715">
<h2 id="titulo-715">Plazos ante tribunales laborales</h2>
<p class="aviso">Para un plazo procesal esta lista no basta: el artículo 715 también excluye los festivos que señale el calendario oficial y los días en que las autoridades laborales suspenden labores, como la Semana Santa o sus vacaciones. Cada tribunal y centro de conciliación publica los suyos y esta lista no los tiene: revisa su calendario antes de contar.</p>
<p>La API lo advierte en cada respuesta con <code>autoridad=lft</code>, con el aviso <code>lft-art-715</code>.</p>
</section>`;
  const desde = anioDe(COBERTURA_LFT.desde);
  const hasta = anioDe(COBERTURA_LFT.hasta);
  const texto = enTexto(anios);
  const h1 = `Días de descanso obligatorio ${texto} (LFT)`;
  return {
    ruta: RUTA_DIAS_LFT,
    titulo: `${h1} · MéxicoAPI`,
    descripcion: `Días de descanso obligatorio de ${texto} según el artículo 74 de la Ley Federal del Trabajo, con su fuente oficial, por API, npm y descarga.`,
    h1,
    miga: "Días de descanso obligatorio",
    dataset: null,
    datosAl: meta.as_of,
    queEsDatosAl:
      "la fecha de la última reforma de la Ley Federal del Trabajo que se tomó en cuenta",
    intro: `<p class="intro">Los días de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, calculados por regla para cada año de ${desde} a ${hasta}. Para nómina (días de descanso obligatorio, artículo 75) esta es la lista que aplica. Los sábados y domingos no se listan por serlo; un día de descanso obligatorio que cae en fin de semana sí aparece.</p>`,
    contenido: [...secciones, ...transmision, art715].join("\n"),
    fuentes: meta.sources,
    citas: citasDe(
      listas.flatMap((l) => l.dias),
      [FUENTE_LFT_715],
    ),
    consultas: anios.map((a) => `/v1/dias-inhabiles?autoridad=lft&anio=${a}`),
    guiaApi: GUIA_INHABILES,
    paquete: `import { diasDescansoLft } from "mexicoapi";

diasDescansoLft(${anio}); // sin red: los días del artículo 74, cada uno con su cita`,
    descargas: [
      {
        archivo: "dias-inhabiles-lft.json",
        contenido: `Los días de ${desde} a ${hasta}, cada uno con el texto del artículo 74 en vigor ese día`,
      },
      { archivo: "dias-inhabiles-lft.csv", contenido: "Lo mismo, con la fuente en columnas" },
      DESCARGA_COBERTURAS,
    ],
    docs: null,
    conjunto: {
      nombre: "Días de descanso obligatorio de la Ley Federal del Trabajo",
      descripcion: `Días de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, calculados por regla para cada año de ${desde} a ${hasta}. Cada día trae su fecha, su motivo y la cita del texto del artículo 74 que estaba en vigor ese día. Los sábados y domingos no se listan por serlo. No incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (artículo 715).`,
      palabrasClave: [
        "días de descanso obligatorio",
        "Ley Federal del Trabajo",
        "artículo 74",
        "días inhábiles",
        "nómina",
      ],
      coberturaTemporal: `${COBERTURA_LISTA_LFT.desde}/${COBERTURA_LISTA_LFT.hasta}`,
      distribucion: ["dias-inhabiles-lft.json", "dias-inhabiles-lft.csv"],
    },
    relacionadas: [RUTA_DIAS_SAT, RUTA_DIAS_CNBV],
  };
}

/** `/dias-inhabiles-bancarios/`: las disposiciones de la CNBV de los años cargados. */
export function paginaDiasCnbv(anio: number, cnbv: CalendarioDePagina): PaginaDatos {
  const { calendario, meta, lista } = cnbv;
  const { amplia } = calendario;
  const ultimo = anioDe(amplia.hasta);
  const cubiertos = aniosCubiertos(anio, amplia);
  // Antes de que la CNBV publique el año, la página se queda con el último que tiene.
  const anios = cubiertos.length > 0 ? cubiertos : [ultimo];
  const faltan = [anio, anio + 1].filter((a) => a > ultimo);
  const anteriores: number[] = [];
  for (let a = anioDe(amplia.desde); a < (anios[0] as number); a++) {
    if (cubreAnio(amplia, a)) anteriores.push(a);
  }
  const listas = anios.map((a) => ({ anio: a, ...diasInhabilesCurados(calendario, a) }));
  const secciones = listas.map(({ anio: a, dias }) => {
    const fechas = [...new Set(dias.flatMap((d) => d.fuente.fecha_publicacion ?? []))];
    return seccionAnio(
      a,
      `Días inhábiles bancarios en ${a}`,
      [
        `<p>${cuenta(dias.length)}, según las disposiciones publicadas en el DOF el ${fechas.map(fechaEnTexto).join(" y el ")}.</p>`,
      ],
      tablaDias(a, `Días inhábiles bancarios en ${a}`, dias, false),
    );
  });
  const faltantes =
    faltan.length === 0
      ? ""
      : `\n<p class="aviso">${faltan.length === 1 ? `El calendario de ${faltan[0]} no se ha cargado` : `Los calendarios de ${enTexto(faltan)} no se han cargado`}: la CNBV publica sus disposiciones en el DOF cada año y se agregan cuando salen. Mientras tanto, la API responde 422 <code>calendario-incompleto</code> para ${faltan.length === 1 ? "ese año" : "esos años"}.</p>`;
  const antes =
    anteriores.length === 0 ? "" : ` La API y las descargas también traen ${enTexto(anteriores)}.`;
  const cobertura = `<section id="cobertura" aria-labelledby="titulo-cobertura">
<h2 id="titulo-cobertura">Años cubiertos</h2>
<p>La lista está completa del ${fechaEnTexto(amplia.desde)} al ${fechaEnTexto(amplia.hasta)}.${antes}</p>${faltantes}
</section>`;
  const notas = `<section id="notas" aria-labelledby="titulo-notas">
<h2 id="titulo-notas">Antes de usarlo</h2>
<ul>
<li>Las disposiciones permiten a cada entidad abrir o cerrar en otros días con aviso a la CNBV, así que el calendario efectivo de una entidad puede variar.</li>
<li>Los almacenes generales de depósito y las casas de cambio pueden abrir y operar todos los días del año.</li>
</ul>
</section>`;
  const texto = enTexto(anios);
  const h1 = `Días inhábiles bancarios ${texto} (CNBV)`;
  return {
    ruta: RUTA_DIAS_CNBV,
    titulo: `${h1} · MéxicoAPI`,
    descripcion: `Días inhábiles bancarios de ${texto}: cuándo cierran los bancos y demás entidades supervisadas por la CNBV, según sus disposiciones en el DOF.`,
    h1,
    miga: "Días inhábiles bancarios",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
    intro: `<p class="intro">Días en que las entidades financieras supervisadas por la Comisión Nacional Bancaria y de Valores (bancos, casas de bolsa y demás entidades que enumeran las disposiciones) deben cerrar sus puertas y suspender operaciones. Es el calendario bancario, no el de la CNBV como autoridad: en un procedimiento ante la Comisión cuentan sus propios días de suspensión de labores, que no están aquí.</p>
<p>Los sábados y domingos también son inhábiles (fracción IX del artículo 1 de las disposiciones) y no se listan; una fecha de las disposiciones que cae en fin de semana sí aparece.</p>`,
    contenido: [cobertura, ...secciones, notas].join("\n"),
    fuentes: meta.sources,
    citas: citasDe(listas.flatMap((l) => l.dias)),
    consultas: anios.map((a) => `/v1/dias-inhabiles?autoridad=cnbv&anio=${a}`),
    guiaApi: GUIA_INHABILES,
    paquete: conCliente("cnbv", anios[0] as number),
    descargas: [
      {
        archivo: "dias-inhabiles-cnbv.json",
        contenido: `Los días de ${enTexto([...new Set([anioDe(lista.desde), anioDe(lista.hasta)])])}, con su motivo y su fuente`,
      },
      { archivo: "dias-inhabiles-cnbv.csv", contenido: "Lo mismo, con la fuente en columnas" },
      { archivo: "dias-inhabiles-cnbv.manifest.json", contenido: "Fuentes, licencia y sha256" },
      DESCARGA_COBERTURAS,
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Días inhábiles bancarios de la CNBV",
      descripcion: `Días en que las entidades financieras supervisadas por la Comisión Nacional Bancaria y de Valores deben cerrar sus puertas y suspender operaciones, transcritos de las disposiciones que la CNBV publica cada año en el Diario Oficial de la Federación. Cada día trae su fecha, su motivo y la cita de su fuente. La lista está completa del ${amplia.desde} al ${amplia.hasta}. Los sábados y domingos no se listan por serlo; una fecha de las disposiciones que cae en fin de semana sí aparece.`,
      palabrasClave: [
        "días inhábiles bancarios",
        "CNBV",
        "calendario bancario",
        "Diario Oficial de la Federación",
      ],
      coberturaTemporal: `${lista.desde}/${lista.hasta}`,
      distribucion: ["dias-inhabiles-cnbv.json", "dias-inhabiles-cnbv.csv"],
    },
    relacionadas: [RUTA_DIAS_SAT, RUTA_DIAS_LFT],
  };
}
