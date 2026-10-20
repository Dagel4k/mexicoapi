# Despliegue en Cloudflare

La API corre como un Worker de Cloudflare en el plan gratuito. Los workflows `despliegue.yml`, `frescura.yml` y el job `estado-kv` de `datos.yml` necesitan dos secretos y una variable de GitHub, y `estado-kv` usa además un token propio, solo para KV. Hasta que existan, los tres terminan en verde y solo dejan un aviso con el enlace a este documento.

Estado: configurado el 2026-10-18. Producción está en https://mexicoapi.dagel4k.workers.dev y staging en el Worker `mexicoapi-staging`; los tres secretos están en el Environment `produccion`, limitado a `main`, y la variable `API_URL` apunta a producción. Los pasos de abajo sirven para repetir la puesta en marcha en otra cuenta o para revisarla.

## Puesta en marcha

Los pasos 1 a 4 son en Cloudflare, los 5 y 6 en GitHub y el 7, el token de KV, en los dos. Los nombres de los menús pueden cambiar; si no encuentras uno, busca la pantalla que se describe.

1. Crea una cuenta de Cloudflare en el plan gratuito. No hace falta tarjeta ni dominio. Cloudflare nombra la cuenta con tu correo: cámbiale el nombre por uno neutro (Manage Account, Configurations, nombre de la cuenta), porque wrangler puede imprimir el nombre de la cuenta en un error de autenticación y los logs de Actions de un repositorio público los puede leer cualquiera.
2. Entra a Workers y Pages. La primera vez pide elegir el subdominio de `workers.dev` (por ejemplo `mi-proyecto`). Las URLs quedan como `https://mexicoapi.<subdominio>.workers.dev`. El subdominio es público, así que elígelo con cuidado.
3. Crea un token de API. En tu perfil, API Tokens, Create Token, Create Custom Token:
   - Permisos de cuenta: `Workers Scripts: Edit`, `Workers KV Storage: Edit` y `Account Settings: Read`.
   - Recursos de cuenta: solo tu cuenta (Include, Specific account).
   - Sin permisos de zona ni de usuario.
   - Fecha de expiración (por ejemplo, 12 meses) y un recordatorio en tu calendario para rotarlo.
   - Copia el token al crearlo: Cloudflare no lo vuelve a mostrar.
4. Copia el Account ID, que aparece en la barra lateral de la vista general de Workers y Pages. Son 32 caracteres hexadecimales.
5. En el repositorio de GitHub, crea el Environment `produccion` (Settings, Environments, New environment). En Deployment branches and tags elige Selected branches and tags y agrega solo `main`; no hacen falta revisores obligatorios. En ese Environment, sección Environment secrets, crea:
   - `CLOUDFLARE_API_TOKEN`: el token del paso 3.
   - `CLOUDFLARE_ACCOUNT_ID`: el ID del paso 4.

   Así solo los jobs que corren desde `main` pueden leer el token. Si los creas como secretos del repositorio (Settings, Secrets and variables, Actions, pestaña Secrets) también funcionan, pero quedan al alcance de los workflows de cualquier rama.
6. Corre el despliegue a mano desde `main`: Actions, Despliegue, Run workflow, rama `main`. Desde otra rama el job de despliegue se salta y solo deja un aviso. Cuando termine en verde, abre el resumen de la corrida, copia la URL de producción y crea en Settings, Secrets and variables, Actions, pestaña Variables, la variable de repositorio `API_URL` con esa URL, sin barra final (`https://mexicoapi.<subdominio>.workers.dev`).

7. Crea un segundo token para el job `estado-kv`, que solo escribe en KV y no necesita desplegar. En API Tokens, Create Token, Create Custom Token:
   - Permisos de cuenta: solo `Workers KV Storage: Edit`.
   - Recursos de cuenta: solo tu cuenta (Include, Specific account).
   - Sin permisos de zona ni de usuario, con fecha de expiración y un recordatorio para rotarlo, como el de despliegue.

   Guárdalo en el Environment `produccion` como `CLOUDFLARE_KV_TOKEN`. `estado-kv` solo usa ese token, nunca el de despliegue: si falta (o falta `CLOUDFLARE_ACCOUNT_ID`), deja un aviso y no escribe el estado.

Con `API_URL` definida, `frescura.yml` empieza a revisar los datos todos los días. Puedes probarla con Actions, Frescura, Run workflow. La alerta de coberturas del mismo workflow no necesita `API_URL` ni secretos: corre desde el primer día.

## Qué hace cada workflow

| Workflow | Con los secretos y la variable | Sin ellos |
| --- | --- | --- |
| `despliegue.yml` (cada merge a `main` y a mano desde `main`) | Compila, despliega a staging, corre la prueba de humo, despliega a producción, corre el humo otra vez y, si falla, revierte | Deja un aviso y termina en verde sin desplegar |
| `datos.yml`, job `estado-kv` (solo desde `main`) | Escribe en KV el estado de cada dataset, que `/v1/status` muestra, con `CLOUDFLARE_KV_TOKEN` y nunca con el token de despliegue | Sin `CLOUDFLARE_KV_TOKEN` o `CLOUDFLARE_ACCOUNT_ID`, deja un aviso y no escribe; el bot de datos funciona igual |
| `frescura.yml` (diario, 13:00 de la Ciudad de México) | Consulta `/v1/status` de `API_URL` y abre issues; además, abre un issue por cada cobertura de los datos curados que termina en 30 días o menos | Sin `API_URL`, deja un aviso y no consulta `/v1/status`; la alerta de coberturas corre igual |

### Despliegue

Solo corre desde `main`, en el Environment `produccion`.

1. Instala y compila el repositorio.
2. `cloudflare.ts configurar` busca (o crea) el namespace de KV titulado `mexicoapi-estado`, genera la configuración del entorno (con el bloque `assets` de `wrangler.jsonc` completo) y devuelve la URL de `workers.dev`. En staging, además, copia `public/` en `public-staging/` con `X-Robots-Tag: noindex` en la regla `/*` del `_headers`, apunta `assets.directory` a esa copia y define la var `X_ROBOTS_TAG`, con la que el Worker manda el mismo encabezado: los buscadores no indexan staging. Producción usa `public/` sin cambios y no lleva ese encabezado.
3. Despliega el Worker `mexicoapi-staging`.
4. Corre `humo.ts` contra staging: las rutas principales de `/v1`, `SHA256SUMS`, la página de inicio, `/llms.txt` y `/v2`, que debe ser el 404 en HTML de los assets y no un 404 del Worker. En cada respuesta revisa `Strict-Transport-Security` y que `Vary` nombre `Accept-Encoding`; pide además `/v1/estados` por `http://`, que debe dar 403 `https-requerido` sin redirigir, y con `--robots noindex` exige `X-Robots-Tag: noindex` en todas las respuestas. Un Worker recién desplegado tarda en propagarse, así que hace hasta 5 intentos, con esperas de 10, 20, 30 y 60 segundos entre ellos.
5. Repite lo mismo con el Worker `mexicoapi` (producción), con `--robots ninguno`: `/` y `/v1` no deben traer `X-Robots-Tag`. Si staging falla, producción no se toca. El humo de producción corre solo si la versión llegó a subirse, aunque el paso de despliegue fallara después; si falló antes de subirla, producción no cambió, no hay humo ni reversión y la corrida queda en rojo.
6. Si el humo de producción falla, corre `wrangler rollback --yes` y deja la corrida en rojo. En el primer despliegue no hay versión anterior: la reversión falla, producción se queda con ese commit y el resumen lo dice.
7. Escribe un resumen con el commit, las URLs, los IDs de versión, si se revirtió y la salida del humo.

Staging y producción comparten el namespace de KV: el estado es del pipeline de datos, no del entorno. Los dos tienen límite de peticiones en lo que pasa por el Worker (`/v1`): 600 por minuto por IP (las IPv6 cuentan por /64) y por ubicación de Cloudflare. Pasado el límite responden 429; quien necesite más volumen debe usar las descargas completas, que se sirven como archivos estáticos y no pasan por ese límite.

`apps/api/wrangler.jsonc` es la base de las dos configuraciones y se llama `mexicoapi-local`: un `wrangler deploy` a mano con ese archivo crea un Worker aparte, sin KV ni límite de peticiones, y no toca staging ni producción.

### Sitio y 404

El mismo despliegue publica el sitio que genera el build (`/`, `/estado/`, `/llms.txt`, `/llms-full.txt`, la hoja de estilo y `sitio.js`) como assets estáticos, con los encabezados de cada ruta en `public/_headers`. El Worker corre primero solo en `/v1` y `/v1/*` (`run_worker_first`); lo demás lo atienden los assets:

- Una dirección fuera de `/v1` que no es un asset (`/wp-admin`, `/v2`, `/descargas/nada`) responde 404 con `404.html` (`not_found_handling: "404-page"` en `wrangler.jsonc`). Como `run_worker_first` es una lista de rutas, esa regla vale para cualquier cliente y no solo para navegadores.
- Un método distinto de GET o HEAD fuera de `/v1` (un `POST /`) responde 405 desde los assets.
- Dentro de `/v1`, una ruta que no existe sigue siendo un 404 problem+json del Worker.

Nada de eso invoca al Worker: los rastreadores que prueban rutas al azar no gastan la cuota diaria ni el límite por IP. Si un despliegue pierde `not_found_handling`, esas direcciones vuelven a llegar al Worker y el humo falla en `/v2`.

`_headers` tiene una regla `/*` con `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000` y `Vary: Accept-Encoding`, que alcanza a todo lo que sirven los assets (también el 404 y las redirecciones), y una regla por archivo con su CSP, su caché y, en las descargas, CORS. Un 404 solo recibe la de `/*` y lleva su CSP en `<meta>`. Las respuestas del Worker en `/v1` no reciben estas reglas: llevan sus propios encabezados.

### Frescura

Lee `/v1/status` con `GITHUB_TOKEN`, sin secretos de Cloudflare.

- Un dataset desactualizado abre o comenta el issue `Datos desactualizados: <dataset>`; cuando vuelve a estar al día, el issue se cierra solo.
- Un estado `unknown` no cuenta como desactualizado: significa que KV aún no tiene estado para ese dataset. Pasa hasta la primera corrida de `datos.yml` con los secretos.
- Si `/v1/status` no responde o no devuelve un estado válido, abre o comenta `API sin respuesta` y la corrida queda en rojo, en lugar de abrir un issue por dataset.

Además, sin `API_URL` ni secretos, revisa en `data/` hasta cuándo cubren los datos curados: cada tipo de plazo de los calendarios de la CNBV y el SAT, la vigencia de la última UMA y el último año del salario mínimo y de las tarifas de ISR (el comando `coberturas` del pipeline).

- Por cada cobertura que termina en 30 días o menos, o que ya terminó, abre un issue `Cobertura por vencer: <cobertura>` con el procedimiento de [datos-curados.md](datos-curados.md). Si ya hay uno abierto, reescribe su descripción con los días que faltan, sin comentar cada día.
- Nunca cierra uno de estos issues: se cierra a mano al integrar el PR con la publicación nueva.
- Va en dos jobs: el que instala y corre el pipeline solo puede leer el repositorio, y el que abre los issues solo puede escribir issues y no instala nada.

### Estado en KV

El job `estado-kv` de `datos.yml` guarda `estado:<dataset>` con la última corrida. Va aparte de los jobs que generan y publican los datos: recibe el resumen de la corrida como artefacto, no instala dependencias y es el único que ve un token de Cloudflare. Usa solo `CLOUDFLARE_KV_TOKEN`, que solo puede escribir en KV; si ese secreto o `CLOUDFLARE_ACCOUNT_ID` no existen, deja un aviso y no escribe nada. Si falla, deja una advertencia y no cambia el resultado de la corrida de datos.

`last_success` avanza con `sin_cambios` siempre y con `actualizado` solo si la corrida publicó el cambio: el paso "Publicar resultado" del job `publicar` terminó bien y la corrida salió con código 0. Sin cambios y con código 0, `publicar` no corre, y no hace falta: todos los datasets quedaron `sin_cambios`. Con código 3 el PR lleva la etiqueta `revisar` y no se fusiona solo, así que ni los datasets `actualizado` de ese grupo cuentan como publicados. Si la corrida falló, no se publica nada y no avanza. Con `requiere_revision` tampoco avanza: lo publicado se queda atrás hasta que una persona revisa, y pasada su ventana de frescura el dataset pasa a desactualizado, que es lo esperado.

## Revertir a mano

Si una versión mala llegó a producción sin que el humo la detectara:

1. Desde `apps/api`, inicia sesión con tu cuenta (`pnpm exec wrangler login`) y corre `pnpm exec wrangler rollback --name mexicoapi`. Sin un ID de versión vuelve a la versión anterior a la actual y solo pide confirmar y un mensaje opcional (`--message` lo da de una vez). Para volver a otra versión, pasa su ID; `pnpm exec wrangler versions list --name mexicoapi` las lista.
2. O vuelve a correr un despliegue anterior que haya salido en verde (Actions, Despliegue, esa corrida, Re-run all jobs). Redespliega ese commit.
3. Comprueba con `curl https://mexicoapi.<subdominio>.workers.dev/v1/status`.

Un rollback no deshace lo que hay en `main`: arregla el código con un PR, o el siguiente merge volverá a desplegar la versión mala.

## Rotar el token

1. Crea un token nuevo con los mismos permisos (paso 3 de la puesta en marcha).
2. Reemplaza el secreto `CLOUDFLARE_API_TOKEN` en GitHub (en el Environment `produccion` o en el repositorio, donde lo hayas creado).
3. Corre Despliegue a mano desde `main` y confirma que termina en verde.
4. Elimina el token anterior en Cloudflare (API Tokens).

El token de KV se rota igual: uno nuevo con el permiso del paso 7, reemplazar `CLOUDFLARE_KV_TOKEN`, correr Datos a mano desde `main` y revisar que `estado-kv` termine sin advertencias, y borrar el anterior.

Hazlo antes de la fecha de expiración, y de inmediato si sospechas que el token se filtró. Si expira sin rotarlo, el despliegue y el job de KV fallan por autenticación.

## Límites del plan gratuito

- 100,000 peticiones al día al Worker. Cada consulta a `/v1` cuenta; las descargas en `/descargas/*`, las páginas del sitio y el 404 de cualquier dirección fuera de `/v1` se sirven como assets estáticos y no cuentan.
- Las escrituras en KV son pocas (3 al día y 5 los lunes: una por dataset en cada corrida programada de datos, más las corridas a mano), muy por debajo del límite diario del plan.
- El límite de peticiones por IP es parte de la configuración del Worker y no tiene costo.

Si el tráfico supera el límite diario, el Worker falla hasta el día siguiente. El plan de pago de 5 USD al mes sube el límite a 10 millones al mes.

## Privacidad

La observabilidad del Worker está desactivada y nada registra consultas. Un error 500 registra solo el nombre del error y la plantilla de la ruta (por ejemplo `/v1/clabe/{clabe}`), nunca el valor de la ruta ni los parámetros. Wrangler no envía métricas de uso (`send_metrics: false`).
