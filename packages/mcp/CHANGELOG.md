# Cambios

## 0.1.0 (sin publicar)

Primera versión.

- Servidor MCP por stdio, de solo lectura: ninguna herramienta escribe, borra ni hace peticiones arbitrarias.
- 13 herramientas: municipios, bancos, validadores de CLABE, RFC, CURP y NSS, FIX, UDIS, días inhábiles y hábiles, constantes (UMA, salario mínimo e ISR) y códigos postales.
- Las herramientas de datos que caducan consultan la API pública de MéxicoAPI (o la de `MEXICOAPI_BASE`) y avisan si usan el paquete; con `MEXICOAPI_SIN_RED=1` funciona sin red con los datos del paquete `mexicoapi`.
- Cada resultado trae texto en español y `structuredContent` con su `outputSchema`, la fuente oficial, la fecha de corte y el origen.
- Cada error de herramienta empieza con su tipo de problema, los de la API: `[no-encontrado] …`, `[dato-no-disponible] …`.
- Requiere Node 22.13 o posterior.
