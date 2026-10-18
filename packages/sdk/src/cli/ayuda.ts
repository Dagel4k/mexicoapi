// Textos de ayuda de la CLI.
const OPCIONES_GLOBALES = `Opciones:
  --json                 imprime el resultado completo como JSON (los errores, por stderr)
  --depurar              muestra el detalle técnico de un error
  --base <url>           origen de la API para dias-habiles, uma, salario-minimo e isr
  -h, --help             muestra esta ayuda
  -v, --version          muestra la versión`;

export const AYUDA = `mexicoapi: validadores y datos oficiales de México

Uso: mexicoapi <comando> [argumentos] [opciones]

Comandos:
  clabe <valor>          valida una CLABE y su banco
  rfc <valor>            valida un RFC
  curp <valor>           valida una CURP
  nss <valor>            valida un número de seguridad social
  dias-habiles           suma días hábiles a una fecha (LFT, CNBV o SAT)
  municipio <valor>      busca un municipio por clave (cvegeo) o por nombre
  banco <codigo>         consulta un banco por los 3 dígitos de la CLABE
  uma <anio>             UMA de un año (o la vigente en una fecha con --fecha)
  salario-minimo <anio>  salario mínimo de un año, por zona
  isr <periodo> <anio>   tarifa de ISR mensual o anual de un año
  sepomex <subcomando>   catálogo de códigos postales en este equipo

${OPCIONES_GLOBALES}

Sin red todo sale de los datos que trae el paquete. Con --base <url> (o la variable
MEXICOAPI_BASE) dias-habiles, uma, salario-minimo e isr consultan primero la API y, si no
responde, usan el paquete y lo avisan. municipio y banco salen siempre del paquete.

Códigos de salida:
  0   todo bien
  1   dato o resultado inválido (una CLABE con mal dígito, un banco o un año que no
      existe) o error al ejecutar
  2   uso incorrecto: comando desconocido, falta un argumento u opción (--autoridad
      sat sin --tipo-plazo) o tiene un valor mal formado (--dias x, sepomex cp 8000)

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
  "dias-habiles": `Uso: mexicoapi dias-habiles --desde AAAA-MM-DD --dias N [--autoridad lft|cnbv|sat]
                             [--tipo-plazo general|declaraciones_pagos] [--json]

Suma N días hábiles (de 1 a 3650) a una fecha con el calendario de la autoridad: la LFT (Ley
Federal del Trabajo, por omisión), la CNBV o el SAT. Con el SAT, --tipo-plazo es obligatorio
(sin él sale con 2): en declaraciones_pagos sus vacaciones cuentan como hábiles (CFF art. 12).
Fuera de la cobertura del calendario sale con 1.

Opciones:
  --desde AAAA-MM-DD   fecha de partida
  --dias N             días hábiles a sumar
  --autoridad <a>      lft, cnbv o sat
  --tipo-plazo <t>     general o declaraciones_pagos (solo con sat)
${BASE}

Ejemplos:
  mexicoapi dias-habiles --desde 2026-03-16 --dias 5
  mexicoapi dias-habiles --autoridad sat --tipo-plazo general --desde 2026-07-17 --dias 3`,
  uma: `Uso: mexicoapi uma <anio> [--json]
       mexicoapi uma --fecha AAAA-MM-DD [--json]

La UMA (unidad de medida y actualización) de un año, o la vigente en una fecha: cada una rige
del 1 de febrero al 31 de enero siguiente. Sale con 1 si el año no está en los datos.

Opciones:
  --fecha AAAA-MM-DD   la UMA vigente ese día
${BASE}

Ejemplo: mexicoapi uma 2026`,
  "salario-minimo": `Uso: mexicoapi salario-minimo <anio> [--json]

El salario mínimo de un año, en pesos diarios, para la zona general y la Zona Libre de la
Frontera Norte. Sale con 1 si el año no está en los datos.

Opciones:
${BASE}

Ejemplo: mexicoapi salario-minimo 2026`,
  isr: `Uso: mexicoapi isr <mensual|anual> <anio> [--json]

La tarifa de ISR de un año, con sus tramos. Sale con 1 si esa tarifa no está en los datos.

Opciones:
${BASE}

Ejemplo: mexicoapi isr mensual 2026`,
  municipio: `Uso: mexicoapi municipio <cvegeo|texto> [--json]

Con una clave de 5 dígitos (25006) muestra ese municipio. Con otro texto busca por nombre sin
distinguir mayúsculas ni acentos. Sale siempre de los datos del paquete, sin red, aunque haya
--base o MEXICOAPI_BASE. Sale con 1 si no hay resultados.

Ejemplo: mexicoapi municipio culiacan`,
  banco: `Uso: mexicoapi banco <codigo> [--json]

Consulta un banco por los 3 dígitos con los que empieza la CLABE. Sale con 1 si no existe.
Sale siempre de los datos del paquete, sin red, aunque haya --base o MEXICOAPI_BASE; la lista
de la API está más al día (Banxico la cambia) y se pide con el cliente y { fuente: "api" }.

Ejemplo: mexicoapi banco 002`,
  sepomex: `Uso: mexicoapi sepomex <subcomando>

Catálogo de códigos postales de Correos de México (SEPOMEX), en este equipo. Los datos no
vienen de MéxicoAPI: se descargan desde aquí, se guardan solo aquí y sync muestra antes el
aviso de uso de Correos de México. Si node:sqlite no carga, se guarda solo en JSON, sin SQLite.

Subcomandos:
  sync             descarga el catálogo del formulario público de Correos de México
  importar <ruta>  importa el ZIP o TXT que descargaste a mano
  cp <cp>          consulta un código postal de 5 dígitos
  resumen          muestra qué catálogo hay guardado`,
  "sepomex sync": `Uso: mexicoapi sepomex sync [--json]

Descarga el catálogo completo (puede tardar y usa unos 340 MB de memoria un momento). Si el
sitio bloquea la descarga automática no se intenta evadir: descarga el archivo a mano y usa
mexicoapi sepomex importar <ruta>. El aviso va a la salida de errores.`,
  "sepomex importar": `Uso: mexicoapi sepomex importar <ruta> [--json]

Importa el ZIP o el TXT (estado "Todos") descargado a mano de la página de Correos de México,
con las mismas revisiones que sync.`,
  "sepomex cp": `Uso: mexicoapi sepomex cp <cp> [--json]

Consulta un código postal de 5 dígitos en el catálogo guardado. Sale con 1 si no existe o si
todavía no hay catálogo, y con 2 si no son 5 dígitos.

Ejemplo: mexicoapi sepomex cp 80000`,
  "sepomex resumen": `Uso: mexicoapi sepomex resumen [--json]

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
