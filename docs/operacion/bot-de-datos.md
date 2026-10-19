# Bot de datos

El workflow `.github/workflows/datos.yml` actualiza los datos de `data/` y abre PRs con los cambios. Usa una GitHub App propia, con tokens de corta vida, en lugar de un token personal. Mientras la App no exista, el workflow termina en verde y solo deja un aviso.

Estado: configurado el 2026-10-18. La App `mexicoapi-datos` está instalada solo en este repositorio, sus secretos están en el Environment `datos`, limitado a `main`, y la regla de ramas del paso 5 está activa. Los pasos de abajo sirven para repetir la puesta en marcha o para revisarla.

## Puesta en marcha

1. Crear la GitHub App en la cuenta dueña del repositorio (Settings, Developer settings, GitHub Apps). Sin webhook (desmarcar "Active"). Permisos de repositorio:
   - Contents: lectura y escritura.
   - Pull requests: lectura y escritura.
   - Issues: lectura y escritura.
   - Metadata: lectura.

   No le des el permiso Workflows: sin él, la App no puede cambiar nada en `.github/workflows/`, donde está el job `solo-datos` que limita sus PRs a las carpetas de sus datasets.
2. Instalar la App solo en el repositorio `mexicoapi`.
3. Generar una clave privada (archivo `.pem`) desde la página de la App.
4. Crear el Environment `datos` (Settings, Environments, New environment). En Deployment branches and tags elegir Selected branches and tags y agregar solo `main`; no hacen falta revisores obligatorios. En ese Environment, sección Environment secrets, guardar:
   - `BOT_CLIENT_ID`: el Client ID de la App, que aparece en la sección "About" de su página de ajustes (empieza con `Iv`). No es el App ID numérico.
   - `BOT_PRIVATE_KEY`: el contenido completo del `.pem`.

   Si ya estaban como secretos del repositorio (Settings, Secrets and variables, Actions), crearlos en el Environment y borrar los del repositorio: así solo los jobs que corren desde `main` en ese Environment pueden leer la clave.
5. Crear una regla de ramas (Settings, Rules, Rulesets, New ruleset, New branch ruleset), activa (Enforcement status: Active):
   - Bypass list: el rol Repository admin.
   - Target branches: Include all branches, y excluir por patrón `main`, `datos/**` y `dependabot/**`.
   - Reglas: Restrict creations, Restrict updates y Restrict deletions.

   Con esa regla, quien no es administrador, la App incluida, solo puede crear, actualizar y borrar ramas `datos/**` (y Dependabot las suyas); `main` sigue con su propia protección. Sin ella, la App puede hacer push a cualquier rama, también a la de un PR de una persona: `solo-datos` solo mira quién disparó cada corrida de CI, así que si después esa persona hace push, la corrida nueva pasa con el commit de la App adentro. Con la regla, la App solo escribe en ramas `datos/**`, y esas siempre pasan por `solo-datos`. Queda `dependabot/**`, que la regla no puede cerrar sin frenar a Dependabot: un push de la App ahí deja `verify` en rojo (lo disparó una cuenta Bot), Dependabot no vuelve a tocar una rama que editó otro, y sus PRs se revisan a mano.
6. Probar con Actions, Datos, "Run workflow", desde `main`, eligiendo `inegi`, `bancos`, `fix` o `udis`.

Además, el repo necesita tener activos "Allow auto-merge" y "Automatically delete head branches", y la etiqueta `revisar`. En la protección de `main` tienen que seguir activos "Require branches to be up to date before merging" y el check `verify` requerido con origen GitHub Actions. No son solo comodidad: `solo-datos` depende de ellos, porque sin el primero la App podría basar una rama `datos/` en un commit viejo de `main` cuyo `ci.yml` no revisa la base, conseguir un verde, cambiar la base a `main` y fusionar.

El workflow ya declara `environment: datos` en los jobs que leen la clave. Si el Environment no existe, GitHub lo crea vacío y sin reglas en la primera corrida, y los secretos del repositorio siguen funcionando: el bot no se detiene mientras se hace el paso 4. Hasta entonces la única barrera de rama es la condición del workflow, que solo corre esos jobs desde `main`. Los pasos 4 y 5 no cambian nada en el código: solo cierran lo que el workflow no puede cerrar solo.

## Cuándo corre

- INEGI (`inegi.estados` e `inegi.municipios`): lunes a las 06:00 de la Ciudad de México.
- Bancos: todos los días a las 08:00 de la Ciudad de México.
- Tipo de cambio FIX (grupo `fix`, dataset `tipo-cambio.fix`): todos los días a las 13:30 de la Ciudad de México (cron `30 19 * * *`, en UTC), después de la publicación del DOF.
- UDIS (grupo `udis`, dataset `udis`): todos los días a las 14:30 de la Ciudad de México (cron `30 20 * * *`).
- FIX y UDIS van en grupos separados, cada uno con su propia corrida, su concurrencia, su rama `datos/<grupo>-<fecha>` y sus issues: si una serie falla o pide revisión, la otra se sigue actualizando. Las UDIS corren una hora después del FIX porque `main` exige que la rama del PR esté al día (un ajuste de seguridad que no se apaga, ver Puesta en marcha): si los dos PRs se abrieran casi a la vez, el segundo quedaría atrasado en cuanto se fusionara el primero y su auto-merge no avanzaría hasta pulsar "Update branch". México no tiene horario de verano desde 2022, así que las horas no se mueven.
- A mano con "Run workflow", solo desde `main`. Desde otra rama los jobs se saltan.

## Cómo está armado

El pipeline procesa archivos de terceros (PDF, JSON y HTML de las fuentes oficiales). Para que un archivo malicioso no pueda llegar a la clave de la App, la corrida va en jobs separados, cada uno en un runner nuevo:

| Job | Qué hace | A qué tiene acceso |
| --- | --- | --- |
| `preparar` | Elige el grupo y revisa que existan `BOT_CLIENT_ID` y `BOT_PRIVATE_KEY` | Environment `datos`, sin checkout ni permisos de `GITHUB_TOKEN`. No crea el token |
| `generar` | Instala el pipeline, descarga y valida los datos y sube el artefacto `resumen` (`resumen.md`, `resumen.json` y `datos.patch`, el parche de `data/`) por un día | Sin secretos; `GITHUB_TOKEN` solo de lectura; sin caché de pnpm (ver abajo) |
| `publicar` | Crea el token de la App, aplica el parche en un checkout limpio de `main`, solo en las carpetas del grupo, y hace commit, push, PR, auto-merge e issues | Environment `datos`, token de la App (contenidos, PRs e issues, una hora). No instala dependencias ni corre nada que venga de `generar` |
| `estado-kv` | Escribe el estado de cada dataset en KV | Environment `produccion`, token de Cloudflare ([Despliegue en Cloudflare](cloudflare.md)) |

`publicar` solo corre si hay algo que publicar o reportar: cambios en `data/`, un código de salida distinto de 0 o una falla de `generar`, antes o después del CLI. Antes de aplicar el parche exige que:

- toque solo archivos de las carpetas del grupo: `data/inegi-estados/` y `data/inegi-municipios/` para `inegi`, `data/bancos/`, `data/tipo-cambio-fix/` o `data/udis/`. La lista sale de `preparar`, que no corre código del repo ni de las fuentes, y una prueba del pipeline (`test/workflows.test.ts`) la compara con el registro de datasets;
- cada ruta lleve solo letras ASCII, dígitos y `. _ / -` (nada de espacios, controles ni saltos de línea), sin componentes vacíos, `.` o `..`, ni que empiecen con `.git`;
- no renombre ni copie archivos, ni cree enlaces simbólicos o submódulos;
- se aplique limpio (`git apply --check`).

Las rutas se revisan antes de que git pueda imprimirlas. git corre con su salida de error en un archivo, y lo que muestra al fallar, como las rutas rechazadas, sale escapado y con prefijo: nada del parche llega crudo al log, donde una línea que empiece con `::` sería un comando del runner. Después de aplicarlo revisa otra vez el índice. Si algo no cumple, no publica nada, abre (o comenta en) `Falla en datos: <grupo>` y la corrida queda en rojo. Para el push, `gh auth setup-git` le pasa el token a git desde el entorno del paso: el token no va en la URL ni queda en `.git/config`.

Los datos curados (`data/curado/` y las carpetas que arma `curar`) nunca pasan por el bot: se cambian en un PR de una persona ([Datos curados](datos-curados.md)).

`generar` no usa la caché de pnpm. Eso no basta para aislarla: un `generar` comprometido podría escribir en la caché de Actions de `main` con el token del runner. Por eso `despliegue.yml`, que tiene el token de Cloudflare, tampoco la usa. Los jobs de `ci.yml` sí: no tienen secretos, y `solo-datos` no instala nada.

Los textos que vienen de las fuentes (motivos, registros, claves y mensajes de error) llegan a los PRs, comentarios e issues como código, en línea o en bloque, y las `@` llevan un espacio de ancho cero: no se vuelven menciones, enlaces ni encabezados.

El cliente HTTP del pipeline solo pide por `https` a los hosts de cada dataset (la lista está en la definición del dataset y una prueba la compara con las URL de `data/*/manifest.json`). No pide una URL con usuario o contraseña. Sigue hasta 5 redirecciones y revisa cada salto como la URL original: esquema, credenciales, host, `robots.txt` e intervalo por host. Lee el cuerpo por partes con un tope de 50 MB (la fuente más grande, el PDF de Banxico, ronda los 400 KB) y cierra los cuerpos que no usa.

## Qué hace el bot

- Descarga y valida los datos con el CLI del pipeline.
- Si no hay cambios, no hace nada.
- Si hay cambios dentro de los umbrales, abre un PR desde la rama `datos/<grupo>-<fecha>` con el resumen y activa el auto-merge. El PR se fusiona cuando pasa el check `verify`, que exige los jobs `verificacion`, `paquete`, `paquete-node`, `paquete-runtimes`, `paquete-mcp` y `solo-datos` de `ci.yml`.
- Si los cambios piden revisión humana, abre el PR con la etiqueta `revisar`, sin auto-merge, y un issue `Revisar datos: <grupo> <fecha>` con los motivos.
- Si el pipeline pide revisión pero no hay cambios en `data/`, abre (o comenta en) un issue `Revisar datos: <grupo>`.
- Si el bot ya tiene un PR abierto para el grupo (una rama `datos/<grupo>-…` del propio repo, con o sin etiqueta), no abre otro: comenta en ese PR con el resumen nuevo y el enlace a la corrida. Si además los cambios piden revisión, abre (o comenta en) el issue `Revisar datos: <grupo>` con los motivos. Cuando ese PR lleva más de 48 horas abierto o tiene algún check en rojo, abre (o comenta en) el issue `PR de datos atascado: <grupo>`. Si esa consulta a GitHub falla, la corrida deja un aviso y sigue, así que el issue de revisión se abre igual.
- Si el pipeline falla, o falla la instalación, la revisión del parche o la publicación, abre (o comenta en) un issue `Falla en datos: <grupo>` y la corrida queda en rojo.
- Al terminar, el job `estado-kv` escribe en KV el estado de cada dataset para `/v1/status`, solo desde `main`. Recibe el resumen de la corrida como artefacto y no instala dependencias, así que el token de Cloudflare no convive con los pasos que procesan datos externos. Sin los secretos de Cloudflare deja un aviso y sigue (cómo crearlos: [Despliegue en Cloudflare](cloudflare.md)); si la escritura falla, deja una advertencia y no cambia el resultado de la corrida. Si `generar` no termina en verde, antes o después del CLI, no se escribe nada: el resumen de un intento anterior de la corrida no debe tomarse por el de este, y la falla la reporta `publicar`.

## FIX publicado en un día inhábil bancario

La API responde la operación del día siguiente a un feriado bancario con la última publicación cargada, porque da por hecho que el DOF no publica el FIX en los días de descanso de la CNBV (ver [Publicado y operación](../api/README.md#publicado-y-operación)). Si la corrida trae un FIX en uno de esos días, el bot abre el PR de datos con la etiqueta `revisar` y el motivo `FIX publicado en día inhábil bancario: <fecha>`. En ese PR `verificacion`, y con él `verify`, queda en rojo: falla la prueba de integración que exige que ningún feriado bancario entre semana ya cargado tenga FIX. Qué hacer:

1. Confirmar en el DOF que ese día hubo publicación del tipo de cambio, con la fecha y el valor del SIDOF.
2. Si la CNBV modificó sus disposiciones y ese día ya no es de cierre, quitar la fecha de `data/curado/dias-inhabiles-cnbv.yaml` con la cita de la modificación (ver [Datos curados](datos-curados.md)). Si el día sigue siendo de cierre y aun así hubo FIX, el supuesto de la API ya no vale: ajustar la regla (que el Worker no salte ese día) y la prueba de integración antes de seguir. El cambio del YAML curado, o el de la regla y la prueba, va en un PR propio de una persona, no en la rama `datos/…`: los datos curados nunca pasan por el bot, y `solo-datos` deja `verify` en rojo si un PR del bot toca algo fuera de las carpetas de sus datasets. Ya en `main`, pulsar "Update branch" en el PR de datos para que vuelva a correr CI.
3. Con `verify` en verde, fusionar el PR de datos. Mientras tanto la serie no avanza y el bot comenta en el mismo PR cada día. Las respuestas de `operacion` del día siguiente que se dieron antes de la corrida usaron el FIX anterior.

## Qué nunca hace

- Nunca hace push a `main`.
- Nunca fusiona un PR que necesita revisión.
- Solo modifica archivos de las carpetas de sus datasets en `data/`, y solo abre PRs a `main`. Un PR del bot que toque algo más, o que vaya a otra base, no se fusiona: el job `solo-datos` de `ci.yml` deja `verify` en rojo. Cuenta como PR del bot si su rama empieza con `datos/`, si lo abrió una cuenta Bot que no es Dependabot, o si el evento que disparó esa corrida de CI (abrir, reabrir o hacer push) lo hizo una de esas cuentas. Solo cuenta quién disparó la corrida, no quién hizo push antes: por eso hace falta la regla de ramas del paso 5. Si algún día se suma otra App que deba tocar código, hay que agregarla como excepción en ese job.
- Cambiar la base de un PR no vuelve a correr CI (`ci.yml` no escucha el evento `edited`, que también llega con cada cambio de título o descripción). No hace falta: un PR del bot con otra base ya falla en `solo-datos`, y ese rojo se queda en su commit hasta un push nuevo o una reapertura, que vuelven a revisarlo contra `main`.
- No reescribe historial ni hace push forzado; si la rama del día ya existe, usa otra con sufijo.
- El resto del repositorio lo usa solo en lectura.

## Rotar la clave de la App

1. En la página de la App, Private keys, generar una clave nueva.
2. Reemplazar `BOT_PRIVATE_KEY` en el Environment `datos`.
3. Correr Datos a mano desde `main` y confirmar que termina en verde.
4. Borrar la clave anterior en la página de la App.

Hacerlo una vez al año, y de inmediato si se sospecha que la clave se filtró.

## Nota sobre main

`main` exige que las ramas estén al día. Si `main` avanza mientras un PR de datos espera el auto-merge, puede hacer falta pulsar "Update branch" en ese PR. Ese paso de más es el precio de una protección que el bot necesita: sin ella, un PR del bot podría pasar CI contra una versión vieja de `ci.yml` (ver Puesta en marcha). No hay que desactivarla para que los PRs de datos se fusionen solos.
