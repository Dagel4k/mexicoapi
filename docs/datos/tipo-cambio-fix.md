# Tipo de cambio FIX (DOF)

El tipo de cambio FIX, que el Banco de México determina y publica en el Diario Oficial de la Federación (DOF) como tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana. La serie empieza en 2020.

- Identificador: `tipo-cambio.fix`
- Registros: uno por cada día con publicación en el DOF; el total y la última fecha están en `records` y `as_of` del manifiesto y en `/v1/status`
- Clave: `fecha_publicacion`
- Se actualiza: a diario
- Datos en el repositorio: `data/tipo-cambio-fix/`

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `fecha_publicacion` | fecha `AAAA-MM-DD` | `"2024-06-03"` | Día en que el DOF publicó el valor |
| `valor` | texto decimal, 4 decimales | `"17.0177"` | Pesos por dólar de Estados Unidos |

El valor es texto y no número, para no perder decimales: `"18.8642"`.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/tipo-cambio/fix?publicado=` o `?operacion=` y `GET /v1/tipo-cambio/fix/ultimo` |
| Descarga | `/descargas/tipo-cambio-fix.json`, `.csv` y `.manifest.json` |
| SQLite | tabla `tipo_cambio_fix` de `/descargas/mexicoapi.sqlite` |

Ver [API v1](../api/README.md#tipo-de-cambio-fix).

## Fuente y licencia

- Fuente: Diario Oficial de la Federación, Sistema de Información del Diario Oficial (SIDOF), indicador 158 (https://sidof.segob.gob.mx/).
- Licencia: publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente (https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html).
- Cita: "Banco de México. Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana. Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/"

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- `fecha_publicacion` es la fecha de publicación en el DOF, no el día al que se aplica el valor. El FIX se determina el día hábil bancario anterior a su publicación y solo hay registro en los días con publicación: no hay valores para fines de semana ni feriados bancarios.
- Para una operación, el artículo 20 del Código Fiscal de la Federación manda usar el FIX publicado el día hábil bancario anterior a la fecha de la operación. Esa regla la aplica la API al consultar; el archivo de datos solo trae las publicaciones.
- Los valores de los últimos días pueden no estar todavía: se cargan en la corrida diaria.
- La serie empieza el 2 de enero de 2020. Antes de esa fecha no hay datos.
- La respuesta original de la fuente se guarda sin cambios, un archivo por año, en `data/tipo-cambio-fix/raw/`, y su hash va en el manifiesto.
