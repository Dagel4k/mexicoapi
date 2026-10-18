# MéxicoAPI

Datos de referencia de México, abiertos y al día, con su fuente oficial.

Cualquier sistema que se hace en México termina necesitando lo mismo:

- estados y municipios;
- bancos y validación de CLABE;
- tipo de cambio y UDIS;
- días inhábiles del SAT o de los bancos;
- UMA, salario mínimo y tablas de ISR.

Hoy cada quien descarga esos datos por su cuenta, los limpia a mano y deja de actualizarlos. MéxicoAPI los publica una sola vez, bien hechos, y los mantiene al día de forma automática.

> En desarrollo. Los primeros datos ya están en [`data/`](data/) y la API v1 está construida y documentada, pero todavía no está desplegada; el paquete de npm viene después. No hay versión publicada.

## Qué va a incluir

- **API pública** de solo lectura: rápida (archivos estáticos en el borde) y gratuita.
- **Paquete de npm** (`mexicoapi`) con cliente, validadores y datos para usar sin conexión.
- **Servidor MCP** (`mexicoapi-mcp`) para que los asistentes de IA consulten el dato oficial en vez de inventarlo.
- **Descargas completas** en JSON, CSV y SQLite.

Cada respuesta indica de dónde salió el dato, su licencia y la fecha en que se verificó.

## Datos de la primera versión

| Dato | Fuente |
| --- | --- |
| Estados y municipios | INEGI |
| Bancos (participantes SPEI) y validación de CLABE | Banxico |
| Tipo de cambio FIX y UDIS | Diario Oficial de la Federación |
| Días inhábiles (LFT, bancos y SAT) | DOF, LFT, CFF |
| UMA, salario mínimo y tarifas de ISR | INEGI, CONASAMI, SAT |

Los códigos postales de SEPOMEX no se pueden redistribuir. El paquete incluirá un comando para descargarlos directamente de Correos de México en tu máquina y dejarlos listos para usar.

## Datos disponibles hoy

| Dataset | Carpeta | Fuente | Se actualiza | Documentación |
| --- | --- | --- | --- | --- |
| Estados | `data/inegi-estados/` | INEGI | semanal | [estados](docs/datos/inegi-estados.md) |
| Municipios | `data/inegi-municipios/` | INEGI | semanal | [municipios](docs/datos/inegi-municipios.md) |
| Bancos, con historial | `data/bancos/` | Banxico | diario | [bancos](docs/datos/bancos.md) |

Además, la API calcula la validación de CLABE y los días hábiles con el calendario de la Ley Federal del Trabajo.

Cada carpeta incluye `manifest.json` con la fuente, la licencia y el hash, y los archivos fuente en `raw/` (los descargados tal cual y, en bancos, la compilación mensual del CEP). Los términos de uso de cada fuente están en [DATA_LICENSE.md](DATA_LICENSE.md).

## API

API de solo lectura, con respuestas JSON `{ data, meta }`, descargas completas y especificación OpenAPI. Se publicará primero en `workers.dev` y después en un dominio propio; el despliegue público viene después. La referencia está en [docs/api/README.md](docs/api/README.md) y los errores en [docs/api/problemas.md](docs/api/problemas.md).

```bash
curl https://<base>/v1/estados/25
curl https://<base>/v1/clabe/002010077777777771
```

## Documentación

- [API v1](docs/api/README.md) y [errores](docs/api/problemas.md)
- [Diseño técnico v1](docs/diseno/arquitectura-v1.md)
- [Bot de datos](docs/operacion/bot-de-datos.md)

## Licencia

El código se publica bajo la licencia [MIT](LICENSE). Los datos conservan la licencia de su fuente oficial, indicada en cada dataset.
