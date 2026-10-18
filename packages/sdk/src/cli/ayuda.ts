// Textos de ayuda de la CLI.
const OPCIONES_GLOBALES = `Opciones:
  --json       imprime el resultado completo como JSON
  --depurar    muestra el detalle técnico de un error
  -h, --help   muestra esta ayuda
  -v, --version  muestra la versión`;

export const AYUDA = `mexicoapi: validadores y datos oficiales de México

Uso: mexicoapi <comando> [argumentos] [opciones]

Comandos:
  clabe <valor>        valida una CLABE y su banco
  rfc <valor>          valida un RFC
  curp <valor>         valida una CURP
  nss <valor>          valida un número de seguridad social
  dias-habiles         suma días hábiles a una fecha
  municipio <valor>    busca un municipio por clave (cvegeo) o por nombre
  banco <codigo>       consulta un banco por los 3 dígitos de la CLABE
  sepomex <subcomando> catálogo de códigos postales en este equipo

${OPCIONES_GLOBALES}

Sin red todo sale de los datos que trae el paquete. Con --base <url> (o la variable
MEXICOAPI_BASE) municipio, banco y dias-habiles consultan primero la API.

Códigos de salida: 0 bien; 1 dato inválido o error; 2 uso incorrecto.
Usa "mexicoapi <comando> --help" para el detalle de cada comando.`;

const validador = (comando: string, que: string, ejemplo: string): string =>
  `Uso: mexicoapi ${comando} <valor> [--json]

Valida ${que}: formato y dígito verificador, sin red. No confirma que exista ante la
institución que lo emite. Sale con 0 si es válido y con 1 si no lo es.

Ejemplo: mexicoapi ${comando} ${ejemplo}`;

const BASE = `  --base <url>   origen de la API (o la variable MEXICOAPI_BASE); sin él, solo el paquete`;

const COMANDOS: Readonly<Record<string, string>> = {
  clabe: validador(
    "clabe",
    "una CLABE y su banco con el catálogo del paquete",
    "002010077777777771",
  ),
  rfc: validador("rfc", "un RFC de persona física, moral o genérico", "XAXX010101000"),
  curp: validador("curp", "una CURP", "HEGG560427MVZRRL04"),
  nss: validador("nss", "un número de seguridad social del IMSS", "12345678903"),
  "dias-habiles": `Uso: mexicoapi dias-habiles --desde AAAA-MM-DD --dias N [--autoridad lft] [--json]

Suma N días hábiles (de 1 a 3650) a una fecha con el calendario de la autoridad. Por ahora
solo existe la LFT (Ley Federal del Trabajo), que es la opción por omisión.

Opciones:
  --desde AAAA-MM-DD  fecha de partida
  --dias N            días hábiles a sumar
  --autoridad lft     calendario a usar
${BASE}

Ejemplo: mexicoapi dias-habiles --desde 2026-03-16 --dias 5`,
  municipio: `Uso: mexicoapi municipio <cvegeo|texto> [--json]

Con una clave de 5 dígitos (25006) muestra ese municipio. Con otro texto busca por nombre sin
distinguir mayúsculas ni acentos, siempre en los datos del paquete. Sale con 1 si no hay
resultados.

Opciones:
${BASE}

Ejemplo: mexicoapi municipio culiacan`,
  banco: `Uso: mexicoapi banco <codigo> [--json]

Consulta un banco por los 3 dígitos con los que empieza la CLABE.

Opciones:
${BASE}

Ejemplo: mexicoapi banco 002`,
  sepomex: `Uso: mexicoapi sepomex <subcomando>

Catálogo de códigos postales de Correos de México (SEPOMEX), en este equipo. Los datos no
vienen de MéxicoAPI: se descargan desde aquí, se guardan solo aquí y sync muestra antes el
aviso de uso de Correos de México. Pide Node 22.13 o posterior.

Subcomandos:
  sync             descarga el catálogo del formulario público de Correos de México
  importar <ruta>  importa el ZIP o TXT que descargaste a mano
  cp <cp>          consulta un código postal de 5 dígitos
  estado           muestra qué catálogo hay guardado`,
  "sepomex sync": `Uso: mexicoapi sepomex sync [--json]

Descarga el catálogo completo (puede tardar y usa unos 340 MB de memoria un momento). Si el
sitio bloquea la descarga automática no se intenta evadir: descarga el archivo a mano y usa
mexicoapi sepomex importar <ruta>. El aviso va a la salida de errores.`,
  "sepomex importar": `Uso: mexicoapi sepomex importar <ruta> [--json]

Importa el ZIP o el TXT (estado "Todos") descargado a mano de la página de Correos de México,
con las mismas revisiones que sync.`,
  "sepomex cp": `Uso: mexicoapi sepomex cp <cp> [--json]

Consulta un código postal de 5 dígitos en el catálogo guardado. Sale con 1 si no existe o si
todavía no hay catálogo.

Ejemplo: mexicoapi sepomex cp 80000`,
  "sepomex estado": `Uso: mexicoapi sepomex estado [--json]

Muestra cuándo se guardó el catálogo y cuántos códigos postales tiene. Sale con 1 si no hay.`,
};

/** Ayuda de un comando (y de un subcomando de sepomex), o undefined si no existe. */
export function ayudaDe(comando: string | undefined, sub: string | undefined): string | undefined {
  if (comando === undefined) return undefined;
  return (
    (comando === "sepomex" && sub !== undefined ? COMANDOS[`sepomex ${sub}`] : undefined) ??
    COMANDOS[comando]
  );
}
