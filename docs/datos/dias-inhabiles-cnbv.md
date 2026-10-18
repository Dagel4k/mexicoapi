# Días inhábiles de la CNBV

Días en que las entidades financieras supervisadas por la Comisión Nacional Bancaria y de Valores (bancos, casas de bolsa y demás entidades que enumeran las disposiciones) deben cerrar sus puertas y suspender operaciones. Sirve para contar plazos con el calendario bancario.

- Identificador: `dias-inhabiles.cnbv`
- Clave: `fecha`
- Se actualiza: a mano, cuando la CNBV publica en el DOF las disposiciones de un nuevo año; el cambio entra por PR revisado
- Datos en el repositorio: `data/dias-inhabiles-cnbv/` (generado) y `data/curado/dias-inhabiles-cnbv.yaml` (la transcripción)

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `fecha` | texto `AAAA-MM-DD` | `"2026-02-02"` | Día inhábil |
| `autoridad` | texto | `"cnbv"` | Siempre `cnbv` en este dataset |
| `motivo` | texto | `"Primer lunes de febrero, en conmemoración del 5 de febrero"` | Fecha o regla de las disposiciones. En los días de regla, la regla con la que se calculó la fecha |
| `tipo` | texto | `"descanso"` | Siempre `descanso` en este dataset |
| `fuente` | objeto | ver abajo | Publicación del DOF que establece el día |

Los sábados y domingos también son inhábiles (fracción IX del artículo 1), pero no se listan: el calendario los agrega solo. Una fecha de las disposiciones que cae en fin de semana sí aparece, como el 12 de diciembre de 2026, que es sábado.

## Fuente de cada registro

Cada día trae su `fuente` completa:

| Campo | Descripción |
| --- | --- |
| `nombre` | Título de las disposiciones |
| `url` | Nota del DOF |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`) |
| `fragmento` | Artículo 1 de las disposiciones, citado tal cual; `[...]` marca texto omitido |

## Cobertura

La lista está completa solo dentro del rango que declara `cobertura` en el YAML. Fuera de ese rango no se puede saber si un día es inhábil, así que un cálculo de plazos que lo cruce no debe tomar como hábil un día que no aparece. Cuando la CNBV publique el calendario de un año nuevo, se agregan sus días y se extiende la cobertura.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| Repositorio | `data/dias-inhabiles-cnbv/dias-inhabiles.json` y `manifest.json` |
| Transcripción con citas | `data/curado/dias-inhabiles-cnbv.yaml` |

## Fuentes y licencia

- Fuente: las disposiciones de carácter general que señalan los días del año en que las entidades financieras sujetas a la supervisión de la CNBV deberán cerrar sus puertas y suspender operaciones, publicadas en el Diario Oficial de la Federación (una por año).
- Licencia: texto oficial publicado en el DOF, que no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII).
- Cita: el nombre de las disposiciones, "Diario Oficial de la Federación" y la fecha de publicación. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- Las fechas de regla ("primer lunes de febrero", "tercer lunes de noviembre") se guardan ya calculadas, con la regla en `motivo`. La verificación las recalcula y falla si no coinciden.
- Las disposiciones permiten a cada entidad abrir o cerrar en otros días con aviso a la CNBV, así que el calendario efectivo de una entidad puede variar.
- Las disposiciones también dicen que los almacenes generales de depósito y las casas de cambio pueden abrir y operar todos los días del año.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
