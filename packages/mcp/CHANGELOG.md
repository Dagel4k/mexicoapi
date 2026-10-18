# Cambios

## 0.1.0 (sin publicar)

Primera versión.

- Servidor MCP por stdio, de solo lectura: ninguna herramienta escribe, borra ni hace peticiones arbitrarias.
- 13 herramientas: municipios, bancos, validadores de CLABE, RFC, CURP y NSS, FIX, UDIS, días inhábiles y hábiles, constantes (UMA, salario mínimo e ISR) y códigos postales.
- Funciona sin red con los datos del paquete `mexicoapi`; con `MEXICOAPI_BASE`, las herramientas de datos que caducan consultan la API y avisan si usan el paquete.
- Cada resultado trae texto en español y `structuredContent` con su `outputSchema`, la fuente oficial, la fecha de corte y el origen.
- Requiere Node 22.13 o posterior.
