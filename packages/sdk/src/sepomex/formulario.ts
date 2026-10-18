// Lee el formulario ASP.NET de la página de descarga: sus campos ocultos (__VIEWSTATE y los demás
// que traiga), su action y los controles de estado, formato y botón. No guarda ningún valor fijo:
// todo sale de la página que responde el sitio en ese momento.
import { SepomexError } from "./error.js";
import { DESCARGA_MANUAL } from "./fuente.js";

export interface Formulario {
  /** URL a la que se envía: el action del formulario, del mismo origen que la página. */
  accion: string;
  /** Campos ocultos en el orden de la página, con sus valores ya decodificados. */
  ocultos: [string, string][];
  /** Lo que envía el botón de descarga: sus coordenadas si es una imagen, o su valor. */
  boton: [string, string][];
  /** "Última Actualización de Información" de la página, como fecha ISO; null si no viene. */
  as_of: string | null;
}

const ESTADO = "cboEdo";
const TODO_EL_PAIS = "00";
const FORMATO = "rblTipo";
const TXT = "txt";
const BOTON = "btnDescarga";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entidad, cuerpo: string) => {
    if (cuerpo[0] === "#") {
      const hex = cuerpo[1] === "x" || cuerpo[1] === "X";
      return String.fromCodePoint(Number.parseInt(cuerpo.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? entidad;
  });
}

type Atributos = Map<string, string>;

function atributos(etiqueta: string): Atributos {
  const resultado: Atributos = new Map();
  const interior = etiqueta.replace(/^<\w+/, "").replace(/\/?>$/, "");
  for (const m of interior.matchAll(
    /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    const nombre = (m[1] as string).toLowerCase();
    if (!resultado.has(nombre)) {
      resultado.set(nombre, decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? ""));
    }
  }
  return resultado;
}

const etiquetas = (html: string, nombre: string): Atributos[] =>
  [...html.matchAll(new RegExp(`<${nombre}\\b[^>]*>`, "gi"))].map((m) => atributos(m[0]));

const paginaCambio = (falta: string): SepomexError =>
  new SepomexError(
    "pagina-inesperada",
    `La página de descarga de Correos de México cambió: falta ${falta}. ${DESCARGA_MANUAL}`,
  );

/** Las partes de la página desde cada `<form` hasta su `</form>` (o el final). */
function formularios(html: string): { inicio: Atributos; contenido: string }[] {
  const partes: { inicio: Atributos; contenido: string }[] = [];
  for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
    const desde = m.index + m[0].length;
    const cierre = html.slice(desde).search(/<\/form\s*>/i);
    partes.push({
      inicio: atributos(m[0]),
      contenido: html.slice(desde, cierre < 0 ? undefined : desde + cierre),
    });
  }
  return partes;
}

function fechaDeActualizacion(html: string): string | null {
  const m = /Actualizaci[oó]n de Informaci[oó]n:\s*([a-záéíóú]+)\s+(\d{1,2})\s+de\s+(\d{4})/i.exec(
    html,
  );
  if (m === null) return null;
  const nombre = (m[1] as string).toLowerCase();
  const mes = MESES.indexOf(nombre === "setiembre" ? "septiembre" : nombre) + 1;
  const dia = Number(m[2]);
  const anio = Number(m[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (mes === 0 || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return fecha.toISOString().slice(0, 10);
}

/** Si la página pide resolver un CAPTCHA o un reto contra robots. */
export const pideCaptcha = (html: string): boolean =>
  /captcha|turnstile|challenge-platform/i.test(html);

/** El error de una página con CAPTCHA: no se intenta resolver. */
export const errorCaptcha = (): SepomexError =>
  new SepomexError(
    "bloqueado",
    `Correos de México no permitió la descarga automática: la página pide un CAPTCHA. ${DESCARGA_MANUAL}`,
  );

/**
 * Lee el formulario de descarga de la página. Lanza SepomexError `bloqueado` si la página pide un
 * CAPTCHA (no se intenta resolver) y `pagina-inesperada` si falta el formulario, un campo oculto
 * de ASP.NET, la opción de todo el país, la de TXT o el botón, o si se envía a otro sitio.
 */
export function leerFormulario(html: string, url: string): Formulario {
  if (pideCaptcha(html)) throw errorCaptcha();
  const formulario = formularios(html).find(({ contenido }) =>
    etiquetas(contenido, "select").some((s) => s.get("name") === ESTADO),
  );
  if (formulario === undefined) throw paginaCambio(`el formulario de descarga (${ESTADO})`);
  const { contenido } = formulario;

  const entradas = etiquetas(contenido, "input");
  const ocultos: [string, string][] = entradas
    .filter((e) => e.get("type")?.toLowerCase() === "hidden" && e.has("name"))
    .map((e) => [e.get("name") as string, e.get("value") ?? ""]);
  if (!ocultos.some(([nombre]) => nombre === "__VIEWSTATE")) {
    throw paginaCambio("el campo oculto __VIEWSTATE");
  }
  const opciones = etiquetas(contenido, "option").map((o) => o.get("value"));
  if (!opciones.includes(TODO_EL_PAIS)) {
    throw paginaCambio(`la opción Todos (${ESTADO}=${TODO_EL_PAIS})`);
  }
  if (!entradas.some((e) => e.get("name") === FORMATO && e.get("value") === TXT)) {
    throw paginaCambio(`la opción TXT (${FORMATO})`);
  }
  const boton = entradas.find((e) => e.get("name") === BOTON);
  const tipoBoton = boton?.get("type")?.toLowerCase();
  if (boton === undefined || (tipoBoton !== "image" && tipoBoton !== "submit")) {
    throw paginaCambio(`el botón de descarga (${BOTON})`);
  }

  const accion = new URL(formulario.inicio.get("action") || url, url);
  if (accion.origin !== new URL(url).origin) {
    throw new SepomexError(
      "pagina-inesperada",
      `La página de descarga envía el formulario a otro sitio (${accion.origin}). ${DESCARGA_MANUAL}`,
    );
  }
  return {
    accion: accion.href,
    ocultos,
    // Un botón de imagen envía dónde se hizo clic; cualquier punto dentro de la imagen sirve.
    boton:
      tipoBoton === "image"
        ? [
            [`${BOTON}.x`, "1"],
            [`${BOTON}.y`, "1"],
          ]
        : [[BOTON, boton.get("value") ?? ""]],
    as_of: fechaDeActualizacion(html),
  };
}

/** Cuerpo `application/x-www-form-urlencoded` para descargar todo el país en TXT. */
export function cuerpoDeDescarga(formulario: Formulario): string {
  return new URLSearchParams([
    ...formulario.ocultos,
    [ESTADO, TODO_EL_PAIS],
    [FORMATO, TXT],
    ...formulario.boton,
  ]).toString();
}
