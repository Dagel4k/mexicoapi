#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# pnpm omite `prepare` si la instalación ya está al día; esto deja el hook activo siempre.
git config core.hooksPath .githooks

echo "verify: instalando dependencias"
pnpm install --frozen-lockfile

echo "verify: biome"
pnpm biome ci .

echo "verify: typecheck"
pnpm -r typecheck

echo "verify: pruebas con cobertura"
pnpm test:coverage

echo "verify: build"
pnpm -r build

echo "verify: gitleaks"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git . --no-banner --redact
elif [ -n "${CI:-}" ]; then
  echo "verify: gitleaks no estÃ¡ instalado y CI estÃ¡ activo" >&2
  exit 1
else
  echo "verify: aviso, gitleaks no estÃ¡ instalado; se omite el escaneo de secretos" >&2
fi

echo "verify: OK"
