# UDIS (DOF)

El valor diario de la Unidad de Inversión (UDI) que el Banco de México publica en el Diario Oficial de la Federación (DOF). La serie empieza en 2020.

- Identificador: `udis`
- Registros: uno por cada día del calendario; el total y la última fecha están en `records` y `as_of` del manifiesto y en `/v1/status`
- Clave: `fecha`
- Se actualiza: a diario
- Datos en el repositorio: `data/udis/`

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `fecha` | fecha `AAAA-MM-DD` | `"2024-06-03"` | Día al que aplica el valor |
| `valor` | texto decimal, 6 decimales | `"8.146030"` | Pesos por UDI |

El valor es texto y no número, para no perder decimales ni el cero final: `"8.146030"`.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/udis?fecha=` |
| Descarga | `/descargas/udis.json`, `.csv` y `.manifest.json` |
| SQLite | tabla `udis` de `/descargas/mexicoapi.sqlite` |

Ver [API v1](../api/README.md#udis).

## Fuente y licencia

- Fuente: Diario Oficial de la Federación, Sistema de Información del Diario Oficial (SIDOF), indicador 159 (https://sidof.segob.gob.mx/).
- Licencia: publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente (https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html).
- Cita: "Banco de México. Valor de la unidad de inversión. Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/"

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- Hay un valor para cada día del calendario, incluidos fines de semana y feriados.
- Las UDIS se publican por adelantado, dos veces al mes, para los días siguientes. Por eso la serie llega unos días después de la fecha de la última corrida.
- La serie empieza el 1 de enero de 2020. Antes de esa fecha no hay datos.
- La respuesta original de la fuente se guarda sin cambios, un archivo por año, en `data/udis/raw/`, y su hash va en el manifiesto.
