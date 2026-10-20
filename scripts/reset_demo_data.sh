#!/usr/bin/env bash
# Prepare a clean live demo: removes the loaded users, their matches and the batch records, and
# keeps everything expensive to rebuild (lender products, cached lender notes, test-recipient mapping).
# The recipient mapping is keyed by user_id, so re-uploading the same CSV re-uses it.
#
#   ./scripts/reset_demo_data.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PGPASSWORD="$(terraform -chdir=infra output -raw db_password)"
CONN="host=$(terraform -chdir=infra output -raw db_host) dbname=$(terraform -chdir=infra output -raw db_name) user=$(terraform -chdir=infra output -raw db_user) sslmode=require"
docker run --rm -i -e PGPASSWORD postgres:16-alpine psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
DELETE FROM users;     -- cascades to matches and staging rows
DELETE FROM batches;
SELECT (SELECT count(*) FROM users)               AS users,
       (SELECT count(*) FROM matches)             AS matches,
       (SELECT count(*) FROM loan_products)       AS lenders_kept,
       (SELECT count(*) FROM qualitative_reviews) AS notes_kept,
       (SELECT count(*) FROM test_recipients)     AS test_recipients_kept;
SQL
