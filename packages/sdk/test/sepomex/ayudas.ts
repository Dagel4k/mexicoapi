// Fixtures de SEPOMEX armados en la prueba: un ZIP de un archivo, un TXT con el formato oficial
// (unas filas escritas a mano y una de relleno por entidad) y la página del formulario. Nada de
// esto es el catálogo de Correos de México.
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

// De data/ y no de src/datos: estas ayudas también prueban dist, donde no hay plugin de datos.
const DATA = new URL("../../../../data/", import.meta.url);
const leer = <T>(ruta: string): T => JSON.parse(readFileSync(new URL(ruta, DATA), "utf8")) as T;
const ESTADOS = leer<{ cve_ent: string; nombre: string }[]>("inegi-estados/estados.json");
const MUNICIPIOS = leer<{ cve_ent: string; cve_mun: string; nombre: string }[]>(
  "inegi-municipios/municipios.json",
);

export const AVISO =
  "El Catálogo Nacional de Códigos Postales, es elaborado por Correos de México y se proporciona en forma gratuita para uso particular, no estando permitida su comercialización, total o parcial, ni su distribución a terceros bajo ningún concepto.";

export const CABECERA =
  "d_codigo|d_asenta|d_tipo_asenta|D_mnpio|d_estado|d_ciudad|d_CP|c_estado|c_oficina|c_CP|c_tipo_asenta|c_mnpio|id_asenta_cpcons|d_zona|c_cve_ciudad";

/** Filas con el formato del TXT oficial, escritas a mano: acentos, ñ, ciudad vacía y zona rural. */
export const FILAS_A_MANO = [
  "80000|Culiacán Centro|Colonia|Culiacán|Sinaloa|Culiacán Rosales|80001|25|80001||09|006|0001|Urbano|01",
  "80010|Jorge Almada|Colonia|Culiacán|Sinaloa|Culiacán Rosales|80201|25|80201||09|006|0002|Urbano|01",
  "80010|Ciudad Universitaria|Colonia|Culiacán|Sinaloa|Culiacán Rosales|80201|25|80201||09|006|0003|Urbano|01",
  "80396|El Diez|Pueblo|Culiacán|Sinaloa||80396|25|80396||28|006|0450|Rural|",
  "15520|Peñón de los Baños|Colonia|Venustiano Carranza|Ciudad de México|Ciudad de México|15521|09|15521||09|017|0789|Urbano|01",
  "76240|La Cañada|Pueblo|El Marqués|Querétaro||76241|22|76241||28|011|0102|Rural|",
] as const;

/** Una fila por cada entidad que no tienen las filas a mano, con su primer municipio de INEGI. */
export function filasDeRelleno(): string[] {
  const conFilas = new Set(FILAS_A_MANO.map((f) => f.split("|")[7]));
  return ESTADOS.filter((e) => !conFilas.has(e.cve_ent)).map((e) => {
    const m = MUNICIPIOS.find((x) => x.cve_ent === e.cve_ent);
    if (m === undefined) throw new Error(`sin municipios en ${e.cve_ent}`);
    const cp = `${e.cve_ent}999`;
    return `${cp}|Asentamiento de prueba|Colonia|${m.nombre}|${e.nombre}||${cp}|${e.cve_ent}|${cp}||09|${m.cve_mun}|0001|Urbano|`;
  });
}

/** Líneas del TXT completo: aviso, cabecera, filas a mano, relleno y `extra`. */
export function lineasTxt(extra: readonly string[] = []): string[] {
  return [AVISO, CABECERA, ...FILAS_A_MANO, ...filasDeRelleno(), ...extra];
}

/** El TXT en ISO-8859-1 con fin de línea CRLF, como el oficial. */
export function txt(lineas: readonly string[] = lineasTxt()): Uint8Array {
  return new Uint8Array(Buffer.from(`${lineas.join("\r\n")}\r\n`, "latin1"));
}

export interface EntradaZip {
  nombre: string;
  datos: Uint8Array;
  /** 8 (deflate, por omisión) o 0 (sin comprimir); otro número se escribe tal cual. */
  metodo?: number;
  flags?: number;
  /** Para mentir en el encabezado: CRC y tamaño descomprimido que se declaran. */
  crc?: number;
  tamano?: number;
  /** Nombre en el encabezado local, si debe ser distinto del central. */
  nombreLocal?: string;
}

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

export interface OpcionesZip {
  comentario?: string;
  /** Sobrescribe campos del fin del directorio central. */
  fin?: Partial<{
    disco: number;
    discoCentral: number;
    enDisco: number;
    total: number;
    tamCentral: number;
    inicioCentral: number;
  }>;
}

/** Arma un ZIP con sus encabezados locales, el directorio central y su fin. */
export function crearZip(entradas: readonly EntradaZip[], opciones: OpcionesZip = {}): Uint8Array {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;
  for (const e of entradas) {
    const metodo = e.metodo ?? 8;
    const comprimidos = metodo === 8 ? deflateRawSync(e.datos) : Buffer.from(e.datos);
    const crc = e.crc ?? crc32(e.datos);
    const tamano = e.tamano ?? e.datos.length;
    const flags = e.flags ?? 0;
    const nombre = Buffer.from(e.nombre, "utf8");
    const nombreLocal = Buffer.from(e.nombreLocal ?? e.nombre, "utf8");
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(metodo),
      u16(0),
      u16(0x5b52),
      u32(crc),
      u32(comprimidos.length),
      u32(tamano),
      u16(nombreLocal.length),
      u16(0),
      nombreLocal,
      comprimidos,
    ]);
    centrales.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(metodo),
        u16(0),
        u16(0x5b52),
        u32(crc),
        u32(comprimidos.length),
        u32(tamano),
        u16(nombre.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(desplazamiento),
        nombre,
      ]),
    );
    locales.push(local);
    desplazamiento += local.length;
  }
  const central = Buffer.concat(centrales);
  const comentario = Buffer.from(opciones.comentario ?? "", "latin1");
  const f = opciones.fin ?? {};
  const fin = Buffer.concat([
    u32(0x06054b50),
    u16(f.disco ?? 0),
    u16(f.discoCentral ?? 0),
    u16(f.enDisco ?? entradas.length),
    u16(f.total ?? entradas.length),
    u32(f.tamCentral ?? central.length),
    u32(f.inicioCentral ?? desplazamiento),
    u16(comentario.length),
    comentario,
  ]);
  return new Uint8Array(Buffer.concat([...locales, central, fin]));
}

/** El ZIP como lo entrega Correos de México: un solo `CPdescarga.txt`. */
export const zipOficial = (datos: Uint8Array = txt()): Uint8Array =>
  crearZip([{ nombre: "CPdescarga.txt", datos }]);

export interface OpcionesPagina {
  /** Campos ocultos además de los de ASP.NET. */
  ocultos?: Record<string, string>;
  /** Quita uno de los controles del formulario. */
  sin?: "cboEdo" | "rblTipo" | "btnDescarga" | "__VIEWSTATE";
  accion?: string;
  extra?: string;
}

/** Página del formulario con la forma de la real: campos ocultos, estados, formatos y botón. */
export function pagina(opciones: OpcionesPagina = {}): string {
  const ocultos: Record<string, string> = {
    __VIEWSTATE: "/wEPDwUINzcwOTQyOTgPZBYCAgEPZBYCAgEPZBYGAgEPDxYCHgRUZXh0+/=",
    __VIEWSTATEGENERATOR: "BE1A6D2E",
    __EVENTVALIDATION: "/wEWJwLdqZ3eDwLWk4iCCgLWk4SCCgLW&amp;k4CCCg==",
    ...opciones.ocultos,
  };
  if (opciones.sin === "__VIEWSTATE") delete ocultos.__VIEWSTATE;
  const campos = Object.entries(ocultos)
    .map(([n, v]) => `<input type="hidden" name="${n}" id="${n}" value="${v}" />`)
    .join("\n");
  const estados =
    opciones.sin === "cboEdo"
      ? ""
      : `<select name="cboEdo" id="cboEdo" tabindex="1" class="cbo">
		<option selected="selected" value="00">---------- T  o  d  o  s ----------</option>
		<option value="01">Aguascalientes</option>
		<option value="09">Ciudad de M&#233;xico</option>
	</select>`;
  const tipos =
    opciones.sin === "rblTipo"
      ? ""
      : `<span id="rblTipo" class="lbl"><input id="rblTipo_0" type="radio" name="rblTipo" value="xls" checked="checked" /><label for="rblTipo_0">EXCEL</label><br /><input id="rblTipo_1" type="radio" name="rblTipo" value="txt" /><label for="rblTipo_1">TXT</label><br /><input id="rblTipo_2" type="radio" name="rblTipo" value="xml" /><label for="rblTipo_2">XML</label></span>`;
  const boton =
    opciones.sin === "btnDescarga"
      ? ""
      : `<input type="image" name="btnDescarga" id="btnDescarga" title="De clic para Descargar los Códigos Postales" src="imagenes/btnDescarga.jpg" border="0" />`;
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html>
<head><title>Descarga de Códigos Postales</title></head>
<body ms_positioning="GridLayout">
    <form name="Form1" method="post" action="${opciones.accion ?? "CodigoPostal_Exportar.aspx"}" id="Form1">
${campos}
<span id="lblfec" class="lblback">Última Actualización de Información: Octubre 17 de 2026</span>
${estados}
${tipos}
${boton}
${opciones.extra ?? ""}
    </form>
</body>
</html>`;
}

/** La página en ISO-8859-1, como la sirve Correos de México. */
export const paginaEnBytes = (html: string = pagina()): Uint8Array =>
  new Uint8Array(Buffer.from(html, "latin1"));

export interface Llamada {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface RespuestaFalsa {
  status?: number;
  cuerpo?: Uint8Array | string;
  headers?: Record<string, string>;
}

/**
 * Un fetch que responde la página al GET y el ZIP al POST (o lo que se le pida) y guarda las
 * llamadas. Una respuesta `Error` se lanza como un fallo de red.
 */
export function fetchFalso(
  respuestas: { get?: RespuestaFalsa | Error; post?: RespuestaFalsa | Error } = {},
) {
  const llamadas: Llamada[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<Response> => {
    llamadas.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r =
      init.method === "GET"
        ? (respuestas.get ?? { cuerpo: paginaEnBytes() })
        : (respuestas.post ?? { cuerpo: zipOficial() });
    if (r instanceof Error) throw r;
    const cuerpo = typeof r.cuerpo === "string" ? Buffer.from(r.cuerpo, "latin1") : r.cuerpo;
    return new Response(cuerpo === undefined ? null : new Uint8Array(cuerpo), {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  };
  return { fetch, llamadas };
}
