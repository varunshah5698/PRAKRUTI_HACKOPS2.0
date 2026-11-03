#!/bin/sh
set -e

echo "Preparing database schema…"
node server/dist/db/setup.js

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "Seeding deterministic demo data (existing data is not overwritten)…"
  node server/dist/db/seed.js --if-empty || echo "Seed skipped or failed; the API will still start."
fi

exec node server/dist/index.js
