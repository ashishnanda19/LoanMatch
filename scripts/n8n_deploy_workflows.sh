#!/usr/bin/env bash
# Build the workflow JSON from n8n/code + n8n/sql, import all four workflows into the n8n host,
# publish them and restart n8n (n8n only registers new webhooks/triggers after a restart; this
# interrupts any run that is in flight, so do not run it in the middle of a crawl).
#
#   ./scripts/n8n_deploy_workflows.sh
#
# Needs: the n8n credentials to exist already (scripts/n8n_credentials.sh and
# scripts/n8n_ses_credential.sh), because the workflows reference them by fixed id.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 scripts/build_workflows.py

IP="$(terraform -chdir=infra output -raw n8n_public_ip)"
KEY="loan-engine-n8n.pem"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)

FILES=(R_lender_notes A_loan_product_discovery B_user_loan_matching C_match_notifications)
IDS=(workflowR0000001 workflowA0000001 workflowB0000001 workflowC0000001)

for f in "${FILES[@]}"; do
  scp "${SSH_OPTS[@]}" "n8n/workflows/$f.json" "ec2-user@$IP:/tmp/$f.json"
done

ssh "${SSH_OPTS[@]}" "ec2-user@$IP" "FILES='${FILES[*]}' IDS='${IDS[*]}' bash -s" <<'REMOTE'
set -e
# import everything first: A and B call R and C by id, so those must exist before publishing
for f in $FILES; do
  sudo docker cp "/tmp/$f.json" "n8n:/tmp/$f.json"
  sudo docker exec n8n n8n import:workflow --input="/tmp/$f.json" 2>&1 | grep -iE "success|error" || true
done
for id in $IDS; do
  sudo docker exec n8n n8n publish:workflow --id="$id" 2>&1 | grep -iE "publish|error" || true
done
sudo docker restart n8n >/dev/null
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/healthz)" = "200" ] && { echo "n8n is up."; exit 0; }
  sleep 3
done
echo "n8n did not come back within 90 s" >&2; exit 1
REMOTE

echo "Deployed. Webhooks: /webhook/batch-ready (B)  /webhook/crawl-now (A)  /webhook/review-now (R)  /webhook/notify-now (C)"
