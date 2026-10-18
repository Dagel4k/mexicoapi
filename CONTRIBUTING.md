# Contribuir a MéxicoAPI

Gracias por querer ayudar. Lo más útil, en este orden:

1. Reportar un dato que no coincide con el oficial.
2. Agregar una publicación nueva a los datos curados.
3. Corregir un fallo o mejorar el código.

## Reportar un dato incorrecto

Abre un issue con el formulario "Error en los datos". Pide el dataset, el valor que da MéxicoAPI, el valor correcto, la fecha de publicación y el enlace a la fuente oficial (una nota del DOF, una publicación del INEGI, de Banxico, del SAT). Sin esa fuente no se puede corregir nada: el dato de este proyecto solo se cambia contra una publicación oficial.

Si es un fallo de la API, del paquete, de las descargas o del sitio, usa el formulario "Fallo". No pegues datos personales; usa CURP, RFC o CLABE de ejemplo. Las vulnerabilidades no van en un issue: sigue [SECURITY.md](SECURITY.md).

## Preparar el entorno

- Node 24 (la versión de `.nvmrc`; `package.json` pide 24.2 o superior).
- pnpm, con la versión exacta de `packageManager` en `package.json`. Lo más simple es activarlo con Corepack: `corepack enable`.
- Git. En Windows, instala Git para Windows y corre `./scripts/verify.sh` desde Git Bash, porque es un script de bash.

```bash
pnpm install --frozen-lockfile
```

La instalación activa el hook de pre-commit de `.githooks/`, que revisa el formato con Biome y busca secretos con gitleaks si está instalado.

## Flujo de trabajo

- Una rama por cambio; no se trabaja directo en `main`.
- Commits pequeños, en español, en imperativo, con la primera línea de 60 caracteres o menos (por ejemplo `agrega validador de CLABE`).
- En el núcleo y los parsers se escribe primero la prueba que falla y después el código.
- Un cambio está terminado cuando `./scripts/verify.sh` termina en verde. Corre el formato, los tipos, las pruebas, el build y la verificación de los datos.
- Abre el PR contra `main`. La integración continua debe pasar.

## Datos curados

Los días inhábiles de la CNBV y el SAT, la UMA, el salario mínimo y las tarifas de ISR se transcriben a mano del DOF. El flujo:

1. Edita el YAML correspondiente en `data/curado/`, con la cita literal de la publicación.
2. Corre `pnpm -r build` y después `pnpm datos:curar` para generar la carpeta de `data/`.
3. Corre `pnpm datos:verificar`.

No edites a mano los JSON de `data/`: `verificar` los regenera desde el YAML y falla si no coinciden. Los demás datasets (estados, municipios, bancos, tipo de cambio, UDIS) los actualiza el bot; tampoco se tocan a mano. Los pasos completos, con ejemplos, están en [docs/operacion/datos-curados.md](docs/operacion/datos-curados.md).

## Licencias

El código tiene la licencia de [LICENSE](LICENSE) y los datos los términos de [DATA_LICENSE.md](DATA_LICENSE.md). No agregues dependencias con licencias no comerciales ni fuentes de datos que no se puedan redistribuir.
