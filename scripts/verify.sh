#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# pnpm omite `prepare` si la instalación ya está al día; esto deja el hook activo siempre.
if git rev-parse --git-dir >/dev/null 2>&1; then git config core.hooksPath .githooks; fi

echo "verify: instalando dependencias"
pnpm install --frozen-lockfile

echo "verify: biome"
pnpm biome ci .

echo "verify: typecheck"
pnpm -r typecheck

echo "verify: pruebas con cobertura"
pnpm test:coverage

echo "verify: pruebas en zonas horarias"
pnpm test:tz

echo "verify: build"
pnpm -r build

echo "verify: paquete mexicoapi"
pnpm --filter mexicoapi test:paquete

echo "verify: integración de la API"
pnpm --filter @mexicoapi/api test:integracion

echo "verify: cliente contra el Worker"
pnpm --filter mexicoapi test:integracion

echo "verify: datos"
pnpm datos:verificar

echo "verify: gitleaks"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git . --no-banner --redact
elif [ -n "${CI:-}" ]; then
  echo "verify: gitleaks no está instalado y CI está activo" >&2
  exit 1
else
  echo "verify: aviso, gitleaks no está instalado; se omite el escaneo de secretos" >&2
fi

echo "verify: OK"
