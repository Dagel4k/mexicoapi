# UMA (INEGI)

Unidad de medida y actualización: la referencia en pesos con la que se calculan los montos que las leyes expresan en UMA, en lugar del salario mínimo. El INEGI publica en el DOF, cada enero, el valor diario, el mensual y el anual.

- Identificador: `constantes.uma`
- Clave: `anio`
- Se actualiza: a mano, una vez al año, cuando el INEGI publica la UMA en el DOF; el cambio entra por PR revisado
- Datos en el repositorio: `data/constantes-uma/` (generado) y `data/curado/constantes-uma.yaml` (la transcripción)

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `anio` | número | `2026` | Año de la UMA |
| `diaria` | texto, dos decimales | `"117.31"` | Valor diario en pesos |
| `mensual` | texto, dos decimales | `"3566.22"` | Valor mensual en pesos: la diaria por 30.4 |
| `anual` | texto, dos decimales | `"42794.64"` | Valor anual en pesos: la mensual por 12 |
| `vigencia_desde` | texto `AAAA-MM-DD` | `"2026-02-01"` | Primer día de vigencia |
| `fuente` | objeto | ver abajo | Publicación del INEGI en el DOF |

Los montos son texto con dos decimales y sin separador de miles, para no perder precisión al leerlos.

## Vigencia

Cada valor rige del 1 de febrero del año al 31 de enero del siguiente. En enero sigue vigente la UMA del año anterior: para una fecha de enero de 2026 corresponde la UMA de 2025.

## Fuente de cada registro

| Campo | Descripción |
| --- | --- |
| `nombre` | Nombre de la publicación |
| `url` | Nota del DOF |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`) |
| `fragmento` | Texto oficial con las tres cifras, citado tal cual (con su ortografía, como "1o." o "1 º"); `[...]` marca texto omitido |

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/constantes/uma?fecha=` y `GET /v1/constantes/uma/{anio}` |
| Descarga | `/descargas/constantes-uma.json`, `.csv` y `.manifest.json` |
| SQLite | tabla `uma` de `/descargas/mexicoapi.sqlite` |
| Repositorio | `data/constantes-uma/uma.json` y `manifest.json` |
| Transcripción con citas | `data/curado/constantes-uma.yaml` |

Ver [API v1](../api/README.md#uma).

## Fuente y licencia

- Fuente: INEGI, "Unidad de medida y actualización", publicada cada año en el Diario Oficial de la Federación.
- Licencia: términos de libre uso de la información del INEGI (https://www.inegi.org.mx/inegi/terminos.html). Se puede usar, incluso con fines comerciales, citando al INEGI como fuente.
- Cita: "INEGI. Unidad de medida y actualización. Diario Oficial de la Federación", con la fecha y la URL de cada año. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- La verificación comprueba en cada año que la mensual sea la diaria por 30.4 y la anual la mensual por 12 (redondeadas a centavos), que la vigencia empiece el 1 de febrero y que el fragmento contenga las tres cifras tal como se publicaron. Un dígito mal capturado hace fallar la verificación.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
