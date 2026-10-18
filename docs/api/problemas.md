# Errores de la API

Los errores usan `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)). El campo `type` es un enlace a la sección de este documento con el mismo nombre que el tipo. Todas las respuestas de error llevan `Cache-Control: no-store`.

Campos de siempre: `type`, `title`, `status`, `detail` (el motivo, en español) e `instance` (la ruta pedida). Algunos tipos agregan campos propios, como `parametro`.

| Tipo | Status | Cuándo |
| --- | --- | --- |
| [`parametro-invalido`](#parametro-invalido) | 400 | Un valor no cumple su formato |
| [`parametro-desconocido`](#parametro-desconocido) | 400 | La ruta no acepta ese parámetro |
| [`parametro-faltante`](#parametro-faltante) | 400 | Falta un parámetro obligatorio |
| [`no-encontrado`](#no-encontrado) | 404 | No existe la ruta o el recurso |
| [`metodo-no-permitido`](#metodo-no-permitido) | 405 | Método distinto de GET, HEAD u OPTIONS |
| [`calendario-incompleto`](#calendario-incompleto) | 422 | El calendario no cubre las fechas pedidas |
| [`demasiadas-peticiones`](#demasiadas-peticiones) | 429 | Se rebasó el límite de peticiones |
| [`error-interno`](#error-interno) | 500 | Falla del servidor |

## parametro-invalido

Status 400. Un parámetro de ruta o de query tiene un formato incorrecto. También lo causan un parámetro repetido, un parámetro vacío y una query con un segmento sin nombre (`?&`). El campo `parametro` dice cuál es, salvo cuando la query tiene un segmento sin nombre.

```bash
curl https://<base>/v1/estados/99x
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#parametro-invalido",
  "title": "Parámetro inválido",
  "status": 400,
  "detail": "La clave de estado (cve_ent) debe tener 2 dígitos.",
  "instance": "/v1/estados/99x",
  "parametro": "cve_ent"
}
```

Otros casos que dan este tipo: una CLABE que no tiene 18 dígitos, una fecha que no existe, `dias` fuera de 1 a 3650, o, con `permitir_incompleto=true`, un resultado de `dias-habiles` que pasaría del año 9999 (en ese caso `parametro` es `desde`).

Qué hacer: corrige el valor. El `detail` dice el formato esperado.

## parametro-desconocido

Status 400. La ruta no acepta ese parámetro de query. Aplica también a las rutas que no tienen ninguno, y a los que se agregan para saltarse el caché (`?_=123`).

```bash
curl "https://<base>/v1/dias-habiles?autoridad=lft&desde=2026-01-01&dias=3&x=1"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#parametro-desconocido",
  "title": "Parámetro desconocido",
  "status": 400,
  "detail": "Esta ruta no acepta el parámetro x.",
  "instance": "/v1/dias-habiles",
  "parametro": "x"
}
```

Qué hacer: quita el parámetro. Si es para evitar el caché, no hace falta: los datos cambian como máximo una vez al día y se revalidan con `ETag`.

## parametro-faltante

Status 400. Falta un parámetro obligatorio. Solo `dias-habiles` y `dias-inhabiles` tienen parámetros de query obligatorios.

```bash
curl "https://<base>/v1/dias-habiles?autoridad=lft&dias=3"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#parametro-faltante",
  "title": "Falta un parámetro obligatorio",
  "status": 400,
  "detail": "Falta el parámetro desde.",
  "instance": "/v1/dias-habiles",
  "parametro": "desde"
}
```

Qué hacer: agrega el parámetro que indica `parametro`.

## no-encontrado

Status 404. La ruta no existe, o el estado, municipio o banco tiene un formato correcto pero no está en el catálogo. Una ruta con `%` tampoco se encuentra.

```bash
curl https://<base>/v1/estados/99
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "No existe el estado 99.",
  "instance": "/v1/estados/99"
}
```

Si la ruta no existe, el `detail` es `No existe la ruta.`

Qué hacer: revisa la ruta y la clave. Las claves llevan ceros a la izquierda (`09`, no `9`).

## metodo-no-permitido

Status 405. La API es de solo lectura: acepta `GET`, `HEAD` y `OPTIONS`. La respuesta trae `Allow: GET, HEAD, OPTIONS`.

```bash
curl -X POST https://<base>/v1/estados
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#metodo-no-permitido",
  "title": "Método no permitido",
  "status": 405,
  "detail": "Solo se permiten GET, HEAD y OPTIONS.",
  "instance": "/v1/estados"
}
```

Qué hacer: usa `GET`.

## calendario-incompleto

Status 422. El cálculo cruza fechas que el calendario no cubre. Hoy el calendario `lft` va del 2007-01-01 al 2100-12-31. El problema trae además `autoridad`, `fecha` (la primera fecha sin cobertura) y `cobertura`.

```bash
curl "https://<base>/v1/dias-habiles?autoridad=lft&desde=2100-12-30&dias=3"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#calendario-incompleto",
  "title": "Calendario incompleto",
  "status": 422,
  "detail": "El calendario de lft no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
  "instance": "/v1/dias-habiles",
  "autoridad": "lft",
  "fecha": "2101-01-01",
  "cobertura": { "desde": "2007-01-01", "hasta": "2100-12-31" }
}
```

También lo da `dias-inhabiles` con un `anio` fuera de la cobertura.

Qué hacer: acota la consulta a la cobertura. Con `permitir_incompleto=true`, `dias-habiles` calcula fuera de ella descontando solo fines de semana y avisa en `advertencias`. Ver [dias-habiles](README.md#dias-habiles).

## demasiadas-peticiones

Status 429. Una IP rebasó el límite de peticiones. La respuesta trae `Retry-After: 60` (segundos). El límite solo aplica cuando el despliegue lo tiene activado.

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#demasiadas-peticiones",
  "title": "Demasiadas peticiones",
  "status": 429,
  "detail": "Se rebasó el límite de peticiones; intenta de nuevo en un minuto.",
  "instance": "/v1/estados"
}
```

Qué hacer: espera lo que indica `Retry-After`. Si necesitas todos los datos, usa las [descargas](README.md#descargas) en lugar de consultar uno por uno.

## error-interno

Status 500. Falló algo en el servidor. El `detail` siempre es el mismo y nunca incluye trazas ni mensajes internos.

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#error-interno",
  "title": "Error interno",
  "status": 500,
  "detail": "Ocurrió un error interno.",
  "instance": "/v1/estados"
}
```

Qué hacer: reintenta más tarde. Si persiste, abre un issue en el [repositorio](https://github.com/Dagel4k/mexicoapi/issues) con la ruta que pediste.
