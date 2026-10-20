#!/usr/bin/env bash
# Load the webhook shared secret into n8n as the "Webhook secret" Header Auth credential
# (fixed id credWebhook000001, used by the authentication setting of all four webhooks). The value
# comes from Terraform state, is encrypted by n8n at rest and is never written into the repo.
#
#   ./scripts/n8n_webhook_credential.sh
set -euo pipefail
cd "$(dirname "$0")/.."

tf() { terraform -chdir=infra output -raw "$1"; }
IP="$(tf n8n_public_ip)"
KEY="loan-engine-n8n.pem"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

WEBHOOK_SECRET="$(tf webhook_secret)" python3 -I - > "$TMP" <<'PY'
import json, os
print(json.dumps([{"id": "credWebhook000001", "name": "Webhook secret", "type": "httpHeaderAuth",
                   "data": {"name": "X-Webhook-Secret", "value": os.environ["WEBHOOK_SECRET"]}}]))
PY

SSH_OPTS=(-i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)
scp "${SSH_OPTS[@]}" "$TMP" "ec2-user@$IP:/tmp/n8n_webhook_cred.json"
ssh "${SSH_OPTS[@]}" "ec2-user@$IP" '
  sudo docker cp /tmp/n8n_webhook_cred.json n8n:/tmp/n8n_webhook_cred.json
  sudo docker exec n8n n8n import:credentials --input=/tmp/n8n_webhook_cred.json 2>&1 | grep -v "license SDK"
  sudo docker exec n8n rm -f /tmp/n8n_webhook_cred.json; shred -u /tmp/n8n_webhook_cred.json 2>/dev/null || rm -f /tmp/n8n_webhook_cred.json
'
echo "Webhook credential imported. Call webhooks with:  -H \"X-Webhook-Secret: \$(terraform -chdir=infra output -raw webhook_secret)\""
