#!/usr/bin/env sh
# Applies pending Alembic migrations, then starts the API. Migrations run on
# every container start rather than at image-build time, since the DB isn't
# reachable during `docker build` (and may itself just have started).
set -eu

echo "Running database migrations..."
alembic upgrade head

echo "Starting API server..."
exec uvicorn server.main:app --host 0.0.0.0 --port 8001
