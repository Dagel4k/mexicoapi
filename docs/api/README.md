# API v1

API de solo lectura con los datos de referencia de MéxicoAPI. Responde JSON en UTF-8, no pide llave ni cuenta y cada respuesta dice de dónde salió el dato.

## URL base

La API pública está en `https://mexicoapi.dagel4k.workers.dev`, en `workers.dev` de Cloudflare; todavía no tiene dominio propio. Los ejemplos usan esa base. Todas las rutas cuelgan de `/v1`; un cambio incompatible irá a `/v2`. En la raíz del mismo origen está el [sitio](#sitio): la página de inicio, el estado de los datos y `llms.txt`.

Las respuestas de ejemplo son las de la API el 2026-10-18, casi todas recortadas. Los valores que cambian con cada actualización (`as_of`, `cobertura`, `records`, `data_sha256`, `ETag`) pueden ser otros cuando lo leas, y también las respuestas que dependen de lo cargado: `/v1/tipo-cambio/fix/ultimo` cambia con cada publicación del FIX, una fecha que hoy da 404 `dato-no-disponible` responde 200 cuando se carga su dato, y la cobertura de los calendarios de la CNBV y el SAT crece con cada publicación que se captura.

Dentro de `/v1`, un `/` al final de la ruta redirige (308) a la misma ruta sin él.

## Rutas

| Ruta | Qué devuelve |
| --- | --- |
| `GET /v1` | Índice con los enlaces principales |
| `GET /v1/estados` | Los 32 estados |
| `GET /v1/estados/{cve_ent}` | Un estado |
| `GET /v1/estados/{cve_ent}/municipios` | Municipios de un estado |
| `GET /v1/municipios` | Todos los municipios (unos 240 KB; unos 35 KB con gzip) |
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
| `GET /v1/openapi.json` | Especificación OpenAPI 3.1; en `servers` trae primero la API pública, la base que toman Postman, Insomnia u openapi-generator al importarla desde un archivo, y después `/` (el mismo origen) |
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
| `as_of` | En los datasets automáticos, fecha de la última corrida del pipeline que cambió el dataset. No es la fecha del registro: en el FIX y las UDIS, la última fecha de la serie está en `cobertura.hasta` de [`/v1/status`](#status). En los datos curados (calendarios de la CNBV y el SAT, UMA, salario mínimo y tarifas de ISR), que no los baja un bot, es la fecha de publicación más reciente entre sus fuentes. En el calendario de la LFT (`dias-inhabiles.lft`), que se calcula por regla y no está en `data/`, es la fecha de la última reforma de la ley que se tomó en cuenta (hoy 2026-05-14) |
| `sources` | Lista de fuentes: `name`, `url`, `license`, `license_url` y `citation`. Bancos tiene dos fuentes |
| `docs` | Documentación del dataset o de la ruta |

`meta` no trae el estado de frescura, porque eso cambiaría la respuesta (y su `ETag`) con la hora. La frescura se consulta en [`/v1/status`](#status).

Una respuesta puede ganar campos nuevos dentro de `/v1`: los esquemas del documento OpenAPI son abiertos y no prohíben campos adicionales, así que tu cliente debe ignorar los que no conozca. Quitar o cambiar un campo sí es un cambio incompatible e iría a `/v2`.

Las rutas de días hábiles e inhábiles traen además `advertencias` y `avisos`: lo que conviene revisar antes de usar el dato, en texto y con un código estable (ver [Avisos](#avisos)).

Dos rutas tienen otra forma: `/v1/status` responde `{ "data": [...] }` sin `meta`, y `/v1` responde un objeto de índice:

```json
{
  "nombre": "MéxicoAPI",
  "version": "v1",
  "documentacion": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md",
  "openapi": "/v1/openapi.json",
  "status": "/v1/status",
  "descargas": "/descargas/SHA256SUMS",
  "sitio": "/",
  "llms": "/llms.txt"
}
```

## Fechas

Las fechas de los parámetros y de las respuestas van en `AAAA-MM-DD`, sin hora, y son días de la Ciudad de México (`America/Mexico_City`). Importa sobre todo en el FIX: el de un pago de hoy se pide con la fecha de hoy en la Ciudad de México (ver [Publicado y operación](#publicado-y-operación)). Si tu servidor está en UTC, de las 18:00 a las 24:00 de la Ciudad de México `new Date().toISOString().slice(0, 10)` ya da el día siguiente; calcula hoy así:

```js
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
```

En el paquete `mexicoapi`, `hoyEnMexico()` hace lo mismo.

## Avisos

Toda respuesta que trae `advertencias` trae también `avisos`, justo después: las mismas advertencias, en el mismo orden, cada una como `{ "codigo": …, "texto": … }`. `avisos[i].texto` es igual a `advertencias[i]`. El texto es para mostrarlo y puede cambiar de redacción o traer fechas; el código no cambia de significado dentro de `/v1`. Para decidir en un programa (mostrar el aviso, detener el cálculo, mandarlo a revisión), usa `codigo`.

En `/v1/dias-habiles` van dentro de `data`, junto a `data.advertencias`; en `/v1/dias-inhabiles`, en el primer nivel, junto a `advertencias`.

```json
"avisos": [
  { "codigo": "lft-art-715", "texto": "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; …" }
]
```

| `codigo` | Qué significa | Cuándo sale | Qué hacer |
| --- | --- | --- | --- |
| `calendario-incompleto` | El cálculo pasó por un año que el calendario no cubre y ahí solo descontó sábados y domingos | Con `permitir_incompleto=true`, fuera de la [cobertura](#cobertura-del-calendario) | El resultado puede ser anterior al real: no lo uses como vencimiento sin revisar el calendario de ese año |
| `tipo-plazo-incompleto` | El cálculo pasó por fechas que el calendario de ese `tipo_plazo` no cubre: se descontaron los días publicados y los fines de semana, pero pueden faltar días de algún tipo | Con `permitir_incompleto=true`; hoy, `sat` con `general` después del 2026-11-30 | El resultado puede cambiar cuando se publique lo que falta: revísalo entonces |
| `lista-incompleta` | La lista del año solo está completa para algunos tipos de plazo | `dias-inhabiles` con `sat` en un año que `general` no cubre completo | Para `declaraciones_pagos` la lista está completa; para `general` pueden faltar vacaciones |
| `lft-art-715` | El calendario de la LFT no tiene los festivos del calendario oficial ni las suspensiones de labores de los tribunales | Siempre con `lft` | Revisa el calendario del tribunal o del centro de conciliación: el vencimiento real puede ser posterior |
| `transmision-poder-ejecutivo` | En un año de [transmisión del Poder Ejecutivo](#transmisión-del-poder-ejecutivo) no se descuentan el 1o. de octubre ni el 1o. de diciembre | `sat`, en un cálculo que pasa por esos días o en la lista de ese año | Si el SAT declara inhábil alguno de los dos, el plazo que lo cruce vence un día hábil después |
| `prorroga-art-12` | El resultado cae en viernes, en vacaciones del SAT o en un cierre bancario, y el [quinto párrafo del artículo 12](#prórroga-del-artículo-12-del-cff) puede prorrogarlo | `sat` con `declaraciones_pagos` | El resultado no incluye la prórroga: aplícala si corresponde según dónde se presenta o se paga |
| `vacaciones-sin-publicar` | El resultado cae fuera de las vacaciones del SAT publicadas; si ese día resulta ser de vacaciones, puede aplicar la prórroga | `sat` con `declaraciones_pagos`; hoy, después del 2026-11-30 | Revisa el resultado cuando el SAT publique el periodo |
| `api-sin-respuesta` | La API falló y la respuesta sale de los datos del paquete | Cliente de `mexicoapi` | Los datos pueden no estar al día |
| `respuesta-guardada` | La API falló y la respuesta es una guardada en la caché del cliente, ya caducada | Cliente de `mexicoapi` con caché | El texto dice qué tan vieja es |
| `datos-viejos` | La serie del paquete (FIX o UDIS) termina hace más de 7 días | Cliente de `mexicoapi` | La API puede tener datos más recientes: actualiza el paquete o consulta la API |
| `datos-del-paquete` | La serie sale del paquete y no de la API: pueden faltar publicaciones recientes | Cliente de `mexicoapi` (último FIX del paquete) y servidor MCP sin red | Para el dato más reciente, consulta la API |
| `municipio-sin-inegi` | Un código postal de Correos de México tiene un municipio que no está en el catálogo de INEGI del paquete | `mexicoapi/sepomex` y la herramienta `codigo_postal` del MCP | El municipio va con `cvegeo` null y el nombre de Correos de México |
| `cp-varios-municipios` | Hay códigos postales que aparecen en más de un municipio | `mexicoapi/sepomex` | Se usa el municipio de su primera fila |
| `aviso-sepomex-distinto` | El aviso de uso del archivo de Correos de México no es el que conoce `mexicoapi` | `mexicoapi/sepomex` | Lee el aviso nuevo antes de usar los datos |
| `otro` | Un texto que esta versión no conoce | Un calendario propio de `crearCalendario`, o una API más nueva que el paquete | Lee el texto |

La API da los siete primeros. Los demás son del paquete `mexicoapi` (el cliente y `mexicoapi/sepomex`) y del servidor MCP, que usan el mismo catálogo. Una versión nueva puede agregar códigos: trata uno que no conozcas como `otro`. El catálogo está en `CODIGOS_AVISO` de `mexicoapi` y en el documento OpenAPI (`components.schemas.Aviso`).

## Estados

```bash
curl https://mexicoapi.dagel4k.workers.dev/v1/estados
curl https://mexicoapi.dagel4k.workers.dev/v1/estados/25
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
curl https://mexicoapi.dagel4k.workers.dev/v1/municipios
curl https://mexicoapi.dagel4k.workers.dev/v1/municipios/25006
curl https://mexicoapi.dagel4k.workers.dev/v1/estados/25/municipios
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
curl https://mexicoapi.dagel4k.workers.dev/v1/bancos
curl https://mexicoapi.dagel4k.workers.dev/v1/bancos/012
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
curl https://mexicoapi.dagel4k.workers.dev/v1/clabe/002010077777777771
```

Valida una CLABE de 18 dígitos: formato, dígito verificador y banco contra el catálogo. La respuesta separa cada revisión:

```json
{
  "data": {
    "valor": "002010077777777771",
    "valido": true,
    "formato_valido": true,
    "digito_verificador_valido": true,
    "banco_revisado": true,
    "errores": [],
    "nota": "Valida formato, banco y dígito de control; no confirma que la cuenta exista.",
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
| `banco_revisado` | Si el código de banco se revisó contra el catálogo de bancos. En la API siempre es `true`. `validarClabe` del paquete `mexicoapi` da `false` si se llama sin el catálogo: entonces `valido` no garantiza que el banco exista |
| `errores` | Lista de motivos: `digito_verificador`, `banco` |
| `detalle` | Las partes de la CLABE; `null` si no se pudo descomponer |
| `detalle.banco.activo` | `false` si el banco ya no aparece en el SPEI |
| `detalle.plaza` | Siempre `null` por ahora: no existe un catálogo oficial de plazas |

Con un dígito de control incorrecto, `valido` es `false` y `errores` trae `digito_verificador`. Con un código de banco que no existe (por ejemplo `999`), el formato no es válido, `detalle` es `null` y `errores` trae `banco`.

La CLABE de un banco inactivo tiene formato válido: la respuesta lo marca con `banco.activo: false` y deja la decisión al cliente.

Una CLABE que no tiene 18 dígitos da 400 (`parametro-invalido`). La validación no confirma que la cuenta exista; solo que la CLABE está bien formada.

## dias-habiles

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=lft&desde=2026-12-18&dias=3"
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
    "advertencias": [
      "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715), como la Semana Santa o sus vacaciones. Revisa el calendario del tribunal o del centro de conciliación."
    ],
    "avisos": [
      {
        "codigo": "lft-art-715",
        "texto": "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; …"
      }
    ]
  }
}
```

`avisos` repite cada advertencia con su [código estable](#avisos); en los ejemplos su `texto` se acorta con "…".

En un plazo que corre desde una notificación, `desde` es el día en que la notificación surte efectos, no el día en que se hizo. Por ejemplo, una notificación del SAT hecha el lunes 2 de marzo de 2026 surte efectos el día hábil siguiente (CFF, art. 135), así que `desde=2026-03-03`. En materia laboral los términos corren desde el día siguiente al en que surte efectos la notificación (LFT, art. 733). Si se pasa la fecha en que se hizo la notificación, el vencimiento sale un día hábil antes.

El `resultado` es el último día del cómputo. No aplica prórrogas que dependen de dónde se hace el trámite (ver [la prórroga del artículo 12](#prórroga-del-artículo-12-del-cff)); cuando el cálculo puede tener una, `advertencias` lo dice.

| Parámetro | Obligatorio | Valores |
| --- | --- | --- |
| `autoridad` | sí | `lft`, `cnbv` o `sat` |
| `tipo_plazo` | solo con `sat` | `general` o `declaraciones_pagos`; con otra autoridad da 400 |
| `desde` | sí | Fecha real con formato `AAAA-MM-DD`: el día en que surte efectos la notificación |
| `dias` | sí | Entero de 1 a 3650, sin ceros a la izquierda |
| `permitir_incompleto` | no | `true` o `false` |

Cada autoridad tiene su calendario de días inhábiles, además de los sábados y domingos:

| `autoridad` | Días inhábiles | Años que cubre |
| --- | --- | --- |
| `lft` | Los de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo, calculados por regla para cada año. No incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715) | 2007 a 2100 |
| `cnbv` | Calendario bancario: los días en que las entidades financieras cierran, según las disposiciones que la CNBV publica en el DOF cada año ([detalle](../datos/dias-inhabiles-cnbv.md)) | 2025 y 2026 |
| `sat` | Los del artículo 12 del Código Fiscal de la Federación, calculados por regla, y los periodos de vacaciones de la regla 2.1.6 de la RMF ([detalle](../datos/dias-inhabiles-sat.md)) | Del art. 12, 2026 a 2100; las vacaciones, hasta donde están publicadas (ver abajo) |

Con `lft`, los días inhábiles son sábados, domingos y los de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo. El artículo 715 también excluye los festivos que señale el calendario oficial y los días en que las autoridades laborales suspenden labores (la Semana Santa, sus vacaciones y otras suspensiones); cada tribunal y centro de conciliación publica los suyos y este calendario no los tiene. Por eso cada respuesta con `lft` trae esa advertencia, y el resultado puede ser anterior al vencimiento real de un plazo procesal: del martes 31 de marzo de 2026, 3 días hábiles dan el viernes 3 de abril, que es Viernes Santo. Para nómina (días de descanso obligatorio, art. 75) la lista del artículo 74 sí es la que aplica.

`inhabiles_saltados` lista los de descanso obligatorio que se saltaron, con su cita. Los sábados y domingos no se listan por serlo, pero un día de la lista que cae en fin de semana sí aparece si queda dentro del cómputo: del viernes 24 de diciembre de 2027, 1 día hábil da el lunes 27 y `inhabiles_saltados` trae el sábado 25. Del 23 de diciembre de 2026, 3 días hábiles caen el 29 porque el 25 es de descanso:

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
  "advertencias": ["Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; …"],
  "avisos": [{ "codigo": "lft-art-715", "texto": "…" }]
}
```

El `fragmento` y la advertencia reales traen el texto completo; aquí se acortaron con "…".

Con `lft`, la `meta` no sale de un dataset de `data/`: `dataset` es `dias-inhabiles.lft`, `as_of` es la fecha de la última reforma de la LFT que se tomó en cuenta (hoy 2026-05-14) y `sources` cita los artículos 74 y 715 de la ley.

Cada día cita el texto del artículo 74 que estaba en vigor ese día. Hasta el 30 de septiembre de 2024, la fracción VII decía "El 1o. de diciembre de cada seis años, cuando corresponda a la transmisión del Poder Ejecutivo Federal", con el texto de la reforma publicada en el DOF el 17 de enero de 2006; el decreto publicado el 30 de septiembre de 2024, vigente al día siguiente, la cambió a "El 1o. de octubre". Los días anteriores al 2024-10-01 (como el 1 de diciembre de 2012 y de 2018) traen en `fuente` la [copia del decreto de 2006](https://www.diputados.gob.mx/LeyesBiblio/ref/lft/LFT_ref24_17ene06.pdf), su `fecha_publicacion` (2006-01-17) y su texto; los demás, el texto vigente, sin `fecha_publicacion`.

### CNBV

Con `autoridad=cnbv` se descuentan los días que las disposiciones de la CNBV mandan cerrar a las entidades financieras (por ejemplo, el 12 y el 25 de diciembre), además de sábados y domingos. Es el calendario bancario, no el de la CNBV como autoridad: para un plazo en un procedimiento ante la Comisión cuentan sus propios días de suspensión de labores, que no están aquí. Del miércoles 23 de diciembre de 2026, 3 días hábiles caen el martes 29:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=cnbv&desde=2026-12-23&dias=3"
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
  "advertencias": [],
  "avisos": []
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
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-07-17&dias=3"
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-07-17&dias=3"
```

Con `general` el resultado es el miércoles 2026-08-05 y `inhabiles_saltados` trae los 12 días de vacaciones (del 2026-07-20 al 2026-07-31, con `tipo: "vacaciones"`). Con `declaraciones_pagos` el resultado es el miércoles 2026-07-22 y `inhabiles_saltados` queda vacío. Como el 22 de julio es de vacaciones del SAT, `advertencias` trae el aviso de la [prórroga del artículo 12](#prórroga-del-artículo-12-del-cff):

```json
{
  "autoridad": "sat",
  "desde": "2026-07-17",
  "dias": 3,
  "resultado": "2026-07-22",
  "inhabiles_saltados": [],
  "advertencias": [
    "El resultado (2026-07-22) es día de vacaciones del SAT. El art. 12 del CFF, quinto párrafo, prorroga el plazo al siguiente día hábil si ese día están cerradas las oficinas donde se hace el trámite, incluidos los bancos que reciben el pago, o si es viernes y el pago se hace en una institución de crédito autorizada. El resultado no incluye esa prórroga."
  ],
  "avisos": [{ "codigo": "prorroga-art-12", "texto": "El resultado (2026-07-22) es día de vacaciones del SAT. …" }]
}
```

Sin `tipo_plazo` responde 400 `parametro-faltante`; con `lft` o `cnbv` y `tipo_plazo`, 400 `parametro-invalido`.

Los días del primer párrafo del artículo 12 (1o. de enero, primer lunes de febrero, tercer lunes de marzo, 1o. y 5 de mayo, 16 de septiembre, tercer lunes de noviembre y 25 de diciembre) los fija la ley, así que se calculan por regla para cada año de 2026 a 2100, como los de la LFT. Del 30 de diciembre de 2026, 2 días hábiles con `declaraciones_pagos` dan el lunes 4 de enero de 2027: el 1 de enero no cuenta.

El 2 y 3 de abril de 2026 (regla 2.1.6, fracción II) no son vacaciones generales, sino días inhábiles para el SAT. Aquí se tratan como vacaciones: en un plazo de declaraciones y pagos cuentan como hábiles y el plazo vence antes, no después. Es el lado seguro para el contribuyente.

#### Transmisión del Poder Ejecutivo

El artículo 12 también excluye "el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo". Desde 2024 la transmisión es el 1o. de octubre, y el artículo no se ha reformado. Por eso en 2030 (y cada seis años hasta 2096) no se descuenta ni el 1o. de octubre ni el 1o. de diciembre: con eso el plazo vence antes, no después. Un cálculo que pasa por alguno de esos dos días trae una advertencia que lo explica, y la lista de `dias-inhabiles` de ese año también.

#### Prórroga del artículo 12 del CFF

El quinto párrafo del artículo 12 prorroga el plazo al siguiente día hábil si el último día están cerradas las oficinas donde se hace el trámite, incluidos los bancos autorizados para recibir el pago, o si es viernes y el pago se hace en una institución de crédito autorizada. La prórroga depende de dónde se presenta y se paga, así que `resultado` no la aplica: es el último día del cómputo, que nunca es posterior al vencimiento legal.

Con `tipo_plazo=declaraciones_pagos`, si el resultado cae en viernes, en un día de vacaciones del SAT (hábil en estos plazos) o en un día de cierre bancario del [calendario de la CNBV](#cnbv), `advertencias` lo dice:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-10-30&dias=1"
```

El resultado es el lunes 2026-11-02, con la advertencia "El resultado (2026-11-02) es día de cierre bancario según la CNBV. El art. 12 del CFF, quinto párrafo, prorroga el plazo …". Su código en `avisos` es `prorroga-art-12`. La advertencia solo conoce lo publicado: fuera de la cobertura de la CNBV no se sabe qué días cierran los bancos.

Si el resultado cae fuera de las vacaciones del SAT publicadas (después de su fin o antes de su inicio), no se sabe si ese día es de vacaciones, y `advertencias` lo dice (en `avisos`, con el código `vacaciones-sin-publicar`). Del 22 de diciembre de 2026, 5 días hábiles con `declaraciones_pagos` dan el 2026-12-30, mientras falte el segundo periodo de vacaciones:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=declaraciones_pagos&desde=2026-12-22&dias=5"
```

```json
{
  "autoridad": "sat",
  "desde": "2026-12-22",
  "dias": 5,
  "resultado": "2026-12-30",
  "inhabiles_saltados": [
    {
      "fecha": "2026-12-25",
      "motivo": "25 de diciembre",
      "tipo": "descanso",
      "fuente": { "nombre": "Código Fiscal de la Federación, artículo 12", "…": "…" }
    }
  ],
  "advertencias": [
    "Las vacaciones del SAT posteriores al 2026-11-30 no están publicadas: si el 2026-12-30 resulta ser día de vacaciones, el art. 12 del CFF, quinto párrafo, puede prorrogar el plazo al siguiente día hábil. El resultado no incluye esa prórroga."
  ],
  "avisos": [{ "codigo": "vacaciones-sin-publicar", "texto": "Las vacaciones del SAT posteriores al 2026-11-30 no están publicadas: …" }]
}
```

En esos casos el resultado sigue siendo el último día del cómputo, nunca posterior al vencimiento legal.

### Cobertura del calendario

El calendario `lft` cubre del 2007-01-01 al 2100-12-31. Si el cálculo cruza esos límites, responde 422 `calendario-incompleto` y nombra la fecha que falta:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=lft&desde=2100-12-30&dias=3"
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

Con `permitir_incompleto=true` calcula fuera de la cobertura descontando solo los fines de semana, y lo avisa en `advertencias` con la autoridad en mayúsculas, antes del aviso de siempre de la LFT:

```json
{
  "autoridad": "lft",
  "desde": "2100-12-30",
  "dias": 3,
  "resultado": "2101-01-04",
  "inhabiles_saltados": [],
  "advertencias": [
    "Calendario incompleto: LFT 2101; solo se descontaron fines de semana.",
    "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; …"
  ],
  "avisos": [
    {
      "codigo": "calendario-incompleto",
      "texto": "Calendario incompleto: LFT 2101; solo se descontaron fines de semana."
    },
    { "codigo": "lft-art-715", "texto": "…" }
  ]
}
```

Un plazo legal equivocado sin aviso es peor que un error: usa `permitir_incompleto` solo si sabes lo que haces. Con `permitir_incompleto=true`, si el resultado pasara del año 9999, responde 400 sobre `desde`.

#### Cobertura de la CNBV y el SAT

La CNBV publica su calendario año con año y el SAT publica sus periodos de vacaciones cuando los fija, así que la cobertura de estos calendarios es corta y crece con cada publicación. Hoy:

| Calendario | Cobertura |
| --- | --- |
| `cnbv` | del 2025-01-01 al 2026-12-31 |
| `sat`, `tipo_plazo=declaraciones_pagos` | del 2026-01-01 al 2100-12-31 |
| `sat`, `tipo_plazo=general` | del 2026-01-01 al 2026-11-30 |

El plazo `general` del SAT termina el 30 de noviembre de 2026 porque el segundo periodo general de vacaciones de 2026 todavía no se publica, y sin él no se sabe qué días de diciembre son inhábiles. Los días de descanso del artículo 12 se calculan por regla, y por eso `declaraciones_pagos`, que no cuenta las vacaciones, llega a 2100. El calendario de la CNBV y las vacaciones del SAT se amplían cuando se captura la publicación correspondiente ([cómo se hace](../operacion/datos-curados.md)).

Fuera de la cobertura responde 422 `calendario-incompleto`. Cuando otro `tipo_plazo` sí cubre la fecha, el `detail` propone primero `permitir_incompleto=true` y el otro `tipo_plazo` solo para un plazo de declaraciones o pagos:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-11-27&dias=5"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#calendario-incompleto",
  "title": "Calendario incompleto",
  "status": 422,
  "detail": "El calendario del SAT para tipo_plazo=general no cubre 2026-12-01; cubre del 2026-01-01 al 2026-11-30 porque los días de tipo vacaciones posteriores no están publicados o no se han cargado. Puedes calcular con permitir_incompleto=true: descuenta lo publicado y el resultado puede cambiar cuando se publique lo que falta. Solo si el plazo es para presentar declaraciones o pagar contribuciones, usa tipo_plazo=declaraciones_pagos, que no los cuenta y cubre del 2026-01-01 al 2100-12-31.",
  "instance": "/v1/dias-habiles",
  "autoridad": "sat",
  "fecha": "2026-12-01",
  "cobertura": { "desde": "2026-01-01", "hasta": "2026-11-30" }
}
```

Con `permitir_incompleto=true`, un plazo que tiene calendario de respaldo no se limita a los fines de semana: sigue descontando los días ya conocidos (el 25 de diciembre y los demás días del artículo 12) y avisa de lo que puede faltar. Del 27 de noviembre de 2026, 20 días hábiles con `tipo_plazo=general`:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=sat&tipo_plazo=general&desde=2026-11-27&dias=20&permitir_incompleto=true"
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
  ],
  "avisos": [{ "codigo": "tipo-plazo-incompleto", "texto": "Calendario incompleto: SAT con tipo_plazo=general …" }]
}
```

El resultado puede cambiar cuando se publique el periodo de vacaciones faltante. Si el cálculo sigue más allá de la cobertura más amplia del calendario (para el SAT, el 31 de diciembre de 2100), se suma el aviso de solo fines de semana de arriba, con la autoridad en mayúsculas y lo que puede faltar: `Calendario incompleto: SAT 2101; solo se descontaron fines de semana. Pueden faltar días del art. 12 del CFF, como el 25 de diciembre y el 1 de enero, y vacaciones del SAT.` (sin las vacaciones con `declaraciones_pagos`). Lo mismo antes de 2026. Si el cálculo no entra en la zona incompleta, no hay aviso.

Con la CNBV no hay respaldo: después del 31 de diciembre de 2026 solo se descuentan fines de semana, y la advertencia nombra el riesgo, porque los bancos cierran días que no son fin de semana:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-habiles?autoridad=cnbv&desde=2026-12-31&dias=1&permitir_incompleto=true"
```

```json
{
  "autoridad": "cnbv",
  "desde": "2026-12-31",
  "dias": 1,
  "resultado": "2027-01-01",
  "inhabiles_saltados": [],
  "advertencias": [
    "Calendario incompleto: CNBV 2027; solo se descontaron fines de semana. Pueden faltar días de cierre bancario, como el 1 de enero."
  ],
  "avisos": [{ "codigo": "calendario-incompleto", "texto": "Calendario incompleto: CNBV 2027; …" }]
}
```

Esta ruta es una calculadora, no asesoría legal. Para un plazo procesal o fiscal, confirma el calendario de la autoridad que corresponde.

## dias-inhabiles

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-inhabiles?autoridad=lft&anio=2026"
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-inhabiles?autoridad=cnbv&anio=2026"
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-inhabiles?autoridad=sat&anio=2026"
```

Lista los días inhábiles de un año: los que salen de una regla (los del artículo 74 de la LFT y los del artículo 12 del CFF) y los publicados (los de la CNBV y las vacaciones del SAT). Los sábados y domingos no se listan por serlo, pero un día publicado que cae en fin de semana sí aparece: el 12 de diciembre de 2026 de la CNBV es sábado, y los periodos de vacaciones del SAT traen sus sábados y domingos. Los parámetros son `autoridad` (`lft`, `cnbv` o `sat`) y `anio` (cuatro dígitos, de `0001` a `9999`), los dos obligatorios. La respuesta tiene cuatro campos de primer nivel: `data`, `advertencias`, `avisos` y `meta`. Cada elemento de `data` trae `fecha`, `motivo`, `tipo` y `fuente` (con `nombre`, `url` y `fragmento`; los calendarios de la CNBV y el SAT agregan `fecha_publicacion`, y la LFT también en los días anteriores al 2024-10-01, que citan el texto de 2006: ver [dias-habiles](#dias-habiles)).

| `autoridad` | Para 2026 devuelve |
| --- | --- |
| `lft` | 7 fechas: 01-01, 02-02, 03-16, 05-01, 09-16, 11-16 y 12-25 |
| `cnbv` | 11 fechas: 01-01, 02-02, 03-16, 04-02, 04-03, 05-01, 09-16, 11-02, 11-16, 12-12 y 12-25 |
| `sat` | 23 fechas, entre días de descanso del artículo 12 y días de vacaciones |

`tipo` es `descanso` para los días que no cuentan en ningún plazo y `vacaciones` para los periodos de vacaciones del SAT y el 2 y 3 de abril de 2026 (días inhábiles de la regla 2.1.6 que se tratan igual), que en los plazos de declaraciones y pagos cuentan como hábiles ([SAT y tipo de plazo](#sat-y-tipo-de-plazo)). La LFT y la CNBV solo tienen `descanso`.

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

Un año que la cobertura del calendario no alcanza da 422 `calendario-incompleto`: fuera de 2007 a 2100 con `lft`, de 2025 a 2026 con `cnbv` y de 2026 a 2100 con `sat`.

### Advertencias de la lista

`advertencias` es un campo de primer nivel de esta ruta, junto a `data` y `meta`. No es lo mismo que `data.advertencias` de [`/v1/dias-habiles`](#dias-habiles), que avisa de un cálculo. Aquí avisa de que la lista de un año puede estar incompleta para algún tipo de plazo o de lo que no incluye. Es `[]` cuando la lista está completa, como en `cnbv`. Con `lft` siempre trae el aviso de que la lista no tiene los festivos ni las suspensiones de labores del artículo 715; con `sat`, en 2030 y cada seis años, el de la [transmisión del Poder Ejecutivo](#transmisión-del-poder-ejecutivo). `avisos` trae las mismas con su [código](#avisos): `lista-incompleta`, `lft-art-715` o `transmision-poder-ejecutivo`.

El SAT 2026 es el caso hoy: el segundo periodo general de vacaciones no se ha publicado, y la lista de vacaciones solo está completa hasta el 30 de noviembre. La lista de 2026 se responde igual, con los 23 días publicados, y la advertencia dice qué puede faltar:

```json
{
  "data": [ "…23 días…" ],
  "advertencias": [
    "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2026 está completa."
  ],
  "avisos": [{ "codigo": "lista-incompleta", "texto": "Los días de tipo vacaciones del SAT solo están completos …" }],
  "meta": { "dataset": "dias-inhabiles.sat", "…": "…" }
}
```

Para un plazo de declaraciones y pagos la lista de 2026 está completa; para un plazo general falta lo que el SAT publique para diciembre. Cuando se capture ese periodo, la advertencia desaparece. De 2027 a 2100 la lista trae los 8 días del artículo 12, calculados por regla, con la misma advertencia mientras no se publiquen las vacaciones de ese año:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/dias-inhabiles?autoridad=sat&anio=2027"
```

```json
{
  "data": [ "…2027-01-01, 02-01, 03-15, 05-01, 05-05, 09-16, 11-15 y 12-25…" ],
  "advertencias": [
    "Los días de tipo vacaciones del SAT solo están completos del 2026-01-01 al 2026-11-30; fuera de ese rango pueden faltar. Para tipo_plazo=declaraciones_pagos, que no los cuenta, la lista de 2027 está completa."
  ],
  "avisos": [{ "codigo": "lista-incompleta", "texto": "Los días de tipo vacaciones del SAT solo están completos …" }],
  "meta": { "dataset": "dias-inhabiles.sat", "…": "…" }
}
```

Un año después de 2100 no se responde: `anio=2101` da 422 con `"detail": "El calendario del SAT no cubre el año 2101; cubre del 2026-01-01 al 2100-12-31."`.

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
curl "https://mexicoapi.dagel4k.workers.dev/v1/tipo-cambio/fix?publicado=2026-10-16"
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

`operacion` da el FIX que aplica a una operación o a un pago de esa fecha, un día de la Ciudad de México (ver [Fechas](#fechas)): el último que el Banco de México publicó en el DOF antes de ese día. Calcula con el artículo 20 del Código Fiscal de la Federación, la regla de las contribuciones: se usa el FIX publicado el día anterior y, si ese día no hubo publicación, el último publicado antes. Para un pago en dólares la regla es otra, pero da la misma publicación (ver [Pagos en dólares](#pagos-en-dólares)). La respuesta dice qué publicación se usó y cita el fundamento:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/tipo-cambio/fix?operacion=2026-10-19"
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

#### Pagos en dólares

Las obligaciones de pago en dólares que se cumplen en México siguen la regla del Banco de México, el artículo 172 de su [Circular 3/2012](https://www.banxico.org.mx/marco-normativo/normativa-emitida-por-el-banco-de-mexico/circular-3-2012/%7B4E0281A4-7AD8-1462-BC79-7F2925F3171D%7D.pdf) (Título Tercero, Capítulo V; texto compilado con sus modificaciones hasta la Circular 11/2026): "Las obligaciones de pago denominadas en Dólares que se contraigan dentro o fuera de la República Mexicana para ser cumplidas en esta, se solventarán entregando el equivalente en moneda nacional al tipo de cambio que el Banco de México publique en el Diario Oficial de la Federación el Día Hábil Bancario inmediato anterior a aquel en que se haga el pago."

Esa publicación es la misma que da `operacion`. El Banco de México determina el FIX cada día hábil bancario y lo publica en el DOF "el Día Hábil Bancario inmediato siguiente a aquel en el que lo determine" (artículos 165 y 171 de la misma circular), así que hay publicación todos los días hábiles bancarios y solo esos. La circular llama días hábiles bancarios a los días en que los bancos no cierran según las disposiciones de la CNBV, el mismo calendario con que la API sabe qué días no hay publicación. La publicación del día hábil bancario anterior al pago es, entonces, la última publicada antes del pago.

Las dos reglas solo se separarían en dos casos: si el DOF no publicara el FIX un día hábil bancario (el artículo 172 no dice qué hacer y el CFF toma el último publicado) o si lo publicara un día inhábil bancario (el CFF tomaría esa publicación y el artículo 172, la del día hábil bancario anterior). En esos casos `operacion` sigue al CFF. En los datos cargados no ha pasado: desde 2020 no hay publicaciones en sábado ni en domingo, y en 2025 y 2026, que cubre el calendario de la CNBV, los días entre semana sin publicación son exactamente sus días de descanso.

La ruta calcula con la regla del CFF y su `fundamento` cita el artículo 20 del CFF. Para un pago en dólares, pasa en `operacion` la fecha del pago y cita el artículo 172 de la circular; para una contribución, la fecha en que se causa. Para otras monedas, el mismo artículo calcula la equivalencia con la cotización de esa moneda contra el dólar el día del pago, que MéxicoAPI no tiene.

`operacion` solo responde cuando la respuesta es cierta, es decir, cuando están cargados todos los días hasta la víspera de la operación en que pudo haber publicación:

- no cuentan los sábados ni los domingos, porque el DOF no publica el FIX esos días;
- tampoco los días de descanso del [calendario de la CNBV](../datos/dias-inhabiles-cnbv.md) dentro de su cobertura (hoy del 2025-01-01 al 2026-12-31), porque en un feriado bancario no hay publicación;
- fuera de esa cobertura la API no sabe qué días son feriados, y un feriado entre semana cuenta como un día sin cargar.

Si falta alguno de esos días, no devuelve un valor anterior: responde 404 `dato-no-disponible`. La actualización diaria del FIX corre a las 13:30 de la Ciudad de México y llega a la API cuando se fusiona su PR y termina el despliegue, así que una consulta temprano por la operación de mañana da 404 hasta entonces; vuelve a intentar después.

La mañana después de un feriado bancario la respuesta ya es cierta. Por ejemplo, el lunes 16 de noviembre de 2026 es feriado bancario y no hay publicación. El martes 17 por la mañana, lo cargado termina en el viernes 13 y el lunes 16 es día de descanso de la CNBV, así que `operacion=2026-11-17` responde la publicación del viernes 13, que es la que aplica, sin esperar la corrida del martes. Por lo mismo, `publicado=2026-11-16` responde `no-encontrado`. En cambio, `operacion=2026-11-18` da `dato-no-disponible` hasta que se cargue la publicación del martes 17.

### Último

```bash
curl https://mexicoapi.dagel4k.workers.dev/v1/tipo-cambio/fix/ultimo
```

Responde `{ "data": { "fecha_publicacion": "2026-10-16", "valor": "18.4250" }, "meta": … }`, con la misma `meta` de arriba y `Cache-Control: public, max-age=300` (ver [Caché y ETag](#caché-y-etag)).

### Errores de fecha

Hay dos 404 distintos, y conviene mirar el `type`, no solo el estado HTTP:

| `type` | Cuándo | Cambia con el tiempo |
| --- | --- | --- |
| [`no-encontrado`](problemas.md#no-encontrado) | Ese día no hubo publicación (fin de semana o feriado bancario) o la fecha es anterior al inicio de la serie. Con `publicado`, también un fin de semana o día de descanso de la CNBV posterior a lo cargado si entre el último dato y esa fecha solo hay días así | No |
| [`dato-no-disponible`](problemas.md#dato-no-disponible) | La fecha es posterior a lo cargado y falta cargar algún día entre semana que no es día de descanso de la CNBV hasta esa fecha, o falta la publicación de la víspera para `operacion` | Sí |

Los dos traen `fecha` (la pedida) y `cobertura` (`desde` y `hasta` de la serie cargada). Para saber qué valor aplica a una operación de un día sin publicación, usa `operacion` en lugar de `publicado`; el `detail` del 404 lo dice:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/tipo-cambio/fix?publicado=2026-10-10"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "No hubo publicación del FIX en el DOF el 2026-10-10. Para el FIX que aplica a una operación de ese día, usa operacion=2026-10-10.",
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
curl "https://mexicoapi.dagel4k.workers.dev/v1/udis?fecha=2026-10-18"
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
curl "https://mexicoapi.dagel4k.workers.dev/v1/udis?fecha=2027-12-01"
```

```json
{
  "type": "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#dato-no-disponible",
  "title": "Dato todavía no disponible",
  "status": 404,
  "detail": "El valor de la UDI del 2027-12-01 todavía no está cargado; el último cargado es del 2026-10-25.",
  "instance": "/v1/udis",
  "fecha": "2027-12-01",
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

Hay UMA de 2017 en adelante: la de 2016, el primer año de la UMA, no está en los datos y responde 404 `no-encontrado` (ver [Años que no están](#años-que-no-están)). Cada UMA rige del 1 de febrero de su año al 31 de enero del siguiente, así que en enero `fecha` responde la UMA del año anterior:

```bash
curl "https://mexicoapi.dagel4k.workers.dev/v1/constantes/uma?fecha=2026-01-15"
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
curl https://mexicoapi.dagel4k.workers.dev/v1/constantes/salario-minimo/2026
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
curl https://mexicoapi.dagel4k.workers.dev/v1/isr/tarifa/mensual/2026
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
| [`no-encontrado`](problemas.md#no-encontrado) | El año es anterior al primero cargado. Hoy no está en los datos y no llega con las publicaciones nuevas; podría agregarse si se captura su publicación | `/v1/constantes/uma/2016` |
| [`dato-no-disponible`](problemas.md#dato-no-disponible) | El año es posterior al último cargado. Puede llegar cuando el DOF lo publique | `/v1/constantes/uma/2030` |

```bash
curl https://mexicoapi.dagel4k.workers.dev/v1/constantes/uma/2016
curl https://mexicoapi.dagel4k.workers.dev/v1/constantes/uma/2030
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
curl https://mexicoapi.dagel4k.workers.dev/v1/status
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
      "status": "ok",
      "last_attempt": "2026-10-18T22:50:40.695Z",
      "last_success": "2026-10-18T22:50:40.695Z",
      "frescura_horas": 216
    },
    {
      "dataset": "tipo-cambio.fix",
      "as_of": "2026-10-18",
      "records": 1710,
      "data_sha256": "ed5d51c0b2ecc8cda7ca984a3cae9fbe6f5d9daf989b7cf76863aa7c5b840f13",
      "cobertura": { "desde": "2020-01-02", "hasta": "2026-10-16" },
      "status": "ok",
      "last_attempt": "2026-10-18T22:50:04.366Z",
      "last_success": "2026-10-18T22:50:04.366Z",
      "frescura_horas": 72
    }
  ]
}
```

La respuesta trae un elemento por dataset (`bancos`, `inegi.estados`, `inegi.municipios`, `tipo-cambio.fix` y `udis`); aquí se muestran dos.

| Campo | Significado |
| --- | --- |
| `as_of`, `records`, `data_sha256` | Los del dataset publicado. `as_of` es la fecha de la última corrida del pipeline que cambió el dataset |
| `cobertura` | Solo en las series (`tipo-cambio.fix` y `udis`): `desde` y `hasta`, la primera y la última fecha de la serie publicada. En las UDIS, `hasta` va por delante de la fecha de hoy porque se publican por adelantado |
| `status` | `ok`; `stale` si el último éxito pasó de `frescura_horas` o si hay corridas pero ninguna exitosa (`last_success` es `null`); `unknown` si no hay registro de corridas |
| `last_attempt`, `last_success` | Instantes UTC de la última corrida y del último éxito; `null` si no hay registro |
| `frescura_horas` | Horas que pueden pasar desde el último éxito antes de considerar el dataset desactualizado: 72 en `bancos`, `tipo-cambio.fix` y `udis`, que el bot revisa cada día, y 216 en `inegi.estados` e `inegi.municipios`, que revisa cada lunes |

`status` es `unknown` en un despliegue sin registro de corridas, como una copia local o uno nuevo antes de la primera corrida del bot. `/v1/status` solo trae los datasets automáticos: los curados (calendarios de la CNBV y el SAT, UMA, salario mínimo y tarifas de ISR) no tienen bot ni plazo de frescura, y su fecha es el `as_of` de su `meta`.

## Caché y ETag

| Respuesta | `Cache-Control` |
| --- | --- |
| Datos, cálculos, índice y OpenAPI | `public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800` |
| `/v1/tipo-cambio/fix/ultimo` | `public, max-age=300` |
| `/v1/status` | `public, max-age=60` |
| Errores (problem+json) | `no-store` |

Los datos se actualizan como máximo una vez al día, así que una hora de caché es segura. No se usa `s-maxage`: un caché compartido de 24 horas rompería la meta de frescura.

`/v1/tipo-cambio/fix/ultimo` cambia con cada publicación del FIX, así que su caché es de cinco minutos y sin `stale-while-revalidate` ni `stale-if-error`: con ellos, un cliente podría seguir viendo el FIX anterior hasta un día después de la actualización.

Las rutas que sirven un archivo traen `ETag`: las de estados, municipios y bancos, las de constantes por año (`/v1/constantes/uma/{anio}`, `/v1/constantes/salario-minimo/{anio}` y `/v1/isr/tarifa/{periodo}/{anio}`) y `/v1/openapi.json`. Las que calculan la respuesta (`/v1`, CLABE, días hábiles e inhábiles, FIX, UDIS, UMA por fecha y status) no lo traen. Si mandas el `ETag` de una respuesta anterior en `If-None-Match`, responde 304 sin cuerpo:

```bash
curl -i -H 'If-None-Match: "<ETag de una respuesta anterior>"' https://mexicoapi.dagel4k.workers.dev/v1/estados/25
```

```
HTTP/1.1 304 Not Modified
Cache-Control: public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800
ETag: "<el mismo valor>"
```

Se omiten los demás encabezados. El `ETag` lo da el archivo publicado y cambia cuando cambian los datos; usa el de tu última respuesta, no uno copiado de esta guía.

## CORS

Todas las respuestas de `/v1` llevan `Access-Control-Allow-Origin: *`, así que puedes llamar la API desde el navegador. Se exponen los encabezados `ETag` y `Retry-After`. Las peticiones `OPTIONS` responden 204 y no cuentan en el límite de peticiones. Solo se aceptan `GET`, `HEAD` y `OPTIONS`; otro método da 405.

Los archivos estáticos de `/descargas/`, `/llms.txt` y `/llms-full.txt` también llevan `Access-Control-Allow-Origin: *`, pero solo aceptan `GET` y `HEAD`: otro método, `OPTIONS` incluido, da 405 sin cuerpo. Como no piden encabezados propios, un `fetch` simple desde el navegador no necesita `OPTIONS`.

## Parámetros y errores

Los parámetros se validan antes de consultar el dato. Estas peticiones dan 400:

- un parámetro que la ruta no acepta (también en rutas sin parámetros: `/v1/estados?x=1`);
- un parámetro repetido;
- un parámetro vacío o un segmento vacío en la query (`?&`);
- un valor que no cumple su formato.

Una ruta con `%` no se encuentra (404). Un cliente que agrega `?_=123` para saltarse el caché recibe 400. Una URL demasiado larga la rechaza la plataforma antes de llegar a la API, con un 414 o un 431 que no es problem+json.

Los errores usan `application/problem+json` (RFC 9457) con `type`, `title`, `status` y `detail`, más `instance` y, cuando aplica, `parametro`. El `type` es un enlace a la sección correspondiente de [problemas.md](problemas.md) y es un identificador estable: dentro de `/v1` no cambia, aunque la API llegue a un dominio propio. Para distinguir un error, compara el `type` completo o la parte después de `#` (`parametro-invalido`). Nunca llevan trazas internas.

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

Lo que pasa por el Worker (`/v1`) tiene un límite de 600 peticiones por minuto por IP (en IPv6 cuenta el bloque /64 completo) en cada ubicación de Cloudflare. Quien lo rebasa recibe 429 (`demasiadas-peticiones`) con `Retry-After: 60`. Las descargas y el sitio no cuentan. Si necesitas todos los datos, no hace falta consultar uno por uno: baja las descargas.

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
| `dias-inhabiles-lft.json`, `.csv` | Días de descanso obligatorio de la LFT (art. 74), de 2007 a 2100 |
| `dias-inhabiles-coberturas.json`, `.csv` | Hasta dónde está completa la lista de días inhábiles de cada autoridad, por tipo de plazo |
| `constantes-uma.json`, `.csv`, `.manifest.json` | UMA |
| `constantes-salario-minimo.json`, `.csv`, `.manifest.json` | Salario mínimo |
| `isr-tarifas.json`, `.csv`, `.manifest.json` | Tarifas de ISR |
| `bancos-historial.csv` | Un renglón por periodo de cada banco |
| `mexicoapi.sqlite` | Todo junto en SQLite |
| `SHA256SUMS` | Hash SHA-256 de cada archivo |

Para verificar lo que descargaste:

```bash
curl -O https://mexicoapi.dagel4k.workers.dev/descargas/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

Cada `.json` es la lista de registros, sin `meta`; el `.manifest.json` trae la fuente, la licencia y el hash. El manifiesto es el mismo archivo de `data/`, así que su `data_file` conserva el nombre original: `estados.json`, `municipios.json` y `fix.json`, que en `/descargas/` se llaman `inegi-estados.json`, `inegi-municipios.json` y `tipo-cambio-fix.json` (`bancos.json` y `udis.json` no cambian). El hash `data_sha256` es el del archivo descargado.

Las listas de días inhábiles no dicen por sí solas hasta dónde están completas: un día que no aparece puede ser hábil o caer fuera de lo que se ha cargado. `dias-inhabiles-coberturas` trae un renglón por autoridad y tipo de plazo, con `autoridad`, `tipo_plazo`, `desde` y `hasta`: el rango en que la lista descargada de esa autoridad está completa para ese plazo. `tipo_plazo` es el valor que se manda a la API; la LFT y la CNBV tienen un solo plazo y no lo aceptan, así que en sus renglones va vacío en el CSV y `null` en el JSON y el SQLite. En la LFT, la CNBV y el SAT con `general` es la misma cobertura que usa `/v1/dias-habiles` (ver [Cobertura del calendario](#cobertura-del-calendario)). En el SAT con `declaraciones_pagos` es más corta: la lista descargada solo trae los días del artículo 12 del CFF de los años con vacaciones capturadas (hoy, hasta el 2026-12-31), y la API los calcula por regla hasta el 2100-12-31.

Los CSV siguen el RFC 4180: UTF-8 sin BOM y saltos de línea `\r\n`. Las claves van como texto, con sus ceros a la izquierda. Para abrirlos en Excel, no uses doble clic (en Windows puede mostrar mal los acentos): usa Datos, Obtener datos, Desde un archivo de texto o CSV y elige UTF-8 como origen. Antes de cargar, en Transformar datos cambia a Texto las columnas de claves (`cve_ent`, `cve_mun`, `cvegeo`, `cve_cabecera`, `codigo` y `codigo_spei`); si Excel las toma como número, pierden los ceros a la izquierda. Si un campo empezara con `=`, `+`, `-`, `@` (también en su forma de ancho completo, `＝＋－＠`), un tabulador, un retorno de carro o un salto de línea, el build falla en vez de alterarlo.

La LFT no tiene dataset en `data/`: sus días de descanso obligatorio se calculan por regla con el núcleo, así que `dias-inhabiles-lft` no tiene manifiesto. Su fuente es el texto oficial de una ley federal, el artículo 74 de la Ley Federal del Trabajo publicado en el DOF, que no es objeto de derecho de autor ([LFDA](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf), art. 14, fracción VIII); cada renglón la cita en `fuente` (en el CSV, en las columnas `fuente_*`). Trae, de cada año de 2007 a 2100, los mismos días que `/v1/dias-inhabiles?autoridad=lft`, con `autoridad` y, en la fuente, siempre `fecha_publicacion`: la del texto citado, que es la de la reforma del DOF 17-01-2006 en los días anteriores al 2024-10-01 (ver [el texto de cada fecha](#dias-habiles)) y, en los demás, la de la última reforma de la ley, como en los días del artículo 12 de la lista del SAT. Igual que la API, no trae los festivos del calendario oficial ni los días en que los tribunales y centros de conciliación suspenden labores (art. 715); para un plazo procesal, agrega los del calendario del tribunal antes de contar.

`mexicoapi.sqlite` tiene las tablas `estados`, `municipios`, `bancos`, `bancos_historial`, `tipo_cambio_fix`, `udis`, `dias_inhabiles` (LFT, CNBV y SAT), `coberturas_calendario` (la cobertura de cada autoridad y tipo de plazo, como `dias-inhabiles-coberturas`, con `tipo_plazo` en `NULL` en la LFT y la CNBV), `uma`, `salario_minimo`, `isr_tramos` y `datasets` (esta última con el `as_of`, el hash y el manifiesto de cada dataset).

### Cambios en las descargas

2026-10-18:

- Archivos nuevos `dias-inhabiles-lft.json` y `.csv`, y renglones de la LFT (`autoridad = 'lft'`, 2007 a 2100) en la tabla `dias_inhabiles` del SQLite.
- `dias-inhabiles-coberturas` y `coberturas_calendario`: renglón nuevo de la LFT, y `tipo_plazo` vacío (`null` en JSON, `NULL` en SQLite) en la LFT y la CNBV, que antes decía `general` en la CNBV.
- `coberturas_calendario` ya no tiene llave primaria, porque `tipo_plazo` puede ser `NULL`. La unicidad de autoridad y tipo de plazo la da el índice único `coberturas_calendario_llave`.

## Sitio

Fuera de `/v1` y `/descargas/` está el sitio, con páginas estáticas que genera el build a partir de los mismos manifiestos:

| Ruta | Qué es |
| --- | --- |
| `/` | Página de inicio: cómo empezar, la tabla de datasets con su fecha, fuente y licencia, y las descargas |
| `/estado/` | Si cada dataset automático está al día; la página consulta `/v1/status` |
| `/llms.txt` | Resumen de la API en el formato de [llmstxt.org](https://llmstxt.org/): cómo pedir el FIX de un pago, y la ruta de cada dataset con sus parámetros obligatorios, su `as_of` (en las series, también su último dato) y su documentación |
| `/llms-full.txt` | Esta referencia, la de errores y la documentación de cada dataset en un solo archivo de texto, con los enlaces absolutos |
| `/robots.txt` | Pide a los rastreadores que no entren a `/v1` ni a `/descargas/`; el resto del sitio queda abierto |

Las sirven los assets de Cloudflare sin pasar por el Worker, así que no cuentan en el límite de peticiones. Las páginas llevan su propia política de seguridad de contenido y cinco minutos de caché; `llms.txt` y `llms-full.txt` se sirven como `text/plain; charset=utf-8`, con `Access-Control-Allow-Origin: *` y una hora de caché. `/estado` redirige a `/estado/`.

Una dirección que no existe fuera de `/v1` (`/v2`, `/descargas/nada`) responde 404 con una página HTML, no con problem+json. Dentro de `/v1`, una ruta que no existe sigue respondiendo [`no-encontrado`](problemas.md#no-encontrado).

## Privacidad

El Worker no guarda ni registra las consultas: la observabilidad de Cloudflare está desactivada y no hay base de datos. Ante un error interno (500) escribe una sola línea con el tipo de error y la plantilla de la ruta (por ejemplo `/v1/clabe/{clabe}`), nunca la URL, la query ni la IP. Fuera de eso solo escribe avisos fijos, sin datos de la petición: cuando no carga el calendario de la CNBV (el FIX y la advertencia de la prórroga del artículo 12 siguen sin él), cuando KV no responde el estado de un dataset en `/v1/status` (queda `unknown`) y cuando falla el límite de peticiones (la petición pasa). Aun así, una CLABE viaja en la ruta de la URL. Si no quieres enviarla a un servidor, valídala sin red con el paquete `mexicoapi` de npm ([packages/sdk](../../packages/sdk/README.md)).

Los datos son públicos y la API no usa cookies.

## Licencia de los datos

Cada respuesta incluye la fuente y su licencia en `meta.sources`. Los términos de cada una están en [DATA_LICENSE.md](../../DATA_LICENSE.md).
