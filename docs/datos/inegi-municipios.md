# Municipios (INEGI)

Los municipios y alcaldías con su clave geoestadística (CVEGEO), del Catálogo Único de Claves de Áreas Geoestadísticas del INEGI.

- Identificador: `inegi.municipios`
- Registros: uno por municipio o alcaldía; el total está en `records` del manifiesto y en `/v1/status`
- Clave: `cvegeo`
- Se actualiza: cada semana (lunes); si más del 0.5 % de los municipios tiene altas, bajas o cambios, el cambio va a revisión humana. En `/v1/status` cuenta como desactualizado si pasan 216 horas sin una revisión correcta
- Datos en el repositorio: `data/inegi-municipios/`

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `cvegeo` | texto, 5 dígitos | `"25006"` | Clave del estado más clave del municipio |
| `cve_ent` | texto, 2 dígitos | `"25"` | Clave del estado |
| `cve_mun` | texto, 3 dígitos | `"006"` | Clave del municipio dentro del estado |
| `nombre` | texto | `"Culiacán"` | Nombre oficial, tal como lo publica el INEGI |
| `cve_cabecera` | texto, 4 dígitos, o `null` | `"0001"` | Clave de la localidad cabecera |

Las claves son texto con ceros a la izquierda.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/municipios`, `GET /v1/municipios/{cvegeo}` y `GET /v1/estados/{cve_ent}/municipios` |
| Descarga | `/descargas/inegi-municipios.json`, `.csv` y `.manifest.json` |
| SQLite | tabla `municipios` de `/descargas/mexicoapi.sqlite` |

`GET /v1/municipios` pesa unos 240 KB (unos 35 KB con gzip). Si necesitas todos los municipios, la descarga trae lo mismo. Ver [API v1](../api/README.md).

## Fuente y licencia

- Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio `wscatgeo` v2 (https://gaia.inegi.org.mx/wscatgeo/v2/), con una consulta por estado.
- Licencia: términos de libre uso de la información del INEGI (https://www.inegi.org.mx/inegi/terminos.html). Se puede usar, incluso con fines comerciales, citando al INEGI como fuente.
- Cita: "INEGI. Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio wscatgeo v2."

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- `cve_cabecera` es `null` en las 16 alcaldías de la Ciudad de México: la fuente no les asigna cabecera (envía "----").
- La clave de municipio coincide con la de SEPOMEX (`c_estado` más `c_mnpio`), lo que permite unir ambos catálogos.
- MéxicoAPI normaliza los textos a NFC y quita espacios sobrantes; los nombres no se corrigen.
- Los 32 archivos originales (uno por estado) se guardan en `data/inegi-municipios/raw/`, con su hash en el manifiesto.
