# API v1

API de solo lectura con los datos de referencia de MéxicoAPI. Responde JSON en UTF-8, no pide llave ni cuenta y cada respuesta dice de dónde salió el dato.

## URL base

La API todavía no está desplegada. Se publicará primero en `workers.dev` y después en un dominio propio. Mientras tanto, los ejemplos usan `https://<base>` y las respuestas de este documento salen de una corrida local del Worker. Todas las rutas cuelgan de `/v1`; un cambio incompatible irá a `/v2`.

Un `/` al final de la ruta redirige (308) a la misma ruta sin él.

## Rutas

| Ruta | Qué devuelve |
| --- | --- |
| `GET /` y `GET /v1` | Índice con los enlaces principales |
| `GET /v1/estados` | Los 32 estados |
| `GET /v1/estados/{cve_ent}` | Un estado |
| `GET /v1/estados/{cve_ent}/municipios` | Municipios de un estado |
| `GET /v1/municipios` | Los 2,478 municipios (unos 300 KB) |
| `GET /v1/municipios/{cvegeo}` | Un municipio |
| `GET /v1/bancos` | Bancos y participantes del SPEI |
| `GET /v1/bancos/{codigo}` | Un banco, con su historial |
| [`GET /v1/clabe/{clabe}`](#clabe) | Valida una CLABE |
| [`GET /v1/dias-habiles`](#dias-habiles) | Suma días hábiles a una fecha |
| [`GET /v1/dias-inhabiles`](#dias-inhabiles) | Días de descanso obligatorio de un año |
| `GET /v1/status` | Frescura de cada dataset |
| `GET /v1/openapi.json` | Especificación OpenAPI 3.1 |
| `GET /descargas/*` | Datos completos (ver [Descargas](#descargas)) |

Los campos de cada dataset están en [estados](../datos/inegi-estados.md), [municipios](../datos/inegi-municipios.md) y [bancos](../datos/bancos.md).

## Forma de la respuesta

Las rutas de datos responden `{ "data": …, "meta": … }`:

```json
{
  "data": { "cve_ent": "25", "nombre": "Sinaloa", "abreviatura": "Sin.", "cvegeo": "25" },
  "meta": {
    "dataset": "inegi.estados",
    "as_of": "2026-10-17",
    "sources": [
      {
        "name": "INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades",
        "url": "https://gaia.inegi.org.mx/wscatgeo/v2/",
        "license": "Términos de libre uso de la información del INEGI",
        "license_url": "https://www.inegi.org.mx/inegi/terminos.html",
        "citation": "INEGI. Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio wscatgeo v2."
      }
    ],
    "docs": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/inegi-estados.md"
  }
}
```

| Campo de `meta` | Significado |
| --- | --- |
| `dataset` | Identificador del dataset |
| `as_of` | Fecha a la que corresponde el dato |
| `sources` | Lista de fuentes: `name`, `url`, `license`, `license_url` y `citation`. Bancos tiene dos fuentes |
| `docs` | Documentación del dataset o de la ruta |

`meta` no trae el estado de frescura, porque eso cambiaría la respuesta (y su `ETag`) con la hora. La frescura se consulta en [`/v1/status`](#status).

Una respuesta puede ganar campos nuevos dentro de `/v1`: los esquemas del documento OpenAPI son abiertos y no prohíben campos adicionales, así que tu cliente debe ignorar los que no conozca. Quitar o cambiar un campo sí es un cambio incompatible e iría a `/v2`.

Dos rutas tienen otra forma: `/v1/status` responde `{ "data": [...] }` sin `meta`, y `/` y `/v1` responden un objeto de índice:

```json
{
  "nombre": "MéxicoAPI",
  "version": "v1",
  "documentacion": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md",
  "openapi": "/v1/openapi.json",
  "status": "/v1/status",
  "descargas": "/descargas/SHA256SUMS"
}
```

## Estados

```bash
curl https://<base>/v1/estados
curl https://<base>/v1/estados/25
```

`cve_ent` son dos dígitos con cero a la izquierda. La lista completa trae 32 estados; este fragmento muestra 2 (`meta` omitido):

```json
{
  "data": [
    { "cve_ent": "01", "nombre": "Aguascalientes", "abreviatura": "Ags.", "cvegeo": "01" },
    { "cve_ent": "02", "nombre": "Baja California", "abreviatura": "BC", "cvegeo": "02" }
  ]
}
```

`GET /v1/estados/25/municipios` devuelve los 20 municipios de Sinaloa, con la misma forma que `/v1/municipios/{cvegeo}`.

## Municipios

```bash
curl https://<base>/v1/municipios
curl https://<base>/v1/municipios/25006
curl https://<base>/v1/estados/25/municipios
```

`cvegeo` son cinco dígitos: la clave del estado más la del municipio.

```json
{
  "data": {
    "cvegeo": "25006",
    "cve_ent": "25",
    "cve_mun": "006",
    "nombre": "Culiacán",
    "cve_cabecera": "0001"
  }
}
```

En las 16 alcaldías de la Ciudad de México, la fuente no trae cabecera y `cve_cabecera` es `null`:

```json
{ "cvegeo": "09002", "cve_ent": "09", "cve_mun": "002", "nombre": "Azcapotzalco", "cve_cabecera": null }
```

## Bancos

```bash
curl https://<base>/v1/bancos
curl https://<base>/v1/bancos/012
```

`codigo` son los tres dígitos que van al inicio de la CLABE. La lista trae 150 instituciones, activas e inactivas. Un banco inactivo se conserva con `activo: false` para decodificar CLABE antiguas. Respuesta de `/v1/bancos/012` (con `meta.sources` recortado a la primera fuente; la segunda es el documento de participantes directos del SPEI):

```json
{
  "data": {
    "codigo": "012",
    "codigo_spei": "40012",
    "nombre_corto": "BBVA MEXICO",
    "razon_social": "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
    "sector": "BANCA MÚLTIPLE",
    "tipo": "banca_multiple",
    "participacion": "directa",
    "activo": true,
    "baja_detectada": null,
    "historial": [
      { "codigo_spei": "40012", "nombre_corto": "BBVA BANCOMER", "desde": "2010-01-01", "hasta": "2021-12-01" },
      { "codigo_spei": "40012", "nombre_corto": "BBVA MEXICO", "desde": "2021-12-01", "hasta": null }
    ]
  }
}
```

Los periodos de `historial` son intervalos `[desde, hasta)` observados, no fechas legales. Ver [bancos](../datos/bancos.md#historial).

## clabe

```bash
curl https://<base>/v1/clabe/002010077777777771
```

Valida una CLABE de 18 dígitos: formato, dígito verificador y banco contra el catálogo. La respuesta separa cada revisión:

```json
{
  "data": {
    "valor": "002010077777777771",
    "valido": true,
    "formato_valido": true,
    "digito_verificador_valido": true,
    "errores": [],
    "nota": "Valida formato y dígito verificador; no confirma que exista ante el SAT, RENAPO, el IMSS o un banco.",
    "detalle": {
      "codigo_banco": "002",
      "codigo_plaza": "010",
      "cuenta": "07777777777",
      "digito_control": "1",
      "banco": { "codigo": "002", "nombre_corto": "BANAMEX", "activo": true },
      "plaza": null
    }
  }
}
```

| Campo | Significado |
| --- | --- |
| `valido` | `true` solo si no hay errores |
| `formato_valido` | 18 dígitos y un banco que existe en el catálogo |
| `digito_verificador_valido` | Resultado del dígito de control; `null` si el formato no es válido |
| `errores` | Lista de motivos: `digito_verificador`, `banco` |
| `detalle` | Las partes de la CLABE; `null` si no se pudo descomponer |
| `detalle.banco.activo` | `false` si el banco ya no aparece en el SPEI |
| `detalle.plaza` | Siempre `null` por ahora: no existe un catálogo oficial de plazas |

Con un dígito de control incorrecto, `valido` es `false` y `errores` trae `digito_verificador`. Con un código de banco que no existe (por ejemplo `999`), el formato no es válido, `detalle` es `null` y `errores` trae `banco`.

La CLABE de un banco inactivo tiene formato válido: la respuesta lo marca con `banco.activo: false` y deja la decisión al cliente.

Una CLABE que no tiene 18 dígitos da 400 (`parametro-invalido`). La validación no confirma que la cuenta exista; solo que la CLABE está bien formada.

## dias-habiles

```bash
curl "https://<base>/v1/dias-habiles?autoridad=lft&desde=2026-12-18&dias=3"
```

Suma días hábiles a una fecha. El plazo empieza a contar el día hábil siguiente a `desde`, sea `desde` hábil o no: del viernes 18 de diciembre de 2026, el día 1 es el lunes 21 y el día 3 el miércoles 23.

```json
{
  "data": {
    "autoridad": "lft",
    "desde": "2026-12-18",
    "dias": 3,
    "resultado": "2026-12-23",
    "inhabiles_saltados": [],
    "advertencias": []
  }
}
```

| Parámetro | Obligatorio | Valores |
| --- | --- | --- |
| `autoridad` | sí | `lft` (por ahora el único; los calendarios de CNBV y SAT llegan con los datos curados) |
| `desde` | sí | Fecha real con formato `AAAA-MM-DD` |
| `dias` | sí | Entero de 1 a 3650, sin ceros a la izquierda |
| `permitir_incompleto` | no | `true` o `false` |

Con `lft`, los días inhábiles son sábados, domingos y los de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, calculados por regla para cada año. `inhabiles_saltados` lista los de descanso obligatorio que se saltaron, con su cita (los fines de semana no se listan). Del 23 de diciembre de 2026, 3 días hábiles caen el 29 porque el 25 es de descanso:

```json
{
  "autoridad": "lft",
  "desde": "2026-12-23",
  "dias": 3,
  "resultado": "2026-12-29",
  "inhabiles_saltados": [
    {
      "fecha": "2026-12-25",
      "motivo": "25 de diciembre",
      "tipo": "descanso",
      "fuente": {
        "nombre": "Ley Federal del Trabajo, artículo 74",
        "url": "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
        "fragmento": "Artículo 74. Son días de descanso obligatorio: I. El 1o. de enero; …"
      }
    }
  ],
  "advertencias": []
}
```

El `fragmento` real trae el artículo completo; aquí se acortó con "…".

### Cobertura del calendario

El calendario `lft` cubre del 2007-01-01 al 2100-12-31. Si el cálculo cruza esos límites, responde 422 `calendario-incompleto` y nombra la fecha que falta:

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

Con `permitir_incompleto=true` calcula fuera de la cobertura descontando solo los fines de semana, y lo avisa en `advertencias`:

```json
{
  "autoridad": "lft",
  "desde": "2100-12-30",
  "dias": 3,
  "resultado": "2101-01-04",
  "inhabiles_saltados": [],
  "advertencias": ["Calendario incompleto: lft 2101; solo se descontaron fines de semana."]
}
```

Un plazo legal equivocado sin aviso es peor que un error: usa `permitir_incompleto` solo si sabes lo que haces. Con `permitir_incompleto=true`, si el resultado pasara del año 9999, responde 400 sobre `desde`.

Esta ruta es una calculadora, no asesoría legal. Para un plazo procesal o fiscal, confirma el calendario de la autoridad que corresponde.

## dias-inhabiles

```bash
curl "https://<base>/v1/dias-inhabiles?autoridad=lft&anio=2026"
```

Lista los días de descanso obligatorio del artículo 74 de la LFT en un año. Los parámetros son `autoridad` (`lft`) y `anio` (cuatro dígitos, de `0001` a `9999`), los dos obligatorios. Para 2026 devuelve 7 fechas: 01-01, 02-02, 03-16, 05-01, 09-16, 11-16 y 12-25. Cada elemento trae `fecha`, `motivo`, `tipo` y `fuente` (con `nombre`, `url` y `fragmento`). Un año fuera de 2007 a 2100 da 422 `calendario-incompleto`.

```json
{
  "fecha": "2026-02-02",
  "motivo": "Primer lunes de febrero, en conmemoración del 5 de febrero",
  "tipo": "descanso",
  "fuente": {
    "nombre": "Ley Federal del Trabajo, artículo 74",
    "url": "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
    "fragmento": "Artículo 74. Son días de descanso obligatorio: …"
  }
}
```

## Tipo de cambio FIX

`GET /v1/tipo-cambio/fix?publicado=AAAA-MM-DD` responde el FIX publicado en el DOF ese día; `GET /v1/tipo-cambio/fix?operacion=AAAA-MM-DD`, el que aplica a una operación de ese día según el artículo 20 del CFF; `GET /v1/tipo-cambio/fix/ultimo`, la publicación más reciente. Un día sin publicación da 404 [`no-encontrado`](problemas.md#no-encontrado) y uno que todavía no se carga, 404 [`dato-no-disponible`](problemas.md#dato-no-disponible).

## UDIS

`GET /v1/udis?fecha=AAAA-MM-DD` responde el valor de la UDI de ese día, con los mismos 404 que el FIX.

## status

```bash
curl https://<base>/v1/status
```

Frescura de cada dataset. Responde `{ "data": [...] }` sin `meta`:

```json
{
  "data": [
    {
      "dataset": "inegi.estados",
      "as_of": "2026-10-17",
      "records": 32,
      "data_sha256": "6a21ed92ea0d892dd37db6b0b724db2bf681febe86eda7f662d87dcc1127d942",
      "status": "unknown",
      "last_attempt": null,
      "last_success": null,
      "frescura_horas": 216
    }
  ]
}
```

La respuesta trae un elemento por dataset (`bancos`, `inegi.estados` e `inegi.municipios`); aquí se muestra uno.

| Campo | Significado |
| --- | --- |
| `as_of`, `records`, `data_sha256` | Los del dataset publicado |
| `status` | `ok`; `stale` si el último éxito pasó de `frescura_horas` o si hay corridas pero ninguna exitosa (`last_success` es `null`); `unknown` si no hay registro de corridas |
| `last_attempt`, `last_success` | Instantes UTC de la última corrida y del último éxito; `null` si no hay registro |
| `frescura_horas` | Antigüedad máxima antes de considerar el dato desactualizado |

El ejemplo es de una corrida local, sin registro de corridas, por eso `status` es `unknown`.

## Caché y ETag

| Respuesta | `Cache-Control` |
| --- | --- |
| Datos, cálculos, índice y OpenAPI | `public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800` |
| `/v1/status` | `public, max-age=60` |
| Errores (problem+json) | `no-store` |

Los datos se actualizan como máximo una vez al día, así que una hora de caché es segura. No se usa `s-maxage`: un caché compartido de 24 horas rompería la meta de frescura.

Las rutas de estados, municipios y bancos, y `/v1/openapi.json`, traen `ETag`. Si lo mandas en `If-None-Match`, responde 304 sin cuerpo:

```bash
curl -i -H 'If-None-Match: "2124ff58da103db22f553c325831f0c5"' https://<base>/v1/estados/25
```

```
HTTP/1.1 304 Not Modified
Cache-Control: public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800
ETag: "2124ff58da103db22f553c325831f0c5"
```

Se omiten los demás encabezados. El valor del `ETag` cambia cuando cambian los datos.

## CORS

Todas las respuestas llevan `Access-Control-Allow-Origin: *`, así que puedes llamar la API desde el navegador. Se exponen los encabezados `ETag` y `Retry-After`. Las peticiones `OPTIONS` responden 204. Solo se aceptan `GET`, `HEAD` y `OPTIONS`; otro método da 405.

## Parámetros y errores

Los parámetros se validan antes de consultar el dato. Estas peticiones dan 400:

- un parámetro que la ruta no acepta (también en rutas sin parámetros: `/v1/estados?x=1`);
- un parámetro repetido;
- un parámetro vacío o un segmento vacío en la query (`?&`);
- un valor que no cumple su formato.

Una ruta con `%` no se encuentra (404). Un cliente que agrega `?_=123` para saltarse el caché recibe 400.

Los errores usan `application/problem+json` (RFC 9457) con `type`, `title`, `status` y `detail`, más `instance` y, cuando aplica, `parametro`. El `type` es un enlace a la sección correspondiente de [problemas.md](problemas.md). Nunca llevan trazas internas.

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

## Límite de peticiones

Cuando el despliegue lo tenga activado, una IP que rebasa el límite (en IPv6 cuenta el bloque /64 completo) recibe 429 (`demasiadas-peticiones`) con `Retry-After: 60`. Si necesitas todos los datos, no hace falta consultar uno por uno: baja las descargas.

## Descargas

Los datos completos están en `/descargas/`:

| Archivo | Contenido |
| --- | --- |
| `inegi-estados.json`, `.csv`, `.manifest.json` | Estados |
| `inegi-municipios.json`, `.csv`, `.manifest.json` | Municipios |
| `bancos.json`, `.csv`, `.manifest.json` | Bancos |
| `bancos-historial.csv` | Un renglón por periodo de cada banco |
| `mexicoapi.sqlite` | Todo junto en SQLite |
| `SHA256SUMS` | Hash SHA-256 de cada archivo |

Para verificar lo que descargaste:

```bash
curl -O https://<base>/descargas/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

Cada `.json` es la lista de registros, sin `meta`; el `.manifest.json` trae la fuente, la licencia y el hash. El manifiesto es el mismo archivo de `data/`, así que su `data_file` conserva el nombre original: `estados.json` y `municipios.json`, que en `/descargas/` se llaman `inegi-estados.json` e `inegi-municipios.json` (`bancos.json` no cambia). El hash `data_sha256` es el del archivo descargado.

Los CSV siguen el RFC 4180: UTF-8 sin BOM y saltos de línea `\r\n`. Las claves van como texto, con sus ceros a la izquierda. Para abrirlos en Excel, no uses doble clic (en Windows puede mostrar mal los acentos): usa Datos, Obtener datos, Desde un archivo de texto o CSV y elige UTF-8 como origen. Antes de cargar, en Transformar datos cambia a Texto las columnas de claves (`cve_ent`, `cve_mun`, `cvegeo`, `cve_cabecera`, `codigo` y `codigo_spei`); si Excel las toma como número, pierden los ceros a la izquierda. Si un campo empezara con `=`, `+`, `-`, `@` (también en su forma de ancho completo, `＝＋－＠`), un tabulador, un retorno de carro o un salto de línea, el build falla en vez de alterarlo.

`mexicoapi.sqlite` tiene las tablas `estados`, `municipios`, `bancos`, `bancos_historial` y `datasets` (esta última con el `as_of`, el hash y el manifiesto de cada dataset).

## Privacidad

El Worker no guarda ni registra las consultas: la observabilidad de Cloudflare está desactivada y no hay base de datos. Ante un error interno (500) escribe una sola línea con el tipo de error y la plantilla de la ruta (por ejemplo `/v1/clabe/{clabe}`), nunca la URL, la query ni la IP. Aun así, una CLABE viaja en la ruta de la URL. Si no quieres enviarla a un servidor, valídala sin red con el paquete de npm cuando esté disponible.

Los datos son públicos y la API no usa cookies.

## Licencia de los datos

Cada respuesta incluye la fuente y su licencia en `meta.sources`. Los términos de cada una están en [DATA_LICENSE.md](../../DATA_LICENSE.md).
