# Salario mínimo (CONASAMI)

Salario mínimo general diario, en pesos, que fija cada año el Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos (CONASAMI) en una resolución publicada en el DOF. Hay un valor para la zona general y otro para la Zona Libre de la Frontera Norte.

- Identificador: `constantes.salario-minimo`
- Clave: `anio` más `zona`
- Se actualiza: a mano, una vez al año, cuando la resolución se publica en el DOF; el cambio entra por PR revisado
- Datos en el repositorio: `data/constantes-salario-minimo/` (generado) y `data/curado/constantes-salario-minimo.yaml` (la transcripción)

## Campos

| Campo | Tipo | Ejemplo | Descripción |
| --- | --- | --- | --- |
| `anio` | número | `2026` | Año del salario mínimo |
| `zona` | texto | `"general"` | `general` o `zlfn` (Zona Libre de la Frontera Norte) |
| `diario` | texto, dos decimales | `"315.04"` | Salario mínimo diario en pesos |
| `vigencia_desde` | texto `AAAA-MM-DD` | `"2026-01-01"` | Primer día de vigencia (1 de enero) |
| `fuente` | objeto | ver abajo | Resolución de la CONASAMI en el DOF |

Cada año tiene dos registros, uno por zona. Los montos son texto con dos decimales y sin separador de miles.

La zona general cambia de nombre según la resolución: "área de Salarios Mínimos Generales" en 2019, "Resto del país" de 2020 a 2024 y "Zona del Salario Mínimo General (ZSMG)" desde 2025. Aquí siempre es `general`.

## Fuente de cada registro

| Campo | Descripción |
| --- | --- |
| `nombre` | Nombre abreviado de la resolución |
| `url` | Nota del DOF |
| `fecha_publicacion` | Fecha de publicación en el DOF (`AAAA-MM-DD`) |
| `fragmento` | Resolutivo que fija los montos de las dos zonas, citado tal cual; `[...]` marca texto omitido |

## Dónde consultarlo

| Forma | Ruta |
| --- | --- |
| Repositorio | `data/constantes-salario-minimo/salario-minimo.json` y `manifest.json` |
| Transcripción con citas | `data/curado/constantes-salario-minimo.yaml` |

## Fuente y licencia

- Fuente: resolución del H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos que fija los salarios mínimos de cada año, publicada en el Diario Oficial de la Federación.
- Licencia: texto oficial publicado en el DOF, que no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII).
- Cita: el nombre de la resolución, "Diario Oficial de la Federación" y la fecha de publicación. Las citas exactas están en el manifiesto.

Más detalle en [DATA_LICENSE.md](../../DATA_LICENSE.md).

## Notas

- Solo incluye el salario mínimo general. Los salarios mínimos profesionales, que fija la misma resolución, no están en este dataset.
- La lista de municipios de la Zona Libre de la Frontera Norte cambia con los años y no se incluye; está en el resolutivo primero de cada resolución.
- La verificación comprueba que cada año tenga las dos zonas, que la vigencia empiece el 1 de enero, que la resolución se haya publicado antes y que el fragmento contenga el monto capturado. Como en todos los años desde 2019 el salario de la ZLFN es mayor que el general, también lo exige, para atrapar zonas intercambiadas.
- Cómo se captura: una persona transcribe el DOF al YAML de `data/curado/`, con la cita literal de cada valor, y el comando `curar` genera la carpeta. `verificar` regenera los archivos desde el YAML y falla si no coinciden byte a byte.
