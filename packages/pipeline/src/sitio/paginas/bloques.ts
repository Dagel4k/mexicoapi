// Lo que comparten las páginas del sitio: tamaños, fechas, rutas partibles y los bloques de los
// ejemplos de la API.
import { URL_API } from "@mexicoapi/core/problemas";
import { escaparHtml } from "./html.js";

/** "2026", "2026 y 2027", "2027, 2028 y 2029". */
export const enTexto = (numeros: readonly number[]): string =>
  numeros.length < 2 ? numeros.join("") : `${numeros.slice(0, -1).join(", ")} y ${numeros.at(-1)}`;

const UNIDADES = ["KB", "MB", "GB"] as const;

/** Tamaño en unidades de 1024, con un decimal por debajo de 10: `512 B`, `1.5 KB`, `300 MB`. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let valor = bytes / 1024;
  let unidad = 0;
  // Lo que redondearía a 1024 pasa a la unidad siguiente.
  while (valor >= 1023.5 && unidad < UNIDADES.length - 1) {
    valor /= 1024;
    unidad += 1;
  }
  const numero = valor < 9.95 ? valor.toFixed(1) : String(Math.round(valor));
  return `${numero} ${UNIDADES[unidad]}`;
}

/** Miles con coma, como se escriben en México. */
export const formatearEntero = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * La base de los ejemplos, en una variable de shell: la API pública, que es la que funciona sin
 * JavaScript. `sitio.js` la cambia por el origen de la página, que sirve la misma API (otro
 * despliegue o `wrangler dev`). Cada `curl` usa `$API`, así que su renglón cabe en una columna
 * angosta; si `API=` no cabe, `<wbr>` lo parte antes de la URL y no a media URL.
 */
export const VARIABLE_API = `API=<wbr><span data-origen>${escaparHtml(URL_API)}</span>`;

/**
 * La línea para PowerShell (5.1 y 7) que va debajo de un bloque de bash: la variable se asigna
 * con espacios y comillas, y `curl` es un alias de Invoke-WebRequest en la 5.1, así que el
 * comando es `curl.exe` (viene con Windows 10 y posteriores), con la URL entre comillas para que
 * PowerShell sustituya `$API`. El origen también lo rellena `sitio.js`.
 */
export const enPowerShell = (comando: string, despues = ""): string =>
  `<p>En PowerShell: <code>$API = &quot;<span data-origen>${escaparHtml(URL_API)}</span>&quot;</code> y <code>${escaparHtml(comando)}</code>${despues}.</p>`;

/** Sin tabindex: con pre-wrap no se desplaza, y Tab no tiene por qué detenerse en él. */
export const codigo = (texto: string): string => `<pre><code>${escaparHtml(texto)}</code></pre>`;

/** Una fecha `AAAA-MM-DD` en `<time>`, tal cual. */
export const tiempo = (fecha: string): string => {
  const texto = escaparHtml(fecha);
  return `<time datetime="${texto}">${texto}</time>`;
};

/**
 * La ruta escapada, con `<wbr>` después de cada `/` (salvo la inicial) y antes de `?` y `&`: donde
 * la columna es angosta se parte ahí y no a media palabra. No cambia lo que se copia.
 */
export const rutaPartible = (ruta: string): string =>
  ruta
    .split(/(?<=.\/)|(?=[?&])/)
    .map(escaparHtml)
    .join("<wbr>");
