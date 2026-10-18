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
| `GET /v1/municipios` | Todos los municipios (unos 300 KB) |
| `GET /v1/municipios/{cvegeo}` | Un municipio |
| `GET /v1/bancos` | Bancos y participantes del SPEI |
| `GET /v1/bancos/{codigo}` | Un banco, con su historial |
| [`GET /v1/clabe/{clabe}`](#clabe) | Valida una CLABE |
| [`GET /v1/dias-habiles`](#dias-habiles) | Suma días hábiles a una fecha según la LFT, la CNBV o el SAT |
| [`GET /v1/dias-inhabiles`](#dias-inhabiles) | Días inhábiles de un año según la LFT, la CNBV o el SAT |
| [`GET /v1/tipo-cambio/fix`](#tipo-de-cambio-fix) | FIX publicado en el DOF un día (`publicado`) o el que aplica a una operación (`operacion`) |
| [`GET /v1/tipo-cambio/fix/ultimo`](#tipo-de-cambio-fix) | La publicación más reciente del FIX |
| [`GET /v1/udis`](#udis) | Valor de la UDI de un día |
| [`GET /v1/constantes/uma`](#constantes) | La UMA vigente un día (`fecha`) |
| [`GET /v1/constantes/uma/{anio}`](#constantes) | La UMA de un año |
| [`GET /v1/constantes/salario-minimo/{anio}`](#constantes) | El salario mínimo de un año, por zona |
| [`GET /v1/isr/tarifa/{periodo}/{anio}`](#constantes) | La tarifa de ISR mensual o anual de un año |
| `GET /v1/status` | Frescura de cada dataset |
| `GET /v1/openapi.json` | Especificación OpenAPI 3.1 |
| `GET /descargas/*` | Datos completos (ver [Descargas](#descargas)) |

Los campos de cada dataset están en [estados](../datos/inegi-estados.md), [municipios](../datos/inegi-municipios.md), [bancos](../datos/bancos.md), [tipo de cambio FIX](../datos/tipo-cambio-fix.md), [UDIS](../datos/udis.md), [días inhábiles de la CNBV](../datos/dias-inhabiles-cnbv.md), [días inhábiles del SAT](../datos/dias-inhabiles-sat.md), [UMA](../datos/constantes-uma.md), [salario mínimo](../datos/constantes-salario-minimo.md) y [tarifas de ISR](../datos/isr-tarifas.md).

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
| `as_of` | Fecha de la última corrida que cambió el dataset. No es la fecha del registro: en el FIX y las UDIS, la última fecha de la serie está en `cobertura.hasta` de [`/v1/status`](#status) |
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

`codigo` son los tres dígitos que van al inicio de la CLABE. La lista trae las instituciones activas e inactivas. Un banco inactivo se conserva con `activo: false` para decodificar CLABE antiguas. Respuesta de `/v1/bancos/012` (con `meta.sources` recortado a la primera fuente; la segunda es el documento de participantes directos del SPEI):

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

Suma días hábiles a una fecha según el calendario de una autoridad: `lft`, `cnbv` o `sat`. El plazo empieza a contar el día hábil siguiente a `desde`, sea `desde` hábil o no: del viernes 18 de diciembre de 2026, el día 1 es el lunes 21 y el día 3 el miércoles 23.

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
| `autoridad` | sí | `lft`, `cnbv` o `sat` |
| `tipo_plazo` | solo con `sat` | `general` o `declaraciones_pagos`; con otra autoridad da 400 |
| `desde` | sí | Fecha real con formato `AAAA-MM-DD` |
| `dias` | sí | Entero de 1 a 3650, sin ceros a la izquierda |
| `permitir_incompleto` | no | `true` o `false` |

Cada autoridad tiene su calendario de días inhábiles, además de los sábados y domingos:

| `autoridad` | Días inhábiles | Años que cubre |
| --- | --- | --- |
| `lft` | Los de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, calculados por regla para cada año | 2007 a 2100 |
| `cnbv` | Los días en que las entidades financieras cierran, según las disposiciones que la CNBV publica en el DOF cada año ([detalle](../datos/dias-inhabiles-cnbv.md)) | 2025 y 2026 |
| `sat` | Los del artículo 12 del Código Fiscal de la Federación y los periodos de vacaciones de la regla 2.1.6 de la RMF ([detalle](../datos/dias-inhabiles-sat.md)) | 2026, con el límite que se explica abajo |

Con `lft`, los días inhábiles son sábados, domingos y los de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo. `inhabiles_saltados` lista los de descanso obligatorio que se saltaron, con su cita (los fines de semana no se listan). Del 23 de diciembre de 2026, 3 días hábiles caen el 29 porque el 25 es de descanso:

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

### CNBV

Con `autoridad=cnbv` se descuentan los días que las disposiciones de la CNBV mandan cerrar a las entidades financieras (por ejemplo, el 12 y el 25 de diciembre), además de sábados y domingos. Del miércoles 23 de diciembre de 2026, 3 días hábiles caen el martes 29:

```bash
curl "https://<base>/v1/dias-habiles?autoridad=cnbv&desde=2026-12-23&dias=3"
```

```json
{
  "autoridad": "cnbv",
  "desde": "2026-12-23",
  "dias": 3,
  "resultado": "2026-12-29",
  "inhabiles_saltados": [
    {
      "fecha": "2026-12-25",
      "motivo": "25 de diciembre",
      "tipo": "descanso",
      "fuente": {
        "nombre": "Disposiciones de carácter general que señalan los días del año 2026 en que las entidades financieras sujetas a la supervisión de la Comisión Nacional Bancaria y de Valores deberán cerrar sus puertas y suspender sus operaciones",
        "url": "https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025",
        "fecha_publicacion": "2025-12-10",
        "fragmento": "Artículo 1.- Las instituciones de crédito, casas de bolsa, … VIII. El 12 y 25 de diciembre. IX. Los sábados y domingos."
      }
    }
  ],
  "advertencias": []
}
```

El `fragmento` real trae el artículo completo. La `meta` de estas respuestas es la del calendario de la autoridad (`dataset: "dias-inhabiles.cnbv"`) y lista en `sources` cada publicación del DOF que respalda un día.

### SAT y tipo de plazo

Con `autoridad=sat`, `tipo_plazo` es obligatorio. El artículo 12 del Código Fiscal de la Federación dice que en los plazos para presentar declaraciones y pagar contribuciones los periodos generales de vacaciones de las autoridades fiscales se consideran hábiles. En los demás plazos no cuentan.

| `tipo_plazo` | Vacaciones del SAT | Descanso (artículo 12) |
| --- | --- | --- |
| `general` | Inhábiles | Inhábiles |
| `declaraciones_pagos` | Hábiles | Inhábiles |

Del viernes 17 de julio de 2026, 3 días hábiles dan resultados distintos porque el primer periodo general de vacaciones de 2026 va del 20 al 31 de julio:

```bash
curl "https://<base>/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-17&dias=3"
curl "https://<base>/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-07-17&dias=3"
```

Con `general` el resultado es el miércoles 2026-08-05 y `inhabiles_saltados` trae los 12 días de vacaciones (del 2026-07-20 al 2026-07-31, con `tipo: "vacaciones"`). Con `declaraciones_pagos` el resultado es el miércoles 2026-07-22 y `inhabiles_saltados` queda vacío:

```json
{
  "autoridad": "sat",
  "desde": "2026-07-17",
  "dias": 3,
  "resultado": "2026-07-22",
  "inhabiles_saltados": [],
  "advertencias": []
}
```

Sin `tipo_plazo` responde 400 `parametro-faltante`; con `lft` o `cnbv` y `tipo_plazo`, 400 `parametro-invalido`.

El 2 y 3 de abril de 2026 (regla 2.1.6, fracción II) no son vacaciones generales, sino días inhábiles para el SAT. Aquí se tratan como vacaciones: en un plazo de declaraciones y pagos cuentan como hábiles y el plazo vence antes, no después. Es el lado seguro para el contribuyente.

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
  "detail": "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
  "instance": "/v1/dias-habiles",
  "autoridad": "lft",
  "fecha": "2101-01-01",
  "cobertura": { "desde": "2007-01-01", "hasta": "2100-12-31" }
}
```

Con `permitir_incompleto=true` calcula fuera de la cobertura descontando solo los fines de semana, y lo avisa en `advertencias` con la autoridad en mayúsculas:

```json
{
  "autoridad": "lft",
  "desde": "2100-12-30",
  "dias": 3,
  "resultado": "2101-01-04",
  "inhabiles_saltados": [],
  "advertencias": ["Calendario incompleto: LFT 2101; solo se descontaron fines de semana."]
}
```

Un plazo legal equivocado sin aviso es peor que un error: usa `permitir_incompleto` solo si sabes lo que haces. Con `permitir_incompleto=true`, si el resultado pasara del año 9999, responde 400 sobre `desde`.

#### Cobertura de la CNBV y el SAT

La CNBV publica su calendario año con año y el SAT publica sus periodos de vacaciones cuando los fija, así que la cobertura de estos calendarios es corta y crece con cada publicación. Hoy:

| Calendario | Cobertura |
| --- | --- |
| `cnbv` | del 2025-01-01 al 2026-12-31 |
| `sat`, `tipo_plazo=declaraciones_pagos` | del 2026-01-01 al 2026-12-31 |
| `sat`, `tipo_plazo=general` | del 2026-01-01 al 2026-11-30 |

El plazo `general` del SAT termina el 30 de noviembre de 2026 porque el segundo periodo general de vacaciones de 2026 todavía no se publica, y sin él no se sabe qué días de diciembre son inhábiles. Los días de descanso del artículo 12 sí están completos todo el año, y por eso `declaraciones_pagos`, que no cuenta las vacaciones, llega al 31 de diciembre. Cada calendario se amplía cuando se captura la publicación correspondiente ([cómo se hace](../operacion/datos-curados.md)).

Fuera de la cobertura responde 422 `calendario-incompleto`. Cuando otro `tipo_plazo` sí cubre la fecha, el `detail` lo dice:

```bash
curl "https://<base>/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-11-27&dias=5"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#calendario-incompleto",
  "title": "Calendario incompleto",
  "status": 422,
  "detail": "El calendario del SAT para tipo_plazo=general no cubre 2026-12-01; cubre del 2026-01-01 al 2026-11-30 porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Con tipo_plazo=declaraciones_pagos, que no los cuenta, cubre del 2026-01-01 al 2026-12-31.",
  "instance": "/v1/dias-habiles",
  "autoridad": "sat",
  "fecha": "2026-12-01",
  "cobertura": { "desde": "2026-01-01", "hasta": "2026-11-30" }
}
```

Con `permitir_incompleto=true`, un plazo que tiene calendario de respaldo no se limita a los fines de semana: sigue descontando los días ya publicados (el 25 de diciembre, que el artículo 12 fija) y avisa de lo que puede faltar. Del 27 de noviembre de 2026, 20 días hábiles con `tipo_plazo=general`:

```bash
curl "https://<base>/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-11-27&dias=20&permitir_incompleto=true"
```

```json
{
  "autoridad": "sat",
  "desde": "2026-11-27",
  "dias": 20,
  "resultado": "2026-12-28",
  "inhabiles_saltados": [
    {
      "fecha": "2026-12-25",
      "motivo": "25 de diciembre",
      "tipo": "descanso",
      "fuente": { "nombre": "Código Fiscal de la Federación, artículo 12", "…": "…" }
    }
  ],
  "advertencias": [
    "Calendario incompleto: SAT con tipo_plazo=general cubre del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar días de tipo vacaciones, que no están publicados o no se han cargado, y solo se descontaron los días publicados y los fines de semana."
  ]
}
```

El resultado puede cambiar cuando se publique el periodo de vacaciones faltante. Si el cálculo sigue más allá de la cobertura más amplia del calendario (para el SAT, el 31 de diciembre de 2026), se suma el aviso de solo fines de semana de arriba, con la autoridad en mayúsculas (`Calendario incompleto: SAT 2027; …`). Si el cálculo no entra en la zona incompleta, no hay aviso.

Esta ruta es una calculadora, no asesoría legal. Para un plazo procesal o fiscal, confirma el calendario de la autoridad que corresponde.

## dias-inhabiles

```bash
curl "https://<base>/v1/dias-inhabiles?autoridad=lft&anio=2026"
curl "https://<base>/v1/dias-inhabiles?autoridad=cnbv&anio=2026"
curl "https://<base>/v1/dias-inhabiles?autoridad=sat&anio=2026"
```

Lista los días inhábiles de un año, sin sábados ni domingos. Los parámetros son `autoridad` (`lft`, `cnbv` o `sat`) y `anio` (cuatro dígitos, de `0001` a `9999`), los dos obligatorios. La respuesta tiene tres campos de primer nivel: `data`, `advertencias` y `meta`. Cada elemento de `data` trae `fecha`, `motivo`, `tipo` y `fuente` (con `nombre`, `url` y `fragmento`; los calendarios de la CNBV y el SAT agregan `fecha_publicacion`).

| `autoridad` | Para 2026 devuelve |
| --- | --- |
| `lft` | 7 fechas: 01-01, 02-02, 03-16, 05-01, 09-16, 11-16 y 12-25 |
| `cnbv` | 11 fechas: 01-01, 02-02, 03-16, 04-02, 04-03, 05-01, 09-16, 11-02, 11-16, 12-12 y 12-25 |
| `sat` | 23 fechas, entre días de descanso del artículo 12 y días de vacaciones |

`tipo` es `descanso` para los días que no cuentan en ningún plazo y `vacaciones` para los periodos de vacaciones del SAT, que en los plazos de declaraciones y pagos cuentan como hábiles ([SAT y tipo de plazo](#sat-y-tipo-de-plazo)). La LFT y la CNBV solo tienen `descanso`.

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

Un año que la cobertura del calendario no alcanza da 422 `calendario-incompleto`: fuera de 2007 a 2100 con `lft`, de 2025 a 2026 con `cnbv` y fuera de 2026 con `sat`.

### Advertencias de la lista

`advertencias` es un campo de primer nivel de esta ruta, junto a `data` y `meta`. No es lo mismo que `data.advertencias` de [`/v1/dias-habiles`](#dias-habiles), que avisa de un cálculo. Aquí avisa de que la lista de un año puede estar incompleta para algún tipo de plazo. Es `[]` cuando la lista está completa, como en `lft` y `cnbv`.

El SAT 2026 es el caso hoy: el segundo periodo general de vacaciones no se ha publicado, y la lista de vacaciones solo está completa hasta el 30 de noviembre. La lista de 2026 se responde igual, con los 23 días publicados, y la advertencia dice qué puede faltar:

```json
{
  "data": [ "…23 días…" ],
  "advertencias": [
    "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa."
  ],
  "meta": { "dataset": "dias-inhabiles.sat", "…": "…" }
}
```

Para un plazo de declaraciones y pagos la lista de 2026 está completa; para un plazo general falta lo que el SAT publique para diciembre. Cuando se capture ese periodo, la advertencia desaparece. Un año que ni siquiera tiene la cobertura de descanso, como 2027, no se responde: da 422.

```bash
curl "https://<base>/v1/dias-inhabiles?autoridad=sat&anio=2027"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#calendario-incompleto",
  "title": "Calendario incompleto",
  "status": 422,
  "detail": "El calendario del SAT no cubre el año 2027; cubre del 2026-01-01 al 2026-12-31.",
  "instance": "/v1/dias-inhabiles",
  "autoridad": "sat",
  "fecha": "2027-01-01",
  "cobertura": { "desde": "2026-01-01", "hasta": "2026-12-31" }
}
```

## Tipo de cambio FIX

El tipo de cambio FIX que el Banco de México publica en el Diario Oficial de la Federación (DOF), en pesos por dólar de Estados Unidos. La serie empieza el 2 de enero de 2020.

| Ruta | Qué devuelve |
| --- | --- |
| `GET /v1/tipo-cambio/fix?publicado=AAAA-MM-DD` | El FIX que el DOF publicó ese día |
| `GET /v1/tipo-cambio/fix?operacion=AAAA-MM-DD` | El FIX que aplica a una operación de ese día |
| `GET /v1/tipo-cambio/fix/ultimo` | La publicación más reciente cargada |

En `/v1/tipo-cambio/fix` hay que mandar exactamente uno de `publicado` y `operacion`: sin ninguno responde 400 [`parametro-faltante`](problemas.md#parametro-faltante) y con los dos, 400 [`parametro-invalido`](problemas.md#parametro-invalido).

### Publicado y operación

`publicado` busca la fecha en que el DOF publicó el valor. Solo hay publicación en los días hábiles bancarios, así que un fin de semana o un feriado bancario no tiene valor.

```bash
curl "https://<base>/v1/tipo-cambio/fix?publicado=2026-10-16"
```

```json
{
  "data": { "fecha_publicacion": "2026-10-16", "valor": "18.4250" },
  "meta": {
    "dataset": "tipo-cambio.fix",
    "as_of": "2026-10-18",
    "sources": [
      {
        "name": "Diario Oficial de la Federación (SIDOF): tipo de cambio para solventar obligaciones denominadas en moneda extranjera (FIX)",
        "url": "https://sidof.segob.gob.mx/",
        "license": "Publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente",
        "license_url": "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
        "citation": "Banco de México. Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana. Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/"
      }
    ],
    "docs": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#tipo-de-cambio-fix"
  }
}
```

`valor` es un texto con 4 decimales, para no perder ceros ni precisión. `fecha_publicacion` es el día de la publicación en el DOF, no el día al que se aplica.

El Banco de México, en el SIE y en su sitio, muestra el FIX por fecha de determinación, que es el día hábil bancario anterior a la publicación en el DOF. Por eso ahí la misma cifra aparece un día hábil antes que en `publicado`: el 18.4250 que el DOF publicó el 2026-10-16 aparece en Banxico como FIX del 2026-10-15. La columna de publicación en el DOF de la tabla de Banxico sí coincide con `publicado`.

`operacion` aplica el artículo 20 del Código Fiscal de la Federación: para una operación se usa el FIX que el Banco de México publicó el día anterior y, si ese día no hubo publicación, el último publicado antes. La respuesta dice qué publicación se usó y cita el fundamento:

```bash
curl "https://<base>/v1/tipo-cambio/fix?operacion=2026-10-19"
```

```json
{
  "data": {
    "fecha_operacion": "2026-10-19",
    "fecha_publicacion": "2026-10-16",
    "valor": "18.4250",
    "fundamento": {
      "nombre": "Código Fiscal de la Federación, artículo 20, tercer párrafo",
      "url": "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      "fragmento": "Para determinar las contribuciones y sus accesorios se considerará el tipo de cambio a que se haya adquirido la moneda extranjera de que se trate y no habiendo adquisición, se estará al tipo de cambio que el Banco de México publique en el Diario Oficial de la Federación el día anterior a aquél en que se causen las contribuciones. Los días en que el Banco de México no publique dicho tipo de cambio se aplicará el último tipo de cambio publicado con anterioridad al día en que se causen las contribuciones."
    }
  },
  "meta": { "dataset": "tipo-cambio.fix", "…": "igual que arriba" }
}
```

El ejemplo es un lunes: la víspera fue domingo, sin publicación, y se aplica el valor del viernes 16.

`operacion` solo responde cuando la respuesta es cierta: cuando están cargados todos los días entre semana hasta la víspera de la operación. Los sábados y domingos no cuentan, porque el DOF no publica el FIX esos días. Los feriados bancarios sí cuentan como días entre semana: la API no usa un calendario bancario y no distingue un feriado de una publicación que todavía no se carga. Si falta alguno de esos días, no devuelve un valor anterior: responde 404 `dato-no-disponible`. La actualización diaria del FIX corre a las 13:30 de la Ciudad de México, así que una consulta temprano por la operación de mañana da 404 hasta esa hora; vuelve a intentar después.

Por la misma razón, la mañana después de un feriado bancario, una operación de ese día da `dato-no-disponible` hasta la corrida de las 13:30. Por ejemplo, el lunes 16 de noviembre de 2026 es feriado bancario y no hay publicación. El martes 17 por la mañana, lo cargado termina en el viernes 13 y el lunes 16 cuenta como día entre semana sin cargar, así que `operacion=2026-11-17` responde `dato-no-disponible`. Después de la corrida del martes responde la publicación del viernes 13, que es la que aplica.

### Último

```bash
curl https://<base>/v1/tipo-cambio/fix/ultimo
```

Responde `{ "data": { "fecha_publicacion": "2026-10-16", "valor": "18.4250" }, "meta": … }`, con la misma `meta` de arriba y `Cache-Control: public, max-age=300` (ver [Caché y ETag](#caché-y-etag)).

### Errores de fecha

Hay dos 404 distintos, y conviene mirar el `type`, no solo el estado HTTP:

| `type` | Cuándo | Cambia con el tiempo |
| --- | --- | --- |
| [`no-encontrado`](problemas.md#no-encontrado) | Ese día no hubo publicación (fin de semana o feriado bancario) o la fecha es anterior al inicio de la serie. Con `publicado`, también un sábado o domingo posterior a lo cargado si entre el último dato y esa fecha solo hay fin de semana | No |
| [`dato-no-disponible`](problemas.md#dato-no-disponible) | La fecha es posterior a lo cargado y falta cargar algún día entre semana hasta esa fecha, o falta la publicación de la víspera para `operacion` | Sí |

Los dos traen `fecha` (la pedida) y `cobertura` (`desde` y `hasta` de la serie cargada). Para saber qué valor aplica a una operación de un día sin publicación, usa `operacion` en lugar de `publicado`.

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

La cobertura de la serie también sale en [`/v1/status`](#status), con la misma forma (`cobertura` con `desde` y `hasta`), junto con su frescura.

## UDIS

El valor de la Unidad de Inversión (UDI) que el Banco de México publica en el DOF, en pesos por UDI. La serie empieza el 1 de enero de 2020.

`GET /v1/udis?fecha=AAAA-MM-DD` responde el valor de la UDI de ese día. Hay un valor para cada día del calendario, fines de semana y feriados incluidos, porque la UDI se publica por adelantado para los días siguientes. Por eso la serie llega unos días después de la fecha de la última corrida.

```bash
curl "https://<base>/v1/udis?fecha=2026-10-18"
```

```json
{
  "data": { "fecha": "2026-10-18", "valor": "8.857670" },
  "meta": {
    "dataset": "udis",
    "as_of": "2026-10-18",
    "sources": [],
    "docs": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#udis"
  }
}
```

En el ejemplo `sources` se muestra vacío por brevedad; la respuesta real trae la fuente, como en el FIX. `valor` es un texto con 6 decimales. Si falta `fecha`, responde 400 [`parametro-faltante`](problemas.md#parametro-faltante).

Los 404 son los mismos que en el FIX. Una fecha anterior al 2020-01-01 da `no-encontrado`; una posterior al último valor cargado da `dato-no-disponible`, porque una publicación próxima puede cubrirla:

```bash
curl "https://<base>/v1/udis?fecha=2026-12-01"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#dato-no-disponible",
  "title": "Dato todavía no disponible",
  "status": 404,
  "detail": "El valor de la UDI del 2026-12-01 todavía no está cargado; el último cargado es del 2026-10-25.",
  "instance": "/v1/udis",
  "fecha": "2026-12-01",
  "cobertura": { "desde": "2020-01-01", "hasta": "2026-10-25" }
}
```

## Constantes

Valores que el DOF publica y que otros cálculos necesitan: la UMA, el salario mínimo y las tarifas de ISR. Cada valor trae su `fuente` (nombre, `url` de la nota del DOF, `fecha_publicacion` y el `fragmento` citado tal cual), para que se pueda comprobar contra la publicación.

| Ruta | Qué devuelve |
| --- | --- |
| `GET /v1/constantes/uma?fecha=AAAA-MM-DD` | La UMA vigente ese día |
| `GET /v1/constantes/uma/{anio}` | La UMA de ese año |
| `GET /v1/constantes/salario-minimo/{anio}` | El salario mínimo de ese año: una lista con la zona `general` y la `zlfn` |
| `GET /v1/isr/tarifa/{periodo}/{anio}` | La tarifa de ISR de ese año; `periodo` es `mensual` o `anual` |

Los montos son texto con dos decimales, sin separador de miles, para no perder precisión. Los campos están en [UMA](../datos/constantes-uma.md), [salario mínimo](../datos/constantes-salario-minimo.md) y [tarifas de ISR](../datos/isr-tarifas.md).

### UMA

Cada UMA rige del 1 de febrero de su año al 31 de enero del siguiente, así que en enero `fecha` responde la UMA del año anterior:

```bash
curl "https://<base>/v1/constantes/uma?fecha=2026-01-15"
```

```json
{
  "data": {
    "anio": 2025,
    "diaria": "113.14",
    "mensual": "3439.46",
    "anual": "41273.52",
    "vigencia_desde": "2025-02-01",
    "fuente": {
      "nombre": "INEGI. Unidad de medida y actualización",
      "url": "https://dof.gob.mx/nota_detalle.php?codigo=5746930&fecha=10/01/2025",
      "fecha_publicacion": "2025-01-10",
      "fragmento": "[...] es de $113.14 pesos mexicanos, el mensual es de $3,439.46 pesos mexicanos y el valor anual $41,273.52 pesos mexicanos, los cuales estarán vigentes a partir del 1º de febrero de 2025."
    }
  },
  "meta": {
    "dataset": "constantes.uma",
    "as_of": "2026-01-09",
    "sources": [ "…una por cada año publicado…" ],
    "docs": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#constantes"
  }
}
```

`meta.sources` lista todas las publicaciones del dataset, no solo la del registro; la del registro está en `data.fuente`. Con `/v1/constantes/uma/2026` la respuesta tiene la misma forma y `data` es la UMA de 2026 (`diaria` 117.31, vigente desde el 2026-02-01). Si falta `fecha`, responde 400 `parametro-faltante`.

### Salario mínimo

```bash
curl https://<base>/v1/constantes/salario-minimo/2026
```

`data` es una lista con un elemento por zona (`general` y `zlfn`, la Zona Libre de la Frontera Norte). Cada elemento trae `anio`, `zona`, `diario`, `vigencia_desde` y `fuente`:

```json
{
  "data": [
    { "anio": 2026, "zona": "general", "diario": "315.04", "vigencia_desde": "2026-01-01", "fuente": { "nombre": "CONASAMI. Resolución que fija los salarios mínimos a partir del 1 de enero de 2026", "url": "https://dof.gob.mx/nota_detalle.php?codigo=5775534&fecha=09/12/2025", "…": "…" } },
    { "anio": 2026, "zona": "zlfn", "diario": "440.87", "vigencia_desde": "2026-01-01", "fuente": { "…": "igual que arriba" } }
  ],
  "meta": { "dataset": "constantes.salario-minimo", "…": "…" }
}
```

### Tarifas de ISR

```bash
curl https://<base>/v1/isr/tarifa/mensual/2026
```

`data` trae `anio`, `periodo`, `tramos` y `fuente`. Cada tramo es `limite_inferior`, `limite_superior` (`null` en el último), `cuota_fija` y `tasa_excedente`, en pesos y por ciento. Dos de los tramos de la mensual de 2026 (la respuesta real trae todos):

```json
{
  "data": {
    "anio": 2026,
    "periodo": "mensual",
    "tramos": [
      { "limite_inferior": "0.01", "limite_superior": "844.59", "cuota_fija": "0.00", "tasa_excedente": "1.92" },
      { "limite_inferior": "844.60", "limite_superior": "7168.51", "cuota_fija": "16.22", "tasa_excedente": "6.40" }
    ],
    "fuente": {
      "nombre": "Anexo 8 de la Resolución Miscelánea Fiscal para 2026",
      "url": "https://dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025",
      "fecha_publicacion": "2025-12-28",
      "fragmento": "V. Tarifa aplicable durante 2026 para el cálculo de los pagos provisionales mensuales a que se refieren los artículos 96 de la Ley del ISR y 175 de su Reglamento, así como la regla 3.12.2."
    }
  },
  "meta": { "dataset": "isr.tarifas", "…": "…" }
}
```

Hay tarifa mensual de 2026 y anuales de 2025 y 2026. Un `periodo` distinto de `mensual` o `anual` da 400 `parametro-invalido`.

### Años que no están

Un año que no está cargado da 404, y el `type` dice cuál de los dos casos es:

| `type` | Cuándo | Ejemplo |
| --- | --- | --- |
| [`no-encontrado`](problemas.md#no-encontrado) | El año es anterior al primero cargado. Los datos no lo tienen y no lo tendrán | `/v1/constantes/uma/2016` |
| [`dato-no-disponible`](problemas.md#dato-no-disponible) | El año es posterior al último cargado. Puede llegar cuando el DOF lo publique | `/v1/constantes/uma/2030` |

```bash
curl https://<base>/v1/constantes/uma/2016
curl https://<base>/v1/constantes/uma/2030
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "No existe la UMA de 2016 en los datos; los años cargados van de 2017 a 2026.",
  "instance": "/v1/constantes/uma/2016"
}
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#dato-no-disponible",
  "title": "Dato todavía no disponible",
  "status": 404,
  "detail": "Todavía no se carga la UMA de 2030; los años cargados van de 2017 a 2026.",
  "instance": "/v1/constantes/uma/2030"
}
```

Las rutas por año no traen `fecha` ni `cobertura`; el rango de años cargados va en el `detail`. Con `/v1/constantes/uma?fecha=` el 404 sí trae `fecha` y `cobertura` (de la primera vigencia al 31 de enero siguiente a la última UMA cargada). Una fecha anterior al 2017-02-01 da `no-encontrado`; una posterior a la cobertura, como 2028-01-01, da `dato-no-disponible`.

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
    },
    {
      "dataset": "tipo-cambio.fix",
      "as_of": "2026-10-18",
      "records": 1710,
      "data_sha256": "ed5d51c0b2ecc8cda7ca984a3cae9fbe6f5d9daf989b7cf76863aa7c5b840f13",
      "cobertura": { "desde": "2020-01-02", "hasta": "2026-10-16" },
      "status": "unknown",
      "last_attempt": null,
      "last_success": null,
      "frescura_horas": 72
    }
  ]
}
```

La respuesta trae un elemento por dataset (`bancos`, `inegi.estados`, `inegi.municipios`, `tipo-cambio.fix` y `udis`); aquí se muestran dos.

| Campo | Significado |
| --- | --- |
| `as_of`, `records`, `data_sha256` | Los del dataset publicado. `as_of` es la fecha de la última corrida que cambió los datos |
| `cobertura` | Solo en las series (`tipo-cambio.fix` y `udis`): `desde` y `hasta`, la primera y la última fecha de la serie publicada. En las UDIS, `hasta` va por delante de la fecha de hoy porque se publican por adelantado |
| `status` | `ok`; `stale` si el último éxito pasó de `frescura_horas` o si hay corridas pero ninguna exitosa (`last_success` es `null`); `unknown` si no hay registro de corridas |
| `last_attempt`, `last_success` | Instantes UTC de la última corrida y del último éxito; `null` si no hay registro |
| `frescura_horas` | Antigüedad máxima antes de considerar el dato desactualizado |

El ejemplo es de una corrida local, sin registro de corridas, por eso `status` es `unknown`.

## Caché y ETag

| Respuesta | `Cache-Control` |
| --- | --- |
| Datos, cálculos, índice y OpenAPI | `public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800` |
| `/v1/tipo-cambio/fix/ultimo` | `public, max-age=300` |
| `/v1/status` | `public, max-age=60` |
| Errores (problem+json) | `no-store` |

Los datos se actualizan como máximo una vez al día, así que una hora de caché es segura. No se usa `s-maxage`: un caché compartido de 24 horas rompería la meta de frescura.

`/v1/tipo-cambio/fix/ultimo` cambia con cada publicación del FIX, así que su caché es de cinco minutos y sin `stale-while-revalidate` ni `stale-if-error`: con ellos, un cliente podría seguir viendo el FIX anterior hasta un día después de la actualización.

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
| `tipo-cambio-fix.json`, `.csv`, `.manifest.json` | Tipo de cambio FIX |
| `udis.json`, `.csv`, `.manifest.json` | UDIS |
| `dias-inhabiles-cnbv.json`, `.csv`, `.manifest.json` | Días inhábiles de la CNBV |
| `dias-inhabiles-sat.json`, `.csv`, `.manifest.json` | Días inhábiles del SAT |
| `constantes-uma.json`, `.csv`, `.manifest.json` | UMA |
| `constantes-salario-minimo.json`, `.csv`, `.manifest.json` | Salario mínimo |
| `isr-tarifas.json`, `.csv`, `.manifest.json` | Tarifas de ISR |
| `bancos-historial.csv` | Un renglón por periodo de cada banco |
| `mexicoapi.sqlite` | Todo junto en SQLite |
| `SHA256SUMS` | Hash SHA-256 de cada archivo |

Para verificar lo que descargaste:

```bash
curl -O https://<base>/descargas/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

Cada `.json` es la lista de registros, sin `meta`; el `.manifest.json` trae la fuente, la licencia y el hash. El manifiesto es el mismo archivo de `data/`, así que su `data_file` conserva el nombre original: `estados.json`, `municipios.json` y `fix.json`, que en `/descargas/` se llaman `inegi-estados.json`, `inegi-municipios.json` y `tipo-cambio-fix.json` (`bancos.json` y `udis.json` no cambian). El hash `data_sha256` es el del archivo descargado.

Los CSV siguen el RFC 4180: UTF-8 sin BOM y saltos de línea `\r\n`. Las claves van como texto, con sus ceros a la izquierda. Para abrirlos en Excel, no uses doble clic (en Windows puede mostrar mal los acentos): usa Datos, Obtener datos, Desde un archivo de texto o CSV y elige UTF-8 como origen. Antes de cargar, en Transformar datos cambia a Texto las columnas de claves (`cve_ent`, `cve_mun`, `cvegeo`, `cve_cabecera`, `codigo` y `codigo_spei`); si Excel las toma como número, pierden los ceros a la izquierda. Si un campo empezara con `=`, `+`, `-`, `@` (también en su forma de ancho completo, `＝＋－＠`), un tabulador, un retorno de carro o un salto de línea, el build falla en vez de alterarlo.

`mexicoapi.sqlite` tiene las tablas `estados`, `municipios`, `bancos`, `bancos_historial`, `tipo_cambio_fix`, `udis`, `dias_inhabiles` (CNBV y SAT), `uma`, `salario_minimo`, `isr_tramos` y `datasets` (esta última con el `as_of`, el hash y el manifiesto de cada dataset).

## Privacidad

El Worker no guarda ni registra las consultas: la observabilidad de Cloudflare está desactivada y no hay base de datos. Ante un error interno (500) escribe una sola línea con el tipo de error y la plantilla de la ruta (por ejemplo `/v1/clabe/{clabe}`), nunca la URL, la query ni la IP. Aun así, una CLABE viaja en la ruta de la URL. Si no quieres enviarla a un servidor, valídala sin red con el paquete de npm cuando esté disponible.

Los datos son públicos y la API no usa cookies.

## Licencia de los datos

Cada respuesta incluye la fuente y su licencia en `meta.sources`. Los términos de cada una están en [DATA_LICENSE.md](../../DATA_LICENSE.md).
