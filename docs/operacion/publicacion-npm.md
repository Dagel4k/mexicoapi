# Publicación en npm

Los paquetes `mexicoapi` (`packages/sdk`) y `mexicoapi-mcp` (`packages/mcp`, el servidor MCP) están listos para publicarse, pero todavía no hay versión en npm. Cada versión la publica el workflow `publicacion.yml` cuando se publica un Release de GitHub con la etiqueta `mexicoapi@<versión>` o `mexicoapi-mcp@<versión>`: sin tokens (npm confía en ese workflow, con OIDC) y con procedencia. npm solo deja configurar esa confianza en un paquete que ya existe, así que la primera versión de cada uno se publica a mano.

Este documento dice cómo se arma cada paquete, qué hay que preparar en npm una sola vez, cómo se publica a mano la primera versión, cómo se configura el publicador de confianza, cómo se corta cada versión después y qué revisa el workflow. `mexicoapi-mcp` depende de `mexicoapi`, así que siempre se publica después.

## Cómo se arma `mexicoapi`

El `package.json` de `packages/sdk` trae cosas que solo sirven en el monorepo: `devDependencies` con `@mexicoapi/core` (`workspace:*`) y wrangler, y `scripts` que llaman a archivos que no viajan en el paquete. Por eso el paquete no se empaqueta desde ahí:

1. `pnpm --filter "mexicoapi..." build` compila el núcleo y después el paquete (el núcleo queda copiado en `dist/nucleo`).
2. `node packages/sdk/scripts/publicable.ts <destino>` arma en `<destino>` (una carpeta nueva o vacía, fuera de `packages/sdk`) lo que lista `files` (`dist`, `README.md`, `CHANGELOG.md` y `LICENSE`) y un `package.json` igual al del repositorio sin `devDependencies` ni `scripts`. Revisa también que `CHANGELOG.md` empiece, en su primer encabezado `## `, con la versión del `package.json` (`revisarHistorial`); `publicacion.yml` exige además que ese encabezado traiga la fecha. Antes de escribir revisa que exista cada archivo que declaran `exports`, `main`, `types` y `bin`, y falla si el manifiesto nombra un paquete `@mexicoapi/` o un rango `workspace:`.
3. `npm pack` y `npm publish` se corren dentro de `<destino>`. Así el `.tgz` y lo que npm registra de la versión salen del mismo manifiesto.

Un `npm pack` o `npm publish` en `packages/sdk` falla a propósito (el `prepack` lo rechaza con un mensaje que dice qué hacer).

En CI, el job `paquete` de `ci.yml` hace estos tres pasos con el Node de `.nvmrc` y sube el `.tgz` como artefacto; `paquete-node` lo instala en un proyecto nuevo con Node 20, 22, 24 y 26 y corre la prueba de humo (`packages/sdk/test/paquete/humo.mjs`). `paquete-runtimes` lo instala igual y prueba lo que no es Node: Bun 1.4.3 y Deno 2.9.7 (este sin permisos) corren la prueba de las entradas universales (`packages/sdk/test/paquete/universal.mjs`, sin módulos de Node ni red), y `packages/sdk/scripts/navegador.ts` empaqueta cada entrada universal con el esbuild del lockfile (`platform: "browser"`, `format: "esm"`) y falla si alguna llega a un módulo de Node o si la principal pasa de 15 KB con gzip. El check `verify`, el que exige la protección de `main`, pasa solo si `verificacion` (que corre `verify.sh`), `paquete`, cada Node de `paquete-node`, `paquete-runtimes` y cada Node de `paquete-mcp` (siguiente sección) terminan bien: uno que falla, se salta o se cancela bloquea el merge. `pnpm --filter mexicoapi test:paquete` (dentro de `verify.sh`) hace lo mismo con el Node local, salvo Bun y Deno, y además levanta un Worker en workerd que usa el paquete instalado.

Hoy (0.1.0) el paquete tiene 145 archivos: unos 180 kB comprimido y 900 kB sin comprimir.

## Cómo se arma `mexicoapi-mcp`

Igual que `mexicoapi`, y con el mismo código: `packages/mcp/scripts/publicable.ts` usa el de `packages/sdk`. La diferencia es la dependencia `mexicoapi`, que en el monorepo es `workspace:*` y se publica como `^<versión de packages/sdk>` (hoy `^0.1.0`). Cada versión de `mexicoapi` va seguida de un *patch* de `mexicoapi-mcp` con ese piso (la regla está en "Cómo se corta una versión").

1. `pnpm --filter "mexicoapi-mcp..." build` compila el núcleo, `mexicoapi` y el servidor.
2. `node packages/mcp/scripts/publicable.ts <destino>` arma en `<destino>` (nuevo o vacío, fuera de `packages/mcp`) `dist`, `README.md`, `CHANGELOG.md`, `LICENSE` y el `package.json` sin `devDependencies` (el cliente oficial de MCP que usan las pruebas) ni `scripts`, con `mexicoapi` en `^` y la versión que lee de `packages/sdk/package.json`. Falla si queda un rango `workspace:` o un paquete `@mexicoapi/`, o si falta un archivo que declara `bin`. Con `--publicar` (`node packages/mcp/scripts/publicable.ts --publicar <destino>`) revisa además con `npm view` que `mexicoapi@<versión de packages/sdk>` ya esté en npm, y si no está (o npm no responde) se niega sin escribir nada: así ningún servidor sale con un piso que todavía no existe.
3. `npm pack` y `npm publish` se corren dentro de `<destino>`.

Un `npm pack` o `npm publish` en `packages/mcp` también falla a propósito.

En CI, el job `paquete-mcp` hace estos tres pasos con el Node de `.nvmrc` e instala el `.tgz` del servidor y el de `mexicoapi` (el artefacto del job `paquete`) en un proyecto nuevo con `npm install --offline`: la dependencia `mexicoapi@^0.1.0` la cumple el `.tgz` local, así que npm no consulta el registro, donde `mexicoapi` todavía no existe. Después, con Node 22.13.0 (el piso de `engines`), 22.23.3 y 24.21.0, corre la prueba de humo (`packages/mcp/test/paquete/humo.mjs`, sin dependencias), que lanza el binario instalado (`node_modules/.bin/mexicoapi-mcp`) y le habla por stdio: `initialize`, `tools/list` y tres `tools/call` (`validar_clabe`, `udis` y `codigo_postal` sin catálogo, que cargan los datos y `mexicoapi/sepomex` del paquete instalado). `paquete-mcp` es uno de los jobs que exige el check `verify`. `pnpm --filter mexicoapi-mcp test:paquete` (dentro de `verify.sh`) hace lo mismo con el Node local y revisa además el `package.json` publicado y lo que lista `npm pack`.

Hoy (0.1.0) el paquete tiene 19 archivos (solo JavaScript en `dist`: es un binario y no publica tipos): unos 30 kB comprimido y 108 kB sin comprimir.

## Preparación en npm (una vez)

1. Crea una cuenta en [npmjs.com](https://www.npmjs.com/signup). El nombre de usuario y el correo de la cuenta aparecen en los metadatos públicos de cada paquete que publiques (`maintainers`), así que usa un correo que no te importe mostrar.
2. Activa la verificación en dos pasos en Account Settings, Two-Factor Authentication, con el modo que la pide para iniciar sesión y para publicar (Authorization and writes). Usa una llave de seguridad o una app de códigos y guarda los códigos de recuperación.
3. Revisa que los nombres sigan libres: `npm view mexicoapi` y `npm view mexicoapi-mcp` responden 404 si nadie los tiene (libres el 2026-10-18). npm no reserva nombres sin publicar y su política no permite paquetes de relleno: el nombre se toma con la primera versión real. `mexicoapi` se toma con la 0.1.0 (siguiente sección) y `mexicoapi-mcp` con la suya, después.

## Primera versión de `mexicoapi`, a mano

El publicador de confianza de npm (trusted publishing) solo se configura en un paquete que ya existe, así que la primera versión sale de tu equipo, sin procedencia.

1. Desde `main` al día y con `./scripts/verify.sh` en verde, revisa la versión en `packages/sdk/package.json` (`0.1.0`) y que el primer encabezado de `packages/sdk/CHANGELOG.md` tenga la fecha de la publicación (`## 0.1.0 (AAAA-MM-DD)`). Si todavía dice "(sin publicar)", cámbialo antes en un PR.
2. Compila y arma el paquete fuera del repositorio:

   ```bash
   pnpm --filter "mexicoapi..." build
   node packages/sdk/scripts/publicable.ts ../mexicoapi-publicable
   cd ../mexicoapi-publicable
   ```

3. Revisa lo que se va a publicar: `npm pack --dry-run` (solo `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` y `package.json`) y el `package.json` (sin `devDependencies` ni `scripts`).
4. Publica: `npm login` (abre el navegador y pide el segundo factor) y después `npm publish --access public`, que pide el código otra vez.
5. Comprueba: `npm view mexicoapi` y, en una carpeta vacía, `npm install mexicoapi` y `npx mexicoapi clabe 002010077777777771`.
6. Marca el commit publicado con la etiqueta `mexicoapi@0.1.0` y súbela: `git tag mexicoapi@0.1.0 <commit>` y `git push origin mexicoapi@0.1.0`. Sin Release de GitHub: un Release con esa etiqueta correría `publicacion.yml`, que se detendría (sin publicar nada) porque la versión ya está en npm.
7. Borra `../mexicoapi-publicable`.
8. Actualiza el sitio. Mientras `PUBLICADO_EN_NPM` (en `packages/pipeline/src/sitio/comun.ts`) sea `false`, la página de inicio y `llms.txt` dicen que el paquete y el servidor MCP están pendientes de publicarse y que mientras tanto se use la API, sin comandos de instalación ni la configuración del servidor; con `true` aparecen. La constante cubre los dos paquetes: cámbiala a `true` en un PR cuando los dos estén en npm, ajusta las pruebas que la fijan en `false` y el despliegue de ese merge publica el sitio nuevo. Si `mexicoapi` sale antes que `mexicoapi-mcp`, el sitio sigue diciendo que ambos están pendientes hasta entonces.

## Primera versión de `mexicoapi-mcp`, a mano

Con `mexicoapi@0.1.0` ya en npm, y con los mismos pasos:

1. Desde `main` al día y con `./scripts/verify.sh` en verde, revisa la versión en `packages/mcp/package.json` (`0.1.0`) y la fecha en el primer encabezado de `packages/mcp/CHANGELOG.md`.
2. Compila y arma el paquete fuera del repositorio. `--publicar` se niega si `mexicoapi@0.1.0` (la versión de `packages/sdk`) todavía no está en npm:

   ```bash
   pnpm --filter "mexicoapi-mcp..." build
   node packages/mcp/scripts/publicable.ts --publicar ../mexicoapi-mcp-publicable
   cd ../mexicoapi-mcp-publicable
   ```

3. Revisa lo que se va a publicar: `npm pack --dry-run` (solo `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` y `package.json`) y el `package.json` (sin `devDependencies` ni `scripts`, con `"mexicoapi": "^0.1.0"` en `dependencies`).
4. Publica con `npm publish --access public` (con la sesión de `npm login` y el segundo factor).
5. Comprueba: `npm view mexicoapi-mcp dependencies` y, en una carpeta vacía con un `package.json` de `"type": "module"`, `npm install mexicoapi-mcp`, copia ahí `packages/mcp/test/paquete/humo.mjs` y corre `node humo.mjs`, que termina con `humo: OK`.
6. Marca el commit publicado con la etiqueta `mexicoapi-mcp@0.1.0` y súbela, también sin Release.
7. Borra `../mexicoapi-mcp-publicable`.

Un número de versión publicado no se puede volver a usar, aunque la versión se retire. Si una versión sale mal, publica otra con el arreglo y marca la mala con `npm deprecate mexicoapi@<versión> "<motivo>"`; `npm unpublish` solo se permite en las primeras 72 horas y con condiciones.

## Después de la primera versión

En npmjs.com, en la página del paquete, Settings, Publishing access, elige la opción que exige dos pasos y no permite tokens. Publicar a mano con `npm login` y el segundo factor sigue funcionando, y el publicador de confianza también.

## Publicador de confianza (una vez por paquete)

El publicador de confianza (trusted publishing) hace que solo `publicacion.yml`, de este repositorio, pueda publicar el paquete sin tokens: el workflow pide a GitHub un token de OIDC y npm lo cambia por un permiso que sirve solo para esa publicación. npm agrega además la procedencia, que liga la versión con el commit y la corrida que la publicaron. Una configuración nueva caduca si no publica nada en 2 días, así que se crea justo antes de cortar la siguiente versión del paquete:

1. En GitHub, crea el Environment `npm` (Settings, Environments; uno para los dos paquetes). En Deployment branches and tags elige Selected branches and tags y agrega dos reglas de tipo Tag: `mexicoapi@*` y `mexicoapi-mcp@*`. Así el job que publica solo corre con esas etiquetas.
2. En npmjs.com, en la página del paquete, Settings, Trusted Publisher, elige GitHub Actions y llena:
   - Organization or user: `Dagel4k`
   - Repository: `mexicoapi`
   - Workflow filename: `publicacion.yml` (solo el nombre del archivo, que está en `.github/workflows/`)
   - Environment name: `npm`

   Los campos distinguen mayúsculas y npm no los revisa al guardar: un error solo aparece al publicar, cuando el job `publicar` falla con E404 o ENEEDAUTH. `repository.url` del `package.json` (`git+https://github.com/Dagel4k/mexicoapi.git`) debe coincidir con el repositorio, y ya coincide.
3. Publica la siguiente versión con el workflow (siguiente sección) dentro de esos 2 días. Si la configuración caduca, bórrala y crea otra.

Lo mismo se repite en `mexicoapi-mcp`: cada paquete tiene su propia configuración, con los mismos valores y el mismo Environment.

## Cómo se corta una versión

Cada paquete lleva su historial en `CHANGELOG.md` (`packages/sdk` y `packages/mcp`), que viaja en el paquete publicado. El PR que sube la versión agrega al principio una sección `## <versión> (AAAA-MM-DD)` con una lista corta de lo que cambia; mientras la versión no sale, el encabezado dice `## <versión> (sin publicar)`, y el PR de la publicación cambia "sin publicar" por la fecha. `publicable.ts` se niega a armar el paquete si el primer encabezado `## ` no empieza con la versión del `package.json`, y `publicacion.yml` se niega si ese encabezado no trae la fecha, así que olvidar esta sección detiene la publicación.

Para `mexicoapi`:

1. Un PR a `main` cambia la versión de `packages/sdk/package.json` con semver (los datos nuevos son un cambio *patch*; mientras el paquete esté en 0.x, un cambio que rompe la API sube la versión menor) y deja el primer encabezado de `packages/sdk/CHANGELOG.md` en `## <versión> (AAAA-MM-DD)`, con la fecha en que se va a publicar.
2. Se integra el PR (`gh pr merge --rebase`) y se espera a que CI termine en verde en `main`. CI corre en el último commit de cada push a `main`, y ese commit es el que se publica.
3. Se crea el Release de GitHub sobre ese commit, con la etiqueta `mexicoapi@<versión>` y sin marcarlo como pre-release. El Release crea la etiqueta. Con gh:

   ```bash
   gh release create "mexicoapi@0.1.1" --target <commit> --title "mexicoapi 0.1.1" --notes-file notas.md
   ```

   Las notas pueden ser la sección del `CHANGELOG.md`. En la web: Releases, Draft a new release, la etiqueta nueva y el commit en Target.
4. `publicacion.yml` corre solo. Se sigue con `gh run watch` o en la pestaña Actions (workflow Publicación): el job `preparar` revisa y arma el paquete, y el job `publicar` lo publica en el Environment `npm`. El resumen de la corrida muestra lo que lleva el paquete y el enlace a la versión en npm.
5. Se comprueba con `npm view mexicoapi@<versión>`. En npmjs.com, la página de la versión muestra la procedencia (Provenance) con el commit y la corrida.

`mexicoapi-mcp` lleva su propia versión y su etiqueta `mexicoapi-mcp@<versión>`. La regla: cada versión de `mexicoapi` va seguida de un *patch* de `mexicoapi-mcp`, en dos pasos y en este orden:

1. Se publica `mexicoapi@<versión>` con su Release, como arriba.
2. Un PR sube la versión *patch* de `packages/mcp/package.json` y agrega a `packages/mcp/CHANGELOG.md` su sección con fecha; si el patch solo sube el piso de `mexicoapi`, basta una línea que lo diga (por ejemplo, "Sube la dependencia a `mexicoapi` ^0.1.1."). Con ese commit integrado y CI en verde se crea el Release `mexicoapi-mcp@<versión>`. El workflow arma el servidor con `publicable.ts --publicar`, que pone la dependencia en `^<versión nueva>` y se niega si el paso 1 no está en npm.

El motivo: `^` basta para las instalaciones nuevas, pero npx guarda lo que instaló y no actualiza las dependencias de un paquete que no cambió de versión. Quien ya usó `npx -y mexicoapi-mcp` seguiría con los datos viejos. Con el *patch* del servidor, npx ve una versión nueva de `mexicoapi-mcp` cuyo piso ya no cumple la instalación vieja, y la reinstala con la `mexicoapi` nueva. Una versión menor de `mexicoapi` (0.2.0) queda fuera de `^0.1.0` y sigue la misma regla: el servidor sale con `^0.2.0`.

## Qué revisa `publicacion.yml`

Corre con cada Release publicado y tiene dos jobs. `preparar` no puede publicar (no tiene `id-token`) y revisa, en este orden; la primera revisión que falla detiene la corrida sin publicar nada:

| Revisión | Si falla |
| --- | --- |
| La etiqueta es `mexicoapi@X.Y.Z` o `mexicoapi-mcp@X.Y.Z` y el Release no es pre-release. Por ahora no se publican pre-versiones. | Borra el Release y su etiqueta (`gh release delete <etiqueta> --cleanup-tag`) y créalo bien. |
| El `package.json` del paquete tiene ese nombre y esa versión. | El Release está sobre un commit anterior al PR de la versión: bórralo y créalo sobre el commit correcto. |
| El primer encabezado del `CHANGELOG.md` es `## <versión> (AAAA-MM-DD)`. | Falta la sección o todavía dice "(sin publicar)": se arregla en un PR y se crea el Release otra vez sobre el commit nuevo. |
| El commit de la etiqueta está en `main`. | La etiqueta apunta a una rama sin integrar: solo se publica lo que ya está en `main`. |
| La corrida más reciente del check `verify` de `ci.yml` terminó en verde en ese commit. | Si todavía corre, espera a que termine y usa Re-run all jobs. Si falló, se arregla en un PR. Si el commit no tiene `verify`, no es el último de un push a `main`. |
| npm: el paquete existe y la versión es mayor que todas las publicadas (`npm view <paquete> versions`). | Si el paquete no existe (404), la corrida termina en verde con un aviso y no publica: la primera versión va a mano. Si la versión ya está o es menor, sube la versión en un PR nuevo. Si npm no responde, Re-run all jobs. |
| Compila el paquete y lo arma con su `publicable.ts`; `mexicoapi-mcp` con `--publicar`, que exige `mexicoapi@<versión de packages/sdk>` en npm. | Lo mismo que en el job `paquete` de CI. En `mexicoapi-mcp`, publica antes esa versión de `mexicoapi`. |

`preparar` deja en el resumen de la corrida lo que lista `npm pack --dry-run` y sube la carpeta armada como artefacto, que dura un día. `publicar` corre solo si `preparar` terminó con algo que publicar: en el Environment `npm`, con `id-token: write` y sin checkout ni compilación. Revisa que npm sea 11.5.1 o posterior (el mínimo para el publicador de confianza) y que la carpeta sea del paquete y la versión del Release, y corre `npm publish --provenance --access public` en ella. Si npm responde E404, ENEEDAUTH o un error de OIDC, casi siempre es la configuración del publicador de confianza (ver arriba): revísala, o créala otra vez si caducó, y usa Re-run all jobs.

Re-run all jobs vuelve a correr sobre el mismo commit. Si el arreglo necesita un commit nuevo, borra el Release y su etiqueta y créalos otra vez sobre ese commit: mientras la versión no esté en npm, el número se puede reutilizar.

Las revisiones de la etiqueta, el `package.json`, el historial, `verify` y npm están en `packages/sdk/scripts/liberacion.ts`, con sus pruebas. El workflow no usa caché, fija cada acción por SHA y corre una vez a la vez por etiqueta.
