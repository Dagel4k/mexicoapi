# mexicoapi-mcp

Servidor MCP (Model Context Protocol) con datos de referencia oficiales de México, para que un asistente consulte el dato publicado en vez de inventarlo: municipios, bancos y CLABE, RFC, CURP y NSS, tipo de cambio FIX, UDIS, días inhábiles y hábiles, UMA, salario mínimo, tarifas de ISR y códigos postales.

- Corre en tu equipo y habla con el cliente por stdio.
- Es de solo lectura: ninguna herramienta escribe, borra ni hace peticiones arbitrarias.
- Funciona sin red. Los datos salen del paquete [`mexicoapi`](https://github.com/Dagel4k/mexicoapi/tree/main/packages/sdk#readme) y cada resultado trae su fuente oficial, su fecha de corte y su origen.

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

### MEXICOAPI_BASE (opcional)

Sin `MEXICOAPI_BASE`, el servidor responde todo con los datos del paquete `mexicoapi` y no usa la red. Con ella, las herramientas de datos que caducan (FIX, UDIS, días inhábiles y hábiles, UMA, salario mínimo e ISR) consultan la API de MéxicoAPI en esa dirección y, si no responde, usan el paquete y lo advierten.

La API todavía no tiene dirección pública, así que por ahora solo sirve con un despliegue propio:

```json
{
  "mcpServers": {
    "mexicoapi": {
      "command": "npx",
      "args": ["-y", "mexicoapi-mcp"],
      "env": { "MEXICOAPI_BASE": "https://<tu-despliegue>" }
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
| `validar_rfc` | Valida el formato y la homoclave de un RFC | No |
| `validar_curp` | Valida el formato y el dígito verificador de una CURP | No |
| `validar_nss` | Valida un NSS del IMSS | No |
| `tipo_de_cambio_fix` | FIX publicado un día, el que aplica a una operación o el más reciente | Con `MEXICOAPI_BASE` |
| `udis` | Valor de la UDI de un día | Con `MEXICOAPI_BASE` |
| `dias_inhabiles` | Días inhábiles de un año según la LFT, la CNBV o el SAT | Con `MEXICOAPI_BASE` |
| `sumar_dias_habiles` | Suma días hábiles a una fecha con el calendario de la LFT, la CNBV o el SAT | Con `MEXICOAPI_BASE` |
| `constantes` | UMA, salario mínimo y tarifas de ISR | Con `MEXICOAPI_BASE` |
| `codigo_postal` | Estado, municipio y asentamientos de un código postal | No (lee la caché local) |

Todas declaran `readOnlyHint: true`, un esquema de entrada estricto y un `outputSchema`. `openWorldHint` es `true` solo en las que usan la red, es decir, en las de datos que caducan cuando hay `MEXICOAPI_BASE`. Los validadores revisan formato y dígito verificador; no confirman que la CLABE, el RFC, la CURP o el NSS existan.

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
- `origen`: `api` si respondió la API de `MEXICOAPI_BASE`, `paquete` si salió de los datos y las reglas del paquete `mexicoapi`, o `cache_local` en `codigo_postal`.
- `advertencias`: lo que hay que decirle a quien pregunta, por ejemplo que la API falló o que un calendario puede estar incompleto.

Sin `MEXICOAPI_BASE`, el FIX sin fecha (la publicación más reciente) y el FIX o las UDIS a 7 días o menos del último dato del paquete advierten que pueden faltar publicaciones recientes. Los calendarios y las constantes no lo necesitan: fuera de lo que cubre el paquete responden con error, nunca con un valor anterior.

Un error de la herramienta (un argumento inválido, un dato que no existe, un calendario que no cubre el periodo, una respuesta de la API con otra forma de la esperada) llega como resultado con `isError: true` y un texto que dice qué pasó.

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
- El servidor no envía a ninguna API una CLABE, un RFC, una CURP o un NSS: los valida en tu equipo, también con `MEXICOAPI_BASE`.
- Eso cubre solo al servidor. El host del asistente (la aplicación que lo corre) sí manda al proveedor del modelo los argumentos de cada herramienta y sus resultados, como el resto de la conversación. Si un dato no debe salir de tu equipo, no se lo des al asistente.
- Con `MEXICOAPI_BASE`, el servidor solo habla con esa dirección y solo para las herramientas de datos que caducan. Sin ella no usa la red.
- Los registros van a stderr y nunca traen los argumentos de una herramienta ni la dirección de `MEXICOAPI_BASE`.

## Protocolo

- Transporte stdio: un mensaje JSON-RPC por línea.
- Versiones de MCP: 2025-11-25, 2025-06-18, 2025-03-26 y 2024-11-05. Con un cliente que pide otra, responde con 2025-11-25.
- Capacidades: solo `tools`, sin `listChanged`.
- Probado con el cliente oficial de MCP para TypeScript, que lista las herramientas, las llama y valida cada resultado contra su `outputSchema`.

## Licencias

El código es [MIT](https://github.com/Dagel4k/mexicoapi/blob/main/LICENSE). Los datos no son del proyecto: conservan los términos de la institución que los publica (INEGI, Banxico, DOF, CNBV, SAT, CONASAMI), y cada resultado dice su fuente. El detalle está en [DATA_LICENSE.md](https://github.com/Dagel4k/mexicoapi/blob/main/DATA_LICENSE.md).
