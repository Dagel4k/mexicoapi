# Publicación en npm

Los paquetes `mexicoapi` (`packages/sdk`) y `mexicoapi-mcp` (`packages/mcp`, el servidor MCP) están listos para publicarse, pero todavía no hay versión en npm. El workflow que publicará con procedencia desde GitHub Actions (`publicacion.yml`) todavía no existe: llega en una etapa posterior del proyecto. Mientras tanto, este documento dice cómo se arma cada paquete, qué hay que preparar en npm una sola vez y cómo se publica a mano la primera versión de cada uno. `mexicoapi-mcp` depende de `mexicoapi`, así que siempre se publica después.

## Cómo se arma `mexicoapi`

El `package.json` de `packages/sdk` trae cosas que solo sirven en el monorepo: `devDependencies` con `@mexicoapi/core` (`workspace:*`) y wrangler, y `scripts` que llaman a archivos que no viajan en el paquete. Por eso el paquete no se empaqueta desde ahí:

1. `pnpm --filter "mexicoapi..." build` compila el núcleo y después el paquete (el núcleo queda copiado en `dist/nucleo`).
2. `node packages/sdk/scripts/publicable.ts <destino>` arma en `<destino>` (una carpeta nueva o vacía, fuera de `packages/sdk`) lo que lista `files` (`dist`, `README.md` y `LICENSE`) y un `package.json` igual al del repositorio sin `devDependencies` ni `scripts`. Antes de escribir revisa que exista cada archivo que declaran `exports`, `main`, `types` y `bin`, y falla si el manifiesto nombra un paquete `@mexicoapi/` o un rango `workspace:`.
3. `npm pack` y `npm publish` se corren dentro de `<destino>`. Así el `.tgz` y lo que npm registra de la versión salen del mismo manifiesto.

Un `npm pack` o `npm publish` en `packages/sdk` falla a propósito (el `prepack` lo rechaza con un mensaje que dice qué hacer).

En CI, el job `paquete` de `ci.yml` hace estos tres pasos con el Node de `.nvmrc` y sube el `.tgz` como artefacto; `paquete-node` lo instala en un proyecto nuevo con Node 20, 22, 24 y 26 y corre la prueba de humo (`packages/sdk/test/paquete/humo.mjs`). `paquete-runtimes` lo instala igual y prueba lo que no es Node: Bun 1.4.3 y Deno 2.9.7 (este sin permisos) corren la prueba de las entradas universales (`packages/sdk/test/paquete/universal.mjs`, sin módulos de Node ni red), y `packages/sdk/scripts/navegador.ts` empaqueta cada entrada universal con el esbuild del lockfile (`platform: "browser"`, `format: "esm"`) y falla si alguna llega a un módulo de Node o si la principal pasa de 15 KB con gzip. El check `verify`, el que exige la protección de `main`, pasa solo si `verificacion` (que corre `verify.sh`), `paquete`, cada Node de `paquete-node`, `paquete-runtimes` y cada Node de `paquete-mcp` (siguiente sección) terminan bien: uno que falla, se salta o se cancela bloquea el merge. `pnpm --filter mexicoapi test:paquete` (dentro de `verify.sh`) hace lo mismo con el Node local, salvo Bun y Deno, y además levanta un Worker en workerd que usa el paquete instalado.

Hoy (0.1.0) el paquete tiene 145 archivos: unos 180 kB comprimido y 900 kB sin comprimir.

## Cómo se arma `mexicoapi-mcp`

Igual que `mexicoapi`, y con el mismo código: `packages/mcp/scripts/publicable.ts` usa el de `packages/sdk`. La diferencia es la dependencia `mexicoapi`, que en el monorepo es `workspace:*` y se publica como `^<versión de packages/sdk>` (hoy `^0.1.0`). Cada versión de `mexicoapi` va seguida de un *patch* de `mexicoapi-mcp` con ese piso (la regla está en "Cómo se corta una versión").

1. `pnpm --filter "mexicoapi-mcp..." build` compila el núcleo, `mexicoapi` y el servidor.
2. `node packages/mcp/scripts/publicable.ts <destino>` arma en `<destino>` (nuevo o vacío, fuera de `packages/mcp`) `dist`, `README.md`, `LICENSE` y el `package.json` sin `devDependencies` (el cliente oficial de MCP que usan las pruebas) ni `scripts`, con `mexicoapi` en `^` y la versión que lee de `packages/sdk/package.json`. Falla si queda un rango `workspace:` o un paquete `@mexicoapi/`, o si falta un archivo que declara `bin`. Con `--publicar` (`node packages/mcp/scripts/publicable.ts --publicar <destino>`) revisa además con `npm view` que `mexicoapi@<versión de packages/sdk>` ya esté en npm, y si no está (o npm no responde) se niega sin escribir nada: así ningún servidor sale con un piso que todavía no existe.
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

1. Desde `main` al día y con `./scripts/verify.sh` en verde, revisa la versión en `packages/sdk/package.json` (`0.1.0`).
2. Compila y arma el paquete fuera del repositorio:

   ```bash
   pnpm --filter "mexicoapi..." build
   node packages/sdk/scripts/publicable.ts ../mexicoapi-publicable
   cd ../mexicoapi-publicable
   ```

3. Revisa lo que se va a publicar: `npm pack --dry-run` (solo `dist/`, `README.md`, `LICENSE` y `package.json`) y el `package.json` (sin `devDependencies` ni `scripts`).
4. Publica: `npm login` (abre el navegador y pide el segundo factor) y después `npm publish --access public`, que pide el código otra vez.
5. Comprueba: `npm view mexicoapi` y, en una carpeta vacía, `npm install mexicoapi` y `npx mexicoapi clabe 002010077777777771`.
6. Marca el commit publicado con la etiqueta `mexicoapi@0.1.0` y súbela: `git tag mexicoapi@0.1.0 <commit>` y `git push origin mexicoapi@0.1.0`.
7. Borra `../mexicoapi-publicable`.
8. Actualiza el sitio. Mientras `PUBLICADO_EN_NPM` (en `packages/pipeline/src/sitio/comun.ts`) sea `false`, la página de inicio y `llms.txt` dicen que el paquete y el servidor MCP están pendientes de publicarse y que mientras tanto se use la API, sin comandos de instalación ni la configuración del servidor; con `true` aparecen. La constante cubre los dos paquetes: cámbiala a `true` en un PR cuando los dos estén en npm, ajusta las pruebas que la fijan en `false` y el despliegue de ese merge publica el sitio nuevo. Si `mexicoapi` sale antes que `mexicoapi-mcp`, el sitio sigue diciendo que ambos están pendientes hasta entonces.

## Primera versión de `mexicoapi-mcp`, a mano

Con `mexicoapi@0.1.0` ya en npm, y con los mismos pasos:

1. Desde `main` al día y con `./scripts/verify.sh` en verde, revisa la versión en `packages/mcp/package.json` (`0.1.0`).
2. Compila y arma el paquete fuera del repositorio. `--publicar` se niega si `mexicoapi@0.1.0` (la versión de `packages/sdk`) todavía no está en npm:

   ```bash
   pnpm --filter "mexicoapi-mcp..." build
   node packages/mcp/scripts/publicable.ts --publicar ../mexicoapi-mcp-publicable
   cd ../mexicoapi-mcp-publicable
   ```

3. Revisa lo que se va a publicar: `npm pack --dry-run` (solo `dist/`, `README.md`, `LICENSE` y `package.json`) y el `package.json` (sin `devDependencies` ni `scripts`, con `"mexicoapi": "^0.1.0"` en `dependencies`).
4. Publica con `npm publish --access public` (con la sesión de `npm login` y el segundo factor).
5. Comprueba: `npm view mexicoapi-mcp dependencies` y, en una carpeta vacía con un `package.json` de `"type": "module"`, `npm install mexicoapi-mcp`, copia ahí `packages/mcp/test/paquete/humo.mjs` y corre `node humo.mjs`, que termina con `humo: OK`.
6. Marca el commit publicado con la etiqueta `mexicoapi-mcp@0.1.0` y súbela.
7. Borra `../mexicoapi-mcp-publicable`.

Un número de versión publicado no se puede volver a usar, aunque la versión se retire. Si una versión sale mal, publica otra con el arreglo y marca la mala con `npm deprecate mexicoapi@<versión> "<motivo>"`; `npm unpublish` solo se permite en las primeras 72 horas y con condiciones.

## Después de la primera versión

En npmjs.com, en la página del paquete, Settings, Publishing access, elige la opción que exige dos pasos y no permite tokens. Publicar a mano con `npm login` y el segundo factor sigue funcionando.

## Publicador de confianza (cuando exista `publicacion.yml`)

El publicador de confianza hace que solo un workflow de este repositorio pueda publicar el paquete, sin tokens (usa OIDC). Una configuración nueva caduca si no publica nada en 2 días, así que se crea justo antes de la primera corrida del workflow, no antes:

1. En GitHub, crea el Environment `npm` (Settings, Environments) y limítalo a `main` y a las etiquetas `mexicoapi@*` en Deployment branches and tags.
2. En npmjs.com, en la página del paquete, Settings, Trusted Publisher, elige GitHub Actions y llena:
   - Organization or user: `Dagel4k`
   - Repository: `mexicoapi`
   - Workflow filename: `publicacion.yml` (solo el nombre del archivo, que vivirá en `.github/workflows/`)
   - Environment name: `npm`

   Los campos distinguen mayúsculas y npm no los revisa al guardar: un error solo aparece al publicar. `repository.url` del `package.json` (`git+https://github.com/Dagel4k/mexicoapi.git`) debe coincidir con el repositorio, y ya coincide.
3. Publica la siguiente versión con el workflow dentro de esos 2 días. Si la configuración caduca, bórrala y crea otra.

Lo mismo se repite para `mexicoapi-mcp`: cada paquete tiene su propia configuración, y el Environment `npm` admite también las etiquetas `mexicoapi-mcp@*`.

## Cómo se corta una versión

Con el workflow de publicación (pendiente):

1. Un PR a `main` cambia la versión de `packages/sdk/package.json` con semver: los datos nuevos son un cambio *patch*; mientras el paquete esté en 0.x, un cambio que rompe la API sube la versión menor.
2. Con el PR integrado y CI en verde, se crea la etiqueta `mexicoapi@<versión>` sobre ese commit.
3. `publicacion.yml` corre por la etiqueta en el Environment `npm`, en un runner de GitHub (npm no acepta runners propios), con `permissions: id-token: write`, Node 22.14 o posterior y npm 11.5.1 o posterior. Compila con `pnpm --filter "mexicoapi..." build`, arma el paquete con `publicable.ts` y corre `npm publish` en esa carpeta. Con un repositorio público, npm agrega la procedencia sola.

Hasta que exista ese workflow, cada versión se publica a mano como la primera, sin procedencia.

`mexicoapi-mcp` lleva su propia versión y su etiqueta `mexicoapi-mcp@<versión>`. La regla: cada versión de `mexicoapi` va seguida de un *patch* de `mexicoapi-mcp`, en dos pasos y en este orden:

1. Se publica `mexicoapi@<versión>` (etiqueta `mexicoapi@<versión>`).
2. Un PR sube la versión *patch* de `packages/mcp/package.json`. Con ese commit integrado se arma el servidor con `publicable.ts --publicar`, que pone la dependencia en `^<versión nueva>` y se niega si el paso 1 no está en npm, y se publica con la etiqueta `mexicoapi-mcp@<versión>`.

El motivo: `^` basta para las instalaciones nuevas, pero npx guarda lo que instaló y no actualiza las dependencias de un paquete que no cambió de versión. Quien ya usó `npx -y mexicoapi-mcp` seguiría con los datos viejos. Con el *patch* del servidor, npx ve una versión nueva de `mexicoapi-mcp` cuyo piso ya no cumple la instalación vieja, y la reinstala con la `mexicoapi` nueva. Una versión menor de `mexicoapi` (0.2.0) queda fuera de `^0.1.0` y sigue la misma regla: el servidor sale con `^0.2.0`. `publicacion.yml`, cuando exista, hará los dos pasos.
