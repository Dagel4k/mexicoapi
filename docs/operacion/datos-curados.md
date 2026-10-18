# Datos curados

Los calendarios de la CNBV y el SAT, la UMA, el salario mínimo y las tarifas de ISR no los baja un bot: una persona los transcribe del Diario Oficial de la Federación (DOF) a un YAML en `data/curado/`, con la cita literal de cada valor, y el cambio entra por PR revisado. Este documento explica cómo agregar una publicación nueva.

| Archivo en `data/curado/` | Dataset | Cuándo hay publicación nueva |
| --- | --- | --- |
| `dias-inhabiles-cnbv.yaml` | `dias-inhabiles.cnbv` | Cada diciembre, las disposiciones de la CNBV del año siguiente |
| `dias-inhabiles-sat.yaml` | `dias-inhabiles.sat` | Cada diciembre, la RMF del año siguiente; durante el año, sus resoluciones de modificaciones (regla 2.1.6) |
| `constantes-uma.yaml` | `constantes.uma` | Cada enero, la UMA que publica el INEGI |
| `constantes-salario-minimo.yaml` | `constantes.salario-minimo` | Cada diciembre, la resolución de la CONASAMI |
| `isr-tarifas.yaml` | `isr.tarifas` | Cada diciembre, el Anexo 8 de la RMF |

Cada YAML genera su carpeta en `data/` (por ejemplo `data/dias-inhabiles-sat/`) con el JSON canónico y el manifiesto. Esa carpeta nunca se edita a mano: `verificar` la regenera desde el YAML y falla si no coincide byte a byte.

## Pasos

1. Crear una rama para la tarea (`datos/sat-vacaciones-2026-2`, por ejemplo) y compilar una vez para tener el comando de curado:

   ```bash
   pnpm install --frozen-lockfile
   pnpm -r build
   ```

2. Buscar la publicación en el DOF y copiar su dirección. Las notas del DOF tienen la forma `https://dof.gob.mx/nota_detalle.php?codigo=NNNNNNN&fecha=DD/MM/AAAA`. La fecha de la dirección debe ser la de publicación: `verificar` rechaza una `fecha_publicacion` que no coincida con ella.

3. Editar el YAML. En `fuentes` se agrega una entrada por publicación, con una clave en minúsculas, dígitos, puntos y guiones:

   ```yaml
   fuentes:
     segunda-rm-2026:
       nombre: "Segunda Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026"
       url: https://dof.gob.mx/nota_detalle.php?codigo=NNNNNNN&fecha=DD/MM/2026
       fecha_publicacion: 2026-MM-DD
       fragmento: "2.1.6. ... IV. El segundo periodo general de vacaciones de 2026, comprende del … al … de diciembre de 2026."
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

   Equivale a `pnpm datos:curar`. Si el YAML tiene problemas, no escribe nada y los lista con el campo y la línea. Cuando pasa, reescribe los archivos de `data/<dataset>/` que cambiaron.

7. Volver a compilar, porque la API y el sitio salen de los datos ya curados, y verificar:

   ```bash
   pnpm -r build
   pnpm datos:verificar
   ./scripts/verify.sh
   ```

   El orden importa: si se compila antes de `curar`, el Worker publica los datos anteriores.

8. Si cambió la cobertura de un calendario, actualizar los documentos que citan la cobertura vigente. Las pruebas la toman de los datos, así que no fallan cuando estos textos quedan viejos:

   - `docs/api/README.md`: la tabla de [Cobertura de la CNBV y el SAT](../api/README.md#cobertura-de-la-cnbv-y-el-sat), los ejemplos del 422 y de `permitir_incompleto`, y en [dias-inhabiles](../api/README.md#dias-inhabiles) los años que se responden y la advertencia;
   - `docs/api/problemas.md`: la cobertura de hoy en `calendario-incompleto`;
   - `docs/diseno/arquitectura-v1.md`: el párrafo de cobertura de "Datos curados" (sección 8) y la decisión sobre la cobertura del SAT `general` (sección 14);
   - `docs/datos/dias-inhabiles-cnbv.md` o `docs/datos/dias-inhabiles-sat.md`: la sección Cobertura;
   - este documento: el ejemplo de [Cobertura de los calendarios](#cobertura-de-los-calendarios) y los [Pendientes](#pendientes);
   - el encabezado del YAML, si dice hasta dónde está completa la lista.

9. Abrir un PR con el YAML y la carpeta regenerada de `data/`. En la descripción, la liga a la nota del DOF.

Los pasos 6 y 7 se repiten cada vez que se edita el YAML.

## Cobertura de los calendarios

Los calendarios (`dias-inhabiles-cnbv.yaml` y `dias-inhabiles-sat.yaml`) declaran en `cobertura` el rango en que su lista está completa, por tipo de día:

```yaml
cobertura:
  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }
  vacaciones: { desde: 2026-01-01, hasta: 2026-11-30 }
```

La API no puede saber si un día fuera de ese rango es inhábil, así que responde 422 `calendario-incompleto`. Por eso la cobertura se extiende solo cuando la publicación está completa para ese tramo: nada la revisa contra el DOF. Si se declara hasta el 31 de diciembre y falta un día, la API contará ese día como hábil sin avisar.

Para el SAT, cada tipo de plazo calcula su propia cobertura a partir de los tipos de día que cuenta:

- `declaraciones_pagos` solo cuenta `descanso` (las vacaciones son hábiles en esos plazos), así que llega hasta donde llegue la cobertura de `descanso`.
- `general` cuenta `descanso` y `vacaciones`, así que llega hasta donde coinciden ambas coberturas (la intersección).

Es lo que pasa hoy en 2026: `descanso` llega al 31 de diciembre, `vacaciones` al 30 de noviembre, y por eso `general` termina el 30 de noviembre. Ver la [documentación de la API](../api/README.md#cobertura-de-la-cnbv-y-el-sat).

Cuando se amplía la cobertura de un tipo para un año completo, hay que capturar todos los días de ese tipo en el año, no solo los de la publicación nueva.

## Qué atrapa la verificación

`verificar` y `curar` rechazan el YAML si:

- una llave no existe, falta una obligatoria o un valor tiene el tipo equivocado (los montos van entre comillas y con dos decimales, las fechas como `AAAA-MM-DD`);
- una URL no es https o no está en `dof.gob.mx`, `sidof.segob.gob.mx` o `www.diputados.gob.mx`;
- la fecha de una nota del DOF no coincide con la de su URL;
- una fecha, una clave o un registro están duplicados, o una fuente declarada no se usa;
- en un calendario, un día cae fuera de la cobertura de su tipo, o su `autoridad` no es la del archivo;
- el `motivo` de un día de regla ("tercer lunes de noviembre") no da la fecha capturada. El motivo debe nombrar el mes ("tercer lunes de noviembre"); un ordinal con día de la semana que no se pueda leer (como "3er lunes") también falla, para que ninguna regla pase sin revisar;
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
2. Agregar un registro `tipo: vacaciones` por cada día del periodo, incluidos sábados y domingos, con `fuente` apuntando a esa fuente. Un día que ya es de descanso (el 25 de diciembre) se queda como `descanso`: la clave es la fecha.
3. Extender `cobertura.vacaciones.hasta` al 2026-12-31. Con eso, `general` y `declaraciones_pagos` quedan con la misma cobertura y la advertencia de `dias-inhabiles` para 2026 desaparece.
4. Quitar del encabezado del YAML el párrafo que dice que el periodo no se ha publicado.
5. Seguir los pasos 6 a 9.

Si el periodo cruza al 2027 (por ejemplo, hasta el 1 de enero), esos días de 2027 caen fuera de la cobertura de 2026 y el YAML falla. Hay que capturar entonces el calendario del SAT de 2027 en el mismo cambio.

### Calendarios de 2027

Las disposiciones de la CNBV para 2027 se publican en el DOF en diciembre de 2026, y la RMF 2027 con su regla 2.1.6 se publica a fines de diciembre. Para cada una:

1. Agregar una fuente por publicación. En el calendario de la CNBV, la del artículo 1 de las disposiciones; en el del SAT, el artículo 12 del CFF (ya declarado como `cff-12`, aunque su `fecha_publicacion` es la de la última reforma, que habrá que actualizar si cambió) y la regla 2.1.6 de la RMF 2027.
2. Agregar los días de 2027: los de las disposiciones en la CNBV; los del artículo 12 y las vacaciones o días inhábiles de la regla 2.1.6 en el SAT. Los días de regla llevan en `motivo` la regla ("Tercer lunes de noviembre, en conmemoración del 20 de noviembre") para que la verificación recalcule la fecha.
3. Extender la `cobertura` al 2027-12-31 para los tipos que queden completos. En el SAT, `descanso` suele poder cerrarse al publicarse la RMF; `vacaciones` queda en el último día de periodo publicado, y entonces `general` termina ahí hasta que se publique el resto.
4. Seguir los pasos 6 a 9.

Los calendarios de 2025 y 2026 no se borran: la cobertura es un rango continuo y los plazos que empiezan en un año pueden terminar en el siguiente.

### Constantes de 2027

La UMA de 2027 se publica en enero de 2027 (`constantes-uma.yaml`: fuente `uma-2027` y un registro con vigencia al 2027-02-01). El salario mínimo y el Anexo 8 de la RMF se publican en diciembre (`constantes-salario-minimo.yaml` e `isr-tarifas.yaml`). En la tarifa de ISR, las tasas no cambian: solo se actualizan los montos.
