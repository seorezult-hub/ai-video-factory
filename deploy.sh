#!/bin/bash
set -e

git pull origin main
docker compose build --no-cache
docker compose up -d
docker compose logs --tail=20 app
