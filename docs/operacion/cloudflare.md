# Despliegue en Cloudflare

La API corre como un Worker de Cloudflare en el plan gratuito. Los workflows `despliegue.yml`, `frescura.yml` y el job `estado-kv` de `datos.yml` necesitan dos secretos y una variable de GitHub. Hasta que existan, los tres terminan en verde y solo dejan un aviso con el enlace a este documento.

## Puesta en marcha

Los pasos 1 a 4 son en Cloudflare y los 5 y 6 en GitHub. Los nombres de los menús pueden cambiar; si no encuentras uno, busca la pantalla que se describe.

1. Crea una cuenta de Cloudflare en el plan gratuito. No hace falta tarjeta ni dominio. Cloudflare nombra la cuenta con tu correo: cámbiale el nombre por uno neutro (Manage Account, Configurations, nombre de la cuenta), porque wrangler puede imprimir el nombre de la cuenta en un error de autenticación y los logs de Actions de un repositorio público los puede leer cualquiera.
2. Entra a Workers y Pages. La primera vez pide elegir el subdominio de `workers.dev` (por ejemplo `daniel`). Las URLs quedan como `https://mexicoapi.<subdominio>.workers.dev`. El subdominio es público, así que elígelo con cuidado.
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

Con `API_URL` definida, `frescura.yml` empieza a revisar los datos todos los días. Puedes probarla con Actions, Frescura, Run workflow.

## Qué hace cada workflow

| Workflow | Con los secretos y la variable | Sin ellos |
| --- | --- | --- |
| `despliegue.yml` (cada merge a `main` y a mano desde `main`) | Compila, despliega a staging, corre la prueba de humo, despliega a producción, corre el humo otra vez y, si falla, revierte | Deja un aviso y termina en verde sin desplegar |
| `datos.yml`, job `estado-kv` (solo desde `main`) | Escribe en KV el estado de cada dataset, que `/v1/status` muestra | Deja un aviso y sigue; el bot de datos funciona igual |
| `frescura.yml` (diario, 13:00 de la Ciudad de México) | Consulta `/v1/status` de `API_URL` y abre issues | Sin `API_URL`, deja un aviso y termina en verde |

### Despliegue

Solo corre desde `main`, en el Environment `produccion`.

1. Instala y compila el repositorio.
2. `cloudflare.ts configurar` busca (o crea) el namespace de KV titulado `mexicoapi-estado`, genera la configuración del entorno y devuelve la URL de `workers.dev`.
3. Despliega el Worker `mexicoapi-staging`.
4. Corre `humo.ts` contra staging. Un Worker recién desplegado tarda en propagarse, así que hace hasta 5 intentos, con esperas de 10, 20, 30 y 60 segundos entre ellos.
5. Repite lo mismo con el Worker `mexicoapi` (producción). Si staging falla, producción no se toca. El humo de producción corre solo si la versión llegó a subirse, aunque el paso de despliegue fallara después; si falló antes de subirla, producción no cambió, no hay humo ni reversión y la corrida queda en rojo.
6. Si el humo de producción falla, corre `wrangler rollback --yes` y deja la corrida en rojo. En el primer despliegue no hay versión anterior: la reversión falla, producción se queda con ese commit y el resumen lo dice.
7. Escribe un resumen con el commit, las URLs, los IDs de versión, si se revirtió y la salida del humo.

Staging y producción comparten el namespace de KV: el estado es del pipeline de datos, no del entorno. Los dos tienen límite de peticiones en lo que pasa por el Worker (`/v1`): 600 por minuto por IP (las IPv6 cuentan por /64) y por ubicación de Cloudflare. Pasado el límite responden 429; quien necesite más volumen debe usar las descargas completas, que se sirven como archivos estáticos y no pasan por ese límite.

`apps/api/wrangler.jsonc` es la base de las dos configuraciones y se llama `mexicoapi-local`: un `wrangler deploy` a mano con ese archivo crea un Worker aparte, sin KV ni límite de peticiones, y no toca staging ni producción.

### Frescura

Lee `/v1/status` con `GITHUB_TOKEN`, sin secretos de Cloudflare.

- Un dataset desactualizado abre o comenta el issue `Datos desactualizados: <dataset>`; cuando vuelve a estar al día, el issue se cierra solo.
- Un estado `unknown` no cuenta como desactualizado: significa que KV aún no tiene estado para ese dataset. Pasa hasta la primera corrida de `datos.yml` con los secretos.
- Si `/v1/status` no responde o no devuelve un estado válido, abre o comenta `API sin respuesta` y la corrida queda en rojo, en lugar de abrir un issue por dataset.

### Estado en KV

El job `estado-kv` de `datos.yml` guarda `estado:<dataset>` con la última corrida. Va aparte del job que actualiza los datos: recibe el resumen de la corrida como artefacto, no instala dependencias y es el único que ve el token de Cloudflare. Si falla, deja una advertencia y no cambia el resultado de la corrida de datos.

`last_success` avanza con `sin_cambios` siempre y con `actualizado` solo si la corrida publicó el cambio: el paso "Publicar resultado" terminó bien y la corrida salió con código 0. Con código 3 el PR lleva la etiqueta `revisar` y no se fusiona solo, así que ni los datasets `actualizado` de ese grupo cuentan como publicados. Si la corrida falló, no se publica nada y no avanza. Con `requiere_revision` tampoco avanza: lo publicado se queda atrás hasta que una persona revisa, y pasada su ventana de frescura el dataset pasa a desactualizado, que es lo esperado.

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

Hazlo antes de la fecha de expiración, y de inmediato si sospechas que el token se filtró. Si expira sin rotarlo, el despliegue y el job de KV fallan por autenticación.

## Límites del plan gratuito

- 100,000 peticiones al día al Worker. Cada consulta a `/v1` cuenta; las descargas en `/descargas/*` se sirven como assets estáticos y no cuentan.
- Las escrituras en KV son pocas (de 1 a 3 al día: una por dataset en cada corrida de datos), muy por debajo del límite diario del plan.
- El límite de peticiones por IP es parte de la configuración del Worker y no tiene costo.

Si el tráfico supera el límite diario, el Worker falla hasta el día siguiente. El plan de pago de 5 USD al mes sube el límite a 10 millones al mes.

## Privacidad

La observabilidad del Worker está desactivada y nada registra consultas. Un error 500 registra solo el nombre del error y la plantilla de la ruta (por ejemplo `/v1/clabe/{clabe}`), nunca el valor de la ruta ni los parámetros. Wrangler no envía métricas de uso (`send_metrics: false`).
