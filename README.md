# MéxicoAPI

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15752/badge)](https://www.bestpractices.dev/projects/15752)

Datos de referencia de México, abiertos y al día, con su fuente oficial.

Cualquier sistema que se hace en México termina necesitando lo mismo:

- estados y municipios;
- bancos y validación de CLABE;
- tipo de cambio y UDIS;
- días inhábiles del SAT o de los bancos;
- UMA, salario mínimo y tablas de ISR.

Hoy cada quien descarga esos datos por su cuenta, los limpia a mano y deja de actualizarlos. MéxicoAPI los publica una sola vez, bien hechos, con su fuente. Un bot revisa las fuentes de los datos automáticos, a diario o cada semana, y los actualiza cuando cambian; los que se transcriben del DOF los captura una persona con cada publicación.

> La API v1 ya está en línea en https://mexicoapi.dagel4k.workers.dev, con las descargas y el sitio. Los paquetes `mexicoapi` y `mexicoapi-mcp` están en npm desde el 2026-10-18 (0.1.0).

## Qué incluye

- API pública de solo lectura, rápida (archivos estáticos en el borde) y gratuita.
- Paquete de npm (`mexicoapi`) con cliente, validadores y datos para usar sin conexión: `npm install mexicoapi`.
- Servidor MCP ([`mexicoapi-mcp`](packages/mcp/README.md)) para que los asistentes de IA consulten el dato oficial en vez de inventarlo: `npx -y mexicoapi-mcp`.
- Descargas completas en JSON, CSV y SQLite.

Cada respuesta indica de dónde salió el dato, su licencia y la fecha de su última actualización.

## Datos de la primera versión

| Dato | Fuente |
| --- | --- |
| Estados y municipios | INEGI |
| Bancos (participantes SPEI) y validación de CLABE | Banxico |
| Tipo de cambio FIX y UDIS | Diario Oficial de la Federación |
| Días inhábiles (LFT, bancos y SAT) | DOF, LFT, CFF |
| UMA, salario mínimo y tarifas de ISR | INEGI, CONASAMI, SAT |

Los códigos postales de SEPOMEX no se pueden redistribuir. El paquete trae un comando (`mexicoapi sepomex sync`) que los descarga directamente de Correos de México en tu máquina y los deja listos para usar.

## Datos disponibles hoy

| Dataset | Carpeta | Fuente | Se actualiza | Documentación |
| --- | --- | --- | --- | --- |
| Estados | `data/inegi-estados/` | INEGI | semanal | [estados](docs/datos/inegi-estados.md) |
| Municipios | `data/inegi-municipios/` | INEGI | semanal | [municipios](docs/datos/inegi-municipios.md) |
| Bancos, con historial | `data/bancos/` | Banxico | diario | [bancos](docs/datos/bancos.md) |
| Tipo de cambio FIX | `data/tipo-cambio-fix/` | DOF (Banxico) | diario | [FIX](docs/datos/tipo-cambio-fix.md) |
| UDIS | `data/udis/` | DOF (Banxico) | diario | [UDIS](docs/datos/udis.md) |
| Días inhábiles de la CNBV | `data/dias-inhabiles-cnbv/` | CNBV, DOF | a mano, con cada publicación | [días CNBV](docs/datos/dias-inhabiles-cnbv.md) |
| Días inhábiles del SAT | `data/dias-inhabiles-sat/` | CFF y RMF, DOF | las vacaciones, a mano con cada publicación de la RMF; los del art. 12 del CFF, por regla | [días SAT](docs/datos/dias-inhabiles-sat.md) |
| UMA | `data/constantes-uma/` | INEGI, DOF | a mano, cada año | [UMA](docs/datos/constantes-uma.md) |
| Salario mínimo | `data/constantes-salario-minimo/` | CONASAMI, DOF | a mano, cada año | [salario mínimo](docs/datos/constantes-salario-minimo.md) |
| Tarifas de ISR | `data/isr-tarifas/` | Anexo 8 de la RMF, DOF | a mano, cada año | [tarifas de ISR](docs/datos/isr-tarifas.md) |

Además, la API valida CLABE, calcula días hábiles con los calendarios de la Ley Federal del Trabajo, la CNBV y el SAT, y responde la UMA vigente en una fecha.

Cada carpeta incluye `manifest.json` con la fuente, la licencia y el hash, y los archivos fuente en `raw/` (los descargados tal cual y, en bancos, la compilación mensual del CEP). Los datos curados (días inhábiles, UMA, salario mínimo e ISR) no tienen `raw/`: se transcriben del DOF a `data/curado/`, un YAML por dataset con la cita literal de cada valor, y el comando `curar` genera su carpeta. Los días que fija una ley no se transcriben: los del art. 12 del CFF en el calendario del SAT (y los del art. 74 de la LFT) los calcula una regla del núcleo, y del SAT solo se capturan las vacaciones. Los términos de uso de cada fuente están en [DATA_LICENSE.md](DATA_LICENSE.md).

## API

API de solo lectura, con respuestas JSON `{ data, meta }`, descargas completas y especificación OpenAPI, en https://mexicoapi.dagel4k.workers.dev (`workers.dev` de Cloudflare; todavía sin dominio propio). No pide llave ni cuenta. La referencia está en [docs/api/README.md](docs/api/README.md) y los errores en [docs/api/problemas.md](docs/api/problemas.md); el despliegue, en [docs/operacion/cloudflare.md](docs/operacion/cloudflare.md).

```bash
curl https://mexicoapi.dagel4k.workers.dev/v1/estados/25
curl https://mexicoapi.dagel4k.workers.dev/v1/clabe/002010077777777771
```

El mismo despliegue sirve el sitio, que genera el build con los datos: en `/` la página de inicio con los datasets, su fuente y las descargas; en `/estado/`, si cada dataset automático está al día; y en `/llms.txt`, un resumen de la API para herramientas que leen ese formato, con la documentación completa en `/llms-full.txt` ([detalles](docs/api/README.md#sitio)).

## Documentación

- [API v1](docs/api/README.md) y [errores](docs/api/problemas.md)
- [Paquete `mexicoapi`](packages/sdk/README.md): validadores, datos sin red, cliente, SEPOMEX y CLI
- [Servidor MCP `mexicoapi-mcp`](packages/mcp/README.md): herramientas, configuración del cliente y `MEXICOAPI_BASE`
- [Diseño técnico v1](docs/diseno/arquitectura-v1.md)
- [Bot de datos](docs/operacion/bot-de-datos.md)
- [Datos curados](docs/operacion/datos-curados.md): cómo se transcriben del DOF los calendarios y las constantes
- [Publicación en npm](docs/operacion/publicacion-npm.md): cómo se arman y se publican los paquetes
- [Cómo contribuir](CONTRIBUTING.md) y [política de seguridad](SECURITY.md)

## Licencia

El código se publica bajo la licencia [MIT](LICENSE). Los datos conservan la licencia de su fuente oficial, indicada en cada dataset.
