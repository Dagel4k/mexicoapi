# Licencia de los datos

El código de este repositorio se publica bajo la licencia [MIT](LICENSE). Los datos de `data/` no son del proyecto: son datos oficiales que conservan los términos de la institución que los publica. Esta página dice de dónde viene cada uno, qué términos aplican y qué hace MéxicoAPI con ellos.

Cada dataset trae en su `manifest.json` la fuente, la URL de los términos, la cita y el hash de los archivos de `raw/`. Casi todos son la respuesta de la fuente tal como se descargó. La excepción es `data/bancos/raw/cep-historico.json`: es una compilación de MéxicoAPI con las respuestas mensuales del CEP, que conserva la primera, la última y cada mes cuya lista cambió.

## INEGI: estados y municipios

- Datasets: `data/inegi-estados/` y `data/inegi-municipios/`.
- Publica: Instituto Nacional de Estadística y Geografía (INEGI), Catálogo Único de Claves de Áreas Geoestadísticas.
- Términos: https://www.inegi.org.mx/inegi/terminos.html. El INEGI permite el uso libre de su información y exige darle el crédito.
- Cita: "Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades." Si usas estos datos, cita al INEGI como fuente y aclara que fueron procesados por MéxicoAPI.
- Qué hace MéxicoAPI: normaliza los textos a NFC, quita espacios sobrantes, conserva solo algunos campos (clave, nombre, abreviatura, cabecera), ordena por clave y guarda las claves como texto con ceros a la izquierda. Los nombres se dejan como los publica el INEGI. Las alcaldías de la Ciudad de México no tienen cabecera en la fuente (viene como "----") y quedan con `cve_cabecera: null`.

## Banco de México: bancos y participantes del SPEI

- Dataset: `data/bancos/`.
- Publica: Banco de México (Banxico), a través del Comprobante Electrónico de Pago (CEP) y del documento "Participantes directos en el SPEI".
- Términos: https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html. Banxico autoriza de forma general reproducir su información citando la fuente.
- Cita: "Fuente: Banco de México." Las citas exactas de cada fuente están en `data/bancos/manifest.json`.
- Qué hace MéxicoAPI: normaliza a NFC, une la lista del CEP con el PDF de participantes (razón social y sector), deriva el código de tres dígitos de la CLABE a partir del código SPEI y clasifica el tipo de institución por el prefijo de ese código. Las instituciones que dejan de aparecer no se borran: quedan con `activo: false`.

`razon_social` y `sector` salen solo del PDF oficial vigente de participantes directos. Las instituciones inactivas y las que aparecen únicamente en el CEP (001 BANXICO, 901 CLS y 903 CoDi Valida) los tienen en `null`: MéxicoAPI no los completa sin una fuente.

### El historial de bancos son periodos observados

El campo `historial` de cada banco no contiene fechas legales de altas, bajas o cambios de nombre. Se arma consultando la lista del CEP una vez al mes desde enero de 2010 y, después, en cada corrida diaria. Cada periodo es un intervalo `[desde, hasta)`:

- `desde` es la primera fecha de muestreo en que se vio el código con ese nombre;
- `hasta` es la fecha de la primera observación en que el código ya no aparecía con ese nombre (porque cambió de nombre o dejó de aparecer); `null` significa que sigue vigente.

Por eso, en el histórico mensual, una fecha puede diferir de la real hasta por un mes. Un `desde` de `2010-01-01` solo significa que el código ya aparecía cuando empezó el muestreo; no dice cuándo se creó. Para fechas oficiales hay que acudir a Banxico, a la CNBV o al Diario Oficial.

Un mismo código puede aparecer con nombres distintos a lo largo del tiempo (cambios de nombre, compras o reasignaciones). Ejemplos:

- `102` fue THE ROYAL BANK, luego INVESTA BANK y después ACCENDO BANCO; el código ya no está activo.
- `638` fue AKALA y luego NU MEXICO bajo el código SPEI `90638`, y hoy es NUBANK con el código SPEI `40638`.

Para decodificar una CLABE antigua conviene revisar el historial de ese código y no solo su nombre actual.
