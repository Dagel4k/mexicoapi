# Política de seguridad

## Versiones soportadas

Solo la última versión publicada recibe correcciones de seguridad.

## Cómo reportar una vulnerabilidad

No abras un issue público. Usa el formulario privado de GitHub: en la pestaña Security del repositorio, elige "Report a vulnerability".

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
