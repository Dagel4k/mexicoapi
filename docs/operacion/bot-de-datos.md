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
5. Probar con Actions, Datos, "Run workflow", eligiendo `inegi` o `bancos`.

Además, el repo necesita tener activos "Allow auto-merge" y "Automatically delete head branches", y la etiqueta `revisar`.

## Cuándo corre

- INEGI (`inegi.estados` e `inegi.municipios`): lunes a las 06:00 de la Ciudad de México.
- Bancos: todos los días a las 08:00 de la Ciudad de México.
- A mano con "Run workflow".

## Qué hace el bot

- Descarga y valida los datos con el CLI del pipeline.
- Si no hay cambios, no hace nada.
- Si hay cambios dentro de los umbrales, abre un PR desde la rama `datos/<grupo>-<fecha>` con el resumen y activa el auto-merge. El PR se fusiona cuando pasa el check `verify`.
- Si los cambios piden revisión humana, abre el PR con la etiqueta `revisar`, sin auto-merge, y un issue `Revisar datos: <grupo> <fecha>` con los motivos.
- Si el pipeline pide revisión pero no hay cambios en `data/`, abre (o comenta en) un issue `Revisar datos: <grupo>`.
- Si el bot ya tiene un PR abierto para el grupo (una rama `datos/<grupo>-…` del propio repo, con o sin etiqueta), no abre otro: comenta en ese PR con el resumen nuevo y el enlace a la corrida. Si además los cambios piden revisión, abre (o comenta en) el issue `Revisar datos: <grupo>` con los motivos. Cuando ese PR lleva más de 48 horas abierto o tiene algún check en rojo, abre (o comenta en) el issue `PR de datos atascado: <grupo>`. Si esa consulta a GitHub falla, la corrida deja un aviso y sigue, así que el issue de revisión se abre igual.
- Si el pipeline falla, abre (o comenta en) un issue `Falla en datos: <grupo>` y la corrida queda en rojo.

## Qué nunca hace

- Nunca hace push a `main`.
- Nunca fusiona un PR que necesita revisión.
- Solo modifica archivos dentro de `data/`.
- No reescribe historial ni hace push forzado; si la rama del día ya existe, usa otra con sufijo.
- El resto del repositorio lo usa solo en lectura.

## Nota sobre main

`main` exige que las ramas estén al día. Si `main` avanza mientras un PR de datos espera el auto-merge, puede hacer falta pulsar "Update branch" en ese PR.
