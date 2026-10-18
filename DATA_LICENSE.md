# Licencia de los datos

El código de este repositorio se publica bajo la licencia [MIT](LICENSE). Los datos de `data/` no son del proyecto: son datos oficiales que conservan los términos de la institución que los publica. Esta página dice de dónde viene cada uno, qué términos aplican y qué hace MéxicoAPI con ellos.

Cada dataset trae en su `manifest.json` la fuente, la URL de los términos, la cita y el hash de los archivos de `raw/`. Casi todos son la respuesta de la fuente tal como se descargó. La excepción es `data/bancos/raw/cep-historico.json`: es una compilación de MéxicoAPI con las respuestas mensuales del CEP, que conserva la primera, la última y cada mes cuya lista cambió.

## Descargas y API

Las descargas de `/descargas/` (JSON, CSV y SQLite) y las respuestas de la API son los mismos datos de `data/`, con los términos de cada fuente. La excepción son los días que salen de una ley y no de una publicación anual: los de `autoridad=lft` en `/v1/dias-habiles` y `/v1/dias-inhabiles` (Ley Federal del Trabajo, art. 74, y del 715 los sábados y domingos) y los del artículo 12 del Código Fiscal de la Federación en los del SAT, que MéxicoAPI calcula por regla para cada año. La lista del SAT en `data/` y en las descargas trae los del artículo 12 de los años que cubren sus vacaciones capturadas. Es texto legislativo, que no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII), y su `meta.sources` cita la ley. Cada respuesta de la API lleva en `meta.sources` el nombre de la fuente, su licencia y la cita; cada `.manifest.json` de las descargas, lo mismo. `SHA256SUMS` permite verificar los archivos. Los CSV y la base SQLite solo cambian el formato, no el contenido. Si publicas estos datos, conserva la cita de la fuente.

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

`razon_social` y `sector` salen solo del PDF oficial de participantes directos: MéxicoAPI no los completa sin una fuente. Las instituciones activas que aparecen únicamente en el CEP (001 BANXICO, 901 CLS y 903 CoDi Valida) los tienen en `null` y su `participacion` es `no_confirmada`.

Una institución inactiva conserva la última `razon_social` y el último `sector` conocidos. Si el último día que estuvo activa no aparecía en el PDF, quedan en `null`. Su `participacion` pasa a `no_confirmada`, porque ya no participa.

### El historial de bancos son periodos observados

El campo `historial` de cada banco no contiene fechas legales de altas, bajas o cambios de nombre. Se arma consultando la lista del CEP una vez al mes desde enero de 2010 y, después, en cada corrida diaria. Cada periodo es un intervalo `[desde, hasta)`:

- `desde` es la primera fecha de muestreo en que se vio el código con ese nombre;
- `hasta` es la fecha de la primera observación en que el código ya no aparecía con ese nombre (porque cambió de nombre o dejó de aparecer); `null` significa que sigue vigente.

Por eso, en el histórico mensual, una fecha puede diferir de la real hasta por un mes. Un `desde` de `2010-01-01` solo significa que el código ya aparecía cuando empezó el muestreo; no dice cuándo se creó. Para fechas oficiales hay que acudir a Banxico, a la CNBV o al Diario Oficial.

Un mismo código puede aparecer con nombres distintos a lo largo del tiempo (cambios de nombre, compras o reasignaciones). Ejemplos:

- `102` fue THE ROYAL BANK, luego INVESTA BANK y después ACCENDO BANCO; el código ya no está activo.
- `638` fue AKALA y luego NU MEXICO bajo el código SPEI `90638`, y hoy es NUBANK con el código SPEI `40638`.

Para decodificar una CLABE antigua conviene revisar el historial de ese código y no solo su nombre actual.

## Diario Oficial de la Federación: tipo de cambio FIX y UDIS

- Datasets: `data/tipo-cambio-fix/` y `data/udis/`.
- Publica: Diario Oficial de la Federación (DOF), consultado en su Sistema de Información (SIDOF). El Banco de México determina estos valores.
- Términos: publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente. Ver https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html.
- Cita: "Banco de México. Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana" y "Banco de México. Valor de la unidad de inversión". Ambas, "Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/".
- Qué hace MéxicoAPI: guarda los valores como texto con sus decimales (4 en el FIX, 6 en las UDIS), los ordena por fecha y conserva la respuesta de la fuente sin cambios en `raw/`, un archivo por año. En el FIX, `fecha_publicacion` es el día de publicación en el DOF. La API aplica la regla del artículo 20 del Código Fiscal de la Federación para decir qué FIX corresponde a una operación; los archivos de datos no la aplican.

## Datos curados del DOF

- Datasets: `data/dias-inhabiles-cnbv/`, `data/dias-inhabiles-sat/`, `data/constantes-uma/`, `data/constantes-salario-minimo/` y `data/isr-tarifas/`.
- Qué hace MéxicoAPI: una persona transcribe los valores del Diario Oficial de la Federación a un YAML por dataset en `data/curado/`, con la URL, la fecha de publicación y el fragmento literal que respalda cada valor. El comando `curar` genera el JSON y el manifiesto, y `verificar` exige que correspondan al YAML y revisa la aritmética de cada valor. Los montos se guardan como texto con dos decimales y sin separador de miles; los fragmentos conservan las cifras como se publicaron.
- Estos datasets no tienen `raw/`: el original es la publicación citada en cada registro, y la transcripción es el YAML versionado. El manifiesto lista una fuente por publicación, con su licencia y su cita.
- Cada registro lleva su `fuente` con el fragmento citado. Si publicas estos datos, conserva la cita de la publicación oficial.

### Textos oficiales: CNBV, CFF, RMF y Anexo 8

- Datasets: `data/dias-inhabiles-cnbv/`, `data/dias-inhabiles-sat/` y `data/isr-tarifas/`.
- Publican: la Comisión Nacional Bancaria y de Valores (disposiciones que señalan los días en que las entidades financieras deben cerrar), el Congreso de la Unión (Código Fiscal de la Federación, artículo 12, en el texto vigente que publica la Cámara de Diputados) y el SAT (Resolución Miscelánea Fiscal, regla 2.1.6, y su Anexo 8), en el DOF.
- Términos: son textos legislativos, reglamentarios o administrativos oficiales, que no son objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII; https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf).
- Cita: "<nombre de la publicación>. Diario Oficial de la Federación, DD/MM/AAAA. <url>"; para el CFF, "Texto vigente con la última reforma publicada en el DOF el DD/MM/AAAA". Las citas exactas están en cada `manifest.json`.

### INEGI: UMA

- Dataset: `data/constantes-uma/`.
- Publica: Instituto Nacional de Estadística y Geografía (INEGI), "Unidad de medida y actualización", en el DOF cada año.
- Términos: https://www.inegi.org.mx/inegi/terminos.html. El INEGI permite el uso libre de su información y exige darle el crédito.
- Cita: "INEGI. Unidad de medida y actualización. Diario Oficial de la Federación, DD/MM/AAAA. <url>". Si usas estos datos, cita al INEGI como fuente y aclara que fueron procesados por MéxicoAPI.

### CONASAMI: salario mínimo

- Dataset: `data/constantes-salario-minimo/`.
- Publica: el H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos (CONASAMI), en la resolución anual que fija los salarios mínimos, publicada en el DOF.
- Términos: la resolución es un texto administrativo oficial publicado en el DOF, que no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII). Los valores salen de la resolución, no de las series que la CONASAMI publica en otros portales.
- Cita: "<nombre de la resolución>. Diario Oficial de la Federación, DD/MM/AAAA. <url>". Las citas exactas están en `data/constantes-salario-minimo/manifest.json`.
