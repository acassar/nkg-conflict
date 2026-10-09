#!/usr/bin/env bash
# Installe les dépendances sans le registre npm : récupère node_modules depuis la branche deps-cache,
# publiée par la CI pour le lockfile courant. Usage : bash scripts/deps-from-cache.sh
set -euo pipefail
cd "$(dirname "$0")/.."
hash=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
git fetch -q --depth=1 origin deps-cache
cached=$(git show FETCH_HEAD:LOCKHASH)
if [ "$cached" != "$hash" ]; then
  echo "deps-cache correspond à un autre lockfile ($cached), attendu $hash : relancer la CI sur main (workflow_dispatch) après la mise à jour du lockfile" >&2
  exit 1
fi
tmp=$(mktemp -d)
git archive FETCH_HEAD | tar -x -C "$tmp"
rm -rf node_modules
cat "$tmp"/node_modules.tgz.part-* | tar -xz
rm -rf "$tmp"
echo "node_modules restauré depuis deps-cache ($hash)"
