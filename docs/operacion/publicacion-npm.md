# Publicación en npm

El paquete `mexicoapi` (`packages/sdk`) está listo para publicarse, pero todavía no hay versión en npm. El workflow que publicará con procedencia desde GitHub Actions (`publicacion.yml`) todavía no existe: llega en una etapa posterior del proyecto. Mientras tanto, este documento dice cómo se arma el paquete, qué hay que preparar en npm una sola vez y cómo se publica la primera versión a mano.

## Cómo se arma el paquete

El `package.json` de `packages/sdk` trae cosas que solo sirven en el monorepo: `devDependencies` con `@mexicoapi/core` (`workspace:*`) y wrangler, y `scripts` que llaman a archivos que no viajan en el paquete. Por eso el paquete no se empaqueta desde ahí:

1. `pnpm --filter "mexicoapi..." build` compila el núcleo y después el paquete (el núcleo queda copiado en `dist/nucleo`).
2. `node packages/sdk/scripts/publicable.ts <destino>` arma en `<destino>` (una carpeta nueva o vacía, fuera de `packages/sdk`) lo que lista `files` (`dist`, `README.md` y `LICENSE`) y un `package.json` igual al del repositorio sin `devDependencies` ni `scripts`. Antes de escribir revisa que exista cada archivo que declaran `exports`, `main`, `types` y `bin`, y falla si el manifiesto nombra un paquete `@mexicoapi/` o un rango `workspace:`.
3. `npm pack` y `npm publish` se corren dentro de `<destino>`. Así el `.tgz` y lo que npm registra de la versión salen del mismo manifiesto.

Un `npm pack` o `npm publish` en `packages/sdk` falla a propósito (el `prepack` lo rechaza con un mensaje que dice qué hacer).

En CI, el job `paquete` de `ci.yml` hace estos tres pasos con el Node de `.nvmrc` y sube el `.tgz` como artefacto; `paquete-node` lo instala en un proyecto nuevo con Node 20, 22 y 24 y corre la prueba de humo. `pnpm --filter mexicoapi test:paquete` (dentro de `verify.sh`) hace lo mismo con el Node local y además levanta un Worker en workerd que usa el paquete instalado.

Hoy (0.1.0) el paquete tiene 145 archivos: unos 180 kB comprimido y 900 kB sin comprimir.

## Preparación en npm (una vez)

1. Crea una cuenta en [npmjs.com](https://www.npmjs.com/signup). El nombre de usuario y el correo de la cuenta aparecen en los metadatos públicos de cada paquete que publiques (`maintainers`), así que usa un correo que no te importe mostrar.
2. Activa la verificación en dos pasos en Account Settings, Two-Factor Authentication, con el modo que la pide para iniciar sesión y para publicar (Authorization and writes). Usa una llave de seguridad o una app de códigos y guarda los códigos de recuperación.
3. Revisa que los nombres sigan libres: `npm view mexicoapi` y `npm view mexicoapi-mcp` responden 404 si nadie los tiene (libres el 2026-10-18). npm no reserva nombres sin publicar y su política no permite paquetes de relleno: el nombre se toma con la primera versión real. `mexicoapi` se toma con la 0.1.0 (siguiente sección); `mexicoapi-mcp`, con la primera versión del servidor MCP, cuando exista, con estos mismos pasos.

## Primera versión, a mano

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

Lo mismo se repite para `mexicoapi-mcp` cuando exista: cada paquete tiene su propia configuración.

## Cómo se corta una versión

Con el workflow de publicación (pendiente):

1. Un PR a `main` cambia la versión de `packages/sdk/package.json` con semver: los datos nuevos son un cambio *patch*; mientras el paquete esté en 0.x, un cambio que rompe la API sube la versión menor.
2. Con el PR integrado y CI en verde, se crea la etiqueta `mexicoapi@<versión>` sobre ese commit.
3. `publicacion.yml` corre por la etiqueta en el Environment `npm`, en un runner de GitHub (npm no acepta runners propios), con `permissions: id-token: write`, Node 22.14 o posterior y npm 11.5.1 o posterior. Compila con `pnpm --filter "mexicoapi..." build`, arma el paquete con `publicable.ts` y corre `npm publish` en esa carpeta. Con un repositorio público, npm agrega la procedencia sola.

Hasta que exista ese workflow, cada versión se publica a mano como la primera, sin procedencia.
