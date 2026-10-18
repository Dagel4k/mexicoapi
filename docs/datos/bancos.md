# Bancos (Banxico)

Instituciones financieras con su código de CLABE, su código SPEI, razón social, sector y el historial de nombres. Sirve para saber a qué banco pertenece una CLABE y para validarla.

- Identificador: `bancos`
- Registros: instituciones activas e inactivas; el total está en `records` del manifiesto y en `/v1/status`
- Clave: `codigo`
- Se actualiza: todos los días; las altas y bajas de instituciones pasan por revisión humana
- Datos en el repositorio: `data/bancos/`

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `codigo` | texto, 3 dígitos | `"012"` | Código de banco: los tres primeros dígitos de la CLABE |
| `codigo_spei` | texto, 4 o 5 dígitos | `"40012"` | Código SPEI como lo publica el CEP. BANXICO es `"2001"` |
| `nombre_corto` | texto | `"BBVA MEXICO"` | Nombre del CEP |
| `razon_social` | texto o `null` | `"BBVA México, S.A., …"` | Del PDF de participantes del SPEI |
| `sector` | texto o `null` | `"BANCA MÚLTIPLE"` | Del PDF de participantes del SPEI |
| `tipo` | texto | `"banca_multiple"` | `banca_multiple`, `banca_desarrollo`, `otra_entidad` o `banco_central`, según el prefijo del código SPEI |
| `participacion` | texto | `"directa"` | `directa` si está activo y aparece en el PDF; `no_confirmada` si solo aparece en el CEP o si está inactivo |
| `activo` | booleano | `true` | `false` si la institución dejó de aparecer en la lista del CEP |
| `baja_detectada` | texto `AAAA-MM-DD` o `null` | `"2014-09-01"` | Fecha de muestreo en que se vio que dejó de aparecer |
| `historial` | lista | ver abajo | Periodos observados con cada nombre y código SPEI |

En la API, `historial` va dentro de cada banco. En las descargas CSV va aparte, en `bancos-historial.csv`.

## Historial

Cada elemento de `historial` tiene `codigo_spei`, `nombre_corto`, `desde` y `hasta`, y es un intervalo `[desde, hasta)`: `hasta` es la fecha de la primera observación en que el código ya no aparecía con ese nombre, y `null` significa que sigue vigente.

```json
[
  { "codigo_spei": "90638", "nombre_corto": "AKALA", "desde": "2010-01-01", "hasta": "2022-11-01" },
  { "codigo_spei": "90638", "nombre_corto": "NU MEXICO", "desde": "2022-11-01", "hasta": "2026-09-01" },
  { "codigo_spei": "40638", "nombre_corto": "NUBANK", "desde": "2026-09-01", "hasta": null }
]
```

Son periodos observados, no fechas legales. La lista del CEP se consulta una vez al mes desde enero de 2010 y, después, en cada corrida diaria, así que una fecha puede diferir de la real hasta por un mes. Un `desde` de `2010-01-01` solo dice que el código ya existía cuando empezó el muestreo. Para fechas oficiales hay que acudir a Banxico, a la CNBV o al Diario Oficial.

Un mismo código puede tener nombres distintos a lo largo del tiempo, así que para decodificar una CLABE antigua conviene revisar el historial de ese código y no solo su nombre actual.

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| API | `GET /v1/bancos` y `GET /v1/bancos/{codigo}`; la validación está en `GET /v1/clabe/{clabe}` |
| Descarga | `/descargas/bancos.json`, `bancos.csv`, `bancos-historial.csv` y `bancos.manifest.json` |
| SQLite | tablas `bancos` y `bancos_historial` de `/descargas/mexicoapi.sqlite` |

Ver [API v1](../api/README.md).

## Fuentes y licencia

- Banco de México, Comprobante Electrónico de Pago: instituciones participantes (https://www.banxico.org.mx/cep/). Aporta el código, el nombre y la membresía activa.
- Banco de México, Participantes directos en el SPEI (PDF publicado el 2026-09-23). Aporta razón social, sector y participación directa.
- Licencia: Banxico autoriza de forma general reproducir su información citando la fuente (https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html).
- Cita: "Banco de México. Comprobante Electrónico de Pago, instituciones participantes." y "Banco de México. Participantes directos en el SPEI." Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- `razon_social` y `sector` salen solo del PDF oficial: no se completan sin fuente. Las instituciones activas que aparecen únicamente en el CEP (001 BANXICO, 901 CLS y 903 CoDi Valida) los tienen en `null`.
- Una institución inactiva conserva la última `razon_social` y el último `sector` conocidos; si no estaba en el PDF el último día que estuvo activa, quedan en `null`.
- Los bancos que dejan de aparecer no se borran: quedan con `activo: false`, para que las CLABE antiguas se sigan decodificando. La CLABE de un banco inactivo tiene formato válido y la API lo marca con `activo: false`.
- El catálogo de plazas de la CLABE no tiene fuente oficial pública, por eso `plaza` es `null` en la validación.
- El PDF y las respuestas del CEP se guardan en `data/bancos/raw/`. El archivo `cep-historico.json` es una compilación de MéxicoAPI con las respuestas mensuales del CEP.
