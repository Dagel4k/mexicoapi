# Bot de datos

El workflow `.github/workflows/datos.yml` actualiza los datos de `data/` y abre PRs con los cambios. Usa una GitHub App propia, con tokens de corta vida, en lugar de un token personal. Mientras la App no exista, el workflow termina en verde y solo deja un aviso.

## Puesta en marcha

1. Crear la GitHub App en la cuenta de Daniel (Settings, Developer settings, GitHub Apps). Sin webhook (desmarcar "Active"). Permisos de repositorio:
   - Contents: lectura y escritura.
   - Pull requests: lectura y escritura.
   - Issues: lectura y escritura.
   - Metadata: lectura.
2. Instalar la App solo en el repositorio `mexicoapi`.
3. Generar una clave privada (archivo `.pem`) desde la página de la App.
4. Guardar dos secretos en el repo (Settings, Secrets and variables, Actions):
   - `BOT_CLIENT_ID`: el Client ID de la App, que aparece en la sección "About" de su página de ajustes (empieza con `Iv`). No es el App ID numérico.
   - `BOT_PRIVATE_KEY`: el contenido completo del `.pem`.
5. Probar con Actions, Datos, "Run workflow", eligiendo `inegi`, `bancos`, `fix` o `udis`.

Además, el repo necesita tener activos "Allow auto-merge" y "Automatically delete head branches", y la etiqueta `revisar`.

## Cuándo corre

- INEGI (`inegi.estados` e `inegi.municipios`): lunes a las 06:00 de la Ciudad de México.
- Bancos: todos los días a las 08:00 de la Ciudad de México.
- Tipo de cambio FIX (grupo `fix`, dataset `tipo-cambio.fix`): todos los días a las 13:30 de la Ciudad de México (cron `30 19 * * *`, en UTC), después de la publicación del DOF.
- UDIS (grupo `udis`, dataset `udis`): todos los días a las 14:30 de la Ciudad de México (cron `30 20 * * *`).
- FIX y UDIS van en grupos separados, cada uno con su propia corrida, su concurrencia, su rama `datos/<grupo>-<fecha>` y sus issues: si una serie falla o pide revisión, la otra se sigue actualizando. Las UDIS corren una hora después del FIX porque `main` exige que la rama del PR esté al día: si los dos PRs se abrieran casi a la vez, el segundo quedaría atrasado en cuanto se fusionara el primero y su auto-merge no avanzaría hasta pulsar "Update branch". México no tiene horario de verano desde 2022, así que las horas no se mueven.
- A mano con "Run workflow".

## Qué hace el bot

- Descarga y valida los datos con el CLI del pipeline.
- Si no hay cambios, no hace nada.
- Si hay cambios dentro de los umbrales, abre un PR desde la rama `datos/<grupo>-<fecha>` con el resumen y activa el auto-merge. El PR se fusiona cuando pasa el check `verify`, que exige los jobs `verificacion`, `paquete` y `paquete-node` de `ci.yml`.
- Si los cambios piden revisión humana, abre el PR con la etiqueta `revisar`, sin auto-merge, y un issue `Revisar datos: <grupo> <fecha>` con los motivos.
- Si el pipeline pide revisión pero no hay cambios en `data/`, abre (o comenta en) un issue `Revisar datos: <grupo>`.
- Si el bot ya tiene un PR abierto para el grupo (una rama `datos/<grupo>-…` del propio repo, con o sin etiqueta), no abre otro: comenta en ese PR con el resumen nuevo y el enlace a la corrida. Si además los cambios piden revisión, abre (o comenta en) el issue `Revisar datos: <grupo>` con los motivos. Cuando ese PR lleva más de 48 horas abierto o tiene algún check en rojo, abre (o comenta en) el issue `PR de datos atascado: <grupo>`. Si esa consulta a GitHub falla, la corrida deja un aviso y sigue, así que el issue de revisión se abre igual.
- Si el pipeline falla, abre (o comenta en) un issue `Falla en datos: <grupo>` y la corrida queda en rojo.
- Al terminar, el job `estado-kv` escribe en KV el estado de cada dataset para `/v1/status`, con los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` y solo desde `main`. Corre aparte: recibe el resumen de la corrida como artefacto y no instala dependencias, así que el token no convive con los pasos que procesan datos externos. Sin esos secretos deja un aviso y sigue (cómo crearlos: [Despliegue en Cloudflare](cloudflare.md)); si la escritura falla, deja una advertencia y no cambia el resultado de la corrida. Si la corrida falla antes del CLI no hay resumen y no se escribe nada.

## FIX publicado en un día inhábil bancario

La API responde la operación del día siguiente a un feriado bancario con la última publicación cargada, porque da por hecho que el DOF no publica el FIX en los días de descanso de la CNBV (ver [Publicado y operación](../api/README.md#publicado-y-operación)). Si la corrida trae un FIX en uno de esos días, el bot abre el PR de datos con la etiqueta `revisar` y el motivo `FIX publicado en día inhábil bancario: <fecha>`. En ese PR `verificacion`, y con él `verify`, queda en rojo: falla la prueba de integración que exige que ningún feriado bancario entre semana ya cargado tenga FIX. Qué hacer:

1. Confirmar en el DOF que ese día hubo publicación del tipo de cambio, con la fecha y el valor del SIDOF.
2. Si la CNBV modificó sus disposiciones y ese día ya no es de cierre, quitar la fecha de `data/curado/dias-inhabiles-cnbv.yaml` con la cita de la modificación (ver [Datos curados](datos-curados.md)). Si el día sigue siendo de cierre y aun así hubo FIX, el supuesto de la API ya no vale: ajustar la regla (que el Worker no salte ese día) y la prueba de integración antes de seguir.
3. Con `verify` en verde, fusionar el PR de datos. Mientras tanto la serie no avanza y el bot comenta en el mismo PR cada día. Las respuestas de `operacion` del día siguiente que se dieron antes de la corrida usaron el FIX anterior.

## Qué nunca hace

- Nunca hace push a `main`.
- Nunca fusiona un PR que necesita revisión.
- Solo modifica archivos dentro de `data/`.
- No reescribe historial ni hace push forzado; si la rama del día ya existe, usa otra con sufijo.
- El resto del repositorio lo usa solo en lectura.

## Nota sobre main

`main` exige que las ramas estén al día. Si `main` avanza mientras un PR de datos espera el auto-merge, puede hacer falta pulsar "Update branch" en ese PR.
