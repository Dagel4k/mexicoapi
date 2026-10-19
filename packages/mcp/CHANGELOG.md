# Cambios

## 0.2.0 (sin publicar)

- Usa `mexicoapi` 0.2.0 (`^0.2.0`).
- `validar_clabe`: el resultado trae `banco_revisado` (siempre `true`), requerido en su `outputSchema`. La nota es la de la CLABE, sin el SAT, RENAPO ni el IMSS; cada validador tiene la suya.
- Cambia el texto de la advertencia de los datos del paquete que pueden no estar al día: "Respuesta con los datos del paquete mexicoapi, no de la API: pueden faltar publicaciones recientes." Antes nombraba `MEXICOAPI_SIN_RED=1`. Es la misma del cliente de `mexicoapi` y sale una sola vez.
- `tipo_de_cambio_fix` dice que las fechas son días de America/Mexico_City; con `publicado` en un día sin publicación, el error sugiere `operacion`.
- `sumar_dias_habiles`: con `declaraciones_pagos`, advertencia nueva si el resultado cae fuera de las vacaciones publicadas del SAT; con `sat` y `general` fuera de su cobertura, el error sugiere `permitir_incompleto`.
- Si la API responde con una redirección, con un cuerpo de más de 8 MB o con `data` de otro tipo, las herramientas de datos que caducan responden con los datos del paquete y la advertencia de respaldo. Antes la redirección se seguía y `data` de otro tipo daba un error de la herramienta.
- `dias_inhabiles` y `sumar_dias_habiles` con `lft`: los días anteriores al 2024-10-01 citan el texto del art. 74 vigente entonces, el de la reforma del DOF 17-01-2006, con su `fecha_publicacion`. Las fechas no cambian.
- `MEXICOAPI_SIN_RED` acepta `1`, `true`, `yes`, `si` u `on` para no usar la red y `0`, `false`, `no`, `off` o vacía para consultar la API, sin distinguir mayúsculas. Otro valor hace que el servidor no arranque (código 2, con un mensaje en stderr). Antes solo `1` apagaba la red y cualquier otro valor la dejaba encendida sin avisar.
- Nuevas herramientas, sin red y con los datos del paquete: `estados` (las 32 entidades con su clave, nombre y abreviatura) y `municipios_de_estado` (todos los municipios y alcaldías de un estado, cada uno con su `cvegeo` y su nombre, con `total` y el estado; el estado va por `cve_ent` o por su nombre o abreviatura, sin distinguir mayúsculas ni acentos, también nombres de uso común como "Edomex", "Distrito Federal" o "Querétaro de Arteaga"; un nombre que no es de un solo estado da error, y "México" sin más también, porque puede ser el Estado de México o la Ciudad de México). Antes no había forma de listar los municipios de un estado y `buscar_municipio` con un texto corto daba solo parte de ellos.
- Nuevo tipo de error `[sin-conexion]`, propio del servidor y no de la API: el cliente no llegó a la API (sin conexión o tiempo agotado) y los datos del paquete no bastan para responder. Antes era `[error-interno]` o, si el paquete no tenía el dato todavía, su tipo (`[dato-no-disponible]`, `[calendario-incompleto]`), que no decía que la API no se pudo consultar; ahora el texto da primero la falla de conexión y después lo que dijo el paquete. Las respuestas definitivas del paquete (`[no-encontrado]`, `[parametro-invalido]`) no cambian.
- Nuevo: `avisos` en el `structuredContent` de cada herramienta (y en `datos` de `sumar_dias_habiles`), requerido en su `outputSchema`: las mismas advertencias con un código estable, como en la API. El texto no cambia.

## 0.1.0 (2026-10-18)

Primera versión.

- Servidor MCP por stdio, de solo lectura: ninguna herramienta escribe, borra ni hace peticiones arbitrarias.
- 13 herramientas: municipios, bancos, validadores de CLABE, RFC, CURP y NSS, FIX, UDIS, días inhábiles y hábiles, constantes (UMA, salario mínimo e ISR) y códigos postales.
- Las herramientas de datos que caducan consultan la API pública de MéxicoAPI (o la de `MEXICOAPI_BASE`) y avisan si usan el paquete; con `MEXICOAPI_SIN_RED=1` funciona sin red con los datos del paquete `mexicoapi`.
- Cada resultado trae texto en español y `structuredContent` con su `outputSchema`, la fuente oficial, la fecha de corte y el origen.
- Cada error de herramienta empieza con su tipo de problema, los de la API: `[no-encontrado] …`, `[dato-no-disponible] …`.
- Requiere Node 22.13 o posterior.
