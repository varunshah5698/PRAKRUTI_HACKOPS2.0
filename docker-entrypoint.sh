#!/bin/sh
set -e

attempt=1
until node server/dist/db/setup.js; do
  if [ "$attempt" -ge 20 ]; then
    echo "Database schema setup failed after 20 attempts."
    exit 1
  fi
  echo "Database not ready yet (attempt $attempt). Retrying…"
  attempt=$((attempt + 1))
  sleep 2
done

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "Seeding deterministic demo data (existing data is not overwritten)…"
  node server/dist/db/seed.js || echo "Seed skipped or failed; the API will still start."
fi

exec node server/dist/index.js
