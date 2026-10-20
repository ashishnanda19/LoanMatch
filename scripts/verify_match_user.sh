#!/usr/bin/env bash
# Proves the instant-match SQL function behind the web UI ("Check offers") returns EXACTLY the same top 5 as the
# set-based batch pipeline stored in `matches`. Samples N users (default 3000, ordered by user_id).
#
#   ./scripts/verify_match_user.sh [N]
set -euo pipefail
cd "$(dirname "$0")/.."
N="${1:-3000}"
export PGPASSWORD="$(terraform -chdir=infra output -raw db_password)"
CONN="host=$(terraform -chdir=infra output -raw db_host) dbname=$(terraform -chdir=infra output -raw db_name) user=$(terraform -chdir=infra output -raw db_user) sslmode=require"
docker run --rm -e PGPASSWORD postgres:16-alpine psql "$CONN" -v ON_ERROR_STOP=1 -c "
WITH s AS (SELECT * FROM users ORDER BY user_id LIMIT $N),
c AS (SELECT u.user_id,
        (SELECT array_agg(product_id ORDER BY match_rank) FROM matches m WHERE m.user_id = u.user_id) AS stored,
        (SELECT array_agg(product_id ORDER BY match_rank)
           FROM match_user(u.monthly_income, u.credit_score, u.age, u.employment_status, 5)) AS via_function
      FROM s u)
SELECT count(*) AS users_checked,
       count(*) FILTER (WHERE stored = via_function) AS identical,
       count(*) FILTER (WHERE stored IS DISTINCT FROM via_function) AS different
FROM c"
