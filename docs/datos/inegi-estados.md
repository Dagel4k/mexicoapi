# Estados (INEGI)

Los 32 estados con su clave, nombre y abreviatura, del Catálogo Único de Claves de Áreas Geoestadísticas del INEGI.

- Identificador: `inegi.estados`
- Registros: 32
- Clave: `cve_ent`
- Se actualiza: cada semana (lunes)
- Datos en el repositorio: `data/inegi-estados/`

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `cve_ent` | texto, 2 dígitos | `"25"` | Clave del estado. Conserva el cero a la izquierda |
| `nombre` | texto | `"Sinaloa"` | Nombre oficial, tal como lo publica el INEGI |
| `abreviatura` | texto | `"Sin."` | Abreviatura oficial |
| `cvegeo` | texto, 2 dígitos | `"25"` | Clave geoestadística; en estados es igual a `cve_ent` |

Las claves son texto, no número: `"09"` y no `9`.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/estados` y `GET /v1/estados/{cve_ent}` |
| Descarga | `/descargas/inegi-estados.json`, `.csv` y `.manifest.json` |
| SQLite | tabla `estados` de `/descargas/mexicoapi.sqlite` |

Ver [API v1](../api/README.md).

## Fuente y licencia

- Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio `wscatgeo` v2 (https://gaia.inegi.org.mx/wscatgeo/v2/).
- Licencia: términos de libre uso de la información del INEGI (https://www.inegi.org.mx/inegi/terminos.html). Se puede usar, incluso con fines comerciales, citando al INEGI como fuente.
- Cita: "INEGI. Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio wscatgeo v2."

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- MéxicoAPI normaliza los textos a NFC y quita espacios sobrantes; los nombres se dejan como los publica el INEGI (por ejemplo, "Coahuila de Zaragoza").
- La respuesta original de la fuente se guarda sin cambios en `data/inegi-estados/raw/`, y su hash va en el manifiesto.
