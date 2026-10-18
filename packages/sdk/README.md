# mexicoapi

Validadores, reglas y datos oficiales de México para JavaScript y TypeScript: CLABE, RFC, CURP y NSS; días hábiles de la LFT, la CNBV y el SAT; tipo de cambio FIX, UDIS, UMA, salario mínimo y tarifas de ISR; estados, municipios y bancos. Incluye el cliente de la API de [MéxicoAPI](https://github.com/Dagel4k/mexicoapi), que usa los datos del paquete si la API no responde, y una herramienta para descargar en tu equipo el catálogo de códigos postales de Correos de México.

- Sin dependencias. ESM con tipos incluidos.
- Funciona sin red: los datos vienen dentro del paquete y cada uno dice su fuente oficial.
- Cada entrada se carga por separado: quien solo valida una CLABE no carga los municipios.

La API de MéxicoAPI todavía no tiene dirección pública: mientras tanto, el cliente pide `base` (el origen de tu despliegue) u `offline: true`. Todo lo demás funciona sin ella.

## Instalación

```bash
npm install mexicoapi
```

También con `pnpm add mexicoapi`, `yarn add mexicoapi` o `bun add mexicoapi`.

## Entradas

| Entrada | Qué trae | Dónde corre |
| --- | --- | --- |
| `mexicoapi` | Validadores y reglas: CLABE, RFC, CURP, NSS, días hábiles, FIX y UDIS sobre una serie | Universal |
| `mexicoapi/datos` | Estados, municipios y bancos | Universal |
| `mexicoapi/datos/fix` | Serie del tipo de cambio FIX | Universal |
| `mexicoapi/datos/udis` | Serie de las UDIS | Universal |
| `mexicoapi/datos/calendarios` | Calendarios de días inhábiles de la CNBV y el SAT | Universal |
| `mexicoapi/datos/constantes` | UMA, salario mínimo y tarifas de ISR | Universal |
| `mexicoapi/cliente` | Cliente de la API con respaldo en los datos del paquete | Universal |
| `mexicoapi/sepomex` | Catálogo de códigos postales descargado en tu equipo | Node |
| `mexicoapi` (binario) | CLI | Node |

Universal quiere decir que no usa módulos de Node: corre en Node, en el navegador con un bundler, en Cloudflare Workers, Deno y Bun.

## Validadores

```ts
import { validarClabe, validarCurp, validarNss, validarRfc } from "mexicoapi";

const r = validarClabe("002010077777777771");
r.valido; // true
r.detalle?.codigo_banco; // "002"
r.detalle?.cuenta; // "07777777777"

validarRfc("XAXX010101000").detalle?.tipo; // "generico"
validarCurp("HEGG560427MVZRRL04").valido; // true
validarNss("12345678903").valido; // true
```

Cada validador devuelve `{ valor, valido, formato_valido, digito_verificador_valido, errores, nota, detalle }`. `errores` dice qué falló (`longitud`, `caracteres`, `digito_verificador`...). Revisan formato y dígito verificador; no confirman que la CLABE, el RFC, la CURP o el NSS existan ante el banco, el SAT, RENAPO o el IMSS.

Para que la CLABE diga su banco, pásale el catálogo del paquete:

```ts
import { validarClabe } from "mexicoapi";
import { catalogoClabe } from "mexicoapi/datos";

const bancos = catalogoClabe(); // guárdalo si vas a validar muchas
validarClabe("002010077777777771", { bancos }).detalle?.banco;
// { codigo: "002", nombre_corto: "BANAMEX", activo: true }
```

Con el catálogo, un código de banco que no existe es un error de formato (`banco`). Un banco dado de baja sigue dando una CLABE válida, con `activo: false`.

## Días hábiles

La LFT (artículos 74 y 715) se calcula por regla y viene en la entrada principal:

```ts
import { calendarioLft, sumarDiasHabiles } from "mexicoapi";

const r = sumarDiasHabiles({ calendario: calendarioLft(), desde: "2026-11-13", dias: 3 });
r.resultado; // "2026-11-19": salta el lunes 16 de noviembre
r.inhabiles_saltados; // [{ fecha: "2026-11-16", motivo: "Tercer lunes de noviembre...", tipo: "descanso", fuente }]
```

Los calendarios de la CNBV y el SAT se transcriben del DOF y están en `mexicoapi/datos/calendarios`. Con el SAT el tipo de plazo es obligatorio: en `declaraciones_pagos` sus vacaciones cuentan como hábiles (CFF, artículo 12) y en `general` no.

```ts
import { sumarDiasHabiles } from "mexicoapi";
import { calendario, calendarioCurado } from "mexicoapi/datos/calendarios";

sumarDiasHabiles({ calendario: calendario("cnbv"), desde: "2026-04-01", dias: 1 }).resultado;
// "2026-04-06": jueves y viernes santos no abren los bancos

const desde = "2026-07-17";
sumarDiasHabiles({ calendario: calendario("sat", "general"), desde, dias: 3 }).resultado;
// "2026-08-05"
sumarDiasHabiles({ calendario: calendario("sat", "declaraciones_pagos"), desde, dias: 3 }).resultado;
// "2026-07-22"

calendario("sat"); // TypeError: Con autoridad=sat falta tipoPlazo: ...

const sat = calendarioCurado("sat");
[...sat.plazos.keys()]; // ["general", "declaraciones_pagos"]
sat.plazos.get("general")?.cobertura; // { desde: "2026-01-01", hasta: "..." }
```

`calendarioCurado(autoridad).plazos` es un `ReadonlyMap`: cada plazo trae su `cobertura`, su `calendario` y, si aplica, un `respaldo`. Fuera de la cobertura, `sumarDiasHabiles` lanza `CalendarioIncompletoError`; con `permitirIncompleto: true` calcula de todos modos con lo publicado (o solo con los fines de semana) y lo dice en `advertencias`.

## Tipo de cambio FIX y UDIS

Las series viajan en `mexicoapi/datos/fix` y `mexicoapi/datos/udis`; las reglas, en la entrada principal. Cada consulta da `{ tipo: "encontrado", registro }`, `{ tipo: "sin_dato" }` (ese día no hubo publicación) o `{ tipo: "no_disponible" }` (el paquete todavía no tiene el dato).

```ts
import { fixParaOperacion, fixPublicado, udiDeFecha } from "mexicoapi";
import { feriadoBancario } from "mexicoapi/datos/calendarios";
import * as fix from "mexicoapi/datos/fix";
import * as udis from "mexicoapi/datos/udis";

// FIX que aplica a una operación según el CFF, artículo 20: el publicado el día anterior.
const r = fixParaOperacion(fix.serie, fix.tramo, fix.cobertura, "2026-10-13", {
  sinPublicacion: feriadoBancario,
});
if (r.tipo === "encontrado") r.registro; // { fecha_publicacion: "2026-10-12", valor: "18.4163" }

fixPublicado(fix.serie, fix.tramo, fix.cobertura, "2026-10-12");
udiDeFecha(udis.serie, udis.tramo, udis.cobertura, "2026-10-01");
fix.cobertura; // primera y última publicación que trae el paquete
```

`feriadoBancario` le dice a la regla qué días entre semana no publica el DOF el FIX (los de descanso de la CNBV). Sin esa opción solo cuentan sábados y domingos, y un feriado después del último dato da `no_disponible`.

## UMA, salario mínimo e ISR

```ts
import { salarioMinimo, tarifaIsr, uma, umaVigente } from "mexicoapi/datos/constantes";

uma(2026)?.diaria; // "117.31"
umaVigente("2027-01-15")?.anio; // 2026: cada UMA rige del 1 de febrero al 31 de enero
salarioMinimo(2026); // [{ zona: "general", diario: "315.04", ... }, { zona: "zlfn", ... }]
tarifaIsr("mensual", 2026)?.tramos;
```

Los importes son texto con sus decimales, como los publica el DOF, para no perder centavos con `number`.

## Estados, municipios y bancos

```ts
import { banco, bancos, buscarMunicipio, estado, estados, meta, municipio, municipios } from "mexicoapi/datos";

estado("25")?.nombre; // "Sinaloa"
municipio("25006")?.nombre; // "Culiacán"
municipios("25").length; // municipios de Sinaloa
buscarMunicipio("culiacan"); // sin distinguir mayúsculas ni acentos
banco("002")?.nombre_corto; // "BANAMEX"
bancos({ activos: true });
meta.bancos.as_of; // fecha del último cambio en la fuente
```

Los registros y las listas están congelados. Cada dataset trae su `meta` con la fuente, su licencia y `as_of`.

## Cliente de la API

```ts
import { crearCliente, MexicoApiError } from "mexicoapi/cliente";

const api = crearCliente({ base: "https://mexicoapi.example.workers.dev", cache: true });

const { data, meta, origen, advertencias } = await api.diasHabiles({
  autoridad: "sat",
  tipoPlazo: "general",
  desde: "2026-07-17",
  dias: 3,
});
data.resultado; // "2026-08-05"
origen; // "api", o "paquete" si la API no respondió
```

Sin red: `crearCliente({ offline: true })` responde todo con los datos del paquete, con las mismas reglas y los mismos errores que la API. `crearCliente({})` sin `base` ni `offline` lanza `TypeError`, igual que una `base` con query, fragmento o credenciales (`usuario:clave@`).

Métodos: `estados`, `estado`, `municipios`, `municipio`, `bancos`, `banco`, `clabe`, `diasHabiles`, `diasInhabiles`, `fixPublicado`, `fixParaOperacion`, `fixUltimo`, `udi`, `uma`, `umaVigente`, `salarioMinimo`, `tarifaIsr`, `status` y `consultar` para cualquier ruta (`api.consultar("/v1/estados/{cve_ent}", { cve_ent: "25" })`). Cada respuesta trae `data` y `meta` como los da la API, más `origen` y `advertencias`.

### Qué responde el paquete y qué la API

- Datos estables (estados, municipios, bancos) y la validación de la CLABE: salen del paquete por omisión, también cuando el cliente tiene `base`, sin red. Con `{ fuente: "api" }` en la consulta se piden a la API.
- Datos que caducan (FIX, UDIS, días hábiles e inhábiles, UMA, salario mínimo y tarifas de ISR): se piden a la API. Si no responde (red, tiempo agotado, 5xx, 429 o una respuesta que no es de la API), responde el paquete con `origen: "paquete"`, su `meta.as_of` y advertencias: que la API falló y, en las series, que el último dato del paquete tiene más de 7 días. Un problema de la API (400, 404, 422) no se cambia por el paquete, y lo que el paquete no tiene da `dato-no-disponible`, nunca un valor anterior.
- `{ fuente: "paquete" }` en una consulta, u `offline: true` en el cliente, nunca usan la red. `status()` solo existe en la API: sin red lanza `TypeError`.

Los datos estables del paquete no llevan advertencia de antigüedad: su `as_of` es la fecha del último cambio en la fuente, no de la última revisión, y el paquete no guarda cuándo se construyó. Un catálogo que no cambió en años tiene un `as_of` viejo y está al día. Por eso tampoco avisa `bancos`, aunque es el que más cambia: Banxico actualiza la lista de participantes y la API la revisa cada día, mientras que el paquete trae la de su versión. Si necesitas la lista al día, pide `{ fuente: "api" }`.

### Errores

Cada método lanza `MexicoApiError` si la API (o el paquete, con las mismas reglas) responde con un problema, o si la API no responde y no hay respaldo:

```ts
try {
  await api.banco("999");
} catch (error) {
  if (error instanceof MexicoApiError) {
    error.status; // 404; 0 si la API no respondió
    error.tipo; // "no-encontrado", "dato-no-disponible", "parametro-invalido"...
    error.detail; // el texto de la API
    error.problema; // el problem+json completo
    error.origen; // "api" o "paquete"
    error.url; // la URL consultada, con {clabe} en lugar de una CLABE
  }
}
```

Los tipos de problema están en [docs/api/problemas.md](https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md).

### Reintentos y tiempo límite

- `timeoutMs` (10 000 por omisión): tope de cada intento, incluida la lectura del cuerpo. Un intento que agota el tiempo no se repite.
- `reintentos` (2 por omisión, de 0 a 10): ante fallos de red, 5xx y 429, con espera exponencial y algo de azar. Todas las rutas son GET.
- `esperaMaximaMs` (10 000 por omisión; 0 para no esperar nunca): lo más que espera una consulta en total entre reintentos. Nunca reintenta antes de lo que pide un `Retry-After` (lo respeta hasta 60 s). Si esa espera no cabe en lo que queda, no reintenta y responde de inmediato con el error, la caché o el paquete. La API pide 60 s en un 429, así que con los valores por omisión un 429 no se reintenta: una función serverless se cortaría antes.
- `signal`: cancela la consulta, también durante las esperas.

### Caché

`cache: true` (o `{ ttlMs, maxEntradas }`, 5 minutos y 100 respuestas por omisión) guarda en memoria las respuestas de la API, nunca más de lo que permite su `Cache-Control`, y revalida con `ETag`. Si al revalidar la API no responde, usa la respuesta guardada mientras no pase su `stale-if-error` (7 días en la API), con `origen: "api"` y una advertencia con su edad: es más nueva que los datos del paquete.

## Códigos postales (SEPOMEX)

El catálogo de códigos postales es de Correos de México y no se puede redistribuir. Su aviso de uso dice:

> El Catálogo Nacional de Códigos Postales, es elaborado por Correos de México y se proporciona en forma gratuita para uso particular, no estando permitida su comercialización, total o parcial, ni su distribución a terceros bajo ningún concepto.

Por eso este paquete no lo trae ni MéxicoAPI lo publica. `mexicoapi/sepomex` lo descarga en tu equipo del formulario público de Correos de México, como lo haría una persona, lo une con los municipios de INEGI y lo guarda en tu caché local. Antes de pedir nada muestra ese aviso (en stderr, o en la función `aviso`). El uso que hagas de esos datos queda sujeto a los términos de Correos de México.

```ts
import { sepomex } from "mexicoapi/sepomex";

await sepomex.sync(); // descarga y guarda; tarda unos segundos
const cp = await sepomex.cp("80000");
// { cp: "80000", estado: { cve_ent: "25", nombre: "Sinaloa" },
//   municipio: { cvegeo: "25006", nombre: "Culiacán" }, asentamientos: [...] }
await sepomex.colonias("80000");
await sepomex.resumen(); // cuándo se descargó, cuántos códigos, el aviso, dónde quedó
```

- Si el sitio bloquea la descarga automática (un 403, un 429 o un CAPTCHA), no se intenta evadir: el error dice cómo bajar el archivo a mano (estado "Todos", formato TXT) y cargarlo con `sepomex.importar("CPdescarga.zip")`, que acepta el ZIP o el TXT.
- La caché queda en `%LOCALAPPDATA%\mexicoapi\sepomex` en Windows y en `$XDG_CACHE_HOME/mexicoapi/sepomex` (o `~/.cache/mexicoapi/sepomex`) en los demás; la opción `dir` la cambia. Si algo falla, la caché anterior queda igual.
- Se guarda en JSON y, con Node 22.13 o posterior (`node:sqlite`), también en SQLite. Con un Node anterior queda solo en JSON y `resumen().sin_sqlite` lo dice.
- Memoria: descargar o importar el catálogo completo (unas 160 mil filas) usa unos 340 MB por un momento. La primera consulta lee el JSON (unos 17 MB) y lo deja en la memoria del proceso.
- Los errores son `SepomexError` con `tipo`: `bloqueado`, `sin-respuesta`, `pagina-inesperada`, `archivo-invalido`, `sin-datos`, `cache-invalida`, `ocupado` o `escritura`.

## CLI

```bash
npx mexicoapi clabe 002010077777777771
npx mexicoapi rfc XAXX010101000 --json
npx mexicoapi dias-habiles --desde 2026-03-16 --dias 5
npx mexicoapi dias-habiles --autoridad sat --tipo-plazo general --desde 2026-07-17 --dias 3
npx mexicoapi municipio culiacan
npx mexicoapi banco 002
npx mexicoapi uma 2026
npx mexicoapi isr mensual 2026
npx mexicoapi sepomex sync
npx mexicoapi sepomex cp 80000
```

```text
$ npx mexicoapi dias-habiles --autoridad sat --tipo-plazo general --desde 2026-07-17 --dias 3
2026-07-17 + 3 días hábiles (sat, general): 2026-08-05
Inhábiles saltados:
  2026-07-20  Primer periodo general de vacaciones de 2026
  ...
Origen: datos del paquete, sin red
```

Sin red todo sale del paquete. Con `--base <url>` (o la variable `MEXICOAPI_BASE`), `dias-habiles`, `uma`, `salario-minimo` e `isr` consultan primero la API y, si no responde, usan el paquete y lo dicen en el pie (`Origen: datos del paquete (la API no respondió)`). `municipio` y `banco` salen siempre del paquete, sin red, también con `--base`. `--json` imprime el resultado completo (los errores, por stderr), `--depurar` muestra el detalle técnico de un error y `mexicoapi <comando> --help` explica cada comando.

Códigos de salida:

| Código | Cuándo |
| --- | --- |
| 0 | Todo bien |
| 1 | Dato o resultado inválido (una CLABE con mal dígito, un banco o un año que no existe) o error al ejecutar |
| 2 | Uso incorrecto: comando desconocido, falta un argumento u opción (`--autoridad sat` sin `--tipo-plazo`) o uno mal formado (`--dias x`, `sepomex cp 8000`) |

## Nombres

- Las funciones y los métodos tipados del cliente, y sus parámetros, van en camelCase: `sumarDiasHabiles`, `tipoPlazo`, `permitirIncompleto`.
- Los datos (`data`, `meta`, los registros de `mexicoapi/datos`), `consultar`, los problemas y la CLI usan los nombres de la API: `cve_ent`, `nombre_corto`, `tipo_plazo`, `inhabiles_saltados`, `--tipo-plazo`.

## Privacidad

- Los validadores corren en tu equipo. Un RFC, una CURP o un NSS nunca salen de él. Una CLABE solo sale si pides su validación a la API con `{ fuente: "api" }` (en `clabe()` o en `consultar()`).
- Ni los mensajes de error, ni `url`, ni el problema, ni la cadena de causas traen una CLABE: aparece como `{clabe}`.
- El cliente solo habla con la `base` que le das y no agrega más encabezados que `Accept` e `If-None-Match`. `sepomex.sync()` solo habla con el sitio de Correos de México. No hay telemetría.

## Tamaño y compatibilidad

Tamaño con gzip de lo que carga cada entrada (todos sus módulos juntos), en la versión 0.1.0:

| Entrada | gzip |
| --- | --- |
| `mexicoapi` | 10.8 KB (una prueba exige 15 KB o menos) |
| `mexicoapi/cliente` | 8.3 KB al importarlo; el núcleo y cada dataset se cargan solo si responde el paquete |
| `mexicoapi/datos` | 44.8 KB |
| `mexicoapi/datos/fix` | 13.4 KB |
| `mexicoapi/datos/udis` | 19.1 KB |
| `mexicoapi/datos/calendarios` | 13.0 KB |
| `mexicoapi/datos/constantes` | 8.7 KB |

| Entorno | Estado |
| --- | --- |
| Node 20, 22 y 24 | Probado en CI con el paquete instalado desde su `.tgz` |
| CommonJS (`require`) | Desde Node 20.19 y 22.12, que cargan ESM con `require()`; antes, solo `import` |
| Cloudflare Workers | Probado en workerd, sin `nodejs_compat` |
| Navegador con bundler | Entradas universales, sin módulos de Node; `sideEffects: false` |
| Deno y Bun | Entradas universales; sin pruebas propias |
| TypeScript | Tipos incluidos, probados con `moduleResolution` NodeNext y Bundler |

`mexicoapi/sepomex` y la CLI piden Node. El SQLite de SEPOMEX pide Node 22.13 o posterior.

## Licencias

El código es [MIT](https://github.com/Dagel4k/mexicoapi/blob/main/LICENSE). Los datos que trae el paquete no son del proyecto: conservan los términos de la institución que los publica (INEGI, Banxico, DOF, CNBV, SAT, CONASAMI), y cada `meta` dice su fuente y su licencia. El detalle de cada uno está en [DATA_LICENSE.md](https://github.com/Dagel4k/mexicoapi/blob/main/DATA_LICENSE.md). Si publicas estos datos, conserva la cita de la fuente.
