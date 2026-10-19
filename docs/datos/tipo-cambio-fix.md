# Tipo de cambio FIX (DOF)

El tipo de cambio FIX, que el Banco de México determina y publica en el Diario Oficial de la Federación (DOF) como tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana. La serie empieza en 2020.

- Identificador: `tipo-cambio.fix`
- Registros: uno por cada día con publicación en el DOF; el total está en `records` del manifiesto y de `/v1/status`, y la primera y la última fecha, en `cobertura` (`desde` y `hasta`) de `/v1/status`
- Clave: `fecha_publicacion`
- Se actualiza: a diario, a las 13:30 de la Ciudad de México. En `/v1/status` cuenta como desactualizado si pasan 72 horas sin una revisión correcta
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
- Para una operación, el artículo 20 del Código Fiscal de la Federación manda usar el FIX publicado el día anterior a la operación o, si ese día no hubo publicación, el último publicado antes. Esa regla la aplica la API al consultar; el archivo de datos solo trae las publicaciones.
- Después de la última publicación cargada, la API solo responde una operación si no falta ningún día en que pudo haber publicación: da por hecho que no hay FIX en fines de semana ni en los días de descanso del [calendario de la CNBV](dias-inhabiles-cnbv.md), dentro de su cobertura. De 2020 a octubre de 2026 ningún feriado bancario entre semana tiene FIX; si la corrida diaria trae uno, pide revisión.
- Los valores de los últimos días pueden no estar todavía: se cargan en la corrida diaria.
- `as_of` (en el manifiesto, en `meta` y en `/v1/status`) es la fecha de la última corrida del pipeline que cambió los datos, no la última fecha de la serie. Por ejemplo, con `as_of` 2026-10-18 (domingo) la última publicación es la del viernes 16, que es la que trae `cobertura.hasta`.
- La serie empieza el 2 de enero de 2020. Antes de esa fecha no hay datos.
- La respuesta original de la fuente se guarda sin cambios, un archivo por año, en `data/tipo-cambio-fix/raw/`, y su hash va en el manifiesto.
