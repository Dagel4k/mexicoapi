# @mexicoapi/core

Funciones puras en TypeScript, sin dependencias de runtime. Por ahora el paquete es interno (`private`); lo consumen el SDK, la API y el MCP del monorepo.

## Qué exporta

- Validadores: `validarClabe`, `validarRfc`, `validarCurp` y `validarNss`, más los cálculos de dígito verificador (`digitoControlClabe`, `digitoVerificadorRfc`, `digitoVerificadorCurp`, `digitoVerificadorNss`).
- Días hábiles: `sumarDiasHabiles`, `calendarioLft`, `crearCalendario`, `diasDescansoLft`, `CalendarioIncompletoError` y `FechaFueraDeRangoError`.
- Tipo de cambio FIX y UDIS: `fixPublicado` (el publicado en el DOF ese día), `fixParaOperacion` (el aplicable a una operación según el CFF art. 20, con `FUENTE_CFF_20`), `udiDeFecha` y `SerieIncompletaError`. Reciben un tramo de la serie, las fechas que cubre ese tramo y la cobertura de la serie completa, y responden `encontrado`, `sin_dato` (definitivo) o `no_disponible` (falta cargar la publicación que decide la respuesta).
- Fechas `YYYY-MM-DD`: `esFechaIsoValida`, `sumarDias`, `diaDeLaSemana`, `enesimoDiaDeSemana`, `esBisiesto` y `fechaValida`.
- Constantes y tipos: `NOTA_VALIDACION`, `ResultadoValidacion`, `Calendario`, `DiaInhabil`, `Fuente`, entre otros.

Dos subrutas traen las reglas de los datos curados, aparte para no pesar en quien solo valida:

- `@mexicoapi/core/curados`: los calendarios de la CNBV y el SAT. `PLAZOS` y `revisarPlazos` (los tipos de plazo y su cobertura), `crearCalendarioCurado` (un calendario por tipo de plazo, con su respaldo), `sumarDiasHabilesCurado` (con el respaldo y sus advertencias), `diasInhabilesCurados` y `exigirAnio` (la lista de un año y lo que puede faltar) y `feriadosBancarios` (los días sin publicación del FIX). Fuera de la cobertura lanzan `CalendarioIncompletoError` con `detalle`, el texto que da la API.
- `@mexicoapi/core/constantes`: `umaVigente` (la UMA que rige en una fecha) y `anioDeConstante` (si una constante tiene un año, o por qué no).

Los validadores revisan formato y dígito verificador. No confirman que la CLABE, el RFC, la CURP o el NSS existan ante un banco, el SAT, RENAPO o el IMSS. Las funciones `validar*` nunca lanzan excepciones, aunque la entrada no sea string: una entrada inválida devuelve `valido: false` con los códigos de error. Las auxiliares `digito*` sí lanzan `RangeError` si la entrada no tiene la longitud o los caracteres esperados. Las funciones de días hábiles lanzan `RangeError` por parámetros inválidos, `FechaFueraDeRangoError` (un `RangeError` con `codigo: "fecha-fuera-de-rango"`) si el resultado pasaría de 0001-9999, y `CalendarioIncompletoError` (con `codigo: "calendario-incompleto"`) si la fecha cae fuera de la cobertura del calendario. Las consultas de FIX y UDIS lanzan `RangeError` si la fecha, la cobertura o el tramo no son válidos (el tramo debe estar dentro de la cobertura), y `SerieIncompletaError` (con `codigo: "serie-incompleta"`) si el tramo que reciben no alcanza para responder con certeza o trae registros fuera de sus fechas.

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
