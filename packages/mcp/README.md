# mexicoapi-mcp

Servidor MCP (Model Context Protocol) con datos de referencia oficiales de México, para que un asistente consulte el dato publicado en vez de inventarlo: municipios, bancos y CLABE, RFC, CURP y NSS, tipo de cambio FIX, UDIS, días inhábiles y hábiles, UMA, salario mínimo, tarifas de ISR y códigos postales.

- Corre en tu equipo y habla con el cliente por stdio.
- Es de solo lectura: ninguna herramienta escribe, borra ni hace peticiones arbitrarias.
- Los datos que caducan (FIX, UDIS, calendarios y constantes) se piden a la API pública de MéxicoAPI y, si no responde, salen del paquete [`mexicoapi`](https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#readme); los demás salen siempre del paquete. Con `MEXICOAPI_SIN_RED=1` funciona sin red. Cada resultado trae su fuente oficial, su fecha de corte y su origen.

## Requisitos

Node 22.13 o posterior.

## Configuración

En la configuración de servidores MCP de tu cliente:

```json
{
  "mcpServers": {
    "mexicoapi": {
      "command": "npx",
      "args": ["-y", "mexicoapi-mcp"]
    }
  }
}
```

Cada cliente guarda este bloque en su propio archivo; revisa su documentación para saber cuál. En Windows, si el cliente no encuentra `npx`, usa `"command": "cmd"` y `"args": ["/c", "npx", "-y", "mexicoapi-mcp"]`.

### La API: MEXICOAPI_BASE y MEXICOAPI_SIN_RED (opcionales)

Las herramientas de datos que caducan (FIX, UDIS, días inhábiles y hábiles, UMA, salario mínimo e ISR) consultan la API pública de MéxicoAPI, https://mexicoapi.dagel4k.workers.dev, y si no responde usan los datos del paquete `mexicoapi` y lo advierten. Las demás nunca usan la red.

- `MEXICOAPI_BASE` cambia la dirección de la API, por ejemplo a un despliegue propio o a la API local de `wrangler dev`.
- `MEXICOAPI_SIN_RED=1` hace que el servidor responda todo con los datos del paquete y no use la red, aunque haya `MEXICOAPI_BASE`.

```json
{
  "mcpServers": {
    "mexicoapi": {
      "command": "npx",
      "args": ["-y", "mexicoapi-mcp"],
      "env": { "MEXICOAPI_BASE": "http://127.0.0.1:8787" }
    }
  }
}
```

Una dirección inválida (con credenciales, query o fragmento) hace que el servidor no arranque: sale con código 2 y un mensaje en stderr que no repite la dirección.

## Herramientas

| Herramienta | Qué hace | Red |
| --- | --- | --- |
| `buscar_municipio` | Busca municipios y alcaldías por nombre en el catálogo de INEGI | No |
| `municipio` | Un municipio por su clave geoestadística (`cvegeo`) | No |
| `validar_clabe` | Valida una CLABE (dígito de control y banco) | No |
| `banco_por_codigo` | Un banco o participante del SPEI por su código de 3 dígitos | No |
| `validar_rfc` | Valida el formato de un RFC; el dígito verificador de la homoclave se revisa, pero si no coincide solo se avisa y el RFC no se marca inválido | No |
| `validar_curp` | Valida el formato y el dígito verificador de una CURP | No |
| `validar_nss` | Valida un NSS del IMSS | No |
| `tipo_de_cambio_fix` | FIX publicado un día, el que aplica a una operación o el más reciente | Sí, salvo con `MEXICOAPI_SIN_RED=1` |
| `udis` | Valor de la UDI de un día | Sí, salvo con `MEXICOAPI_SIN_RED=1` |
| `dias_inhabiles` | Días inhábiles de un año según la LFT, la CNBV o el SAT | Sí, salvo con `MEXICOAPI_SIN_RED=1` |
| `sumar_dias_habiles` | Suma días hábiles a una fecha con el calendario de la LFT, la CNBV (bancario) o el SAT, con advertencias de lo que no descuenta: con la LFT, los festivos y las suspensiones de labores del art. 715; con el SAT y `declaraciones_pagos`, la prórroga del art. 12 del CFF | Sí, salvo con `MEXICOAPI_SIN_RED=1` |
| `constantes` | UMA, salario mínimo y tarifas de ISR | Sí, salvo con `MEXICOAPI_SIN_RED=1` |
| `codigo_postal` | Estado, municipio y asentamientos de un código postal | No (lee la caché local) |

Todas declaran `readOnlyHint: true`, un esquema de entrada estricto y un `outputSchema`. `openWorldHint` es `true` solo en las que usan la red, es decir, en las de datos que caducan, salvo con `MEXICOAPI_SIN_RED=1`. Los validadores revisan formato y dígito verificador, y cada uno lo dice en su `nota`; no confirman que la cuenta, el RFC, la CURP o el NSS existan. `validar_clabe` siempre revisa el banco contra el catálogo (`banco_revisado: true`).

## Qué trae cada resultado

Cada resultado tiene un texto en español y `structuredContent`, que cumple el `outputSchema` de la herramienta:

```json
{
  "datos": { "fecha": "2026-10-01", "valor": "8.836029" },
  "as_of": "2026-10-18",
  "fuente": { "nombre": "Diario Oficial de la Federación (SIDOF): valor de la unidad de inversión (UDIS)", "url": "https://sidof.segob.gob.mx/" },
  "fuentes": [{ "nombre": "Diario Oficial de la Federación (SIDOF): valor de la unidad de inversión (UDIS)", "url": "https://sidof.segob.gob.mx/" }],
  "origen": "paquete",
  "advertencias": []
}
```

- `datos`: el valor pedido, con su propia fecha (la del valor).
- `as_of`: la fecha de corte del dataset, la de la última actualización que lo cambió. No es la fecha del valor. Es `null` en RFC, CURP y NSS (son algoritmos, no datos publicados) y en `codigo_postal` cuando Correos de México no dio la fecha; ahí `descargado` dice cuándo se descargó el catálogo.
- `fuente` y `fuentes`: la publicación oficial con su URL, para citarla. `fuente` es la primera de `fuentes`.
- `origen`: `api` si respondió la API (la pública o la de `MEXICOAPI_BASE`), `paquete` si salió de los datos y las reglas del paquete `mexicoapi`, o `cache_local` en `codigo_postal`.
- `advertencias`: lo que hay que decirle a quien pregunta, por ejemplo que la API falló o que un calendario puede estar incompleto.

Sin red (`MEXICOAPI_SIN_RED=1`), el FIX sin fecha (la publicación más reciente) y el FIX o las UDIS a 7 días o menos del último dato del paquete advierten que pueden faltar publicaciones recientes. Es el mismo umbral del cliente de `mexicoapi` (`DIAS_DATOS_RECIENTES`), que lo cuenta desde el último dato hasta hoy; por eso una respuesta puede traer las dos advertencias. Los calendarios y las constantes no lo necesitan: fuera de lo que cubre el paquete responden con error, nunca con un valor anterior.

Un error de la herramienta (un argumento inválido, un dato que no existe, un calendario que no cubre el periodo, una respuesta de la API con otra forma de la esperada) llega como resultado con `isError: true` y un texto que dice qué pasó. El texto empieza con su tipo de problema entre corchetes, los mismos de la API: `[parametro-invalido]` y `[parametro-faltante]` (hay que corregir la llamada), `[no-encontrado]` (el dato no existe), `[dato-no-disponible]` (todavía no se publica o no se ha cargado: puede llegar después), `[calendario-incompleto]`, `[demasiadas-peticiones]` y `[error-interno]` (sin conexión o una respuesta que no se esperaba). Por ejemplo: `[no-encontrado] No existe el banco 999.`

### Datos al día

Los datos del paquete `mexicoapi` tienen la fecha de corte de su versión. npx guarda lo que instala y no actualiza las dependencias de un paquete que no cambió de versión, así que una versión nueva de `mexicoapi` sola no le llega a quien ya usó el servidor. Por eso cada versión de `mexicoapi` va seguida de una de `mexicoapi-mcp` que pide esa versión como mínimo: npx ve que hay una nueva y la instala con los datos nuevos. `as_of` y las advertencias dicen siempre de cuándo es cada dato.

## Códigos postales (SEPOMEX)

El catálogo de códigos postales es de Correos de México y no se puede redistribuir, así que ni este paquete ni `mexicoapi` lo traen. Para que `codigo_postal` funcione, descárgalo una vez en tu equipo:

```bash
npx mexicoapi sepomex sync
```

El comando muestra el aviso de uso de Correos de México y guarda el catálogo en tu caché local (`%LOCALAPPDATA%\mexicoapi\sepomex` en Windows y `$XDG_CACHE_HOME/mexicoapi/sepomex` o `~/.cache/mexicoapi/sepomex` en los demás). El servidor solo lee esa caché. Sin catálogo, `codigo_postal` responde con error y el comando para descargarlo. Cada resultado trae el aviso de uso, y el uso que hagas de esos datos queda sujeto a los términos de Correos de México. Los detalles están en el [README de `mexicoapi`](https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#c%C3%B3digos-postales-sepomex).

## Privacidad

- No hay telemetría.
- El servidor no envía a ninguna API una CLABE, un RFC, una CURP o un NSS: los valida en tu equipo, también cuando consulta la API.
- Eso cubre solo al servidor. El host del asistente (la aplicación que lo corre) sí manda al proveedor del modelo los argumentos de cada herramienta y sus resultados, como el resto de la conversación. Si un dato no debe salir de tu equipo, no se lo des al asistente.
- El servidor solo habla con la API pública de MéxicoAPI, o con la dirección de `MEXICOAPI_BASE`, y solo para las herramientas de datos que caducan. Con `MEXICOAPI_SIN_RED=1` no usa la red.
- Los registros van a stderr y nunca traen los argumentos de una herramienta ni la dirección de `MEXICOAPI_BASE`.

## Protocolo

- Transporte stdio: un mensaje JSON-RPC por línea.
- Versiones de MCP: 2025-11-25, 2025-06-18, 2025-03-26 y 2024-11-05. Con un cliente que pide otra, responde con 2025-11-25.
- Capacidades: solo `tools`, sin `listChanged`.
- Probado con el cliente oficial de MCP para TypeScript, que lista las herramientas, las llama y valida cada resultado contra su `outputSchema`.

## Licencias

El código es [MIT](https://github.com/Dagel4k/mexicoapi/blob/main/LICENSE). Los datos no son del proyecto: conservan los términos de la institución que los publica (INEGI, Banxico, DOF, CNBV, SAT, CONASAMI), y cada resultado dice su fuente. El detalle está en [DATA_LICENSE.md](https://github.com/Dagel4k/mexicoapi/blob/main/DATA_LICENSE.md).
