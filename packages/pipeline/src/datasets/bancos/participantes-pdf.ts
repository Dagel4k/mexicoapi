import { esFechaIsoValida, type FechaISO } from "@mexicoapi/core";
import { getDocumentProxy } from "unpdf";
import { limpiarTexto } from "../../canonico.js";
import { ErrorDatos } from "../../errores.js";

const ID = "bancos";
const TOLERANCIA_Y = 2;
const MARGEN_X = 3;
const MARGEN_SUPERINDICE = 6;

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

export interface FilaParticipante {
  numero: number;
  nombre_corto: string;
  razon_social: string;
  sector: string;
}
export interface ListadoParticipantes {
  actualizado_al: FechaISO;
  total: number;
  filas: FilaParticipante[];
}

export interface Fragmento {
  texto: string;
  x: number;
  y: number;
  ancho: number;
}
export interface Linea {
  y: number;
  fragmentos: Fragmento[];
  texto: string;
}
export interface Seccion {
  pagina: number;
  y: number;
  nombre: string;
  cantidad: number;
}
export interface Ancla {
  pagina: number;
  y: number;
  numero: number;
  nombre: string[];
  razon: string[];
}
export interface Columnas {
  yEncabezado: number;
  ysEncabezado: number[];
  numero: number;
  nombre: number;
  razon: number;
}

const REGEX_ENCABEZADO = /actualizado al (\d{1,2}) de (\p{L}+) de (\d{4}).*?(\d+) participantes/u;
const REGEX_SECCION = /^(.*?)\s*\[(\d+) instituci(?:ón|ones)\]$/u;
const REGEX_RUIDO = [
  /^Uso Público$/u,
  /^Información de acceso público\.?$/u,
  /^Página \d+ de \d+$/u,
];

function unir(fragmentos: Fragmento[]): string {
  const orden = [...fragmentos].sort((a, b) => a.x - b.x);
  let salida = "";
  let fin = Number.NEGATIVE_INFINITY;
  for (const f of orden) {
    if (salida !== "" && f.x - fin > 1) salida += " ";
    salida += f.texto;
    fin = f.x + f.ancho;
  }
  return limpiarTexto(salida);
}

function agruparLineas(fragmentos: Fragmento[]): Linea[] {
  const orden = [...fragmentos].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: Fragmento[][] = [];
  let yGrupo = Number.NaN;
  for (const f of orden) {
    const actual = grupos[grupos.length - 1];
    if (actual !== undefined && Math.abs(yGrupo - f.y) <= TOLERANCIA_Y) actual.push(f);
    else {
      grupos.push([f]);
      yGrupo = f.y;
    }
  }
  return grupos.map((g) => ({ y: g[0]?.y ?? 0, fragmentos: g, texto: unir(g) }));
}

async function leerPaginas(bytes: Uint8Array): Promise<Fragmento[][]> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // pdf.js puede transferir el búfer; se le pasa una copia.
    doc = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
    const paginas: Fragmento[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const contenido = await (await doc.getPage(i)).getTextContent();
      const fragmentos: Fragmento[] = [];
      for (const item of contenido.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        fragmentos.push({
          texto: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          ancho: item.width,
        });
      }
      paginas.push(fragmentos);
    }
    return paginas;
  } catch {
    throw new ErrorDatos("El PDF de participantes no se pudo leer", ID);
  } finally {
    await doc?.loadingTask.destroy().catch(() => undefined);
  }
}

function leerEncabezado(lineas: Linea[]): { actualizado_al: FechaISO; total: number } {
  for (const l of lineas) {
    const m = REGEX_ENCABEZADO.exec(l.texto);
    if (m === null) continue;
    const mes = MESES.indexOf((m[2] ?? "").toLowerCase()) + 1;
    if (mes === 0) throw new ErrorDatos(`Mes desconocido en el encabezado: ${m[2]}`, ID);
    const dia = String(Number(m[1])).padStart(2, "0");
    const iso = `${m[3]}-${String(mes).padStart(2, "0")}-${dia}`;
    if (!esFechaIsoValida(iso)) throw new ErrorDatos(`Fecha inválida en el encabezado: ${iso}`, ID);
    return { actualizado_al: iso as FechaISO, total: Number(m[4]) };
  }
  throw new ErrorDatos("El PDF de participantes no trae el encabezado esperado", ID);
}

/** Cada sección repite el encabezado de la tabla; las columnas salen del primero. */
function leerColumnas(lineas: Linea[]): Columnas | null {
  let cols: Columnas | null = null;
  const ys: number[] = [];
  for (const l of lineas) {
    const num = l.fragmentos.find((f) => f.texto.trim() === "#");
    const nom = l.fragmentos.find((f) => f.texto.startsWith("NOMBRE CORTO"));
    const raz = l.fragmentos.find((f) => f.texto.startsWith("RAZÓN SOCIAL"));
    if (num === undefined || nom === undefined || raz === undefined) continue;
    ys.push(l.y);
    cols ??= { yEncabezado: l.y, ysEncabezado: ys, numero: num.x, nombre: nom.x, razon: raz.x };
  }
  return cols;
}

function dentro(x: number, desde: number, hasta: number): boolean {
  return x >= desde - MARGEN_X && x < hasta - MARGEN_X;
}

/** Pitch vertical típico de las filas: mediana de las distancias entre anclas consecutivas. */
function pitchMediano(ys: number[]): number {
  if (ys.length < 2) return 12 * 2;
  const d = ys
    .slice(1)
    .map((y, i) => Math.abs((ys[i] ?? 0) - y))
    .sort((p, q) => p - q);
  return d[Math.floor(d.length / 2)] ?? 24;
}

/**
 * Crea las anclas (número en la columna #) y asigna cada línea de las columnas de nombre
 * y razón social a la ancla más cercana. Una línea a más de medio pitch de toda ancla
 * no es parte de la tabla conocida: se falla en lugar de pegarla a una fila.
 */
export function repartirLineas(pagina: number, validas: Linea[], cols: Columnas): Ancla[] {
  const nuevas: Ancla[] = [];
  for (const l of validas) {
    for (const f of l.fragmentos) {
      if (dentro(f.x, cols.numero, cols.nombre) && /^\d+$/.test(f.texto.trim())) {
        nuevas.push({ pagina, y: l.y, numero: Number(f.texto), nombre: [], razon: [] });
      }
    }
  }
  if (nuevas.length === 0) return nuevas;
  const maxDistancia = pitchMediano(nuevas.map((a) => a.y)) / 2;
  for (const l of validas) {
    const nombre = l.fragmentos.filter((f) => dentro(f.x, cols.nombre, cols.razon));
    const razon = l.fragmentos.filter((f) => f.x >= cols.razon - MARGEN_X);
    if (nombre.length === 0 && razon.length === 0) continue;
    let cercana = nuevas[0] as Ancla;
    for (const a of nuevas) if (Math.abs(a.y - l.y) < Math.abs(cercana.y - l.y)) cercana = a;
    if (Math.abs(cercana.y - l.y) > maxDistancia) {
      throw new ErrorDatos(`Línea inesperada en la tabla (página ${pagina + 1}): "${l.texto}"`, ID);
    }
    if (nombre.length > 0) cercana.nombre.push(unir(nombre));
    if (razon.length > 0) cercana.razon.push(unir(razon));
  }
  return nuevas;
}

/** Lee el PDF oficial de participantes directos del SPEI; falla si cambia la forma. */
export async function interpretarParticipantesPdf(
  bytes: Uint8Array,
): Promise<ListadoParticipantes> {
  const paginas = await leerPaginas(bytes);
  const primera = paginas[0];
  if (primera === undefined) throw new ErrorDatos("El PDF de participantes no tiene páginas", ID);
  const { actualizado_al, total } = leerEncabezado(agruparLineas(primera));

  const secciones: Seccion[] = [];
  const anclas: Ancla[] = [];

  paginas.forEach((fragmentos, pagina) => {
    const lineas = agruparLineas(fragmentos);
    const enSeccion = new Set<Linea>();
    for (const l of lineas) {
      const m = REGEX_SECCION.exec(l.texto);
      if (m === null) continue;
      enSeccion.add(l);
      secciones.push({ pagina, y: l.y, nombre: limpiarTexto(m[1] ?? ""), cantidad: Number(m[2]) });
    }
    const cols = leerColumnas(lineas);
    if (cols === null) return;

    const validas = lineas.filter(
      (l) =>
        l.y < cols.yEncabezado - TOLERANCIA_Y &&
        // El encabezado repetido y sus marcas de nota (superíndices) no son datos.
        !cols.ysEncabezado.some((y) => l.y <= y + MARGEN_SUPERINDICE && l.y >= y - TOLERANCIA_Y) &&
        !enSeccion.has(l) &&
        !REGEX_RUIDO.some((r) => r.test(l.texto)),
    );
    const nuevas = repartirLineas(pagina, validas, cols);
    if (nuevas.length === 0) return;
    anclas.push(...nuevas);
  });

  const filas: FilaParticipante[] = anclas.map((a) => {
    // Última sección que aparece antes de la fila en el orden del documento.
    let sector: Seccion | undefined;
    for (const s of secciones) {
      if (s.pagina < a.pagina || (s.pagina === a.pagina && s.y >= a.y)) sector = s;
    }
    if (sector === undefined) throw new ErrorDatos(`La fila ${a.numero} no tiene sección`, ID);
    return {
      numero: a.numero,
      nombre_corto: limpiarTexto(a.nombre.join(" ")),
      razon_social: limpiarTexto(a.razon.join(" ")),
      sector: sector.nombre,
    };
  });

  validar(filas, secciones, total);
  return { actualizado_al, total, filas };
}

export function validar(filas: FilaParticipante[], secciones: Seccion[], total: number): void {
  if (filas.length !== total) {
    throw new ErrorDatos(`El PDF declara ${total} participantes y se leyeron ${filas.length}`, ID);
  }
  filas.forEach((f, i) => {
    if (f.numero !== i + 1)
      throw new ErrorDatos(`Numeración no consecutiva en la fila ${i + 1}`, ID);
    if (f.nombre_corto === "") throw new ErrorDatos(`Fila ${f.numero} sin nombre corto`, ID);
    if (f.razon_social === "") throw new ErrorDatos(`Fila ${f.numero} sin razón social`, ID);
  });
  const suma = secciones.reduce((s, x) => s + x.cantidad, 0);
  if (suma !== total) {
    throw new ErrorDatos(`Las secciones suman ${suma} y el total es ${total}`, ID);
  }
  for (const s of secciones) {
    const n = filas.filter((f) => f.sector === s.nombre).length;
    if (n !== s.cantidad) {
      throw new ErrorDatos(`La sección ${s.nombre} declara ${s.cantidad} y trae ${n}`, ID);
    }
  }
}

function atributo(etiqueta: string, nombre: string): string | undefined {
  const m = new RegExp(String.raw`(?:^|\s)${nombre}\s*=\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(
    etiqueta,
  );
  return m?.[1] ?? m?.[2];
}

/** URL absoluta del PDF enlazado con title="Participantes". */
export function enlacePdfParticipantes(html: string, base: string): string {
  for (const etiqueta of html.match(/<a\b[^>]*>/giu) ?? []) {
    if (atributo(etiqueta, "title") !== "Participantes") continue;
    const valor = atributo(etiqueta, "href")?.trim();
    if (valor === undefined || valor === "" || valor.startsWith("#")) continue;
    let url: URL;
    try {
      url = new URL(valor.replaceAll("&amp;", "&"), base);
    } catch {
      throw new ErrorDatos(`Enlace de participantes inválido: ${valor}`, ID);
    }
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "banxico.org.mx" || url.hostname.endsWith(".banxico.org.mx"))
    ) {
      throw new ErrorDatos(`El enlace de participantes no es de banxico.org.mx: ${url.href}`, ID);
    }
    // URL codifica las llaves; la fuente las publica literales.
    return url.href.replaceAll("%7B", "{").replaceAll("%7D", "}");
  }
  throw new ErrorDatos("La página no enlaza el PDF de participantes", ID);
}
