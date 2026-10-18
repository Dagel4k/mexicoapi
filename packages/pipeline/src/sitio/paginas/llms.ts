import { posix } from "node:path";
import { URL_ARCHIVOS, URL_DOCS } from "../meta.js";
import { describir } from "./catalogo.js";
import { PUBLICADO_EN_NPM } from "./inicio.js";

/**
 * `llms.txt` (formato de llmstxt.org) y `llms-full.txt`: lo que una herramienta que lee esos
 * archivos necesita para consultar la API sin inventar datos.
 */

/** Lo que `llms.txt` dice de cada dataset; sale de su manifiesto, como en la página de inicio. */
export interface DatasetLlms {
  id: string;
  directorio: string;
  as_of: string;
  docs: string;
}

/** Un archivo de Markdown del repositorio, con su ruta desde la raíz (`docs/api/README.md`). */
export interface DocumentoMarkdown {
  ruta: string;
  texto: string;
}

/** Caracteres de control: un salto de renglón en un dato abriría otro renglón o un encabezado. */
const CONTROL = /\p{Cc}/gu;

/** Texto de datos en Markdown: en un solo renglón y sin abrir enlaces, código ni énfasis. */
const textoMd = (texto: string): string =>
  texto.replace(CONTROL, " ").replace(/[\\`*_[\]()<>]/g, (c) => `\\${c}`);

/** Entre comillas invertidas si se puede; si no, como texto escapado. */
const codigoMd = (texto: string): string =>
  /[`\p{Cc}]/u.test(texto) ? textoMd(texto) : `\`${texto}\``;

/** Solo una URL `https://` sin espacios, controles ni paréntesis entra como destino de un enlace. */
const destinoSeguro = (url: string): boolean =>
  url.startsWith("https://") && !/[\s\p{Cc}()<>]/u.test(url) && URL.canParse(url);

const enlaceMd = (url: string, texto: string): string =>
  destinoSeguro(url) ? `[${textoMd(texto)}](${url})` : textoMd(texto);

function renglonDataset(d: DatasetLlms): string {
  const { nombre, ruta } = describir(d.id);
  const api =
    ruta === null ? "sin ruta propia en la API; está en las descargas" : `\`GET ${ruta}\``;
  return `- ${enlaceMd(d.docs, nombre)}: ${codigoMd(d.id)}, as_of ${textoMd(d.as_of)}, ${api}`;
}

function paquetes(publicado: boolean): string {
  return publicado
    ? "También hay un paquete de npm con validadores, los mismos datos sin red y un cliente de la API (`npm install mexicoapi`), y un servidor MCP por stdio con los mismos datos y validadores como herramientas (`npx -y mexicoapi-mcp`)."
    : "El paquete de npm `mexicoapi` (validadores y los mismos datos sin red) y el servidor MCP `mexicoapi-mcp` todavía no están publicados en npm; mientras tanto, usa la API.";
}

/** `llms.txt`: qué es, cómo se consulta, la documentación y una línea por dataset. */
export function archivoLlms(
  datasets: readonly DatasetLlms[],
  publicado: boolean = PUBLICADO_EN_NPM,
): string {
  return `# MéxicoAPI

> Datos de referencia de México con fuente oficial, licencia y sha256: catálogos, indicadores, calendarios y constantes, en una API JSON de solo lectura y en descargas completas en JSON, CSV y SQLite.

La API no pide llave ni cuenta y vive en \`/v1\`, en el mismo origen que este archivo; \`GET /v1\` responde un índice en JSON. Los ejemplos de la documentación usan \`https://<base>\`: cámbialo por ese origen. Las rutas de datos responden \`{ "data": …, "meta": … }\`: \`meta\` trae \`dataset\`, \`as_of\`, \`sources\` (nombre, URL, licencia y cita de cada fuente oficial) y \`docs\`. Los errores responden \`application/problem+json\`. La API también valida CLABE y suma días hábiles; esas rutas están en la referencia.

Si la API responde 404 \`dato-no-disponible\` o 422 \`calendario-incompleto\`, ese dato todavía no está cargado: no lo inventes ni lo estimes. Dilo así y remite a la fuente oficial que nombra la documentación del dataset.

${paquetes(publicado)}

## Docs

- [Referencia de la API](${URL_DOCS}/api/README.md): rutas, parámetros, ejemplos de respuesta, caché, CORS y límite de peticiones
- [Errores](${URL_DOCS}/api/problemas.md): cada tipo de \`application/problem+json\` y qué significa
- [OpenAPI](/v1/openapi.json): especificación OpenAPI 3.1 de todas las rutas
- [Documentación completa](/llms-full.txt): la referencia, los errores y la documentación de cada dataset en un solo archivo

## Datos

${datasets.map(renglonDataset).join("\n")}

## Optional

- [Descargas](/descargas/SHA256SUMS): cada dataset en JSON y CSV, todo junto en \`/descargas/mexicoapi.sqlite\`; SHA256SUMS trae el sha256 de cada archivo
- [Diseño técnico](${URL_DOCS}/diseno/arquitectura-v1.md): arquitectura, fuentes, pipeline de datos y decisiones
- [Seguridad](${URL_ARCHIVOS}/SECURITY.md): cómo reportar una vulnerabilidad
`;
}

/** El destino de cada enlace en línea: `](destino` hasta un espacio o `)`. */
const ENLACE = /\]\(([^)\s]*)/g;

/** `https:`, `mailto:`: un destino con esquema ya es absoluto. */
const CON_ESQUEMA = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Cambia cada enlace relativo de un Markdown del repositorio por su URL en GitHub, resuelto contra
 * la carpeta del archivo (`/` es la raíz del repositorio, como en GitHub). Los absolutos y las
 * anclas de la misma página quedan igual.
 */
export function enlacesAbsolutos(ruta: string, texto: string): string {
  return texto.replace(ENLACE, (enlace, destino: string) => {
    if (destino.startsWith("#") || CON_ESQUEMA.test(destino)) return enlace;
    if (destino === "") throw new Error(`${ruta}: un enlace no tiene destino`);
    const ancla = destino.indexOf("#");
    const camino = ancla === -1 ? destino : destino.slice(0, ancla);
    const fragmento = ancla === -1 ? "" : destino.slice(ancla);
    const resuelta = camino.startsWith("/")
      ? posix.normalize(camino.slice(1))
      : posix.join(posix.dirname(ruta), camino);
    if (resuelta === ".." || resuelta.startsWith("../")) {
      throw new Error(`${ruta}: el enlace ${destino} sale del repositorio`);
    }
    return `](${URL_ARCHIVOS}/${resuelta}${fragmento}`;
  });
}

/** Orden por unidades de código UTF-16, igual que el resto del build. */
const porNombre = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Lo que junta `llms-full.txt`: la referencia, los errores y la doc de cada dataset por nombre. */
export function ordenLlmsCompleto(docsDeDatos: readonly string[]): string[] {
  return [
    "docs/api/README.md",
    "docs/api/problemas.md",
    ...[...docsDeDatos].sort(porNombre).map((nombre) => `docs/datos/${nombre}`),
  ];
}

/** `llms-full.txt`: cada archivo precedido de `# <ruta>`, con los enlaces absolutos. */
export function archivoLlmsCompleto(documentos: readonly DocumentoMarkdown[]): string {
  const partes = documentos.map(({ ruta, texto }) => {
    const limpio = texto.replace(/\r\n/g, "\n").trimEnd();
    return `# ${ruta}\n\n${enlacesAbsolutos(ruta, limpio)}\n`;
  });
  return partes.join("\n");
}
