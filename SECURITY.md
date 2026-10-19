# Política de seguridad

## Versiones soportadas

La API desplegada es siempre la de `main`: las correcciones llegan con el siguiente despliegue. Los paquetes de npm `mexicoapi` y `mexicoapi-mcp` reciben correcciones de seguridad solo en su última versión.

## Cómo reportar una vulnerabilidad

No abras un issue público. Usa el formulario privado de GitHub: <https://github.com/Dagel4k/mexicoapi/security/advisories/new> (en la pestaña Security del repositorio, "Report a vulnerability").

Incluye qué encontraste, cómo reproducirlo y qué impacto crees que tiene.

## Tiempo de respuesta

Acusamos recibo en un máximo de 7 días. Después te contamos si lo aceptamos como vulnerabilidad y cómo vamos a corregirlo.

## Alcance

Entra en el alcance la API, los paquetes que publicamos y el pipeline de datos.

Un dato oficial equivocado (un día feriado, una tasa, un valor de la UMA) no es una vulnerabilidad: repórtalo como un issue normal.

## Análisis automático

El workflow `seguridad.yml` corre en cada pull request, en cada push a `main` y una vez por semana:

- CodeQL analiza el código TypeScript con las consultas `security-extended`.
- osv-scanner revisa `pnpm-lock.yaml` y falla si hay vulnerabilidades conocidas. Las excepciones, si las hay, se justifican en `osv-scanner.toml`.
- OpenSSF Scorecard evalúa las prácticas del repositorio (solo en `main` y en la corrida semanal) y publica el resultado.

Los hallazgos de CodeQL, osv-scanner y Scorecard aparecen en la pestaña Security, sección Code scanning. Además, CI revisa los workflows con actionlint y busca secretos con gitleaks.

## Paquetes de npm

Después de su primera versión, que se publica a mano, `mexicoapi` y `mexicoapi-mcp` se publican desde el workflow `publicacion.yml`, sin tokens (trusted publishing de npm) y con procedencia: la página de cada versión en npmjs.com enlaza el commit y la corrida que la publicaron, y `npm audit signatures` la verifica en un proyecto que instala los paquetes.
