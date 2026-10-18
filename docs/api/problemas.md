# Errores de la API

Los errores usan `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)). El campo `type` es un enlace a la sección de este documento con el mismo nombre que el tipo. Todas las respuestas de error llevan `Cache-Control: no-store`.

Campos de siempre: `type`, `title`, `status`, `detail` (el motivo, en español) e `instance` (la ruta pedida). Algunos tipos agregan campos propios, como `parametro`.

| Tipo | Status | Cuándo |
| --- | --- | --- |
| [`parametro-invalido`](#parametro-invalido) | 400 | Un valor no cumple su formato |
| [`parametro-desconocido`](#parametro-desconocido) | 400 | La ruta no acepta ese parámetro |
| [`parametro-faltante`](#parametro-faltante) | 400 | Falta un parámetro obligatorio |
| [`no-encontrado`](#no-encontrado) | 404 | No existe la ruta o el recurso |
| [`dato-no-disponible`](#dato-no-disponible) | 404 | El dato de esa fecha todavía no se carga |
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

Otros casos que dan este tipo: una CLABE que no tiene 18 dígitos, una fecha que no existe, `dias` fuera de 1 a 3650, o, con `permitir_incompleto=true`, un resultado de `dias-habiles` que pasaría del año 9999 (en ese caso `parametro` es `desde`). En `/v1/tipo-cambio/fix`, pedir `publicado` y `operacion` a la vez también da este tipo, sin `parametro`.

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

Status 400. Falta un parámetro obligatorio. Tienen parámetros de query obligatorios `dias-habiles` (`autoridad`, `desde` y `dias`, más `tipo_plazo` con `autoridad=sat`), `dias-inhabiles` (`autoridad` y `anio`), `udis` y `/v1/constantes/uma` (`fecha`). `/v1/tipo-cambio/fix` pide exactamente uno de `publicado` u `operacion`: sin ninguno, el `detail` es `Indica publicado u operacion.` y no hay `parametro`.

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

En las constantes (`/v1/constantes/...` y `/v1/isr/tarifa/...`), lo da un año anterior al primero cargado. Hoy no está en los datos y no va a llegar con las publicaciones nuevas, aunque podría agregarse si se captura su publicación. Las rutas por año no traen `fecha` ni `cobertura`: el `detail` dice qué años hay (`No existe la UMA de 2016 en los datos; los años cargados van de 2017 a 2026.`). Ver [Constantes](README.md#constantes).

En el tipo de cambio FIX, las UDIS y `/v1/constantes/uma?fecha=`, este tipo es definitivo y el problema trae además `fecha` (la pedida) y `cobertura` (la primera y la última fecha de la serie; en la UMA, de la primera vigencia al 31 de enero siguiente a la última UMA cargada). Si el dato puede llegar después, el tipo es [`dato-no-disponible`](#dato-no-disponible).

- En el FIX: ese día no hubo publicación en el DOF (un fin de semana o un feriado bancario), o la fecha es anterior al inicio de la serie. Con `publicado`, un sábado o domingo posterior a lo cargado también lo da si entre el último dato y esa fecha solo hay fin de semana. Con `operacion`, lo da una operación hasta el primer día de la serie, porque la publicación que aplica es anterior a ella.
- En las UDIS: solo una fecha anterior al inicio de la serie. Hay un valor para cada día, así que dentro de la serie no falta ninguno; una fecha posterior a lo cargado es `dato-no-disponible`.

```bash
curl "https://<base>/v1/tipo-cambio/fix?publicado=2026-10-10"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "No hubo publicación del FIX en el DOF el 2026-10-10.",
  "instance": "/v1/tipo-cambio/fix",
  "fecha": "2026-10-10",
  "cobertura": { "desde": "2020-01-02", "hasta": "2026-10-16" }
}
```

Antes del inicio de la serie, el `detail` dice dónde empieza:

```bash
curl "https://<base>/v1/udis?fecha=2019-12-31"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "La serie empieza el 2020-01-01; no incluye el 2019-12-31.",
  "instance": "/v1/udis",
  "fecha": "2019-12-31",
  "cobertura": { "desde": "2020-01-01", "hasta": "2026-10-25" }
}
```

Qué hacer: revisa la ruta y la clave. Las claves llevan ceros a la izquierda (`09`, no `9`). En el FIX, para saber qué tipo de cambio aplica a una operación de un día sin publicación, usa `operacion` en lugar de `publicado`.

## dato-no-disponible

Status 404. Todavía no se cargan los datos necesarios para responder con certeza: la fecha es posterior al último dato de la serie (salvo en el FIX con `publicado` un sábado o domingo justo después del último dato, sin días entre semana de por medio, que es [`no-encontrado`](#no-encontrado)) o, en una operación con FIX, falta cargar algún día entre semana hasta la víspera (un feriado bancario cuenta como día entre semana; ver [Publicado y operación](README.md#publicado-y-operación)). La API no responde un valor anterior en su lugar. En el FIX, las UDIS y `/v1/constantes/uma?fecha=`, el problema trae `fecha` y `cobertura`; `cobertura.hasta` es el último dato cargado (en la UMA, el 31 de enero siguiente a la última UMA cargada).

```bash
curl "https://<base>/v1/tipo-cambio/fix?operacion=2026-10-20"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#dato-no-disponible",
  "title": "Dato todavía no disponible",
  "status": 404,
  "detail": "Todavía no está cargado el FIX que aplica a una operación del 2026-10-20; la última publicación cargada es del 2026-10-16.",
  "instance": "/v1/tipo-cambio/fix",
  "fecha": "2026-10-20",
  "cobertura": { "desde": "2020-01-02", "hasta": "2026-10-16" }
}
```

En las constantes, lo da un año posterior al último cargado, que puede llegar cuando el DOF lo publique (`Todavía no se carga la UMA de 2030; los años cargados van de 2017 a 2026.`). Las rutas por año no traen `fecha` ni `cobertura`; el rango de años cargados va en el `detail`. Ver [Constantes](README.md#constantes).

A diferencia de `no-encontrado`, la respuesta puede cambiar. El FIX y las UDIS se actualizan una vez al día y [`/v1/status`](README.md#status) dice cuándo se actualizó cada uno. Las constantes no tienen fecha de actualización: una persona las captura del DOF cuando se publica el año nuevo, y no aparecen en `/v1/status`.

Qué hacer: en el FIX y las UDIS, reintenta después de la siguiente actualización. En las constantes, el año aparece cuando se captura su publicación.

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

Status 422. El cálculo cruza fechas que el calendario no cubre. Hoy el calendario `lft` va del 2007-01-01 al 2100-12-31, el de la `cnbv` del 2025-01-01 al 2026-12-31 y el del `sat` del 2026-01-01 al 2026-12-31 (con `tipo_plazo=general`, hasta el 2026-11-30). El problema trae además `autoridad`, `fecha` (la primera fecha sin cobertura) y `cobertura`.

```bash
curl "https://<base>/v1/dias-habiles?autoridad=lft&desde=2100-12-30&dias=3"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#calendario-incompleto",
  "title": "Calendario incompleto",
  "status": 422,
  "detail": "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
  "instance": "/v1/dias-habiles",
  "autoridad": "lft",
  "fecha": "2101-01-01",
  "cobertura": { "desde": "2007-01-01", "hasta": "2100-12-31" }
}
```

También lo da `dias-inhabiles` con un `anio` fuera de la cobertura.

Qué hacer: acota la consulta a la cobertura. Con `permitir_incompleto=true`, `dias-habiles` calcula fuera de ella y avisa en `advertencias`: descuenta solo fines de semana o, en un plazo del SAT que tiene respaldo, también los días ya publicados. Ver [dias-habiles](README.md#dias-habiles).

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
