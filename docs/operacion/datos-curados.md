# Datos curados

Los calendarios de la CNBV y el SAT, la UMA, el salario mínimo y las tarifas de ISR no los baja un bot: una persona los transcribe del Diario Oficial de la Federación (DOF) a un YAML en `data/curado/`, con la cita literal de cada valor, y el cambio entra por PR revisado. Este documento explica cómo agregar una publicación nueva.

| Archivo en `data/curado/` | Dataset | Cuándo hay publicación nueva |
| --- | --- | --- |
| `dias-inhabiles-cnbv.yaml` | `dias-inhabiles.cnbv` | Cada diciembre, las disposiciones de la CNBV del año siguiente |
| `dias-inhabiles-sat.yaml` | `dias-inhabiles.sat` | Cada diciembre, la RMF del año siguiente; durante el año, sus resoluciones de modificaciones (regla 2.1.6). Solo las vacaciones: los días del artículo 12 del CFF los calcula el núcleo |
| `constantes-uma.yaml` | `constantes.uma` | Cada enero, la UMA que publica el INEGI |
| `constantes-salario-minimo.yaml` | `constantes.salario-minimo` | Cada diciembre, la resolución de la CONASAMI |
| `isr-tarifas.yaml` | `isr.tarifas` | Cada diciembre, el Anexo 8 de la RMF |

Cada YAML genera su carpeta en `data/` (por ejemplo `data/dias-inhabiles-sat/`) con el JSON canónico y el manifiesto. Los calendarios llevan además `calendario.json`: sus tipos de plazo con la cobertura de cada uno y la publicación que cita los fines de semana de cada año (en el SAT, ninguna: los cita el artículo 12), lo mismo que usa la API, sin los días; el paquete `mexicoapi` lo lee tal cual. Esa carpeta nunca se edita a mano: `verificar` la regenera desde el YAML y falla si no coincide byte a byte.

Los días del primer párrafo del artículo 12 del CFF (1o. de enero, primer lunes de febrero, etc.) no se capturan: los calcula una regla del núcleo (`diasDescansoCff`) de 2026 a 2100, con el texto y la fecha de la última reforma del CFF que guarda el núcleo (`FUENTE_CFF_12` y `VIGENCIA_CFF`). `curar` los agrega a la lista publicada del SAT en los años que cubre el YAML. Si se reforma el artículo 12, se cambia la regla del núcleo y su prueba, no el YAML.

El workflow Frescura revisa cada día hasta cuándo cubren estos datos: cada tipo de plazo de los calendarios, la vigencia de la última UMA y el último año del salario mínimo y de las tarifas de ISR. Treinta días antes de que termine una cobertura (o si ya terminó) abre un issue por cobertura, "Cobertura por vencer: …", que enlaza este documento, y cada día actualiza su descripción con los días que faltan. Nunca cierra ninguno: se cierra a mano al integrar el PR con la publicación nueva. Con el pipeline compilado, `pnpm --filter @mexicoapi/pipeline coberturas` lista cada cobertura y los días que faltan; con `--dias 30`, solo las que terminan en ese plazo.

El mismo workflow lee cada día el índice del SIDOF de ese día (la fecha de la Ciudad de México, con las ediciones matutina, vespertina y extraordinaria que haya a esa hora) y abre un issue `Publicación en el DOF: <código> (<captura>)` por cada nota cuyo título trae alguno de estos textos, sin distinguir mayúsculas ni acentos: "Resolución de Modificaciones a la Resolución Miscelánea Fiscal", "Resolución Miscelánea Fiscal para", "cerrar sus puertas", "salarios mínimos", "Unidad de Medida y Actualización" o "Anexo 8". El issue trae el título de la nota, el enlace a su texto en el SIDOF (`https://sidof.segob.gob.mx/notas/docFuente/<código>`) y los YAML donde puede ir la captura. No captura nada: si la publicación trae los datos, se capturan con los pasos de abajo y el issue se cierra al integrar el PR; si no, se cierra sin más. Un issue con ese título, abierto o cerrado, no se vuelve a abrir. Si el SIDOF no responde, la corrida deja un aviso y sigue en verde; ese día no se revisa. El workflow corre a partir de las 13:00: una edición vespertina publicada más tarde no se revisa, ni ese día ni el siguiente. Con el pipeline compilado, `pnpm --filter @mexicoapi/pipeline dof --fecha AAAA-MM-DD` revisa el índice completo de un día anterior, y sin `--fecha`, el de hoy.

## Pasos

1. Crear una rama para la tarea (`curado/sat-vacaciones-2026-2`, por ejemplo; no `datos/…`: ese prefijo es el del bot, y `solo-datos` deja `verify` en rojo si la rama toca algo fuera de las carpetas de sus datasets) y compilar una vez para tener el comando de curado:

   ```bash
   pnpm install --frozen-lockfile
   pnpm -r build
   ```

2. Buscar la publicación en el DOF y copiar su dirección. Las notas del DOF tienen la forma `https://dof.gob.mx/nota_detalle.php?codigo=NNNNNNN&fecha=DD/MM/AAAA`. La fecha de la dirección debe ser la de publicación: `verificar` rechaza una `fecha_publicacion` que no coincida con ella.

3. Editar el YAML. En `fuentes` se agrega una entrada por publicación, con una clave en minúsculas, dígitos, puntos y guiones:

   ```yaml
   fuentes:
     segundo-periodo-2026:
       nombre: "Título de la resolución que publique el segundo periodo, tal como sale en el DOF"
       url: https://dof.gob.mx/nota_detalle.php?codigo=NNNNNNN&fecha=DD/MM/2026
       fecha_publicacion: 2026-MM-DD
       fragmento: "2.1.6. ... El segundo periodo general de vacaciones de 2026, comprende del … al … de diciembre de 2026."
       licencia: "Texto oficial publicado en el DOF; no es objeto de derecho de autor (LFDA art. 14, fracción VIII)"
       licencia_url: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf
   ```

   El `fragmento` es texto del DOF copiado tal cual, sin retocarlo. `[...]` marca texto omitido, y `...` es como el DOF publica las partes que una modificación no cambia. Si dos fuentes tienen la misma URL, deben coincidir en nombre, fecha de publicación y licencia; solo cambia el fragmento.

4. Agregar los días o los valores en `registros`, cada uno con `fuente: <clave>`. Una fuente que ningún registro usa también falla.

5. Si la publicación completa un tramo del calendario, extender la `cobertura` del YAML (ver la sección siguiente). Un día fuera de la cobertura de su tipo falla.

6. Generar la carpeta de `data/` desde el YAML:

   ```bash
   node packages/pipeline/dist/bin.js curar --datos data
   ```

   Equivale a `pnpm datos:curar`. Si el YAML tiene problemas, no escribe nada y los lista: un error de sintaxis con su línea y columna, y uno de esquema o de invariante con la ruta del campo (`registros.3.fecha`) o la fecha del registro, no con la línea. Cuando pasa, reescribe los archivos de `data/<dataset>/` que cambiaron.

7. Volver a compilar, porque la API y el sitio salen de los datos ya curados, y verificar:

   ```bash
   pnpm -r build
   pnpm datos:verificar
   ./scripts/verify.sh
   ```

   El orden importa: si se compila antes de `curar`, el Worker publica los datos anteriores. Las pruebas de integración lo detectan: fallan y piden `pnpm -r build`.

8. Si cambió la cobertura de un calendario, actualizar los documentos que citan la cobertura vigente. Las pruebas la toman de los datos, así que no fallan cuando estos textos quedan viejos:

   - `docs/api/README.md`: la tabla de [Cobertura de la CNBV y el SAT](../api/README.md#cobertura-de-la-cnbv-y-el-sat), los ejemplos del 422 y de `permitir_incompleto`, y en [dias-inhabiles](../api/README.md#dias-inhabiles) los años que se responden, el número de fechas de cada autoridad y la advertencia;
   - `docs/api/problemas.md`: la cobertura de hoy en `calendario-incompleto`;
   - `docs/diseno/arquitectura-v1.md`: el párrafo de cobertura de "Datos curados" (sección 8), el de "Calendario incompleto" (sección 8.1) y la decisión sobre la cobertura del SAT `general` (sección 14);
   - `docs/datos/dias-inhabiles-cnbv.md` o `docs/datos/dias-inhabiles-sat.md`: la sección Cobertura;
   - este documento: el ejemplo de [Cobertura de los calendarios](#cobertura-de-los-calendarios) y los [Pendientes](#pendientes);
   - el encabezado del YAML, si dice hasta dónde está completa la lista.

9. Abrir un PR con el YAML y la carpeta regenerada de `data/`. En la descripción, la liga a la nota del DOF.

Los pasos 6 y 7 se repiten cada vez que se edita el YAML.

## Cobertura de los calendarios

Los calendarios (`dias-inhabiles-cnbv.yaml` y `dias-inhabiles-sat.yaml`) declaran en `cobertura` el rango en que su lista está completa, por tipo de día:

```yaml
# dias-inhabiles-cnbv.yaml
cobertura:
  descanso: { desde: 2025-01-01, hasta: 2026-12-31 }
# dias-inhabiles-sat.yaml: solo las vacaciones; la de descanso es la de la regla del artículo 12
cobertura:
  vacaciones: { desde: 2026-01-01, hasta: 2026-11-30 }
```

La API no puede saber si un día fuera de ese rango es inhábil, así que responde 422 `calendario-incompleto`. Por eso la cobertura se extiende solo cuando la publicación está completa para ese tramo: nada la revisa contra el DOF. Si se declara hasta el 31 de diciembre y falta un día, la API contará ese día como hábil sin avisar.

Para el SAT, cada tipo de plazo calcula su propia cobertura a partir de los tipos de día que cuenta:

- `declaraciones_pagos` solo cuenta `descanso` (las vacaciones son hábiles en esos plazos), así que llega hasta donde llega la regla del artículo 12: el 31 de diciembre de 2100.
- `general` cuenta `descanso` y `vacaciones`, así que llega hasta donde coinciden ambas coberturas (la intersección).

Es lo que pasa hoy: `vacaciones` llega al 30 de noviembre de 2026, y por eso `general` termina ahí. Ver la [documentación de la API](../api/README.md#cobertura-de-la-cnbv-y-el-sat).

Cada día tiene que caer en la cobertura de su tipo y, además, en la de algún tipo de plazo. En el SAT, la más amplia es la de `declaraciones_pagos`, es decir, la de la regla: unas vacaciones antes de 2026 (por ejemplo, la cola de 2025 de un segundo periodo) no caben en ningún plazo y el YAML falla, aunque estén dentro de la cobertura de `vacaciones`. El YAML del SAT tampoco puede traer días de `descanso`, ni la cobertura de `descanso`, ni unas vacaciones en un día del artículo 12: los da la regla.

Cuando se amplía la cobertura de un tipo para un año completo, hay que capturar todos los días de ese tipo en el año, no solo los de la publicación nueva.

## Calendario de la CNBV y el FIX

La API usa los días de la CNBV para responder el [FIX de una operación](../api/README.md#publicado-y-operación): da por hecho que en un día de descanso de la CNBV el DOF no publica el FIX. Un día capturado por error en `dias-inhabiles-cnbv.yaml` hace que, la mañana siguiente a ese día, `operacion` responda la publicación anterior, un valor viejo, en vez de `dato-no-disponible`. Revisa dos veces cada fecha de la CNBV contra las disposiciones del DOF antes de fusionar: la verificación recalcula los días de regla y revisa el día y el mes con que empieza el motivo, pero no sabe si sobra un día. Por lo mismo, la CNBV solo admite días de tipo `descanso` (los de cierre); unas vacaciones administrativas, con los bancos abiertos, no se capturan aquí.

## Qué atrapa la verificación

`verificar` y `curar` rechazan el YAML si:

- una llave no existe, falta una obligatoria o un valor tiene el tipo equivocado (los montos van entre comillas y con dos decimales, las fechas como `AAAA-MM-DD`);
- una URL no es https o no está en `dof.gob.mx`, `sidof.segob.gob.mx` o `www.diputados.gob.mx`;
- la fecha de una nota del DOF no coincide con la de su URL;
- una fecha, una clave o un registro están duplicados, o una fuente declarada no se usa;
- en un calendario, un día cae fuera de la cobertura de su tipo o de la de todos los tipos de plazo, un plazo se queda sin cobertura, o su `autoridad` no es la del archivo; en el de la CNBV, además, un día o una cobertura de un tipo que no sea `descanso`; en el del SAT, un día o una cobertura de `descanso` (los da la regla del artículo 12) o unas vacaciones en un día del artículo 12;
- el `motivo` de un día de regla ("tercer lunes de noviembre") no da la fecha capturada. El motivo debe nombrar el mes ("tercer lunes de noviembre"); un ordinal con día de la semana que no se pueda leer (como "3er lunes") también falla, para que ninguna regla pase sin revisar;
- un `motivo` que empieza con un día y un mes ("16 de septiembre", "1o. de enero", "17 y 18 de abril") no coincide con la fecha capturada (con alguna de ellas, si nombra varias);
- en la UMA, la mensual no es la diaria por 30.4, la anual no es la mensual por 12, la vigencia no es el 1 de febrero del año, o el `fragmento` no contiene los montos capturados;
- en el salario mínimo, la vigencia no es el 1 de enero, el `fragmento` no cita el monto, falta una zona o la `zlfn` no es mayor que la general;
- en las tarifas de ISR, los límites no encadenan (cada inferior es el superior anterior más un centavo), las tasas no crecen o difieren de las otras tarifas, o la cuota fija no es la del tramo anterior más su impuesto completo;
- en la UMA y el salario mínimo, la fuente se publicó después de que empezara la vigencia.

Los montos se comparan en centavos enteros, sin decimales flotantes. Un dígito mal capturado en una cifra casi siempre rompe alguna de estas igualdades.

## Excepción de cuota fija del ISR

El SAT actualiza cada cantidad de la tarifa por separado, así que la cuota fija publicada puede diferir un centavo de la que resulta de encadenar el tramo anterior. Eso se tolera. Si la diferencia es mayor, `verificar` falla con la cuota esperada. Antes de declarar una excepción hay que comparar la cifra con el DOF: casi siempre es un error de captura.

Si el valor publicado de verdad no cuadra (el tramo 10 de la tarifa anual de 2025 se publicó como 392,294.17 y el encadenamiento da 392,294.19), se conserva el valor publicado y se declara la excepción en el mismo YAML:

```yaml
excepciones_cuota_fija:
  - anio: 2025
    periodo: anual
    tramo: 10
    publicada: "392294.17"
    calculada: "392294.19"
    motivo: "El SAT actualiza cada cantidad de la tarifa por separado; el encadenamiento da 392,294.19 y el DOF publica 392,294.17."
```

`publicada` debe ser la cuota fija capturada y `calculada` la que resulta del encadenamiento: si alguna cambia, la excepción falla. También falla si no hace falta (la diferencia cabe en la tolerancia) o si ningún tramo la usa.

## Pendientes

### Segundo periodo de vacaciones del SAT de 2026

El SAT suele fijar el segundo periodo general de vacaciones de diciembre en una resolución de modificaciones a la RMF, o en la RMF del año siguiente. Cuando se publique:

1. Agregar la fuente en `data/curado/dias-inhabiles-sat.yaml`, con el `fragmento` de la regla 2.1.6 donde aparece el periodo.
2. Agregar un registro `tipo: vacaciones` por cada día del periodo, incluidos sábados y domingos, con `fuente` apuntando a esa fuente. Un día del artículo 12 (el 25 de diciembre, el 1 de enero) no se captura: ya es de descanso por la regla, y `verificar` falla si se repite como vacaciones.
3. Extender `cobertura.vacaciones.hasta` al 2026-12-31. Con eso, la advertencia de `dias-inhabiles` para 2026 desaparece y `general` llega al 31 de diciembre.
4. Quitar del encabezado del YAML el párrafo que dice que el periodo no se ha publicado.
5. Seguir los pasos 6 a 9.

Si el periodo cruza al 2027 (por ejemplo, hasta el 4 de enero), se extiende la cobertura de `vacaciones` hasta ese día. Los días del artículo 12 de 2027 ya los da la regla, y `curar` agrega a la lista los de 2027 porque el YAML ya cubre parte de ese año.

### Calendarios de 2027

Las disposiciones de la CNBV para 2027 se publican en el DOF en diciembre de 2026, y la RMF 2027 con su regla 2.1.6 se publica a fines de diciembre. Para cada una:

1. Agregar una fuente por publicación. En el calendario de la CNBV, la del artículo 1 de las disposiciones; en el del SAT, la regla 2.1.6 de la RMF 2027.
2. Agregar los días de 2027: los de las disposiciones en la CNBV; las vacaciones o días inhábiles de la regla 2.1.6 en el SAT. Los del artículo 12 del CFF no se capturan: los da la regla del núcleo. Los días de regla de la CNBV llevan en `motivo` la regla ("Tercer lunes de noviembre, en conmemoración del 20 de noviembre") para que la verificación recalcule la fecha.
3. Extender la `cobertura` al 2027-12-31 para los tipos que queden completos. En el SAT, `vacaciones` queda en el último día de periodo publicado, y entonces `general` termina ahí hasta que se publique el resto; `declaraciones_pagos` ya llega a 2100.
4. Seguir los pasos 6 a 9.

Si se reforma el artículo 12 del CFF (o se publica un decreto o una regla que declare inhábil la transmisión del Poder Ejecutivo de 2030), se cambian la regla del núcleo (`packages/core/src/dias-habiles/cff.ts`), su fecha de vigencia y sus pruebas.

Los calendarios de 2025 y 2026 no se borran: la cobertura es un rango continuo y los plazos que empiezan en un año pueden terminar en el siguiente.

### Constantes de 2027

La UMA de 2027 se publica en enero de 2027 (`constantes-uma.yaml`: fuente `uma-2027` y un registro con vigencia al 2027-02-01). El salario mínimo y el Anexo 8 de la RMF se publican en diciembre (`constantes-salario-minimo.yaml` e `isr-tarifas.yaml`). En la tarifa de ISR, las tasas no cambian: solo se actualizan los montos.
