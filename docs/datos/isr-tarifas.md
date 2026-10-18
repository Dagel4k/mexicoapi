# Tarifas de ISR (Anexo 8 de la RMF)

Tarifas del impuesto sobre la renta de personas físicas que el SAT publica en el Anexo 8 de la Resolución Miscelánea Fiscal: la mensual, para los pagos provisionales mensuales del artículo 96 de la Ley del ISR, y la anual, para el cálculo del impuesto del ejercicio (artículos 97 y 152).

- Identificador: `isr.tarifas`
- Clave: `anio` más `periodo`
- Se actualiza: a mano, cuando el DOF publica el Anexo 8 de una RMF con tarifas nuevas; el cambio entra por PR revisado
- Datos en el repositorio: `data/isr-tarifas/` (generado) y `data/curado/isr-tarifas.yaml` (la transcripción)

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `anio` | número | `2026` | Año al que se aplica la tarifa |
| `periodo` | texto | `"mensual"` | `mensual` o `anual` |
| `tramos` | lista | ver abajo | Renglones de la tarifa, en el orden publicado |
| `fuente` | objeto | ver abajo | Fracción del Anexo 8 que publica la tarifa |

Cada tramo:

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `limite_inferior` | texto, dos decimales | `"844.60"` | Límite inferior en pesos |
| `limite_superior` | texto, dos decimales, o `null` | `"7168.51"` | Límite superior en pesos; `null` en el último tramo ("En adelante") |
| `cuota_fija` | texto, dos decimales | `"16.22"` | Cuota fija en pesos |
| `tasa_excedente` | texto, dos decimales | `"6.40"` | Por ciento que se aplica sobre el excedente del límite inferior |

Los montos son texto con dos decimales y sin separador de miles. Con la tarifa, el impuesto de un ingreso es la cuota fija de su tramo más la `tasa_excedente` por ciento de lo que exceda al límite inferior.

## Qué tarifas incluye

Del Anexo 8 de cada RMF se capturan la tarifa mensual del año y las tarifas anuales que publica. La RMF 2026, por ejemplo, trae la anual del ejercicio 2025, que se usa en la declaración anual de 2025 que se presenta en 2026, y la del ejercicio 2026.

El Anexo 8 también trae tarifas de 7, 10 y 15 días, por día trabajado, para el artículo 106 por mes y otras. No están en este dataset.

## Fuente de cada registro

| Campo | Descripción |
| --- | --- |
| `nombre` | Nombre de la publicación |
| `url` | Nota del DOF con los anexos de la RMF |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`) |
| `fragmento` | Encabezado de la fracción del Anexo 8 que contiene la tarifa, citado tal cual |

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| Repositorio | `data/isr-tarifas/tarifas.json` y `manifest.json` |
| Transcripción con citas | `data/curado/isr-tarifas.yaml` |

## Fuente y licencia

- Fuente: Anexo 8 de la Resolución Miscelánea Fiscal, publicado por el SAT en el Diario Oficial de la Federación.
- Licencia: texto oficial publicado en el DOF, que no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII).
- Cita: "Anexo 8 de la Resolución Miscelánea Fiscal", el año de la RMF, "Diario Oficial de la Federación" y la fecha de publicación. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- La verificación revisa la aritmética de cada tarifa: el primer tramo empieza en 0.01 con cuota fija 0.00, cada límite inferior es el superior anterior más un centavo, solo el último tramo es abierto, las tasas crecen y son las mismas en todas las tarifas, y cada cuota fija es la anterior más el impuesto del tramo anterior completo. Un dígito mal capturado en un límite o una cuota hace fallar la verificación.
- El SAT actualiza cada cantidad de la tarifa por separado, así que el encadenamiento de cuotas puede diferir un centavo. Lo que pase de eso se declara en el YAML, en `excepciones_cuota_fija`, con el valor publicado, el recalculado y el motivo. Por ejemplo, el tramo 10 de la tarifa anual de 2025 se publicó como 392,294.17 y el encadenamiento da 392,294.19. Siempre se conserva el valor publicado.
- La cuota fija del primer tramo de la tarifa anual de 2026 se publicó como "0", sin decimales. Aquí se captura como `"0.00"`, igual que en las demás tarifas.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
