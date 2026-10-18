#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Cada paso dice cuántos segundos van desde el inicio.
paso() { echo "verify: $1 (${SECONDS} s)"; }

# pnpm omite `prepare` si la instalación ya está al día; esto deja el hook activo siempre.
if git rev-parse --git-dir >/dev/null 2>&1; then git config core.hooksPath .githooks; fi

paso "instalando dependencias"
pnpm install --frozen-lockfile

paso "biome"
pnpm biome ci .

paso "typecheck"
pnpm -r typecheck

# El build va antes de las pruebas: un error de compilación aparece en segundos, no al final.
paso "build"
pnpm -r build

paso "datos"
pnpm datos:verificar

paso "pruebas con cobertura (TZ=America/Mexico_City)"
pnpm test:coverage

# Solo los proyectos que usan fechas del sistema (Date o Intl); el núcleo calcula con enteros.
paso "pruebas en otra zona horaria (TZ=UTC)"
pnpm test:tz

paso "paquete mexicoapi"
pnpm --filter mexicoapi test:paquete

paso "integración de la API"
pnpm --filter @mexicoapi/api test:integracion

paso "cliente contra el Worker"
pnpm --filter mexicoapi test:integracion

paso "integración del servidor MCP"
pnpm --filter mexicoapi-mcp test:integracion

paso "paquete mexicoapi-mcp"
pnpm --filter mexicoapi-mcp test:paquete

paso "gitleaks"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git . --no-banner --redact
elif [ -n "${CI:-}" ]; then
  echo "verify: gitleaks no está instalado y CI está activo" >&2
  exit 1
else
  echo "verify: aviso, gitleaks no está instalado; se omite el escaneo de secretos" >&2
fi

echo "verify: OK en ${SECONDS} s"
