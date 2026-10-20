# Cambios

## 0.2.0 (sin publicar)

Cambios de comportamiento. Revisa tu código si usas lo que nombran:

- `diasHabiles` del cliente revisa `tipoPlazo` antes de ir a la red o al paquete: con el SAT sin él, con otra autoridad y con él, o con un valor que no es `general` ni `declaraciones_pagos`, lanza `TypeError` (que nombra `tipoPlazo`) en lugar de `MexicoApiError`. `consultar("/v1/dias-habiles", …)` sigue dando el `MexicoApiError` de la API, con `tipo_plazo`.
- Las `advertencias` de primer nivel del cliente traen también las del cálculo (`data.advertencias` de `diasHabiles`), al final y sin repetidos; `data.advertencias` no cambia. Si las juntabas a mano (`[...advertencias, ...data.advertencias]`), tendrás repetidas: usa solo `advertencias`.
- `sumarDiasHabiles` con `calendario("sat", "general")` y `permitirIncompleto: true` sigue con el respaldo del plazo, como la API: del 2026-12-23, 2 días hábiles dan el 2026-12-28 (antes, el 25, inhábil por el art. 12), con la advertencia de la API.
- Cada validador tiene su propia `nota`: la de la CLABE ya no nombra al SAT, RENAPO ni el IMSS y, sin catálogo de bancos, dice que no revisó el banco. `NOTA_VALIDACION` sigue exportada, pero ningún validador la usa y queda obsoleta: usa `NOTAS_VALIDACION`.
- `fixUltimo()` respondido con los datos del paquete (sin red, con `fuente: "paquete"` o de respaldo) trae siempre la advertencia `AVISO_SIN_API`: pueden faltar publicaciones recientes.
- Con el SAT y `declaraciones_pagos`, advertencia nueva cuando el resultado cae fuera de las vacaciones publicadas: ese día podría ser de vacaciones y aplicaría la prórroga del art. 12. El resultado no cambia.
- Los días de la LFT anteriores al 2024-10-01 (`diasDescansoLft`, `calendarioLft` y el cliente) citan el texto del art. 74 vigente entonces, el de la reforma del DOF 17-01-2006 (fracción VII: "1o. de diciembre"), con su `fecha_publicacion`; antes citaban el texto actual. Las fechas no cambian.
- El cliente ya no sigue redirecciones. Pide con `redirect: "manual"` (también el `InitFetch` que recibe un `fetch` propio) y una 3xx de la API, salvo 304, es un `MexicoApiError` "Respuesta inesperada de la API" con su estado HTTP (estado 0 si el navegador da una redirección opaca), sin reintentos; en las rutas que caducan responde el paquete con la advertencia de respaldo. Antes `fetch` seguía la redirección.
- El cliente lee el cuerpo de la respuesta con un tope de 8 MB y revisa que `data` sea una lista o un objeto según la ruta: lo que no cumple también es "Respuesta inesperada de la API". `RespuestaFetch` acepta `body` (un `ReadableStream`, para leer por partes) y `type`.
- CLI: `MEXICOAPI_SIN_RED` acepta `1`, `true`, `yes`, `si` u `on` para no usar la red y `0`, `false`, `no`, `off` o vacía para consultar la API, sin distinguir mayúsculas, como el servidor MCP. Antes solo `1` apagaba la red y cualquier otro valor la dejaba encendida; ahora otro valor es un error de configuración (sale con 2, sin el recordatorio de `--help`) en los comandos que usan el cliente, aunque haya `--base`.
- CLI: `dias-habiles` exige `--autoridad` (`lft`, `cnbv` o `sat`), como la API y el servidor MCP; sin ella sale con 2. Antes usaba la LFT si no se daba. Si tus scripts la omitían, agrega `--autoridad lft` para el mismo resultado.
- CLI: un error de uso (código 2) termina con la ayuda de su comando, `Usa mexicoapi dias-habiles --help para ver su uso.` (o `mexicoapi sepomex cp --help`); solo sin comando, o con uno que no existe, con `Usa mexicoapi --help para ver los comandos.` Antes siempre con la general.
- Textos más claros: el 422 del SAT `general` fuera de su cobertura sugiere `permitir_incompleto=true` y nombra `declaraciones_pagos` solo para plazos de declaraciones o pagos; el 404 del FIX con `publicado` en un día sin publicación sugiere `operacion`. La CLI muestra esos errores con sus opciones (`--tipo-plazo`, `--permitir-incompleto`) y rechaza con su nombre un `--tipo-plazo` que no existe.
- `validarCurp`: la posición 17 (el diferenciador) solo acepta un dígito o una letra de la A a la J, como dice el Instructivo Normativo de la CURP (DOF 18-06-2018). Con una letra de la K a la Z da `valido: false` y `errores: ["estructura"]`; antes se aceptaba cualquier letra.
- `crearCliente` lanza `TypeError` con una `base` `http://` que no sea `localhost`, `127.0.0.1` o `[::1]`, con puerto o sin él; para otro host, usa `https://`. La CLI da el mismo error con `--base` o `MEXICOAPI_BASE` así, salvo en los comandos que no usan el cliente (los validadores, `sepomex` y `municipio` con un nombre) o, con `MEXICOAPI_BASE`, sin red (`MEXICOAPI_SIN_RED`). Sale con 2, como un error de configuración.
- `TipoProblema` (de `mexicoapi` y `mexicoapi/cliente`) y `PROBLEMAS` (de `mexicoapi/cliente`) suman el tipo `https-requerido`: la API responde 403 con él a una petición por `http://` a un host que no es local. Un `switch` exhaustivo sobre `TipoProblema` tiene un caso más.

Nuevo:

- `banco_revisado` en el resultado de `validarClabe` (`false` si no se pasa el catálogo de bancos; `bancos: null` cuenta como no pasarlo, como en la 0.1.0) y en `clabe()` del cliente (siempre `true`, como la API). Tipo `ResultadoValidacionClabe`.
- CLI: `fix [--operacion AAAA-MM-DD | --publicado AAAA-MM-DD]` (sin opciones, la publicación más reciente) y `udi <AAAA-MM-DD>`, con la fuente, el pie de origen y `--json` (la respuesta del cliente, con los `avisos`). Como los demás datos que caducan, consultan la API y, si no responde, usan el paquete y lo avisan. Un error de la API que sugiere `operacion=` se muestra con `--operacion`.
- CLI: `estados` (las 32 entidades con su clave y abreviatura) y `municipios <cve_ent>` (todos los municipios de un estado, con el total), del paquete y sin red, en texto y con `--json`. `municipio 25`, que busca por nombre y no encuentra nada, sugiere `mexicoapi municipios 25`.
- `hoyEnMexico()`: la fecha de hoy en la Ciudad de México, la zona de todas las fechas de MéxicoAPI.
- `NOTAS_VALIDACION`, `AVISO_SIN_API`, el tipo `RespaldoCalendario` y `Calendario.respaldo`.
- `avisos` junto a cada `advertencias`: las mismas, en el mismo orden, como `{ codigo, texto }`, con un código estable para decidir sin leer el texto. Están en las respuestas del cliente (y en `data.avisos` de `diasHabiles`), en el resultado de `sumarDiasHabiles` (campo nuevo de `ResultadoDiasHabiles`) y en `resumen()` de `mexicoapi/sepomex`. `CODIGOS_AVISO` y `codigoAviso()` dan el catálogo y el código de un texto; tipos `Aviso` y `CodigoAviso`. Si la API manda el código de un aviso, el cliente lo conserva; si no, lo saca del texto. Los códigos del cliente y de SEPOMEX: `api-fallo`, `respuesta-guardada`, `datos-viejos`, `datos-del-paquete`, `municipio-sin-inegi`, `cp-varios-municipios` y `aviso-de-uso-sepomex-distinto`.

Correcciones:

- Caché del cliente: descuenta de `max-age` y de la ventana de `stale-if-error` la edad con la que llega la respuesta (`Age`), así que una respuesta que pasó por otra caché no se usa más tiempo del que permite la API. No guarda las respuestas `no-cache`, y una respuesta `no-store` o `no-cache` deja sin usar lo que había guardado de esa consulta, también para `stale-if-error`.
- El aviso `transmision-poder-ejecutivo` (SAT, 2030 y cada seis años) solo sale por el 1o. de octubre o el 1o. de diciembre que caen de lunes a viernes, y su texto nombra solo esos. En 2030 un cálculo que cruza el 1o. de diciembre, que es domingo, ya no lo trae, y el texto dice "no se descuenta el 1o. de octubre". `codigoAviso` reconoce el texto nuevo y el anterior.
- El `detail` del error por un parámetro desconocido da el nombre tal cual solo si tiene letras sin acento (A-Z, a-z), dígitos, `_`, `.` o `-`. Si no, lo da entre comillas y con lo invisible escapado (por ejemplo, `​`): controles, caracteres de formato, separadores de línea y los que se ignoran por omisión (`\p{Default_Ignorable_Code_Point}`). La API, el cliente sin red y el servidor MCP dan el mismo texto.

## 0.1.0 (2026-10-18)

Primera versión.

- Validadores de CLABE, RFC, CURP y NSS, con dígito de control.
- Días hábiles con los calendarios de la LFT, la CNBV y el SAT.
- Tipo de cambio FIX, UDIS, UMA, salario mínimo y tarifas de ISR, cada dato con su fuente oficial.
- Estados, municipios y bancos del catálogo oficial.
- Cliente de la API de MéxicoAPI (por omisión, la pública: `URL_API`) que usa los datos del paquete si la API no responde, o sin red con `offline: true`.
- Herramienta para descargar en tu equipo el catálogo de códigos postales de SEPOMEX (`mexicoapi/sepomex`).
- CLI `mexicoapi` y tipos incluidos, sin dependencias.
