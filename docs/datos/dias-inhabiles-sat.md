# Días inhábiles del SAT

Días que no cuentan en los plazos fiscales ante el SAT: los del artículo 12 del Código Fiscal de la Federación y los periodos de vacaciones y días inhábiles que fija la regla 2.1.6 de la Resolución Miscelánea Fiscal.

- Identificador: `dias-inhabiles.sat`
- Clave: `fecha`
- Se actualiza: las vacaciones, a mano, cuando el DOF publica la RMF de un año nuevo o una modificación a la regla 2.1.6; el cambio entra por PR revisado. Los días del artículo 12 no se capturan: los calcula una regla del núcleo
- Datos en el repositorio: `data/dias-inhabiles-sat/` (generado) y `data/curado/dias-inhabiles-sat.yaml` (la transcripción de las vacaciones)

Los días del primer párrafo del artículo 12 los fija la ley, no una publicación anual. El núcleo los calcula para cada año de 2026 a 2100, con el texto vigente del CFF (última reforma publicada en el DOF el 9 de abril de 2026). La API y los paquetes los usan para todos esos años; este dataset (el archivo, las descargas y el SQLite) los trae solo de los años que cubren las vacaciones capturadas, hoy 2026. Para otro año, `GET /v1/dias-inhabiles?autoridad=sat&anio=` los lista.

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `fecha` | texto `AAAA-MM-DD` | `"2026-07-20"` | Día inhábil |
| `autoridad` | texto | `"sat"` | Siempre `sat` en este dataset |
| `motivo` | texto | `"Primer periodo general de vacaciones de 2026"` | Fecha, regla o periodo. En los días de regla, la regla con la que se calculó la fecha |
| `tipo` | texto | `"vacaciones"` | `descanso` o `vacaciones`, ver abajo |
| `fuente` | objeto | ver abajo | Publicación que establece el día |

En la API, cada día de `/v1/dias-inhabiles` trae `fecha`, `motivo`, `tipo` y `fuente`; `autoridad` solo va en los archivos de `data/` y en las descargas.

Los sábados y domingos también son inhábiles (artículo 12 del CFF), pero no se listan: el calendario los agrega solo.

## Tipos de día

- `descanso`: los días del primer párrafo del artículo 12 del CFF (1o. de enero, primer lunes de febrero, etc.). No cuentan en ningún plazo.
- `vacaciones`: los días de la regla 2.1.6 de la RMF. El segundo párrafo del artículo 12 dice que en los plazos para presentar declaraciones y pagar contribuciones esos días se consideran hábiles; en los demás plazos no cuentan.

Los días de la fracción II de la regla 2.1.6 de la RMF 2026 (2 y 3 de abril de 2026) no son vacaciones generales, sino días inhábiles para el SAT. Se clasifican como `vacaciones` porque así, en los plazos de declaraciones y pagos, cuentan como hábiles: el plazo vence antes y no después, que es el lado seguro para el contribuyente.

El artículo 12 también excluye "el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo". Desde 2024 la transmisión es el 1o. de octubre y el artículo no se ha reformado, así que la regla no descuenta ninguno de los dos días en 2030 ni en los años de transmisión siguientes: el plazo vence antes, no después. La API lo advierte en esos años y en los cálculos que pasan por esos días.

## Fuente de cada registro

Cada día trae su `fuente` completa:

| Campo | Descripción |
| --- | --- |
| `nombre` | Nombre de la publicación |
| `url` | Nota del DOF o, para el CFF, el texto vigente en diputados.gob.mx |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`). En el CFF es la de su última reforma |
| `fragmento` | Texto oficial citado tal cual: el primer párrafo del artículo 12 o la fracción de la regla 2.1.6 que corresponde. `[...]` marca texto omitido y `...` es como el DOF publica las partes que una modificación no cambia |

La cita del artículo 12 es la misma en todos sus días: el primer párrafo con la fecha de la última reforma del CFF, la que guarda el núcleo.

## Cobertura

El YAML declara solo la cobertura de `vacaciones`, porque un periodo de vacaciones puede publicarse tarde: si el SAT todavía no publica el periodo de un tramo del año, la cobertura termina antes de ese tramo. La de `descanso` es la de la regla del artículo 12, de 2026 a 2100; el YAML no la declara.

Para un plazo general cuentan los dos tipos, así que el calendario está completo donde se cruzan ambas coberturas. Para un plazo de declaraciones y pagos las vacaciones no cuentan y basta la de `descanso`. Fuera de la cobertura no se puede saber si un día es inhábil.

Hoy `vacaciones` va del 2026-01-01 al 2026-11-30, porque el segundo periodo de vacaciones de 2026 no se ha publicado. Por tipo de plazo, en la API y en los paquetes:

| Tipo de plazo | Cobertura |
| --- | --- |
| `general` | del 2026-01-01 al 2026-11-30 |
| `declaraciones_pagos` | del 2026-01-01 al 2100-12-31 |

En las descargas la cobertura es la de la lista, que trae los días del artículo 12 solo de los años de las vacaciones capturadas: hoy `declaraciones_pagos` va del 2026-01-01 al 2026-12-31 y `general` del 2026-01-01 al 2026-11-30.

La lista de días por sí sola no dice hasta dónde está completa: en diciembre de 2026 no hay vacaciones listadas, y eso no quiere decir que no las haya. La cobertura de cada tipo de plazo en la lista viene aparte en `/descargas/dias-inhabiles-coberturas.json` y `.csv` y en la tabla `coberturas_calendario` del SQLite (con `autoridad` igual a `sat`), y la API manda la suya en el 422 `calendario-incompleto` y en las advertencias de `/v1/dias-inhabiles`.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/dias-habiles?autoridad=sat&tipo_plazo=` y `GET /v1/dias-inhabiles?autoridad=sat&anio=` |
| Descarga | `/descargas/dias-inhabiles-sat.json`, `.csv` y `.manifest.json`; la cobertura, en `/descargas/dias-inhabiles-coberturas.json` y `.csv` |
| SQLite | tablas `dias_inhabiles` y `coberturas_calendario` de `/descargas/mexicoapi.sqlite`, con `autoridad = 'sat'` |
| Repositorio | `data/dias-inhabiles-sat/dias-inhabiles.json`, `manifest.json` y `calendario.json`. `calendario.json` trae los tipos de plazo con la cobertura de la API (`declaraciones_pagos` hasta 2100, por la regla del artículo 12, que también cita los fines de semana), mientras `dias-inhabiles.json` solo trae los días de 2026 |
| Transcripción con citas | `data/curado/dias-inhabiles-sat.yaml` (solo las vacaciones) |

Ver [API v1](../api/README.md#sat-y-tipo-de-plazo).

## Fuentes y licencia

- Código Fiscal de la Federación, artículo 12, texto vigente publicado por la Cámara de Diputados (https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf).
- Resolución Miscelánea Fiscal de cada año y sus resoluciones de modificaciones, regla 2.1.6, publicadas en el Diario Oficial de la Federación.
- Licencia: textos legislativos y administrativos oficiales, que no son objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII).
- Cita: el nombre de la publicación, "Diario Oficial de la Federación" y la fecha; para el CFF, el texto vigente con la fecha de su última reforma. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- Los días del artículo 12 llevan en `motivo` la regla con que se calcularon ("Primer lunes de febrero, en conmemoración del 5 de febrero"). El YAML no los trae: si se captura uno, o la cobertura de `descanso`, `curar` y `verificar` fallan.
- El 1o. de diciembre de cada 6 años no se agrega (ver arriba).
- Un periodo de vacaciones se lista completo, incluidos los sábados y domingos que caen dentro.
- Si un día ya es de `descanso`, no se repite como `vacaciones`: la clave es la fecha, y `verificar` falla si el YAML trae unas vacaciones en un día del artículo 12. Por ejemplo, el 1o. de enero de 2026 cae dentro del segundo periodo de vacaciones de 2025, pero queda como `descanso`.
- El quinto párrafo del artículo 12 prorroga el plazo al siguiente día hábil si el último día están cerradas las oficinas o los bancos donde se hace el trámite, o si es viernes y el pago se hace en un banco. Depende de dónde se presenta, así que el cálculo no la aplica; la API lo advierte en los plazos de declaraciones y pagos cuando el resultado cae en viernes, en vacaciones publicadas o en un cierre de la CNBV. Un resultado dentro de un periodo de vacaciones que todavía no se publica no trae ese aviso.
- No se modelan las habilitaciones de días inhábiles ni las suspensiones de plazos por fuerza mayor o caso fortuito, que el artículo 12 permite a las autoridades fiscales y que se dan a conocer por separado.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
