// Las páginas de los indicadores y las constantes: el tipo de cambio FIX, las UDIS, la UMA, el
// salario mínimo y las tarifas de ISR. Cada cifra y fecha sale del mismo registro que sirve la API
// (`data/`), así que la página y la API dicen lo mismo. Los textos explicativos son los de
// docs/datos/*.md y docs/api/README.md.
import type { FechaISO, SalarioMinimo, TarifaIsr, TipoCambioFix, Udi, Uma } from "@mexicoapi/core";
import { umaVigente } from "@mexicoapi/core/constantes";
import { fechaEnTexto } from "@mexicoapi/core/rutas";
import { type Meta, URL_DOCS } from "../meta.js";
import { formatearEntero } from "./bloques.js";
import { RUTA_DIAS_CNBV } from "./dias-inhabiles.js";
import { escaparHtml } from "./html.js";
import type { CitaPagina, PaginaDatos, PaquetePagina } from "./pagina-datos.js";

export const RUTA_FIX = "/tipo-de-cambio-fix/";
export const RUTA_UDIS = "/udis/";
export const RUTA_UMA = "/uma/";
export const RUTA_SALARIO_MINIMO = "/salario-minimo/";
export const RUTA_ISR = "/tarifas-isr/";

/** Un dataset cargado de `data/`: sus registros y su meta, la misma que lleva la API. */
export interface SerieDePagina<T> {
  registros: readonly T[];
  meta: Meta;
}

export interface EntradaIndicadores {
  fix: SerieDePagina<TipoCambioFix>;
  udis: SerieDePagina<Udi>;
  uma: SerieDePagina<Uma>;
  salarioMinimo: SerieDePagina<SalarioMinimo>;
  isr: SerieDePagina<TarifaIsr>;
}

/** Cuántos FIX lista la tabla de la página. */
const FIX_EN_TABLA = 30;
/** Cuántos días antes de la fecha de referencia empieza la tabla de las UDIS. */
const UDIS_ANTES = 30;

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const sumarDias = (fecha: FechaISO, dias: number): FechaISO =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

const nombreDelDia = (fecha: FechaISO): string =>
  NOMBRES_DIA[new Date(`${fecha}T12:00:00Z`).getUTCDay()] as string;

const anioDe = (fecha: FechaISO): number => Number(fecha.slice(0, 4));

/** "1 de febrero": la fecha sin el año, cuando la fila ya lo dice. */
const diaYMes = (fecha: FechaISO): string => fechaEnTexto(fecha).replace(/ de \d+$/, "");

/** "3566.22" → "3,566.22": miles con coma a la vista; el `value` conserva el texto de la API. */
const conMiles = (monto: string): string => {
  const [entero, decimales] = monto.split(".") as [string, string | undefined];
  return decimales === undefined
    ? formatearEntero(Number(entero))
    : `${formatearEntero(Number(entero))}.${decimales}`;
};

/** El monto en una celda numérica: el texto de la API en `value`, con miles a la vista. */
const monto = (valor: string, conSeparador = true): string =>
  `<data value="${escaparHtml(valor)}">${escaparHtml(conSeparador ? conMiles(valor) : valor)}</data>`;

const hora = (fecha: FechaISO): string =>
  `<time datetime="${escaparHtml(fecha)}">${fechaEnTexto(fecha)}</time>`;

/** La fecha de una fila con el día de la semana debajo. */
const celdaFecha = (fecha: FechaISO, conAnio = true): string =>
  `<th scope="row"><time datetime="${escaparHtml(fecha)}">${conAnio ? fechaEnTexto(fecha) : diaYMes(fecha)}</time><span class="detalle">${nombreDelDia(fecha)}</span></th>`;

interface Columna {
  texto: string;
  numerica?: boolean;
}

/** Una tabla compacta con caption; las filas ya vienen armadas. */
function tabla(id: string, titulo: string, columnas: readonly Columna[], filas: readonly string[]) {
  const encabezados = columnas.map(
    (c) =>
      `<th scope="col"${c.numerica === true ? ' class="num"' : ""}>${escaparHtml(c.texto)}</th>`,
  );
  return `<div class="tabla compacta" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${escaparHtml(titulo)}</caption>
<thead>
<tr>${encabezados.join("")}</tr>
</thead>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</div>`;
}

const celdaNum = (html: string): string => `<td class="num">${html}</td>`;

function seccion(id: string, titulo: string, partes: readonly string[]): string {
  return `<section id="${id}" aria-labelledby="titulo-${id}">
<h2 id="titulo-${id}">${escaparHtml(titulo)}</h2>
${partes.join("\n")}
</section>`;
}

const CLIENTE_NOTA =
  "Con <code>npm install mexicoapi</code>. El cliente pide el dato a la API; si no responde, usa los datos del paquete y lo avisa.";

const conCliente = (cuerpo: string, usaHoy: boolean): PaquetePagina => ({
  codigo: `import { crearCliente } from "mexicoapi/cliente";
${usaHoy ? 'import { hoyEnMexico } from "mexicoapi";\n' : ""}
const api = crearCliente();
${cuerpo}`,
  nota: CLIENTE_NOTA,
});

const guia = (ancla: string): string => `${URL_DOCS}/api/README.md#${ancla}`;

/** Un renglón de aviso cuando el año de referencia no tiene su dato cargado. */
const aviso = (texto: string): string => `<p class="aviso">${texto}</p>`;

/** Las cinco páginas, en el orden del registro. */
export function paginasDeIndicadores(entrada: EntradaIndicadores): PaginaDatos[] {
  const ultimoFix = entrada.fix.registros.at(-1);
  if (ultimoFix === undefined) throw new Error("no hay FIX para armar las páginas");
  // Fecha y año de referencia de las páginas: la publicación más reciente del FIX en `data/`.
  const referencia = ultimoFix.fecha_publicacion;
  const anio = anioDe(referencia);
  return [
    paginaFix(entrada.fix),
    paginaUdis(entrada.udis, referencia),
    paginaUma(entrada.uma, referencia),
    paginaSalarioMinimo(entrada.salarioMinimo, anio),
    paginaIsr(entrada.isr, anio),
  ];
}

/** `/tipo-de-cambio-fix/`: el último FIX, cuál usar para pagar y los últimos publicados. */
export function paginaFix({ registros, meta }: SerieDePagina<TipoCambioFix>): PaginaDatos {
  const ultimo = registros.at(-1) as TipoCambioFix;
  const anterior = registros.at(-2);
  const primero = registros[0] as TipoCambioFix;
  const siguiente = sumarDias(ultimo.fecha_publicacion, 1);
  // La regla del artículo 20 del CFF: el último publicado antes del día de la operación.
  const aplicaA = (dia: FechaISO): TipoCambioFix | undefined =>
    [...registros].reverse().find((r) => r.fecha_publicacion < dia);

  const filaUltimo = (etiqueta: string, celda: string) =>
    `<tr><th scope="row">${etiqueta}</th><td>${celda}</td></tr>`;
  const resumen = tabla(
    "fix-ultimo",
    "El último FIX publicado en el DOF",
    [{ texto: "Dato" }, { texto: "Valor" }],
    [
      filaUltimo("Pesos por dólar", `<strong>${monto(ultimo.valor, false)}</strong>`),
      filaUltimo("Publicado en el DOF", hora(ultimo.fecha_publicacion)),
      ...(anterior === undefined
        ? []
        : [
            filaUltimo(
              "Fecha de determinación (la que muestra Banxico)",
              hora(anterior.fecha_publicacion),
            ),
          ]),
    ],
  );

  const ejemplos = [siguiente, ultimo.fecha_publicacion].flatMap((dia) => {
    const aplica = aplicaA(dia);
    if (aplica === undefined) return [];
    return [
      `<tr>${celdaFecha(dia)}${celdaNum(monto(aplica.valor, false))}<td>${hora(aplica.fecha_publicacion)}</td></tr>`,
    ];
  });
  const operacion = seccion("operacion", "Cuál FIX usar para pagar hoy", [
    `<p>Para una operación o un pago se usa el FIX que el Banco de México publicó en el DOF antes de ese día, no el del mismo día. El artículo 20 del Código Fiscal de la Federación manda usar el publicado el día anterior y, si ese día no hubo publicación, el último publicado antes. Para un pago en dólares que se cumple en México, el artículo 172 de la Circular 3/2012 del Banco de México dice lo mismo: el publicado el día hábil bancario inmediato anterior al pago. Los dos dan la misma publicación.</p>`,
    `<p>La API lo calcula con <code>operacion=AAAA-MM-DD</code>, que es el día de la Ciudad de México en que se hace el pago, y responde qué publicación usó y su fundamento. En la página, los dos días más recientes:</p>`,
    tabla(
      "fix-operacion",
      "Qué FIX aplica a una operación de cada día",
      [{ texto: "Operación del día" }, { texto: "FIX", numerica: true }, { texto: "Publicado" }],
      ejemplos,
    ),
    `<p>El de un día sin publicación en la víspera, como el lunes, es el último publicado: el del viernes.</p>`,
  ]);

  const ultimos = registros.slice(-FIX_EN_TABLA).reverse();
  const serie = seccion("ultimos", `Los últimos ${ultimos.length} FIX publicados`, [
    `<p><code>fecha_publicacion</code> es el día de la publicación en el DOF, no el día al que se aplica el valor. Solo hay publicación en los días hábiles bancarios: no hay valores para fines de semana ni feriados bancarios, ver los <a href="${RUTA_DIAS_CNBV}">días inhábiles bancarios</a>.</p>`,
    tabla(
      "fix-ultimos",
      "Tipo de cambio FIX por fecha de publicación en el DOF",
      [{ texto: "Publicado en el DOF" }, { texto: "Pesos por dólar", numerica: true }],
      ultimos.map(
        (r) => `<tr>${celdaFecha(r.fecha_publicacion)}${celdaNum(monto(r.valor, false))}</tr>`,
      ),
    ),
  ]);

  const publicacion = seccion("determinacion", "Publicación y determinación", [
    `<p>El Banco de México determina el FIX cada día hábil bancario y lo publica en el DOF el día hábil bancario siguiente. Por eso en el SIE y en el sitio del Banco el mismo valor aparece con la fecha de determinación, un día hábil antes que la de publicación que usa esta página. El ${fechaEnTexto(ultimo.fecha_publicacion)} es la fecha de publicación del último valor${anterior === undefined ? "" : `; en Banxico aparece como FIX del ${fechaEnTexto(anterior.fecha_publicacion)}`}.</p>`,
    `<p>El valor es texto con 4 decimales, para no perder ceros. La serie empieza el ${fechaEnTexto(primero.fecha_publicacion)} y los valores de los últimos días pueden no estar todavía: se cargan en la corrida diaria.</p>`,
  ]);

  return {
    ruta: RUTA_FIX,
    titulo: "Tipo de cambio FIX del DOF · MéxicoAPI",
    descripcion:
      "Último tipo de cambio FIX del Banco de México en el DOF, cuál usar para pagar hoy y los últimos 30 valores, por API, npm y descarga.",
    h1: "Tipo de cambio FIX del DOF",
    miga: "Tipo de cambio FIX",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: `la fecha de la última actualización de la serie; la publicación más reciente es del ${fechaEnTexto(ultimo.fecha_publicacion)}`,
    intro: `<p class="intro">El tipo de cambio FIX que el Banco de México determina y publica en el Diario Oficial de la Federación para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana: el último es de ${monto(ultimo.valor, false)} pesos por dólar, publicado el ${fechaEnTexto(ultimo.fecha_publicacion)}.</p>`,
    contenido: [seccion("ultimo", "Último valor", [resumen]), operacion, serie, publicacion].join(
      "\n",
    ),
    fuentes: meta.sources,
    citas: [],
    consultas: [
      "/v1/tipo-cambio/fix/ultimo",
      `/v1/tipo-cambio/fix?operacion=${siguiente}`,
      `/v1/tipo-cambio/fix?publicado=${ultimo.fecha_publicacion}`,
    ],
    guiaApi: guia("tipo-de-cambio-fix"),
    paquete: conCliente("const { data } = await api.fixParaOperacion(hoyEnMexico());", true),
    descargas: [
      {
        archivo: "tipo-cambio-fix.json",
        contenido: `Las ${formatearEntero(registros.length)} publicaciones desde ${primero.fecha_publicacion}`,
      },
      { archivo: "tipo-cambio-fix.csv", contenido: "Lo mismo, en columnas" },
      { archivo: "tipo-cambio-fix.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Tipo de cambio FIX del Banco de México",
      descripcion: `Tipo de cambio FIX que el Banco de México determina y publica en el Diario Oficial de la Federación para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana, en pesos por dólar de Estados Unidos. Un registro por cada día con publicación en el DOF, desde el ${primero.fecha_publicacion}; cada uno trae la fecha de publicación y el valor con 4 decimales, como texto para no perder ceros. No hay valores para fines de semana ni feriados bancarios.`,
      palabrasClave: [
        "tipo de cambio FIX",
        "FIX",
        "dólar",
        "Banco de México",
        "Diario Oficial de la Federación",
        "tipo de cambio de hoy",
      ],
      coberturaTemporal: `${primero.fecha_publicacion}/..`,
      distribucion: ["tipo-cambio-fix.json", "tipo-cambio-fix.csv"],
    },
    relacionadas: [RUTA_UDIS, RUTA_DIAS_CNBV],
  };
}

/** `/udis/`: los 30 días anteriores a la fecha de referencia y los publicados por adelantado. */
export function paginaUdis(
  { registros, meta }: SerieDePagina<Udi>,
  referencia: FechaISO,
): PaginaDatos {
  const primera = registros[0] as Udi;
  const ultima = registros.at(-1) as Udi;
  const desde = sumarDias(referencia, -UDIS_ANTES);
  const lista = registros.filter((u) => u.fecha >= desde);
  const deReferencia = registros.find((u) => u.fecha === referencia);
  const intro =
    deReferencia === undefined
      ? `<p class="intro">El valor de la Unidad de Inversión (UDI) que el Banco de México publica en el Diario Oficial de la Federación, en pesos por UDI: uno por cada día del calendario, publicados por adelantado.</p>`
      : `<p class="intro">El valor de la Unidad de Inversión (UDI) que el Banco de México publica en el Diario Oficial de la Federación, en pesos por UDI. El ${fechaEnTexto(referencia)} (la publicación más reciente del FIX) vale ${monto(deReferencia.valor, false)}; el último valor cargado, el del ${fechaEnTexto(ultima.fecha)}, ${monto(ultima.valor, false)}.</p>`;
  const contenido = seccion("valores", "Valor de la UDI por día", [
    `<p>Hay un valor para cada día del calendario, fines de semana y feriados incluidos. Las UDIS se publican por adelantado, dos veces al mes, para los días siguientes: por eso la tabla llega hasta ${fechaEnTexto(ultima.fecha)}, unos días después de la fecha de la última actualización. La fila del día de hoy en la Ciudad de México se resalta cuando la página puede ejecutar su script.</p>`,
    tabla(
      "udis-tabla",
      `UDI de los ${UDIS_ANTES} días anteriores al ${fechaEnTexto(referencia)} y de los siguientes publicados`,
      [{ texto: "Fecha" }, { texto: "Pesos por UDI", numerica: true }],
      lista.map(
        (u) =>
          `<tr data-fecha="${escaparHtml(u.fecha)}">${celdaFecha(u.fecha)}${celdaNum(monto(u.valor, false))}</tr>`,
      ),
    ),
    `<p>El valor es texto con 6 decimales, para no perder el cero final. La serie empieza el ${fechaEnTexto(primera.fecha)}; antes de esa fecha no hay datos.</p>`,
  ]);
  return {
    ruta: RUTA_UDIS,
    titulo: "Valor de la UDI de hoy y de los próximos días · MéxicoAPI",
    descripcion:
      "Valor de la UDI de hoy y de los días siguientes que el Banco de México publica por adelantado en el DOF, con la serie desde 2020 por API, npm y descarga.",
    h1: "Valor de la UDI de hoy y de los próximos días",
    miga: "UDIS",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: `la fecha de la última actualización de la serie; la última UDI cargada es del ${fechaEnTexto(ultima.fecha)}`,
    intro,
    contenido,
    fuentes: meta.sources,
    citas: [],
    consultas: [`/v1/udis?fecha=${referencia}`, `/v1/udis?fecha=${ultima.fecha}`],
    guiaApi: guia("udis"),
    paquete: conCliente("const { data } = await api.udi(hoyEnMexico());", true),
    descargas: [
      {
        archivo: "udis.json",
        contenido: `Los ${formatearEntero(registros.length)} valores diarios desde ${primera.fecha}`,
      },
      { archivo: "udis.csv", contenido: "Lo mismo, en columnas" },
      { archivo: "udis.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Valor de la UDI (Unidad de Inversión)",
      descripcion: `Valor diario de la Unidad de Inversión (UDI) que el Banco de México publica en el Diario Oficial de la Federación, en pesos por UDI. Hay un valor por cada día del calendario, desde el ${primera.fecha}, fines de semana y feriados incluidos; se publican por adelantado, dos veces al mes, así que la serie llega unos días después de la fecha de la última actualización. Cada registro trae la fecha y el valor con 6 decimales, como texto para no perder el cero final.`,
      palabrasClave: ["UDI", "UDIS", "Unidad de Inversión", "Banco de México", "valor de la UDI"],
      coberturaTemporal: `${primera.fecha}/..`,
      distribucion: ["udis.json", "udis.csv"],
    },
    relacionadas: [RUTA_FIX],
  };
}

/** Las notas del DOF de los registros: una cita por publicación, con el texto citado. */
function citasDeFuentes(
  registros: readonly { fuente: { nombre: string; url: string; fragmento: string } }[],
): CitaPagina[] {
  const porPublicacion = new Map<string, CitaPagina & { fragmentos: string[] }>();
  for (const { fuente } of registros) {
    const clave = `${fuente.nombre}\n${fuente.url}`;
    const cita = porPublicacion.get(clave) ?? {
      nombre: fuente.nombre,
      url: fuente.url,
      fragmentos: [],
    };
    if (!cita.fragmentos.includes(fuente.fragmento)) cita.fragmentos.push(fuente.fragmento);
    porPublicacion.set(clave, cita);
  }
  return [...porPublicacion.values()];
}

const faltaElAnio = (sujeto: string, anio: number, resto: string): string =>
  aviso(`${sujeto} de ${anio} todavía no se ha cargado. Se agrega cuando ${resto}.`);

/** `/uma/`: la UMA diaria, mensual y anual de cada año, con su vigencia. */
export function paginaUma(
  { registros, meta }: SerieDePagina<Uma>,
  referencia: FechaISO,
): PaginaDatos {
  const porAnio = [...registros].sort((a, b) => b.anio - a.anio);
  const nueva = porAnio[0] as Uma;
  const vieja = porAnio.at(-1) as Uma;
  const anioRef = anioDe(referencia);
  const consulta = umaVigente(registros, referencia);
  const vigente = consulta.tipo === "encontrado" ? consulta.registro : undefined;
  const frase =
    vigente === undefined
      ? `Ninguna de las UMA cargadas rige el ${fechaEnTexto(referencia)}.`
      : `La UMA vigente el ${fechaEnTexto(referencia)} es la de ${vigente.anio}: ${monto(vigente.diaria)} pesos diarios, ${monto(vigente.mensual)} mensuales y ${monto(vigente.anual)} anuales, desde el ${fechaEnTexto(vigente.vigencia_desde)}.`;
  const avisos = registros.some((u) => u.anio === anioRef)
    ? []
    : [faltaElAnio("La UMA", anioRef, "el INEGI la publica en el DOF")];
  const contenido = seccion("valores", "UMA por año", [
    `<p>Cada valor rige del 1 de febrero de su año al 31 de enero del siguiente, así que en enero sigue vigente la UMA del año anterior: para una fecha de enero de ${nueva.anio} corresponde la de ${nueva.anio - 1}. La mensual es la diaria por 30.4 y la anual, la mensual por 12. La de ${vieja.anio - 1}, el primer valor de la UMA, no está en los datos.</p>`,
    ...avisos,
    tabla(
      "uma-tabla",
      `UMA de ${vieja.anio} a ${nueva.anio}, en pesos`,
      [
        { texto: "Año" },
        { texto: "Diaria", numerica: true },
        { texto: "Mensual", numerica: true },
        { texto: "Anual", numerica: true },
      ],
      porAnio.map(
        (u) =>
          `<tr><th scope="row">${u.anio}<span class="detalle">desde el <time datetime="${escaparHtml(u.vigencia_desde)}">${diaYMes(u.vigencia_desde)}</time></span></th>${celdaNum(monto(u.diaria))}${celdaNum(monto(u.mensual))}${celdaNum(monto(u.anual))}</tr>`,
      ),
    ),
  ]);
  return {
    ruta: RUTA_UMA,
    titulo: `UMA ${nueva.anio}: valor diario, mensual y anual · MéxicoAPI`,
    descripcion: `UMA diaria, mensual y anual de ${vieja.anio} a ${nueva.anio} con su vigencia y la nota del DOF; la vigente hoy, por API, npm y descarga.`,
    h1: `UMA ${nueva.anio}: valor diario, mensual y anual`,
    miga: "UMA",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
    intro: `<p class="intro">La Unidad de Medida y Actualización (UMA) es la referencia en pesos con la que se calculan los montos que las leyes expresan en UMA, en lugar del salario mínimo. El INEGI publica en el Diario Oficial de la Federación, cada enero, el valor diario, el mensual y el anual. ${frase}</p>`,
    contenido,
    fuentes: meta.sources,
    citas: citasDeFuentes(registros),
    consultas: [`/v1/constantes/uma?fecha=${referencia}`, `/v1/constantes/uma/${nueva.anio}`],
    guiaApi: guia("uma"),
    paquete: conCliente("const { data } = await api.umaVigente(hoyEnMexico());", true),
    descargas: [
      {
        archivo: "constantes-uma.json",
        contenido: `La UMA de ${vieja.anio} a ${nueva.anio}, con la fuente de cada año`,
      },
      { archivo: "constantes-uma.csv", contenido: "Lo mismo, con la fuente en columnas" },
      { archivo: "constantes-uma.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Unidad de Medida y Actualización (UMA)",
      descripcion: `Valor diario, mensual y anual de la Unidad de Medida y Actualización (UMA) que el INEGI publica cada enero en el Diario Oficial de la Federación, de ${vieja.anio} a ${nueva.anio}. Cada valor rige del 1 de febrero de su año al 31 de enero del siguiente. Cada registro trae el año, los tres montos en pesos con dos decimales como texto, la fecha desde la que rige y la cita de la nota del DOF con el texto oficial.`,
      palabrasClave: [
        "UMA",
        "Unidad de Medida y Actualización",
        "INEGI",
        "valor de la UMA",
        "Diario Oficial de la Federación",
      ],
      coberturaTemporal: `${vieja.vigencia_desde}/..`,
      distribucion: ["constantes-uma.json", "constantes-uma.csv"],
    },
    relacionadas: [RUTA_SALARIO_MINIMO, RUTA_ISR],
  };
}

/** `/salario-minimo/`: el general y el de la zona libre de la frontera norte de cada año. */
export function paginaSalarioMinimo(
  { registros, meta }: SerieDePagina<SalarioMinimo>,
  anioRef: number,
): PaginaDatos {
  const anios = [...new Set(registros.map((s) => s.anio))].sort((a, b) => b - a);
  const nuevo = anios[0] as number;
  const viejo = anios.at(-1) as number;
  const de = (anio: number, zona: SalarioMinimo["zona"]): SalarioMinimo =>
    registros.find((s) => s.anio === anio && s.zona === zona) as SalarioMinimo;
  const general = de(nuevo, "general");
  const frontera = de(nuevo, "zlfn");
  const avisos = anios.includes(anioRef)
    ? []
    : [faltaElAnio("El salario mínimo", anioRef, "la CONASAMI lo publica en el DOF")];
  const contenido = seccion("valores", "Salario mínimo por año", [
    `<p>Cada año tiene dos montos diarios, en pesos: el de la zona general y el de la Zona Libre de la Frontera Norte (<code>zlfn</code>). La zona general cambia de nombre según la resolución: "área de Salarios Mínimos Generales" en 2019, "Resto del país" de 2020 a 2024 y "Zona del Salario Mínimo General (ZSMG)" desde 2025; aquí siempre es <code>general</code>.</p>`,
    ...avisos,
    tabla(
      "salario-tabla",
      `Salario mínimo diario de ${viejo} a ${nuevo}, en pesos`,
      [
        { texto: "Año" },
        { texto: "General", numerica: true },
        { texto: "Frontera norte", numerica: true },
      ],
      anios.map(
        (a) =>
          `<tr><th scope="row">${a}<span class="detalle">desde el <time datetime="${escaparHtml(de(a, "general").vigencia_desde)}">${diaYMes(de(a, "general").vigencia_desde)}</time></span></th>${celdaNum(monto(de(a, "general").diario))}${celdaNum(monto(de(a, "zlfn").diario))}</tr>`,
      ),
    ),
  ]);
  return {
    ruta: RUTA_SALARIO_MINIMO,
    titulo: `Salario mínimo ${nuevo}: general y frontera norte · MéxicoAPI`,
    descripcion: `Salario mínimo general y de la zona libre de la frontera norte de ${viejo} a ${nuevo}, con la resolución de la CONASAMI en el DOF, por API, npm y descarga.`,
    h1: `Salario mínimo ${nuevo}: general y frontera norte`,
    miga: "Salario mínimo",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
    intro: `<p class="intro">El salario mínimo diario que fija cada año el Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos y publica en el Diario Oficial de la Federación. El de ${nuevo} es de ${monto(general.diario)} pesos en la zona general y de ${monto(frontera.diario)} en la Zona Libre de la Frontera Norte, desde el ${fechaEnTexto(general.vigencia_desde)}.</p>`,
    contenido,
    fuentes: meta.sources,
    citas: citasDeFuentes(registros),
    consultas: [`/v1/constantes/salario-minimo/${nuevo}`],
    guiaApi: guia("salario-mínimo"),
    paquete: conCliente(
      `const { data } = await api.salarioMinimo(${nuevo}); // general y zlfn`,
      false,
    ),
    descargas: [
      {
        archivo: "constantes-salario-minimo.json",
        contenido: `El salario mínimo de ${viejo} a ${nuevo}, por año y zona, con la fuente de cada uno`,
      },
      {
        archivo: "constantes-salario-minimo.csv",
        contenido: "Lo mismo, con la fuente en columnas",
      },
      {
        archivo: "constantes-salario-minimo.manifest.json",
        contenido: "Fuentes, licencia y sha256",
      },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Salario mínimo en México",
      descripcion: `Salario mínimo diario de la zona general y de la Zona Libre de la Frontera Norte, de ${viejo} a ${nuevo}, según la resolución de la Comisión Nacional de los Salarios Mínimos publicada cada año en el Diario Oficial de la Federación. Cada registro trae el año, la zona, el monto diario en pesos con dos decimales como texto, la fecha desde la que rige y la cita de la resolución con el texto oficial.`,
      palabrasClave: [
        "salario mínimo",
        "CONASAMI",
        "zona libre de la frontera norte",
        "salario mínimo diario",
        "Diario Oficial de la Federación",
      ],
      coberturaTemporal: `${de(viejo, "general").vigencia_desde}/..`,
      distribucion: ["constantes-salario-minimo.json", "constantes-salario-minimo.csv"],
    },
    relacionadas: [RUTA_UMA, RUTA_ISR],
  };
}

/** Las tarifas, la mensual primero y luego las anuales, cada periodo del año más reciente al más antiguo. */
const porPeriodoYAnio = (a: TarifaIsr, b: TarifaIsr): number =>
  a.periodo === b.periodo ? b.anio - a.anio : a.periodo === "mensual" ? -1 : 1;

/** `/tarifas-isr/`: las tarifas mensual y anual del Anexo 8, tramo por tramo. */
export function paginaIsr(
  { registros, meta }: SerieDePagina<TarifaIsr>,
  anioRef: number,
): PaginaDatos {
  const tarifas = [...registros].sort(porPeriodoYAnio);
  const anios = registros.map((t) => t.anio);
  const nuevo = Math.max(...anios);
  const viejo = Math.min(...anios);
  const mensual = tarifas.find((t) => t.periodo === "mensual");
  const avisos = anios.includes(anioRef)
    ? []
    : [faltaElAnio("La tarifa de ISR", anioRef, "el SAT la publica en el Anexo 8 de la RMF")];
  const secciones = tarifas.map((t) => {
    const nombre = t.periodo === "mensual" ? "mensual" : "anual";
    const filas = t.tramos.map((tr) => {
      const superior =
        tr.limite_superior === null
          ? `<span class="detalle"><data value="">en adelante</data></span>`
          : `<span class="detalle">hasta ${monto(tr.limite_superior)}</span>`;
      return `<tr><th scope="row">${monto(tr.limite_inferior)}${superior}</th>${celdaNum(monto(tr.cuota_fija))}${celdaNum(monto(tr.tasa_excedente, false))}</tr>`;
    });
    const id = `isr-${t.periodo}-${t.anio}`;
    return seccion(id.replace("isr-", "tarifa-"), `Tarifa ${nombre} de ${t.anio}`, [
      `<p>${escaparHtml(t.fuente.fragmento)}</p>`,
      tabla(
        id,
        `Tarifa ${nombre} de ISR de ${t.anio}, en pesos`,
        [
          { texto: "Límite inferior" },
          { texto: "Cuota fija", numerica: true },
          { texto: "% sobre el excedente", numerica: true },
        ],
        filas,
      ),
    ]);
  });
  const como = seccion("como-usarla", "Cómo se calcula", [
    `<p>El impuesto de un ingreso es la cuota fija de su tramo más la tasa (por ciento) de lo que exceda al límite inferior. Los montos son texto con dos decimales y sin separador de miles. El SAT actualiza cada cantidad de la tarifa por separado, así que el encadenamiento de cuotas puede diferir un centavo; siempre se conserva el valor publicado.</p>`,
    ...avisos,
    `<p>La mensual sirve para los pagos provisionales mensuales (artículos 96 de la Ley del ISR y 175 de su Reglamento). La anual, para el cálculo del impuesto del ejercicio: la del ejercicio ${nuevo - 1} se usa en la declaración anual que se presenta en ${nuevo}. El Anexo 8 también trae tarifas de 7, 10 y 15 días, que no están en este dataset.</p>`,
  ]);
  return {
    ruta: RUTA_ISR,
    titulo: `Tarifas de ISR ${nuevo}: mensual y anual · MéxicoAPI`,
    descripcion: `Tarifas de ISR de personas físicas ${nuevo}: la mensual y las anuales del Anexo 8 de la RMF, con cada tramo y su cita del DOF, por API, npm y descarga.`,
    h1: `Tarifas de ISR ${nuevo}: mensual y anual`,
    miga: "Tarifas de ISR",
    dataset: meta.dataset,
    datosAl: meta.as_of,
    queEsDatosAl: "la fecha de la publicación más reciente de sus fuentes",
    intro: `<p class="intro">Las tarifas del impuesto sobre la renta de personas físicas que el SAT publica en el Anexo 8 de la Resolución Miscelánea Fiscal: la mensual, para los pagos provisionales, y la anual, para el impuesto del ejercicio. Cada tarifa trae sus ${mensual?.tramos.length ?? 0} tramos con límites, cuota fija y tasa sobre el excedente.</p>`,
    contenido: [como, ...secciones].join("\n"),
    fuentes: meta.sources,
    citas: citasDeFuentes(registros),
    consultas: tarifas.map((t) => `/v1/isr/tarifa/${t.periodo}/${t.anio}`).slice(0, 2),
    guiaApi: guia("tarifas-de-isr"),
    paquete: conCliente(
      `const { data } = await api.tarifaIsr("mensual", ${mensual?.anio ?? nuevo});`,
      false,
    ),
    descargas: [
      {
        archivo: "isr-tarifas.json",
        contenido: `Las tarifas de ${viejo} a ${nuevo}, con la fuente de cada una`,
      },
      { archivo: "isr-tarifas.csv", contenido: "Un renglón por tramo" },
      { archivo: "isr-tarifas.manifest.json", contenido: "Fuentes, licencia y sha256" },
    ],
    docs: meta.docs,
    conjunto: {
      nombre: "Tarifas de ISR de personas físicas",
      descripcion: `Tarifas del impuesto sobre la renta de personas físicas que el SAT publica en el Anexo 8 de la Resolución Miscelánea Fiscal, de ${viejo} a ${nuevo}: la mensual, para los pagos provisionales mensuales, y la anual, para el impuesto del ejercicio. Cada tarifa trae sus tramos con límite inferior, límite superior (vacío en el último), cuota fija y tasa sobre el excedente, en pesos y por ciento como texto con dos decimales, y la cita de la fracción del Anexo 8.`,
      palabrasClave: [
        "ISR",
        "impuesto sobre la renta",
        "tarifa mensual",
        "tarifa anual",
        "Anexo 8",
        "Resolución Miscelánea Fiscal",
      ],
      coberturaTemporal: `${viejo}-01-01/..`,
      distribucion: ["isr-tarifas.json", "isr-tarifas.csv"],
    },
    relacionadas: [RUTA_UMA, RUTA_SALARIO_MINIMO],
  };
}
