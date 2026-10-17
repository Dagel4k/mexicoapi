# @mexicoapi/core

Funciones puras en TypeScript, sin dependencias de runtime. Por ahora el paquete es interno (`private`); lo consumen el SDK, la API y el MCP del monorepo.

## Qué exporta

- Validadores: `validarClabe`, `validarRfc`, `validarCurp` y `validarNss`, más los cálculos de dígito verificador (`digitoControlClabe`, `digitoVerificadorRfc`, `digitoVerificadorCurp`, `digitoVerificadorNss`).
- Días hábiles: `sumarDiasHabiles`, `calendarioLft`, `crearCalendario`, `diasDescansoLft` y `CalendarioIncompletoError`.
- Fechas `YYYY-MM-DD`: `esFechaIsoValida`, `sumarDias`, `diaDeLaSemana`, `enesimoDiaDeSemana`, `esBisiesto` y `fechaValida`.
- Constantes y tipos: `NOTA_VALIDACION`, `ResultadoValidacion`, `Calendario`, `DiaInhabil`, `Fuente`, entre otros.

Los validadores revisan formato y dígito verificador. No confirman que la CLABE, el RFC, la CURP o el NSS existan ante un banco, el SAT, RENAPO o el IMSS. Las funciones `validar*` nunca lanzan excepciones, aunque la entrada no sea string: una entrada inválida devuelve `valido: false` con los códigos de error. Las auxiliares `digito*` sí lanzan `RangeError` si la entrada no tiene la longitud o los caracteres esperados. Las funciones de días hábiles lanzan `RangeError` por parámetros inválidos y `CalendarioIncompletoError` (con `codigo: "calendario-incompleto"`) si la fecha cae fuera de la cobertura del calendario.

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
