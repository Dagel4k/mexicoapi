# @mexicoapi/core

Funciones puras en TypeScript, sin dependencias de runtime. Por ahora el paquete es interno (`private`); lo consumen el SDK, la API y el MCP del monorepo.

## Qué exporta

- Validadores: `validarClabe`, `validarRfc`, `validarCurp` y `validarNss`, más los cálculos de dígito verificador (`digitoControlClabe`, `digitoVerificadorRfc`, `digitoVerificadorCurp`, `digitoVerificadorNss`) y `normalizarClabe` (la CLABE sin separadores, como la revisa `validarClabe`).
- Días hábiles: `sumarDiasHabiles`, `calendarioLft`, `crearCalendario`, `diasDescansoLft`, `CalendarioIncompletoError` y `FechaFueraDeRangoError`.
- Tipo de cambio FIX y UDIS: `fixPublicado` (el publicado en el DOF ese día), `fixParaOperacion` (el aplicable a una operación según el CFF art. 20, con `FUENTE_CFF_20`), `udiDeFecha` y `SerieIncompletaError`. Reciben un tramo de la serie, las fechas que cubre ese tramo y la cobertura de la serie completa, y responden `encontrado`, `sin_dato` (definitivo) o `no_disponible` (falta cargar la publicación que decide la respuesta).
- Fechas `YYYY-MM-DD`: `esFechaIsoValida`, `sumarDias`, `diaDeLaSemana`, `enesimoDiaDeSemana`, `esBisiesto` y `fechaValida`.
- Catálogos de los calendarios: `AUTORIDADES`, `TIPOS_PLAZO` y `TIPOS_DIA_CURADO` (los tipos `Autoridad`, `TipoPlazo` y `TipoDiaCurado` salen de ellos) y `NOMBRE_AUTORIDAD` ("el SAT"), el único lugar donde se nombran las autoridades en los textos.
- Reglas de la API entre parámetros, que el MCP y la CLI usan sin pedirle nada a la API: `revisarTipoPlazo` (con el SAT, el tipo de plazo es obligatorio; con las demás no se acepta) y `revisarFix` (exactamente uno de `publicado` u `operacion`). Devuelven el problema de la API o null.
- `aUnaLinea`: un texto de los datos o de la API sin saltos ni caracteres de control, para imprimirlo.
- Constantes y tipos: `NOTA_VALIDACION`, `ResultadoValidacion`, `Calendario`, `DiaInhabil`, `Fuente`, entre otros.

Las subrutas van aparte para no pesar en quien solo valida:

- `@mexicoapi/core/curados`: los calendarios de la CNBV y el SAT. `PLAZOS` y `revisarPlazos` (los tipos de plazo y su cobertura), `crearCalendarioCurado` (un calendario por tipo de plazo, con su respaldo), `sumarDiasHabilesCurado` (con el respaldo y sus advertencias), `diasInhabilesCurados` y `exigirAnio` (la lista de un año y lo que puede faltar) y `feriadosBancarios` (los días sin publicación del FIX). Fuera de la cobertura lanzan `CalendarioIncompletoError` con `detalle`, el texto que da la API.
- `@mexicoapi/core/constantes`: `umaVigente` (la UMA que rige en una fecha) y `anioDeConstante` (si una constante tiene un año, o por qué no).
- `@mexicoapi/core/rutas`: la semántica de las rutas de la API, que comparten el Worker y el cliente del paquete y que publica el OpenAPI. `REGLAS_RUTA` y `CONSULTAS` (la regla y el texto de cada parámetro de la ruta y de la query, en el orden en que se revisan), `revisarConsulta` (una query en el orden de la API: sin nombre, desconocidos, faltantes, repetidos, vacíos y cada regla), `revisarTipoPlazo` y `revisarFix`, `metaLft` (la meta de la LFT con la fecha de `VIGENCIA_LFT`), `problemaDeError` (un error del núcleo como problema de la API, comparando su `tipo`), `problemaSinRegistro`, `consultarConFeriados` (el FIX con los feriados bancarios solo si hacen falta) y `diasInhabilesLft`.
- `@mexicoapi/core/parametros`: solo `REGLAS_RUTA`, `cumpleRegla`, `revisarTipoPlazo` y `revisarFix`, sin más dependencias que los catálogos: el cliente del paquete los carga al importarse.
- `@mexicoapi/core/problemas`: `PROBLEMAS` (título y status de cada tipo), `URL_API` (la API pública), `URL_REPOSITORIO`, `URL_DOCS`, `URL_PROBLEMAS` y `tipoDeProblema`. No importa nada.

Los validadores revisan formato y dígito verificador. No confirman que la CLABE, el RFC, la CURP o el NSS existan ante un banco, el SAT, RENAPO o el IMSS. Las funciones `validar*` nunca lanzan excepciones, aunque la entrada no sea string: una entrada inválida devuelve `valido: false` con los códigos de error. Las auxiliares `digito*` sí lanzan `RangeError` si la entrada no tiene la longitud o los caracteres esperados. Los errores del núcleo traen `tipo` para reconocerlos sin `instanceof`, que falla con dos copias del núcleo (`problemaDeError` lo compara así). Las funciones de días hábiles lanzan `RangeError` por parámetros inválidos, `FechaFueraDeRangoError` (un `RangeError` con `tipo: "fecha-fuera-de-rango"`) si el resultado pasaría de 0001-9999, y `CalendarioIncompletoError` (con `tipo: "calendario-incompleto"`) si la fecha cae fuera de la cobertura del calendario. Las consultas de FIX y UDIS lanzan `RangeError` si la fecha, la cobertura o el tramo no son válidos (el tramo debe estar dentro de la cobertura), y `SerieIncompletaError` (con `tipo: "serie-incompleta"`) si el tramo que reciben no alcanza para responder con certeza o trae registros fuera de sus fechas.

En el RFC, un dígito verificador que no coincide aparece en `errores` como `digito_verificador`, pero no invalida el resultado: `valido` es igual a `formato_valido`. Cerca de 1.5 % de los RFC en uso tienen un dígito inválido, y rechazar un RFC real es peor que aceptar un error de dedo.

`validarClabe` acepta catálogos opcionales de bancos y plazas. Con catálogo de bancos, un código que no está en él da el error `banco`. La plaza solo es informativa: si no está en el catálogo, queda en `null`.

## Ejemplos

```ts
import { validarClabe } from "@mexicoapi/core";

validarClabe("002010077777777771");
// {
//   valor: "002010077777777771",
//   valido: true,
//   formato_valido: true,
//   digito_verificador_valido: true,
//   errores: [],
//   nota: "Valida formato y dígito verificador; no confirma que exista ante el SAT, RENAPO, el IMSS o un banco.",
//   detalle: {
//     codigo_banco: "002", codigo_plaza: "010", cuenta: "07777777777",
//     digito_control: "1", banco: null, plaza: null
//   }
// }
```

```ts
import { calendarioLft, sumarDiasHabiles } from "@mexicoapi/core";

sumarDiasHabiles({ calendario: calendarioLft(), desde: "2026-11-13", dias: 3 });
// {
//   autoridad: "lft",
//   desde: "2026-11-13",
//   dias: 3,
//   resultado: "2026-11-19",
//   inhabiles_saltados: [
//     {
//       fecha: "2026-11-16",
//       motivo: "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
//       tipo: "descanso",
//       fuente: { nombre: "Ley Federal del Trabajo, artículo 74", url: "...", fragmento: "..." }
//     }
//   ],
//   advertencias: []
// }
```

En el segundo ejemplo, `url` y `fragmento` se abrevian aquí; la salida real los trae completos.
