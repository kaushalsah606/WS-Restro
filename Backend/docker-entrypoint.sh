#!/bin/sh
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  npx prisma migrate deploy
fi

if [ "$RUN_SEED" = "true" ]; then
  echo "[entrypoint] seeding database"
  node dist-seed/seed.js
fi

exec "$@"
