// Las páginas de los catálogos: los códigos de banco de la CLABE, los municipios de cada estado y
// el validador de CLABE. Cada nombre, clave y fecha sale del mismo registro que sirve la API
// (`data/`), así que la página y la API dicen lo mismo. Los textos explicativos son los de
// docs/datos/bancos.md, docs/datos/inegi-municipios.md y docs/api/README.md.
import type { Banco, Estado, FechaISO, Municipio } from "@mexicoapi/core";
import { URL_DOCS } from "../meta.js";
import { formatearEntero } from "./bloques.js";
import { escaparHtml } from "./html.js";
import { celdaNum, type SerieDePagina, seccion, tabla } from "./indicadores.js";
import { CLABE_EJEMPLO } from "./inicio.js";
import type { PaginaDatos } from "./pagina-datos.js";

export const RUTA_BANCOS = "/bancos-clabe/";
export const RUTA_VALIDAR_CLABE = "/validar-clabe/";
export const RUTA_MUNICIPIOS = "/municipios/";

export interface EntradaCatalogos {
  bancos: SerieDePagina<Banco>;
  estados: SerieDePagina<Estado>;
  municipios: SerieDePagina<Municipio>;
}

const guia = (ancla: string): string => `${URL_DOCS}/api/README.md#${ancla}`;

const NOTA_DATOS_EN_PAQUETE =
  "Con <code>npm install mexicoapi</code>. Los datos vienen dentro del paquete: no usa la red.";

/** "Michoacán de Ocampo" → "michoacan-de-ocampo". */
const sinAcentos = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `/municipios/25-sinaloa/`: la página de los municipios de un estado. */
export const rutaDeEstado = (estado: Estado): string =>
  `${RUTA_MUNICIPIOS}${estado.cve_ent}-${sinAcentos(estado.nombre)}/`;

const masReciente = (a: FechaISO, b: FechaISO): FechaISO => (a >= b ? a : b);

/** Las cuatro páginas de arriba y una por estado, en el orden del registro. */
export function paginasDeCatalogos(entrada: EntradaCatalogos): PaginaDatos[] {
  const { estados, municipios } = entrada;
  return [
    paginaBancos(entrada.bancos),
    paginaValidarClabe(entrada.bancos),
    paginaMunicipios(estados, municipios),
    ...estados.registros.map((estado) => paginaDeEstado(estado, municipios)),
  ];
}

/** `/bancos-clabe/`: la tabla completa de códigos de banco. */
export function paginaBancos({ registros, meta }: SerieDePagina<Banco>): PaginaDatos {
  const activos = registros.filter((b) => b.activo).length;
  const inactivos = registros.length - activos;
  const desde = registros
    .flatMap((b) => b.historial.map((p) => p.desde))
    .reduce((a, b) => (a <= b ? a : b));
  const ejemplo = registros.find((b) => b.codigo === "012") ?? (registros[0] as Banco);

  const filas = registros.map((b) => {
    const razon =
      b.razon_social === null ? "" : `<span class="detalle">${escaparHtml(b.razon_social)}</span>`;
    const estado = b.activo
      ? "Activo"
      : `Inactivo<span class="detalle">dejó de aparecer en la lista del CEP${b.baja_detectada === null ? "" : `; baja detectada el ${escaparHtml(b.baja_detectada)}`}</span>`;
    return `<tr><th scope="row">${escaparHtml(b.codigo)}</th><td>${escaparHtml(b.nombre_corto)}${razon}</td><td>${estado}</td></tr>`;
  });

  const lista = seccion("codigos", "Todos los códigos", [
    `<p>Una fila por institución, activa o inactiva, en orden de código. Para saber a qué banco pertenece una CLABE se toman sus tres primeros dígitos y se buscan aquí; para revisar una CLABE completa, usa el <a href="${RUTA_VALIDAR_CLABE}">validador de CLABE</a>.</p>`,
    tabla(
      "bancos-tabla",
      "Códigos de banco de la CLABE, con su nombre y estado",
      [{ texto: "Código" }, { texto: "Institución" }, { texto: "Estado" }],
      filas,
    ),
  ]);

  const estructura = seccion("estructura", "Cómo se forma una CLABE", [
    "<p>Una CLABE tiene 18 dígitos: 3 de banco, 3 de plaza, 11 de cuenta y 1 de dígito verificador. El código de banco es el de esta tabla.</p>",
    "<p>Los bancos que dejan de aparecer en la lista de Banxico no se borran: quedan como inactivos para que las CLABE antiguas se sigan decodificando. La CLABE de un banco inactivo tiene formato válido; si el banco sigue operando o no, lo decide quien la recibe.</p>",
  ]);

  return {
    ruta: RUTA_BANCOS,
    titulo: "Códigos de banco de la CLABE · MéxicoAPI",
    descripcion: `Los ${registros.length} códigos de banco de la CLABE con su nombre y si siguen activos, de las listas del Banco de México, por API, npm y descarga.`,
    h1: "Códigos de banco de la CLABE",
    miga: "Códigos de banco",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la última revisión de la lista de instituciones del Banco de México",
    intro: `<p class="intro">Los tres primeros dígitos de una CLABE son el código del banco. Son ${registros.length} instituciones: ${activos} activas y ${inactivos} inactivas, de la lista del Comprobante Electrónico de Pago y del documento de participantes directos del SPEI del Banco de México.</p>`,
    contenido: [lista, estructura].join("\n"),
    fuentes: meta.sources,
    citas: [],
    consultas: ["/v1/bancos", `/v1/bancos/${ejemplo.codigo}`],
    guiaApi: guia("bancos"),
    paquete: {
      codigo: `import { banco, bancos } from "mexicoapi/datos";

bancos(); // todas las instituciones, con su historial
banco("${ejemplo.codigo}")?.nombre_corto; // "${ejemplo.nombre_corto}"`,
      nota: NOTA_DATOS_EN_PAQUETE,
    },
    descargas: [
      {
        archivo: "bancos.json",
        contenido: `Las ${registros.length} instituciones, con su historial de nombres`,
      },
      { archivo: "bancos.csv", contenido: "Lo mismo, en columnas, sin el historial" },
      { archivo: "bancos-historial.csv", contenido: "El historial de nombres y códigos SPEI" },
      { archivo: "bancos.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Bancos y códigos de banco de la CLABE",
      descripcion: `Instituciones financieras que participan en el SPEI y en el Comprobante Electrónico de Pago del Banco de México, con el código de tres dígitos que va al inicio de la CLABE, el código SPEI, el nombre corto, la razón social, el sector, si siguen activas y el historial de nombres. ${registros.length} instituciones, ${activos} activas y ${inactivos} inactivas; las que dejan de aparecer no se borran, para decodificar CLABE antiguas.`,
      palabrasClave: [
        "códigos de banco",
        "CLABE",
        "bancos de México",
        "SPEI",
        "Banco de México",
        "instituciones financieras",
      ],
      coberturaTemporal: `${desde}/..`,
      distribucion: ["bancos.json", "bancos.csv"],
    },
    relacionadas: [RUTA_VALIDAR_CLABE, RUTA_MUNICIPIOS],
  };
}

/**
 * `/validar-clabe/`: el formulario que `sitio.js` activa. No declara Dataset: es una herramienta,
 * y el catálogo de bancos que usa ya es el Dataset de `/bancos-clabe/`.
 */
export function paginaValidarClabe({ registros, meta }: SerieDePagina<Banco>): PaginaDatos {
  const formulario = `<section id="validador" aria-labelledby="titulo-validador">
<h2 id="titulo-validador">Validar una CLABE</h2>
<noscript><p class="aviso">Este validador necesita JavaScript. Sin él, la API revisa lo mismo: <code>GET /v1/clabe/{clabe}</code>.</p></noscript>
<form id="form-clabe" class="validador" hidden>
<label for="entrada-clabe">CLABE de 18 dígitos</label>
<input id="entrada-clabe" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="40">
<button type="submit">Validar</button>
</form>
<p id="resultado-clabe" role="status"></p>
<p id="estado-catalogo" class="detalle"></p>
<p>Para probarlo: <code>${CLABE_EJEMPLO}</code>, la CLABE de ejemplo de la documentación, que no es una cuenta real.</p>
</section>`;

  const revisa = seccion("que-revisa", "Qué revisa y qué no", [
    "<p>El validador revisa tres cosas: que sean 18 dígitos (se ignoran los espacios y los guiones), que los tres primeros sean el código de un banco de la lista, y que el dígito verificador coincida con el de los 17 primeros dígitos.</p>",
    "<p>El dígito verificador se calcula multiplicando cada uno de los 17 primeros dígitos por 3, 7 y 1, en ese orden y repetidos, y sumando los productos: el dígito es lo que le falta a la suma para llegar a la siguiente decena, o 0 si ya es una.</p>",
    "<p>Una CLABE que pasa las tres revisiones tiene un formato correcto, pero eso no confirma que la cuenta exista, ni quién es su titular. Solo el banco puede decirlo. La plaza no se revisa: no hay un catálogo oficial de plazas. Un banco inactivo se marca, pero su CLABE sigue teniendo formato válido.</p>",
  ]);

  const privacidad = seccion("privacidad", "La CLABE no sale de tu equipo", [
    `<p>La revisión corre en tu navegador. La página descarga una sola vez el catálogo de bancos, <a href="/descargas/bancos.json">/descargas/bancos.json</a> (${formatearEntero(registros.length)} instituciones, el mismo de <a href="${RUTA_BANCOS}">Códigos de banco de la CLABE</a>), y con él revisa lo que escribes. Lo que escribes no se manda a ningún servidor, no se guarda y no queda en la dirección de la página.</p>`,
  ]);

  return {
    ruta: RUTA_VALIDAR_CLABE,
    titulo: "Validador de CLABE · MéxicoAPI",
    descripcion:
      "Valida una CLABE en tu navegador: formato, dígito verificador y banco. No se manda a ningún servidor y no confirma que la cuenta exista.",
    h1: "Validador de CLABE",
    miga: "Validador de CLABE",
    dataset: null,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha del catálogo de bancos con el que se revisa el banco",
    intro:
      '<p class="intro">Revisa una CLABE en tu navegador: el formato, el dígito verificador y el banco. No confirma que la cuenta exista.</p>',
    contenido: [formulario, revisa, privacidad].join("\n"),
    fuentes: meta.sources,
    citas: [],
    consultas: [`/v1/clabe/${CLABE_EJEMPLO}`],
    guiaApi: guia("clabe"),
    paquete: {
      codigo: `import { validarClabe } from "mexicoapi";
import { catalogoClabe } from "mexicoapi/datos";

const r = validarClabe("${CLABE_EJEMPLO}", { bancos: catalogoClabe() });
r.valido; // true
r.banco_revisado; // true`,
      nota: `${NOTA_DATOS_EN_PAQUETE} Sin el catálogo, <code>validarClabe</code> no revisa el banco.`,
    },
    descargas: [
      {
        archivo: "bancos.json",
        contenido: "El catálogo de bancos con el que la página revisa el banco",
      },
    ],
    docs: meta.docs,
    conjunto: null,
    relacionadas: [RUTA_BANCOS],
  };
}

/** `/municipios/`: los 32 estados con su clave, sus municipios y el enlace a su página. */
export function paginaMunicipios(
  estados: SerieDePagina<Estado>,
  municipios: SerieDePagina<Municipio>,
): PaginaDatos {
  const cuantos = new Map<string, number>();
  for (const m of municipios.registros) cuantos.set(m.cve_ent, (cuantos.get(m.cve_ent) ?? 0) + 1);
  const ejemploEstado =
    estados.registros.find((e) => e.cve_ent === "25") ?? (estados.registros[0] as Estado);
  const ejemploMunicipio = municipios.registros.find(
    (m) => m.cve_ent === ejemploEstado.cve_ent,
  ) as Municipio;
  const total = municipios.registros.length;

  const filas = estados.registros.map(
    (e) =>
      `<tr><th scope="row">${escaparHtml(e.cve_ent)}</th><td><a href="${rutaDeEstado(e)}">${escaparHtml(e.nombre)}</a></td>${celdaNum(formatearEntero(cuantos.get(e.cve_ent) ?? 0))}</tr>`,
  );
  const tablaEstados = seccion("estados", "Estados", [
    `<p>Cada estado enlaza a la lista de sus municipios con la clave de 3 dígitos y la CVEGEO de 5, que es la clave del estado seguida de la del municipio. En la Ciudad de México, las 16 alcaldías ocupan el lugar de los municipios.</p>`,
    tabla(
      "municipios-estados",
      "Estados con su clave del INEGI y su número de municipios",
      [{ texto: "Clave" }, { texto: "Estado" }, { texto: "Municipios", numerica: true }],
      filas,
    ),
  ]);

  const claves = seccion("claves", "Cómo son las claves", [
    "<p>Las claves son texto con ceros a la izquierda. La CVEGEO de un municipio son 5 dígitos: los 2 del estado (<code>cve_ent</code>) y los 3 del municipio (<code>cve_mun</code>); por ejemplo, <code>25006</code> es el municipio 006 del estado 25. La clave coincide con la de SEPOMEX, lo que permite unir ambos catálogos.</p>",
  ]);

  const datosAl = masReciente(estados.meta.as_of, municipios.meta.as_of);
  return {
    ruta: RUTA_MUNICIPIOS,
    titulo: "Estados y municipios de México con sus claves · MéxicoAPI",
    descripcion: `Los 32 estados y los ${formatearEntero(total)} municipios y alcaldías de México con su clave del INEGI y su CVEGEO, por API, npm y descarga.`,
    h1: "Estados y municipios de México con sus claves",
    miga: "Municipios",
    dataset: municipios.meta.dataset,
    datosAl,
    queEsDatosAl: "la fecha de la última revisión del catálogo del INEGI",
    intro: `<p class="intro">Los ${estados.registros.length} estados y los ${formatearEntero(total)} municipios y alcaldías de México con su clave geoestadística, del Catálogo Único de Claves de Áreas Geoestadísticas del INEGI.</p>`,
    contenido: [tablaEstados, claves].join("\n"),
    fuentes: [...estados.meta.sources, ...municipios.meta.sources],
    citas: [],
    consultas: [
      "/v1/estados",
      `/v1/estados/${ejemploEstado.cve_ent}/municipios`,
      `/v1/municipios/${ejemploMunicipio.cvegeo}`,
    ],
    guiaApi: guia("municipios"),
    paquete: {
      codigo: `import { estados, municipios } from "mexicoapi/datos";

estados(); // los ${estados.registros.length} estados
municipios("${ejemploEstado.cve_ent}"); // los de ${ejemploEstado.nombre}`,
      nota: NOTA_DATOS_EN_PAQUETE,
    },
    descargas: [
      { archivo: "inegi-estados.json", contenido: "Los estados con su clave y abreviatura" },
      { archivo: "inegi-estados.csv", contenido: "Lo mismo, en columnas" },
      {
        archivo: "inegi-municipios.json",
        contenido: `Los ${formatearEntero(total)} municipios y alcaldías`,
      },
      { archivo: "inegi-municipios.csv", contenido: "Lo mismo, en columnas" },
      { archivo: "inegi-municipios.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: municipios.meta.docs,
    conjunto: {
      nombre: "Estados y municipios de México (INEGI)",
      descripcion: `Los ${estados.registros.length} estados y los ${formatearEntero(total)} municipios y alcaldías de México con su clave geoestadística (CVEGEO), del Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades del INEGI. Cada municipio trae la clave del estado, la clave del municipio de 3 dígitos, su nombre oficial y la clave de su localidad cabecera; las 16 alcaldías de la Ciudad de México no tienen cabecera en la fuente.`,
      palabrasClave: [
        "municipios de México",
        "claves de municipios",
        "CVEGEO",
        "INEGI",
        "estados de México",
        "clave de entidad",
      ],
      coberturaTemporal: datosAl,
      distribucion: [
        "inegi-estados.json",
        "inegi-estados.csv",
        "inegi-municipios.json",
        "inegi-municipios.csv",
      ],
    },
    relacionadas: [RUTA_BANCOS],
  };
}

/** `/municipios/{cve_ent}-{estado}/`: los municipios de un estado con sus claves. */
export function paginaDeEstado(
  estado: Estado,
  { registros, meta }: SerieDePagina<Municipio>,
): PaginaDatos {
  const suyos = registros.filter((m) => m.cve_ent === estado.cve_ent);
  const [primero] = suyos;
  if (primero === undefined) throw new Error(`el estado ${estado.cve_ent} no tiene municipios`);
  const alcaldias = estado.cve_ent === "09";
  const plural = alcaldias ? "alcaldías" : "municipios";
  const h1 = `${alcaldias ? "Alcaldías" : "Municipios"} de ${estado.nombre}: claves INEGI y CVEGEO`;

  const filas = suyos.map(
    (m) =>
      `<tr><th scope="row">${escaparHtml(m.cve_mun)}</th><td>${escaparHtml(m.cvegeo)}</td><td>${escaparHtml(m.nombre)}</td></tr>`,
  );
  return {
    ruta: rutaDeEstado(estado),
    titulo: `${h1} · MéxicoAPI`,
    descripcion: `Los ${suyos.length} ${plural} de ${estado.nombre} con su clave de 3 dígitos y su CVEGEO del INEGI, por API, npm y descarga.`,
    h1,
    miga: estado.nombre,
    superior: RUTA_MUNICIPIOS,
    dataset: null,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la última revisión del catálogo del INEGI",
    intro: `<p class="intro">${estado.nombre} (clave ${escaparHtml(estado.cve_ent)}) tiene ${suyos.length} ${plural}. La CVEGEO de cada uno es la clave del estado, <code>${escaparHtml(estado.cve_ent)}</code>, seguida de su clave de 3 dígitos. <a href="${RUTA_MUNICIPIOS}">Todos los estados</a>.</p>`,
    contenido: seccion("municipios", alcaldias ? "Alcaldías" : "Municipios", [
      tabla(
        "municipios-estado",
        `${alcaldias ? "Alcaldías" : "Municipios"} de ${estado.nombre} con sus claves`,
        [{ texto: "Clave" }, { texto: "CVEGEO" }, { texto: alcaldias ? "Alcaldía" : "Municipio" }],
        filas,
      ),
    ]),
    fuentes: meta.sources,
    citas: [],
    consultas: [`/v1/estados/${estado.cve_ent}/municipios`, `/v1/municipios/${primero.cvegeo}`],
    guiaApi: guia("municipios"),
    paquete: {
      codigo: codigoPaquete(estado),
      nota: NOTA_DATOS_EN_PAQUETE,
    },
    descargas: [
      { archivo: "inegi-municipios.json", contenido: "Los municipios de todos los estados" },
      { archivo: "inegi-municipios.csv", contenido: "Lo mismo, en columnas" },
    ],
    docs: meta.docs,
    conjunto: null,
    relacionadas: [],
  };
}

const codigoPaquete = (estado: Estado): string =>
  `import { municipios } from "mexicoapi/datos";

municipios("${estado.cve_ent}"); // los de ${estado.nombre}`;
