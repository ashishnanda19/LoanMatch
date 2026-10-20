#!/usr/bin/env bash
# Live progress of the qualitative-review run (Workflow A, "Plan reviews -> Loop over segments").
# Prints one line every INTERVAL seconds (default 15) until you press Ctrl-C or it reaches the target.
#
#   ./scripts/watch_reviews.sh            # refresh every 15 s
#   INTERVAL=5 ./scripts/watch_reviews.sh
set -euo pipefail
cd "$(dirname "$0")/.."

INTERVAL="${INTERVAL:-15}"
export PGPASSWORD="$(terraform -chdir=infra output -raw db_password)"
CONN="host=$(terraform -chdir=infra output -raw db_host) dbname=$(terraform -chdir=infra output -raw db_name) user=$(terraform -chdir=infra output -raw db_user) sslmode=require"

read -r -d '' SQL <<'SQL' || true
WITH seg AS (
  SELECT p.product_id, t.employment_type,
         md5('rv4|' || p.qualitative_criteria_text || E'\n' || coalesce(p.raw_criteria_text, '')) AS h
  FROM loan_products p
  CROSS JOIN LATERAL unnest(coalesce(p.allowed_employment_types, ARRAY['Salaried','Self-Employed','Business'])) AS t(employment_type)
  WHERE p.last_crawled_at > now() - interval '7 days' AND p.qualitative_criteria_text IS NOT NULL
)
SELECT count(*) FILTER (WHERE r.criteria_hash = seg.h)                                        AS done,
       count(*)                                                                               AS total,
       count(*) FILTER (WHERE r.criteria_hash = seg.h AND r.provider = 'llm_groq')            AS groq,
       count(*) FILTER (WHERE r.criteria_hash = seg.h AND r.provider = 'llm_gemini')          AS gemini,
       coalesce(to_char(max(r.reviewed_at) FILTER (WHERE r.criteria_hash = seg.h), 'HH24:MI:SS'), '-') AS last_save_utc
FROM seg LEFT JOIN qualitative_reviews r USING (product_id, employment_type)
SQL

start=$(date +%s)
while true; do
  row="$(docker run --rm -e PGPASSWORD postgres:16-alpine psql "$CONN" -At -F '|' -c "$SQL" 2>/dev/null || echo '||||')"
  IFS='|' read -r done_ total groq gemini last <<<"$row"
  if [ -n "${total:-}" ] && [ "${total:-0}" -gt 0 ] 2>/dev/null; then
    pct=$(( 100 * done_ / total )); filled=$(( pct / 4 )); bar=$(printf '%*s' "$filled" '' | tr ' ' '#')$(printf '%*s' "$((25 - filled))" '')
    printf '%s  [%s] %3d%%  %s/%s reviews  (groq %s, gemini %s)  last save %s UTC  elapsed %dm%02ds\n' \
      "$(date +%H:%M:%S)" "$bar" "$pct" "$done_" "$total" "$groq" "$gemini" "$last" $(( ($(date +%s)-start)/60 )) $(( ($(date +%s)-start)%60 ))
    [ "$done_" -ge "$total" ] && { echo "All reviews saved."; exit 0; }
  else
    echo "$(date +%H:%M:%S)  could not read progress (is Docker running and is your IP allowed on the database?)"
  fi
  sleep "$INTERVAL"
done
