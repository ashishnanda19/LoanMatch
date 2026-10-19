#!/usr/bin/env bash
# Apply db/migrations/*.sql to the RDS instance from your laptop (needs Docker; no local psql).
# RDS admits your IP via the security group (my_ip_cidr). Migrations are idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

tf() { terraform -chdir=infra output -raw "$1"; }
HOST="$(tf db_host)"; NAME="$(tf db_name)"; USER_="$(tf db_user)"; PASS="$(tf db_password)"

for f in db/migrations/*.sql; do
  echo "applying $f"
  docker run --rm -i -e PGPASSWORD="$PASS" postgres:16-alpine \
    psql "host=$HOST port=5432 dbname=$NAME user=$USER_ sslmode=require" \
    -v ON_ERROR_STOP=1 -q < "$f"
done
echo "done."
