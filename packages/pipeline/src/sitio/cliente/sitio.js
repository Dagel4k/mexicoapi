// @ts-check
/**
 * El script del sitio, servido tal cual como `/sitio.js` (módulo). En cualquier página cambia la
 * base de los ejemplos (la API pública) por el origen real; en `/estado/` consulta `/v1/status` y
 * pinta la tabla. Todo texto entra con `textContent` o como nodo de texto, nunca como HTML.
 */

/** Cuánto se espera a `/v1/status`, cuerpo incluido, antes de darlo por perdido. */
export const ESPERA_MS = 10_000;

/** @typedef {"ok" | "stale" | "unknown"} Status */

/** @type {Readonly<Record<Status, string>>} */
export const NOMBRES_STATUS = Object.freeze({
  ok: "Al día",
  stale: "Desactualizado",
  unknown: "Sin registro",
});

const HORA_MS = 3_600_000;

/** Fecha y hora de la Ciudad de México, sin importar la zona del equipo. */
const FECHA_HORA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "medium",
  timeStyle: "short",
});

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Instante UTC con `Z`, como lo escribe toISOString() y como lo publica la API.
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Una falla que se explica tal cual después de "No se pudo consultar el estado: ". */
export class ErrorEstado extends Error {
  name = "ErrorEstado";
}

/**
 * @param {unknown} valor
 * @returns {valor is Record<string, unknown>}
 */
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/**
 * @param {unknown} valor
 * @returns {valor is string}
 */
const esFecha = (valor) => typeof valor === "string" && FECHA.test(valor);

/**
 * @param {unknown} valor
 * @returns {valor is string}
 */
const esInstante = (valor) =>
  typeof valor === "string" && INSTANTE.test(valor) && Number.isFinite(Date.parse(valor));

/**
 * @param {unknown} valor
 * @returns {valor is Status}
 */
const esStatus = (valor) => typeof valor === "string" && Object.hasOwn(NOMBRES_STATUS, valor);

/** @param {string} detalle */
const forma = (detalle) => new ErrorEstado(`la respuesta no tiene la forma esperada (${detalle}).`);

/**
 * Lo que la tabla muestra de un dataset, ya como texto.
 * @typedef {object} FilaEstado
 * @property {string} dataset
 * @property {Status} status
 * @property {string} estado El estado en palabras.
 * @property {string} datos La fecha de los datos (`as_of`).
 * @property {string} ultimoExito El último éxito en hora de la Ciudad de México, o "Ninguna
 *   registrada": la API no tiene una, porque nunca hubo o porque no pudo leer el registro.
 * @property {string} hace "hace N h", o vacío si no hay último éxito.
 * @property {string | null} instante El último éxito tal como lo da la API.
 * @property {string} plazo Las horas de frescura: "72 h".
 * @property {string} cobertura "desde – hasta" en las series; "No aplica" en lo demás.
 * @property {string | null} ultimoDato En las series, la fecha de su registro más reciente (el
 *   fin de la cobertura), que no es `as_of`; null en lo demás.
 */

/**
 * El nombre de cada columna después de la del dataset, como en la cabecera de `/estado/`: debajo
 * de 1024 px cada renglón es una tarjeta y la hoja de estilo toma la etiqueta de `data-etiqueta`.
 */
export const ETIQUETAS = Object.freeze([
  "Estado",
  "Datos al",
  "Última revisión correcta",
  "Plazo",
  "Cobertura",
]);

/**
 * @param {string} instante
 * @param {Date} ahora
 */
function horasDesde(instante, ahora) {
  const horas = Math.floor((ahora.getTime() - Date.parse(instante)) / HORA_MS);
  return horas < 1 ? "hace menos de 1 h" : `hace ${horas} h`;
}

/**
 * @param {unknown} valor
 * @param {number} i
 * @param {Date} ahora
 * @returns {FilaEstado}
 */
function filaDe(valor, i, ahora) {
  const donde = `data[${i}]`;
  if (!esObjeto(valor)) throw forma(`${donde} no es un objeto`);
  const { dataset, as_of, status, last_success, frescura_horas, cobertura } = valor;
  if (typeof dataset !== "string" || dataset === "") {
    throw forma(`${donde}.dataset no es un texto`);
  }
  if (!esFecha(as_of)) throw forma(`${donde}.as_of no es una fecha AAAA-MM-DD`);
  if (!esStatus(status)) throw forma(`${donde}.status no es ok, stale ni unknown`);
  if (last_success !== null && !esInstante(last_success)) {
    throw forma(`${donde}.last_success no es un instante ni null`);
  }
  if (typeof frescura_horas !== "number" || !(frescura_horas > 0)) {
    throw forma(`${donde}.frescura_horas no es un número de horas`);
  }
  return {
    dataset,
    status,
    estado: NOMBRES_STATUS[status],
    datos: as_of,
    ultimoExito:
      last_success === null ? "Ninguna registrada" : FECHA_HORA.format(new Date(last_success)),
    hace: last_success === null ? "" : horasDesde(last_success, ahora),
    instante: last_success,
    plazo: `${frescura_horas} h`,
    cobertura: rangoDe(cobertura, donde),
    ultimoDato: esObjeto(cobertura) && esFecha(cobertura.hasta) ? cobertura.hasta : null,
  };
}

/**
 * Solo las series traen cobertura.
 * @param {unknown} cobertura
 * @param {string} donde
 */
function rangoDe(cobertura, donde) {
  if (cobertura === undefined) return "No aplica";
  if (!esObjeto(cobertura) || !esFecha(cobertura.desde) || !esFecha(cobertura.hasta)) {
    throw forma(`${donde}.cobertura no trae desde y hasta`);
  }
  return `${cobertura.desde} – ${cobertura.hasta}`;
}

/**
 * Revisa la respuesta de `/v1/status` y la convierte en filas de texto. El estado es el que
 * calculó la API: no se recalcula con el reloj del equipo. Lanza `ErrorEstado` si la forma no es
 * la esperada; los campos que no conoce los ignora.
 * @param {unknown} cuerpo La respuesta ya leída como JSON.
 * @param {Date} ahora Para el "hace N h".
 * @returns {FilaEstado[]}
 */
export function filasDeEstado(cuerpo, ahora) {
  if (!esObjeto(cuerpo)) throw forma("no es un objeto");
  const { data } = cuerpo;
  if (!Array.isArray(data)) throw forma("data no es una lista");
  return data.map((valor, i) => filaDe(valor, i, ahora));
}

/**
 * Pone `origen` como texto de cada `[data-origen]`.
 * @param {{ querySelectorAll(selector: string): Iterable<{ textContent: string | null }> }} raiz
 * @param {string} origen
 */
export function rellenarOrigen(raiz, origen) {
  for (const elemento of raiz.querySelectorAll("[data-origen]")) elemento.textContent = origen;
}

const DIA_MEXICO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });

/**
 * El día de la Ciudad de México (`AAAA-MM-DD`) de un instante, sin importar la zona del equipo.
 * @param {Date} ahora
 */
export const hoyEnMexico = (ahora) => DIA_MEXICO.format(ahora);

/**
 * Resalta la fila de la tabla de las UDIS que es la de `hoy`. Sin JavaScript la tabla se lee igual.
 * @param {{ querySelectorAll(selector: string): Iterable<{ dataset: Readonly<Record<string, string | undefined>>, className: string, setAttribute(nombre: string, valor: string): void }> }} raiz
 * @param {string} hoy
 */
export function resaltarHoy(raiz, hoy) {
  for (const fila of raiz.querySelectorAll("tr[data-fecha]")) {
    if (fila.dataset.fecha !== hoy) continue;
    fila.className = "hoy";
    fila.setAttribute("aria-current", "date");
  }
}

/**
 * El mapa id → nombre que el HTML trae en `data-nombres`. Sin él, la tabla muestra el id.
 * @param {string | undefined} texto
 * @returns {Map<string, string>}
 */
export function nombresDeDatasets(texto) {
  /** @type {Map<string, string>} */
  const nombres = new Map();
  if (texto === undefined) return nombres;
  /** @type {unknown} */
  let valor;
  try {
    valor = JSON.parse(texto);
  } catch {
    return nombres;
  }
  if (!esObjeto(valor)) return nombres;
  for (const [id, nombre] of Object.entries(valor)) {
    if (typeof nombre === "string") nombres.set(id, nombre);
  }
  return nombres;
}

/** @typedef {(url: string, init: RequestInit) => Promise<Response>} Pedir */

/** @param {Response} respuesta */
function motivoHttp(respuesta) {
  const { status } = respuesta;
  if (status === 429) {
    const segundos = respuesta.headers.get("retry-after");
    const cuanto = segundos !== null && /^\d+$/.test(segundos) ? `${segundos} s` : "un momento";
    return `la API respondió 429 (demasiadas consultas seguidas); espera ${cuanto} y vuelve a intentar.`;
  }
  if (status >= 500) return `la API respondió ${status} (falla del servidor); intenta más tarde.`;
  return `la API respondió ${status}.`;
}

/**
 * La única señal de la consulta es la de tiempo: un `AbortError` también lo es. Algunos
 * navegadores y versiones de `fetch` rechazan con él en vez de con el `TimeoutError` de la señal.
 * @param {unknown} error
 */
const esTiempoAgotado = (error) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

/**
 * Pide `/v1/status` y devuelve el cuerpo JSON. La señal corta la petición y la lectura del
 * cuerpo. Revalida la caché del navegador (con ETag), así que "Consultado el <ahora>" es cierto.
 * Toda falla sale como `ErrorEstado` con su explicación.
 * @param {Pedir} pedir `fetch` o uno hecho a mano.
 * @param {number} [espera]
 * @returns {Promise<unknown>}
 */
export async function consultarEstado(pedir, espera = ESPERA_MS) {
  try {
    const respuesta = await pedir("/v1/status", {
      signal: AbortSignal.timeout(espera),
      headers: { accept: "application/json" },
      cache: "no-cache",
    });
    if (respuesta.status !== 200) throw new ErrorEstado(motivoHttp(respuesta));
    return await respuesta.json();
  } catch (error) {
    if (error instanceof ErrorEstado) throw error;
    if (esTiempoAgotado(error)) {
      throw new ErrorEstado(`la API no respondió en ${espera / 1000} s.`);
    }
    if (error instanceof SyntaxError) throw new ErrorEstado("la respuesta no es JSON.");
    throw new ErrorEstado("no hubo respuesta de la API; revisa tu conexión.");
  }
}

/**
 * Lo que este módulo usa de un elemento que crea. `N` es el tipo de nodo de quien lo crea:
 * `HTMLElement` en el navegador, uno hecho a mano en las pruebas.
 * @template N
 * @typedef {object} Elemento
 * @property {string | null} textContent
 * @property {string} className
 * @property {(nombre: string, valor: string) => void} setAttribute
 * @property {(...hijos: Array<N | string>) => void} append
 */

/**
 * Los elementos de `/estado/` que el módulo toca.
 * @template N
 * @typedef {object} PaginaEstado
 * @property {{ createElement(etiqueta: string): N }} documento
 * @property {{ hidden: boolean | "until-found" }} marco Contenedor de la tabla.
 * @property {{ replaceChildren(...filas: N[]): void }} cuerpo El `tbody`.
 * @property {{ textContent: string | null, className: string }} mensaje Región `aria-live`.
 * @property {{ hidden: boolean | "until-found", addEventListener(tipo: "click", oyente: () => void): void }} boton
 * @property {ReadonlyMap<string, string>} nombres
 */

/**
 * @template {Elemento<N>} N
 * @param {{ createElement(etiqueta: string): N }} documento
 * @param {FilaEstado} fila
 * @param {ReadonlyMap<string, string>} nombres
 * @returns {N}
 */
function crearFila(documento, fila, nombres) {
  /**
   * @param {string} etiqueta
   * @param {string} [clase]
   * @param {...(N | string)} hijos
   */
  const crear = (etiqueta, clase = "", ...hijos) => {
    const elemento = documento.createElement(etiqueta);
    if (clase !== "") elemento.className = clase;
    elemento.append(...hijos);
    return elemento;
  };
  /**
   * @param {string} cuando
   * @param {string} texto
   */
  const tiempo = (cuando, texto) => {
    const elemento = crear("time", "", texto);
    elemento.setAttribute("datetime", cuando);
    return elemento;
  };

  const nombre = nombres.get(fila.dataset);
  const encabezado =
    nombre === undefined
      ? crear("th", "", fila.dataset)
      : crear("th", "", nombre, crear("span", "id", fila.dataset));
  encabezado.setAttribute("scope", "row");
  // Roles explícitos: en modo tarjeta (display: block) WebKit deja de anunciarla como tabla.
  encabezado.setAttribute("role", "rowheader");
  const exito =
    fila.instante === null
      ? crear("td", "", fila.ultimoExito)
      : crear(
          "td",
          "",
          tiempo(fila.instante, fila.ultimoExito),
          crear("span", "detalle", fila.hace),
        );
  const datos =
    fila.ultimoDato === null
      ? crear("td", "junto", tiempo(fila.datos, fila.datos))
      : crear(
          "td",
          "junto",
          tiempo(fila.datos, fila.datos),
          crear("span", "detalle", "último dato ", tiempo(fila.ultimoDato, fila.ultimoDato)),
        );
  const celdas = [
    crear("td", "", crear("span", `estado estado-${fila.status}`, fila.estado)),
    datos,
    exito,
    crear("td", "num", fila.plazo),
    crear("td", "junto", fila.cobertura),
  ];
  celdas.forEach((celda, i) => {
    celda.setAttribute("data-etiqueta", ETIQUETAS[i] ?? "");
    celda.setAttribute("role", "cell");
  });
  const renglon = crear("tr", "", encabezado, ...celdas);
  renglon.setAttribute("role", "row");
  return renglon;
}

/**
 * @param {{ textContent: string | null, className: string }} mensaje
 * @param {string} texto
 * @param {boolean} [falla]
 */
function avisar(mensaje, texto, falla = false) {
  mensaje.className = falla ? "mensaje aviso" : "mensaje";
  mensaje.textContent = texto;
}

/**
 * Consulta `/v1/status` y pinta la tabla. Siempre termina con un mensaje: el momento de la
 * consulta o por qué no se pudo; nunca se queda en "Consultando".
 * @template {Elemento<N>} N
 * @param {PaginaEstado<N>} pagina
 * @param {Pedir} pedir
 * @param {() => Date} [reloj]
 */
export async function actualizarEstado(pagina, pedir, reloj = () => new Date()) {
  avisar(pagina.mensaje, "Consultando el estado…");
  try {
    const cuerpo = await consultarEstado(pedir);
    const ahora = reloj();
    const filas = filasDeEstado(cuerpo, ahora);
    pagina.cuerpo.replaceChildren(
      ...filas.map((fila) => crearFila(pagina.documento, fila, pagina.nombres)),
    );
    pagina.marco.hidden = filas.length === 0;
    avisar(
      pagina.mensaje,
      filas.length === 0
        ? "La API no reporta datasets automáticos."
        : `Consultado el ${FECHA_HORA.format(ahora)}, hora de la Ciudad de México.`,
    );
  } catch (error) {
    pagina.cuerpo.replaceChildren();
    pagina.marco.hidden = true;
    const motivo = error instanceof ErrorEstado ? error.message : "falla inesperada de la página.";
    avisar(pagina.mensaje, `No se pudo consultar el estado: ${motivo}`, true);
  }
}

/**
 * Muestra el botón Actualizar y consulta ahora; un clic mientras hay una consulta en curso no
 * pide otra.
 * @template {Elemento<N>} N
 * @param {PaginaEstado<N>} pagina
 * @param {Pedir} pedir
 * @param {() => Date} [reloj]
 */
export function instalarEstado(pagina, pedir, reloj) {
  let enCurso = false;
  const actualizar = async () => {
    if (enCurso) return;
    enCurso = true;
    try {
      await actualizarEstado(pagina, pedir, reloj);
    } finally {
      enCurso = false;
    }
  };
  pagina.boton.hidden = false;
  pagina.boton.addEventListener("click", () => {
    actualizar();
  });
  return actualizar();
}

/** De dónde sale el catálogo de bancos del validador: la descarga, que no lleva la CLABE. */
export const RUTA_CATALOGO_BANCOS = "/descargas/bancos.json";

/**
 * @typedef {object} BancoValidador
 * @property {string} codigo
 * @property {string} nombre_corto
 * @property {boolean} activo
 */

/**
 * @typedef {object} ResultadoClabe
 * @property {string} valor La CLABE sin espacios ni guiones.
 * @property {boolean} valido
 * @property {string[]} errores `vacio`, `caracteres`, `longitud`, `banco` o `digito_verificador`.
 * @property {boolean} bancoRevisado Si el código de banco se revisó contra el catálogo.
 * @property {BancoValidador | null} banco
 * @property {string | null} digitoEsperado El dígito que corresponde a los 17 primeros.
 */

const PESOS_CLABE = [3, 7, 1];

/**
 * Valida una CLABE como `validarClabe` del núcleo con el mismo catálogo: sin espacios ni guiones,
 * 18 dígitos, banco en el catálogo y dígito verificador con pesos 3, 7 y 1. Corre en el navegador:
 * la CLABE no sale de la página. Sin catálogo (`null`) no revisa el banco.
 * @param {string} clabe
 * @param {ReadonlyMap<string, BancoValidador> | null} bancos
 * @returns {ResultadoClabe}
 */
export function validarClabeLocal(clabe, bancos) {
  const valor = clabe.replace(/[\p{Zs}\t\n\r\v\f-]/gu, "");
  const revisado = bancos !== null;
  /** @param {string} error */
  const falla = (error) => ({
    valor,
    valido: false,
    errores: [error],
    bancoRevisado: revisado,
    banco: null,
    digitoEsperado: null,
  });
  if (valor.length === 0) return falla("vacio");
  if (!/^[0-9]+$/.test(valor)) return falla("caracteres");
  if (valor.length !== 18) return falla("longitud");
  const banco = bancos?.get(valor.slice(0, 3)) ?? null;
  if (revisado && banco === null) return falla("banco");
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    suma += Number(valor[i]) * /** @type {number} */ (PESOS_CLABE[i % 3]);
  }
  const digitoEsperado = String((10 - (suma % 10)) % 10);
  const digitoOk = digitoEsperado === valor[17];
  return {
    valor,
    valido: digitoOk,
    errores: digitoOk ? [] : ["digito_verificador"],
    bancoRevisado: revisado,
    banco,
    digitoEsperado,
  };
}

/**
 * El catálogo de bancos de `/descargas/bancos.json` como mapa código a banco. Lanza Error si no
 * tiene la forma esperada.
 * @param {unknown} cuerpo
 * @returns {Map<string, BancoValidador>}
 */
export function catalogoDeBancos(cuerpo) {
  if (!Array.isArray(cuerpo)) throw new Error("el catálogo de bancos no es una lista.");
  /** @type {Map<string, BancoValidador>} */
  const bancos = new Map();
  for (const banco of cuerpo) {
    if (
      !esObjeto(banco) ||
      typeof banco.codigo !== "string" ||
      !/^[0-9]{3}$/.test(banco.codigo) ||
      typeof banco.nombre_corto !== "string" ||
      typeof banco.activo !== "boolean"
    ) {
      throw new Error("un banco del catálogo no tiene código, nombre y estado.");
    }
    const { codigo, nombre_corto, activo } = banco;
    bancos.set(codigo, { codigo, nombre_corto, activo });
  }
  return bancos;
}

const NO_CONFIRMA = "Esto no confirma que la cuenta exista.";

/**
 * El texto que se muestra de un resultado.
 * @param {ResultadoClabe} r
 * @returns {{ ok: boolean, texto: string }}
 */
export function mensajeClabe(r) {
  const [error] = r.errores;
  if (error === "vacio") return { ok: false, texto: "Escribe una CLABE." };
  if (error === "caracteres") {
    return {
      ok: false,
      texto: "La CLABE solo lleva dígitos; se ignoran los espacios y los guiones.",
    };
  }
  if (error === "longitud") {
    return { ok: false, texto: `La CLABE lleva 18 dígitos y esta tiene ${r.valor.length}.` };
  }
  if (error === "banco") {
    return {
      ok: false,
      texto: `El código de banco ${r.valor.slice(0, 3)} no está en el catálogo de bancos.`,
    };
  }
  if (error === "digito_verificador") {
    return {
      ok: false,
      texto: `El dígito verificador no coincide: con estos 17 dígitos debería ser ${r.digitoEsperado}.`,
    };
  }
  if (r.banco === null) {
    return {
      ok: true,
      texto: `Formato y dígito verificador correctos. El banco no se revisó, porque no se cargó el catálogo. ${NO_CONFIRMA}`,
    };
  }
  const estado = r.banco.activo ? "" : " (ya no aparece en el SPEI)";
  return {
    ok: true,
    texto: `CLABE válida: banco ${r.banco.codigo} ${r.banco.nombre_corto}${estado}, plaza ${r.valor.slice(3, 6)}, cuenta ${r.valor.slice(6, 17)}, dígito verificador ${r.valor[17]}. ${NO_CONFIRMA}`,
  };
}

/**
 * Lo que el validador usa de los elementos de `/validar-clabe/`.
 * @typedef {object} PaginaValidador
 * @property {{ hidden: boolean | "until-found", addEventListener(tipo: "submit", oyente: (evento: { preventDefault(): void }) => void): void }} formulario
 * @property {{ value: string }} entrada
 * @property {{ textContent: string | null, className: string }} resultado
 * @property {{ textContent: string | null }} estado
 */

/**
 * Carga el catálogo de bancos (es la única petición: la CLABE no se manda a ningún lado), muestra
 * el formulario y valida al enviarlo. Si el catálogo no carga, valida formato y dígito y lo avisa.
 * @param {PaginaValidador} pagina
 * @param {Pedir} pedir
 */
export async function instalarValidador(pagina, pedir) {
  /** @type {Map<string, BancoValidador> | null} */
  let bancos = null;
  try {
    const respuesta = await pedir(RUTA_CATALOGO_BANCOS, {
      headers: { accept: "application/json" },
    });
    if (!respuesta.ok) throw new Error(`la descarga respondió ${respuesta.status}`);
    bancos = catalogoDeBancos(await respuesta.json());
  } catch (error) {
    const motivo = error instanceof Error ? error.message.replace(/\.$/, "") : "falla inesperada";
    pagina.estado.textContent = `No se pudo cargar el catálogo de bancos (${motivo}): se revisan el formato y el dígito verificador, pero no el banco.`;
  }
  pagina.formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const { ok, texto } = mensajeClabe(validarClabeLocal(pagina.entrada.value, bancos));
    pagina.resultado.textContent = texto;
    pagina.resultado.className = ok ? "ok" : "mal";
  });
  pagina.formulario.hidden = false;
}

/**
 * Los elementos de `/validar-clabe/`, o `null` en las demás páginas.
 * @param {{ getElementById(id: string): unknown }} documento
 * @returns {PaginaValidador | null}
 */
function paginaDeValidador(documento) {
  const formulario = documento.getElementById("form-clabe");
  const entrada = documento.getElementById("entrada-clabe");
  const resultado = documento.getElementById("resultado-clabe");
  const estado = documento.getElementById("estado-catalogo");
  if (formulario === null || entrada === null || resultado === null || estado === null) {
    return null;
  }
  return /** @type {PaginaValidador} */ (
    /** @type {unknown} */ ({ formulario, entrada, resultado, estado })
  );
}

/**
 * Lo que este módulo usa de los elementos de `/estado/` que busca por id.
 * @template N
 * @typedef {object} ElementoDePagina
 * @property {boolean | "until-found"} hidden
 * @property {string | null} textContent
 * @property {string} className
 * @property {Readonly<Record<string, string | undefined>>} dataset
 * @property {(...filas: N[]) => void} replaceChildren
 * @property {(tipo: "click", oyente: () => void) => void} addEventListener
 */

/**
 * Lo que este módulo usa de `document`.
 * @template N
 * @typedef {object} Documento
 * @property {(selector: string) => Iterable<{ textContent: string | null, dataset: Readonly<Record<string, string | undefined>>, className: string, setAttribute(nombre: string, valor: string): void }>} querySelectorAll
 * @property {(id: string) => ElementoDePagina<N> | null} getElementById
 * @property {(etiqueta: string) => N} createElement
 */

/**
 * Los elementos de `/estado/`, o `null` en las demás páginas.
 * @template {Elemento<N>} N
 * @param {Documento<N>} documento
 * @returns {PaginaEstado<N> | null}
 */
function paginaDeEstado(documento) {
  const marco = documento.getElementById("marco-estado");
  const cuerpo = documento.getElementById("filas-estado");
  const mensaje = documento.getElementById("mensaje-estado");
  const boton = documento.getElementById("actualizar-estado");
  if (marco === null || cuerpo === null || mensaje === null || boton === null) return null;
  const nombres = nombresDeDatasets(cuerpo.dataset.nombres);
  return { documento, marco, cuerpo, mensaje, boton, nombres };
}

/**
 * @template {Elemento<N>} N
 * @param {Documento<N>} documento
 * @param {{ origin: string }} ubicacion
 */
function arrancar(documento, { origin }) {
  // Abierta desde un archivo, el origen es "null": el ejemplo se queda con la API pública.
  if (/^https?:\/\//.test(origin)) rellenarOrigen(documento, origin);
  const pagina = paginaDeEstado(documento);
  // Envuelto: `fetch` llamado como método de otro objeto falla en el navegador.
  if (pagina !== null) instalarEstado(pagina, (url, init) => fetch(url, init));
  const validador = paginaDeValidador(documento);
  if (validador !== null) instalarValidador(validador, (url, init) => fetch(url, init));
}

/**
 * `document` y `location` del navegador. En Node no existen y sus tipos quedan en `never`; el
 * programa de tipos del cliente, con la biblioteca DOM, revisa que cumplan con `Documento`.
 * @typedef {object} Globales
 * @property {typeof globalThis extends { document: infer D } ? D : never} [document]
 * @property {typeof globalThis extends { location: infer L } ? L : never} [location]
 */
const { document: documento, location: ubicacion } = /** @type {Globales} */ (globalThis);
if (documento !== undefined && ubicacion !== undefined) arrancar(documento, ubicacion);
