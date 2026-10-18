# Días inhábiles del SAT

Días que no cuentan en los plazos fiscales ante el SAT: los del artículo 12 del Código Fiscal de la Federación y los periodos de vacaciones y días inhábiles que fija la regla 2.1.6 de la Resolución Miscelánea Fiscal.

- Identificador: `dias-inhabiles.sat`
- Clave: `fecha`
- Se actualiza: a mano, cuando el DOF publica la RMF de un año nuevo o una modificación a la regla 2.1.6; el cambio entra por PR revisado
- Datos en el repositorio: `data/dias-inhabiles-sat/` (generado) y `data/curado/dias-inhabiles-sat.yaml` (la transcripción)

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `fecha` | texto `AAAA-MM-DD` | `"2026-07-20"` | Día inhábil |
| `autoridad` | texto | `"sat"` | Siempre `sat` en este dataset |
| `motivo` | texto | `"Primer periodo general de vacaciones de 2026"` | Fecha, regla o periodo. En los días de regla, la regla con la que se calculó la fecha |
| `tipo` | texto | `"vacaciones"` | `descanso` o `vacaciones`, ver abajo |
| `fuente` | objeto | ver abajo | Publicación que establece el día |

Los sábados y domingos también son inhábiles (artículo 12 del CFF), pero no se listan: el calendario los agrega solo.

## Tipos de día

- `descanso`: los días del primer párrafo del artículo 12 del CFF (1o. de enero, primer lunes de febrero, etc.). No cuentan en ningún plazo.
- `vacaciones`: los días de la regla 2.1.6 de la RMF. El segundo párrafo del artículo 12 dice que en los plazos para presentar declaraciones y pagar contribuciones esos días se consideran hábiles; en los demás plazos no cuentan.

Los días de la fracción II de la regla 2.1.6 de la RMF 2026 (2 y 3 de abril de 2026) no son vacaciones generales, sino días inhábiles para el SAT. Se clasifican como `vacaciones` porque así, en los plazos de declaraciones y pagos, cuentan como hábiles: el plazo vence antes y no después, que es el lado seguro para el contribuyente.

## Fuente de cada registro

Cada día trae su `fuente` completa:

| Campo | Descripción |
| --- | --- |
| `nombre` | Nombre de la publicación |
| `url` | Nota del DOF o, para el CFF, el texto vigente en diputados.gob.mx |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`). En el CFF es la de su última reforma |
| `fragmento` | Texto oficial citado tal cual: el primer párrafo del artículo 12 o la fracción de la regla 2.1.6 que corresponde. `[...]` marca texto omitido y `...` es como el DOF publica las partes que una modificación no cambia |

## Cobertura

La cobertura se declara por tipo de día en el YAML (`cobertura.descanso` y `cobertura.vacaciones`), porque un periodo de vacaciones puede publicarse tarde: si el SAT todavía no publica el periodo de vacaciones de un tramo del año, la cobertura de `vacaciones` termina antes de ese tramo, aunque la de `descanso` siga.

Para un plazo general cuentan los dos tipos, así que la lista está completa donde se cruzan ambas coberturas. Para un plazo de declaraciones y pagos las vacaciones no cuentan y basta la cobertura de `descanso`. Fuera de la cobertura no se puede saber si un día es inhábil.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| Repositorio | `data/dias-inhabiles-sat/dias-inhabiles.json` y `manifest.json` |
| Transcripción con citas | `data/curado/dias-inhabiles-sat.yaml` |

## Fuentes y licencia

- Código Fiscal de la Federación, artículo 12, texto vigente publicado por la Cámara de Diputados (https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf).
- Resolución Miscelánea Fiscal de cada año y sus resoluciones de modificaciones, regla 2.1.6, publicadas en el Diario Oficial de la Federación.
- Licencia: textos legislativos y administrativos oficiales, que no son objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII).
- Cita: el nombre de la publicación, "Diario Oficial de la Federación" y la fecha; para el CFF, el texto vigente con la fecha de su última reforma. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- Las fechas de regla ("primer lunes de febrero", "tercer lunes de noviembre") se guardan ya calculadas, con la regla en `motivo`. La verificación las recalcula y falla si no coinciden.
- El 1o. de diciembre de cada 6 años, cuando corresponde a la transmisión del Poder Ejecutivo, solo se agrega en los años en que aplica.
- Un periodo de vacaciones se lista completo, incluidos los sábados y domingos que caen dentro.
- Si un día ya es de `descanso`, no se repite como `vacaciones`: la clave es la fecha. Por ejemplo, el 1o. de enero de 2026 cae dentro del segundo periodo de vacaciones de 2025, pero queda como `descanso`.
- No se modelan las habilitaciones de días inhábiles ni las suspensiones de plazos por fuerza mayor o caso fortuito, que el artículo 12 permite a las autoridades fiscales y que se dan a conocer por separado.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
